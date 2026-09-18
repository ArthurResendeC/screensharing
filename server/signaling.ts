import {
  clientMessageSchema,
  KICKED_CLOSE_CODE,
  MAX_WATCHED_STREAMS,
  type MediaProviderKind,
  type RoomRole,
  type RtPublication,
  type ServerMessage,
} from '../src/lib/signaling/messages';
import {
  generateRoomSecret,
  issueRoomAccessToken,
  issueRoomCredential,
  verifyRoomAccessToken,
  verifyRoomCredential,
  verifyRoomPassword,
} from './roomCredentials';
import type { RoomDb } from './roomDb';

export type SignalingSocket = {
  send(message: string): number;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): number;
  getBufferedAmount(): number;
};

type Subscription = { publisherId: string; sessionId: string };
export type Client = {
  id: string;
  socket?: SignalingSocket;
  roomId?: string;
  alias?: string;
  sharing: boolean;
  // Onde encontrar as tracks deste cliente no SFU Cloudflare (modo cloudflare).
  rtPublication?: RtPublication;
  watching: Map<string, Subscription>;
  alive: boolean;
  count: number;
  window: number;
  failedRoomAttempts: number;
  // Resolvidos uma vez no join e confiados pelo resto da conexão, igual ao accessToken.
  // `moderator` temporário existe só aqui: um Client novo nasce a cada upgrade de WS,
  // então a promoção temporária morre com a conexão — comportamento pretendido.
  role: RoomRole;
  memberId?: string;
};
type Room = {
  name: string;
  members: Map<string, Client>;
  mediaProvider: MediaProviderKind;
};

export type SignalingOptions = {
  db: RoomDb;
  maxRoomParticipants?: number;
  defaultMediaProvider?: MediaProviderKind;
  availableMediaProviders?: MediaProviderKind[];
};

export class SignalingHub {
  readonly rooms = new Map<string, Room>();
  readonly clients = new Set<Client>();

  private readonly db: RoomDb;
  private readonly maxRoomParticipants?: number;
  private readonly defaultMediaProvider: MediaProviderKind;
  private readonly availableMediaProviders: MediaProviderKind[];

  // maxRoomParticipants ausente = sem limite. Aplicado no join-room, que os dois
  // modos usam para presença.
  constructor(
    private readonly roomTokenSecret: string,
    options: SignalingOptions,
  ) {
    this.db = options.db;
    this.maxRoomParticipants = options.maxRoomParticipants;
    this.defaultMediaProvider = options.defaultMediaProvider ?? 'webrtc';
    this.availableMediaProviders = options.availableMediaProviders ?? [
      'webrtc',
    ];
  }

  createClient(): Client {
    return {
      id: crypto.randomUUID(),
      sharing: false,
      watching: new Map(),
      alive: true,
      count: 0,
      window: Date.now(),
      failedRoomAttempts: 0,
      role: 'guest',
    };
  }

  open(client: Client, socket: SignalingSocket) {
    client.socket = socket;
    if (this.clients.size >= 250) {
      socket.close(1013, 'Server full');
      return;
    }
    this.clients.add(client);
  }

  private send(client: Client, message: ServerMessage) {
    if (!client.socket) return;
    if (client.socket.getBufferedAmount() > 1024 * 1024) {
      client.socket.terminate();
      this.leave(client);
      return;
    }
    client.socket.send(JSON.stringify(message));
  }

  private participants(room: Room) {
    return [...room.members.values()].map(client => ({
      peerId: client.id,
      sharing: client.sharing,
      alias: client.alias ?? null,
      rt: client.rtPublication ?? null,
      // Só o papel derivado sai daqui. memberId e hostToken jamais entram em
      // broadcast: conhecer o memberId de alguém permitiria assumir o grant dessa
      // pessoa no próximo join.
      role: client.role,
    }));
  }

  private broadcast(room: Room) {
    const message: ServerMessage = {
      type: 'room-state',
      peers: this.participants(room),
    };
    for (const member of room.members.values()) this.send(member, message);
  }

  private unsubscribe(viewer: Client, room: Room, sessionId: string) {
    const subscription = viewer.watching.get(sessionId);
    if (!subscription) return;
    viewer.watching.delete(sessionId);
    this.send(viewer, {
      type: 'subscription-ended',
      peerId: subscription.publisherId,
      sessionId: subscription.sessionId,
    });
    const publisher = room.members.get(subscription.publisherId);
    if (publisher)
      this.send(publisher, {
        type: 'subscription-ended',
        peerId: viewer.id,
        sessionId: subscription.sessionId,
      });
  }

  private stopPublishing(publisher: Client, room: Room) {
    publisher.sharing = false;
    publisher.rtPublication = undefined;
    for (const viewer of room.members.values()) {
      for (const subscription of viewer.watching.values())
        if (subscription.publisherId === publisher.id)
          this.unsubscribe(viewer, room, subscription.sessionId);
    }
  }

