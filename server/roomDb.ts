import { Database } from 'bun:sqlite';
import type { MediaProviderKind } from '../src/lib/signaling/messages';
import { hashRoomSecret, verifyRoomSecret } from './roomCredentials';

// Persistência de dono/moderadores/transporte por sala. `bun:sqlite` vem embutido no
// Bun, então não há dependência nova nem ORM — duas tabelas não justificam framework
// de migração, só `CREATE TABLE IF NOT EXISTS` no boot.
//
// Tudo o que é segredo portador (hostToken, recoveryCode, memberId) fica guardado só
// como HMAC com o mesmo ROOM_TOKEN_SECRET que `roomCredentials.ts` já usa: um arquivo
// SQLite roubado não entrega credencial utilizável. Nome e prova de senha continuam
// dentro da credencial assinada do convite, sem duplicação aqui.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  room_id            TEXT PRIMARY KEY,
  host_token_hash    TEXT NOT NULL,
  recovery_code_hash TEXT NOT NULL,
  media_provider     TEXT,
  created_at         INTEGER NOT NULL,
  last_active_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_moderators (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  member_id_hash TEXT NOT NULL,
  granted_at     INTEGER NOT NULL,
  revoked_at     INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS room_moderators_active_member
  ON room_moderators(room_id, member_id_hash) WHERE revoked_at IS NULL;
`;

export type PersistedRoom = {
  roomId: string;
  mediaProvider: MediaProviderKind | null;
  createdAt: number;
  lastActiveAt: number;
};

export type ModeratorGrant = { id: string; grantedAt: number };

type RoomRow = {
  room_id: string;
  host_token_hash: string;
  recovery_code_hash: string;
  media_provider: string | null;
  created_at: number;
  last_active_at: number;
};

function toRoom(row: RoomRow): PersistedRoom {
  return {
    roomId: row.room_id,
    mediaProvider:
      row.media_provider === 'cloudflare' || row.media_provider === 'webrtc'
        ? row.media_provider
        : null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

export class RoomDb {
  private readonly db: Database;

  constructor(
    private readonly secret: string,
    path = ':memory:',
  ) {
    this.db = new Database(path, { create: true });
    // WAL mantém leitura e escrita concorrentes na única réplica; ignorado em memória.
    this.db.run('PRAGMA journal_mode = WAL');
    // Sem isto o ON DELETE CASCADE de room_moderators não roda: o SQLite desliga FKs
    // por padrão, e a varredura de retenção deixaria grants órfãos para trás.
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run(SCHEMA);
  }

  // Cria a linha da sala. INSERT OR IGNORE: dois `claim-host` simultâneos não podem
  // criar duas donas — quem perde recebe `false` e continua guest.
  createRoom(
    roomId: string,
    hostToken: string,
    recoveryCode: string,
    now = Date.now(),
  ): boolean {
    const result = this.db
      .query(
        `INSERT OR IGNORE INTO rooms
           (room_id, host_token_hash, recovery_code_hash, media_provider, created_at, last_active_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        roomId,
        hashRoomSecret(this.secret, hostToken),
        hashRoomSecret(this.secret, recoveryCode),
        now,
        now,
      );
    return result.changes === 1;
  }

  getRoom(roomId: string): PersistedRoom | null {
    const row = this.row(roomId);
    return row ? toRoom(row) : null;
  }

  touchRoom(roomId: string, now = Date.now()): void {
    this.db
      .query('UPDATE rooms SET last_active_at = ? WHERE room_id = ?')
      .run(now, roomId);
  }

  setMediaProvider(
    roomId: string,
    provider: MediaProviderKind,
    now = Date.now(),
  ): boolean {
    const result = this.db
      .query(
        'UPDATE rooms SET media_provider = ?, last_active_at = ? WHERE room_id = ?',
      )
      .run(provider, now, roomId);
    return result.changes === 1;
  }

  verifyHostToken(roomId: string, hostToken: string): boolean {
    const row = this.row(roomId);
    return Boolean(
      row && verifyRoomSecret(this.secret, hostToken, row.host_token_hash),
    );
  }

  verifyRecoveryCode(roomId: string, recoveryCode: string): boolean {
    const row = this.row(roomId);
    return Boolean(
      row &&
      verifyRoomSecret(this.secret, recoveryCode, row.recovery_code_hash),
    );
  }

  // Recuperação é de uso único: ambos os segredos giram juntos, então um código
  // vazado para de valer no instante em que é usado.
  rotateHostCredentials(
    roomId: string,
    hostToken: string,
    recoveryCode: string,
    now = Date.now(),
  ): boolean {
    const result = this.db
      .query(
        `UPDATE rooms
            SET host_token_hash = ?, recovery_code_hash = ?, last_active_at = ?
          WHERE room_id = ?`,
      )
      .run(
        hashRoomSecret(this.secret, hostToken),
        hashRoomSecret(this.secret, recoveryCode),
        now,
        roomId,
      );
    return result.changes === 1;
  }

  // Grant permanente. Moderador temporário nunca chega aqui: vive só no Client em
  // memória e some junto com a conexão, por design.
  //
  // Devolve null quando a sala não tem mais linha (a varredura de retenção passou por
  // ela no meio da sessão). Sem isto o INSERT violaria a foreign key e explodiria no
  // meio do tratamento da mensagem.
  grantModerator(
    roomId: string,
    memberId: string,
    now = Date.now(),
  ): string | null {
    if (!this.row(roomId)) return null;
    const hash = hashRoomSecret(this.secret, memberId);
    const existing = this.db
      .query<{ id: string }, [string, string]>(
        'SELECT id FROM room_moderators WHERE room_id = ? AND member_id_hash = ? AND revoked_at IS NULL',
      )
      .get(roomId, hash);
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    this.db
      .query(
        'INSERT INTO room_moderators (id, room_id, member_id_hash, granted_at) VALUES (?, ?, ?, ?)',
      )
      .run(id, roomId, hash, now);
    return id;
  }

  revokeModerator(roomId: string, memberId: string, now = Date.now()): boolean {
    const result = this.db
      .query(
        'UPDATE room_moderators SET revoked_at = ? WHERE room_id = ? AND member_id_hash = ? AND revoked_at IS NULL',
      )
      .run(now, roomId, hashRoomSecret(this.secret, memberId));
    return result.changes > 0;
  }

  // Revogação pelo handle opaco que o host vê na listagem. Devolve o hash do membro
  // para o hub rebaixar a conexão ao vivo correspondente, se houver — o memberId cru
  // nunca é guardado, então o hash é o único elo possível.
  revokeModeratorById(
    roomId: string,
    id: string,
    now = Date.now(),
  ): string | null {
    const row = this.db
      .query<{ member_id_hash: string }, [string, string]>(
        'SELECT member_id_hash FROM room_moderators WHERE room_id = ? AND id = ? AND revoked_at IS NULL',
      )
      .get(roomId, id);
    if (!row) return null;
    this.db
      .query('UPDATE room_moderators SET revoked_at = ? WHERE id = ?')
      .run(now, id);
    return row.member_id_hash;
  }

  listModerators(roomId: string): ModeratorGrant[] {
    return this.db
      .query<{ id: string; granted_at: number }, [string]>(
        'SELECT id, granted_at FROM room_moderators WHERE room_id = ? AND revoked_at IS NULL ORDER BY granted_at',
      )
      .all(roomId)
      .map(row => ({ id: row.id, grantedAt: row.granted_at }));
  }

  isActiveModerator(roomId: string, memberId: string): boolean {
    return Boolean(
      this.db
        .query<{ id: string }, [string, string]>(
          'SELECT id FROM room_moderators WHERE room_id = ? AND member_id_hash = ? AND revoked_at IS NULL',
        )
        .get(roomId, hashRoomSecret(this.secret, memberId)),
    );
  }

  hashMemberId(memberId: string): string {
    return hashRoomSecret(this.secret, memberId);
  }

  // Salas agora sobrevivem à sala vazia e ao redeploy, então precisam de teto: sem
  // isto toda sala descartável criada acumula para sempre. `last_active_at` sobe em
  // todo join e toda ação de host/moderador, então só o abandono real expira.
  pruneStaleRooms(retentionDays: number, now = Date.now()): number {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    // RETURNING em vez de `changes`: o cascade para room_moderators também conta em
    // `changes`, o que faria o retorno parecer um número de salas sem ser.
    return this.db
      .query<{ room_id: string }, [number]>(
        'DELETE FROM rooms WHERE last_active_at < ? RETURNING room_id',
      )
      .all(cutoff).length;
  }

  close(): void {
    this.db.close();
  }

  private row(roomId: string) {
    return (
      this.db
        .query<RoomRow, [string]>('SELECT * FROM rooms WHERE room_id = ?')
        .get(roomId) ?? null
    );
  }
}