  leave(client: Client) {
    this.clients.delete(client);
    const roomId = client.roomId;
    client.roomId = undefined;
    client.socket = undefined;
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room || !roomId) return;
    for (const sessionId of client.watching.keys())
      this.unsubscribe(client, room, sessionId);
    this.stopPublishing(client, room);
    room.members.delete(client.id);
    if (!room.members.size) this.rooms.delete(roomId);
    else this.broadcast(room);
  }

  pong(client: Client) {
    client.alive = true;
  }

  message(client: Client, data: string | BufferSource) {
    const fail = (message: string) =>
      this.send(client, { type: 'error', message });
    if (Date.now() - client.window > 1000) {
      client.window = Date.now();
      client.count = 0;
    }
    if (++client.count > 150) {
      client.socket?.close(1008, 'Rate limit');
      return;
    }
    let input: unknown;
    try {
      if (typeof data !== 'string') throw new Error();
      input = JSON.parse(data);
    } catch {
      fail('Mensagem inválida.');
      return;
    }
    const parsed = clientMessageSchema.safeParse(input);
    if (!parsed.success) {
      fail('Mensagem inválida.');
      return;
    }
    const message = parsed.data;
    if (message.type === 'ping') {
      this.send(client, { type: 'pong' });
      return;
    }
    if (message.type === 'create-room') {
      if (client.roomId) {
        fail('Saia da sala atual antes de criar outra.');
        return;
      }
      const roomId = crypto.randomUUID();
      // Dono e código de recuperação nascem com a sala e são entregues uma única vez;
      // o servidor guarda só os HMACs. A credencial de convite continua sendo a fonte
      // da verdade para nome e senha — nada disso é duplicado no banco.
      const hostToken = generateRoomSecret();
      const recoveryCode = generateRoomSecret();
      this.db.createRoom(roomId, hostToken, recoveryCode);
      this.send(client, {
        type: 'room-created',
        roomId,
        roomName: message.name,
        credential: issueRoomCredential(
          this.roomTokenSecret,
          roomId,
          message.name,
          message.password,
        ),
        passwordProtected: Boolean(message.password),
        hostToken,
        recoveryCode,
      });
      return;
    }
    if (message.type === 'join-room') {
      if (client.roomId) {
        fail('Você já está em uma sala.');
        return;
      }
      if (client.failedRoomAttempts >= 5) {
        this.send(client, {
          type: 'room-access-denied',
          reason: 'too-many-attempts',
        });
        client.socket?.close(1008, 'Too many room access attempts');
        return;
      }
      const verified = verifyRoomCredential(
        this.roomTokenSecret,
        message.roomId,
        message.credential,
      );
      if (!verified.ok) {
        client.failedRoomAttempts++;
        this.send(client, {
          type: 'room-access-denied',
          reason: verified.reason,
        });
        return;
      }
      let accessToken: string | null = null;
      let accessTokenExpiresAt: number | null = null;
      if (verified.room.passwordProof) {
        const access = message.accessToken
          ? verifyRoomAccessToken(
              this.roomTokenSecret,
              message.roomId,
              message.accessToken,
            )
          : null;
        if (access) {
          accessToken = message.accessToken ?? null;
          accessTokenExpiresAt = access.expiresAt;
        } else if (
          message.password &&
          verifyRoomPassword(
            this.roomTokenSecret,
            verified.room,
            message.password,
          )
        ) {
          const issued = issueRoomAccessToken(
            this.roomTokenSecret,
            message.roomId,
          );
          accessToken = issued.token;
          accessTokenExpiresAt = issued.expiresAt;
        } else {
          client.failedRoomAttempts++;
          this.send(client, {
            type: 'room-access-denied',
            reason: message.password ? 'wrong-password' : 'password-required',
          });
          return;
        }
      }
      // A linha da sala pode não existir: salas abertas de um convite salvo de antes
      // deste recurso nunca tiveram uma. Isso é o caso normal logo após o rollout, não
      // uma exceção — quem resolve é `claim-host`, não uma criação silenciosa aqui.
      const persisted = this.db.getRoom(message.roomId);
      const memberId = message.memberId ?? crypto.randomUUID();
      client.memberId = memberId;
      client.role = !persisted
        ? 'guest'
        : message.hostToken &&
            this.db.verifyHostToken(message.roomId, message.hostToken)
          ? 'host'
          : this.db.isActiveModerator(message.roomId, memberId)
            ? 'moderator'
            : 'guest';
      if (persisted) this.db.touchRoom(message.roomId);
      let room = this.rooms.get(message.roomId);
      if (!room) {
        room = {
          name: verified.room.roomName,
          members: new Map(),
          mediaProvider: persisted?.mediaProvider ?? this.defaultMediaProvider,
        };
        this.rooms.set(message.roomId, room);
      } else if (persisted?.mediaProvider)
        room.mediaProvider = persisted.mediaProvider;
      if (
        this.maxRoomParticipants &&
        room.members.size >= this.maxRoomParticipants
      ) {
        fail(
          `Sala cheia: limite de ${this.maxRoomParticipants} participantes.`,
        );
        return;
      }
      // A reconnecting client reclaims its previous identity so peers can resume their
      // subscriptions after a redeploy or network blip drops the socket. Only the
      // originating tab ever knows its own clientId, so a collision here always means
      // the existing member is a stale connection the heartbeat hasn't reaped yet —
      // evict it immediately instead of leaving both entries visible as "duplicate"
      // participants until the next heartbeat cycle.
      if (message.clientId) {
        const stale = room.members.get(message.clientId);
        if (stale && stale !== client) {
          room.members.delete(stale.id);
          for (const sessionId of stale.watching.keys())
            this.unsubscribe(stale, room, sessionId);
          this.stopPublishing(stale, room);
          this.clients.delete(stale);
          stale.roomId = undefined;
          stale.socket?.close(4001, 'Reconectado em outra sessão.');
          stale.socket = undefined;
        }
        client.id = message.clientId;
      }
      client.roomId = message.roomId;
      room.members.set(client.id, client);
      this.send(client, {
        type: 'joined',
        roomId: message.roomId,
        roomName: room.name,
        passwordProtected: Boolean(verified.room.passwordProof),
        accessToken,
        accessTokenExpiresAt,
        peerId: client.id,
        role: client.role,
        memberId,
        mediaProvider: room.mediaProvider,
        hostClaimable: !persisted,
        peers: this.participants(room),
      });
      this.broadcast(room);
      return;
    }
    const room = client.roomId ? this.rooms.get(client.roomId) : undefined;
    if (!room) {
      fail('Entre em uma sala primeiro.');
      return;
    }
    if (
      message.type === 'sharing-started' ||
      message.type === 'sharing-stopped'
    ) {
      if (message.type === 'sharing-started') client.sharing = true;
      else this.stopPublishing(client, room);
      this.broadcast(room);
      return;
    }
    if (message.type === 'rt-publish') {
      client.sharing = true;
      client.rtPublication = {
        sessionId: message.sessionId,
        video: message.video,
        audio: message.audio,
      };
      this.broadcast(room);
      return;
    }
    if (message.type === 'rt-unpublish') {
      this.stopPublishing(client, room);
      this.broadcast(room);
      return;
    }
    if (message.type === 'set-alias') {
      const alias = message.alias || undefined;
      if (client.alias === alias) return;
      client.alias = alias;
      this.broadcast(room);
      return;
    }
    if (message.type === 'watch') {
      if (!message.targetPeerId) {
        this.unsubscribe(client, room, message.sessionId);
        this.send(client, {
          type: 'watching',
          peerId: null,
          sessionId: message.sessionId,
        });
        return;
      }
      const publisher = message.targetPeerId
        ? room.members.get(message.targetPeerId)
        : undefined;
      const duplicateSession = [...room.members.values()].some(member =>
        member.watching.has(message.sessionId),
      );
      const duplicatePublisher = [...client.watching.values()].some(
        item => item.publisherId === message.targetPeerId,
      );
      if (
        !publisher?.sharing ||
        publisher === client ||
        duplicateSession ||
        duplicatePublisher ||
        client.watching.size >= MAX_WATCHED_STREAMS
      ) {
        this.send(client, {
          type: 'watching',
          peerId: null,
          sessionId: message.sessionId,
        });
        fail('Transmissão indisponível ou seleção inválida.');
        return;
      }
      this.send(client, {
        type: 'watching',
        peerId: publisher?.id ?? null,
        sessionId: message.sessionId,
      });
      if (publisher) {
        client.watching.set(message.sessionId, {
          publisherId: publisher.id,
          sessionId: message.sessionId,
        });
        this.send(publisher, {
          type: 'subscriber-joined',
          peerId: client.id,
          sessionId: message.sessionId,
        });
      }
      return;
    }
    const roomId = client.roomId!;
    if (message.type === 'claim-host') {
      // Salas criadas antes deste recurso não têm linha nem hostToken, então ninguém
      // pode ser dono. Reivindicar é a única ponte: transforma a corrida invisível de
      // "quem reconectou primeiro depois do deploy" numa corrida explícita e opcional.
      const hostToken = generateRoomSecret();
      const recoveryCode = generateRoomSecret();
      if (
        this.db.getRoom(roomId) ||
        !this.db.createRoom(roomId, hostToken, recoveryCode)
      ) {
        fail('Esta sala já tem um dono.');
        return;
      }
      client.role = 'host';
      this.send(client, { type: 'host-claimed', hostToken, recoveryCode });
      this.broadcast(room);
      return;
    }
    if (message.type === 'set-room-media-provider') {
      if (client.role === 'guest') {
        fail('Só o dono ou moderadores podem trocar o transporte de mídia.');
        return;
      }
      if (!this.availableMediaProviders.includes(message.provider)) {
        fail('Este servidor não tem esse transporte de mídia configurado.');
        return;
      }
      if (room.mediaProvider === message.provider) return;
      if (!this.db.setMediaProvider(roomId, message.provider)) {
        fail(
          'Reivindique o controle da sala antes de alterar as configurações.',
        );
        return;
      }
      room.mediaProvider = message.provider;
      // Vai para todo mundo, inclusive quem enviou: mesh e SFU são transportes
      // estruturalmente diferentes, então cada cliente derruba o provedor atual e
      // reconecta com o novo. Não há como trocar a quente.
      const changed: ServerMessage = {
        type: 'room-settings-changed',
        mediaProvider: message.provider,
      };
      for (const member of room.members.values()) this.send(member, changed);
      return;
    }
    if (
      message.type === 'grant-moderator' ||
      message.type === 'revoke-moderator' ||
      message.type === 'kick-peer'
    ) {
      // Autorizado só pelo client.role já resolvido no join, como `sharing-started`
      // confia no estado do hub: nenhum segredo é reapresentado por ação.
      const allowed =
        message.type === 'kick-peer'
          ? client.role !== 'guest'
          : client.role === 'host';
      if (!allowed) {
        fail(
          message.type === 'kick-peer'
            ? 'Só o dono ou moderadores podem remover participantes.'
            : 'Só o dono da sala pode alterar moderadores.',
        );
        return;
      }
      const subject = room.members.get(message.targetPeerId);
      if (!subject || subject === client) {
        fail('Destino inválido.');
        return;
      }
      if (subject.role === 'host') {
        fail('O dono da sala não pode ser removido nem rebaixado.');
        return;
      }
      this.db.touchRoom(roomId);
      if (message.type === 'kick-peer') {
        this.send(subject, {
          type: 'kicked',
          by: client.role === 'host' ? 'host' : 'moderator',
        });
        subject.socket?.close(KICKED_CLOSE_CODE, 'Removido da sala');
        this.leave(subject);
        return;
      }
      if (message.type === 'grant-moderator') {
        // Permanente grava o hash do memberId; temporário fica só no Client e some
        // no próximo disconnect, por design.
        subject.role = 'moderator';
        if (
          message.permanent &&
          subject.memberId &&
          !this.db.grantModerator(roomId, subject.memberId)
        )
          fail(
            'Esta sala não está mais registrada: a moderação vale só nesta sessão.',
          );
      } else {
        if (subject.memberId) this.db.revokeModerator(roomId, subject.memberId);
        subject.role = 'guest';
      }
      this.broadcast(room);
      return;
    }
    const target = room.members.get(message.targetPeerId);
    if (!target || target === client) {
      fail('Destino inválido.');
      return;
    }
    const targetSubscription = target.watching.get(message.sessionId);
    const clientSubscription = client.watching.get(message.sessionId);
    const sending =
      client.sharing && targetSubscription?.publisherId === client.id;
    const receiving =
      target.sharing && clientSubscription?.publisherId === target.id;
    const authorized =
      message.type === 'offer'
        ? sending
        : message.type === 'answer'
          ? receiving
          : sending || receiving;
    if (!authorized) return;
    const { targetPeerId: _target, ...payload } = message;
    void _target;
    this.send(target, { ...payload, peerId: client.id });
  }

  // A revogação pelo endpoint HTTP conhece só o hash do memberId (o valor cru nunca é
  // guardado), então o rebaixamento ao vivo compara pelo hash.
  demoteModeratorByHash(roomId: string, memberIdHash: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    let changed = false;
    for (const member of room.members.values()) {
      if (
        member.role !== 'moderator' ||
        !member.memberId ||
        this.db.hashMemberId(member.memberId) !== memberIdHash
      )
        continue;
      member.role = 'guest';
      changed = true;
    }
    if (changed) this.broadcast(room);
  }

  pruneStaleRooms(retentionDays: number) {
    return this.db.pruneStaleRooms(retentionDays);
  }

  heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) {
        client.socket?.terminate();
        this.leave(client);
        continue;
      }
      client.alive = false;
      client.socket?.ping();
    }
  }

  close() {
    // 1012 = service restart: tells clients this is a redeploy, not a lost connection.
    for (const client of this.clients)
      client.socket?.close(1012, 'Server restarting');
    this.clients.clear();
    this.rooms.clear();
  }
}
