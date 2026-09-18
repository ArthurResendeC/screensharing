import { z } from 'zod';
import { roomIdSchema, roomSecretSchema } from '../src/lib/signaling/messages';
import { clientKey, TokenRateLimiter } from './realtime/rateLimit';
import { generateRoomSecret } from './roomCredentials';
import type { RoomDb } from './roomDb';

// Rotas HTTP de administração da sala. Existem fora do WebSocket porque as duas
// operações abaixo precisam funcionar sem estar conectado: listar/revogar moderadores
// que estão offline e recuperar o controle de um navegador que perdeu o hostToken.
//
// As três reusam o TokenRateLimiter do proxy Realtime (mesma contagem por IP+sala).
// Isso é crítico em /recover: é o único endpoint autenticado por um segredo que a
// pessoa copia e cola, e não por um token de 192 bits apresentado pela máquina.

const recoverBodySchema = z.object({ recoveryCode: roomSecretSchema }).strict();

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return roomSecretSchema.safeParse(token).success ? token : null;
}

export function createRoomAdminRoutes(options: {
  db: RoomDb;
  // Revogar pelo HTTP também precisa rebaixar a conexão ao vivo, se houver: o papel
  // é resolvido uma vez no join e ficaria "moderator" até a pessoa reconectar.
  onModeratorRevoked?: (roomId: string, memberIdHash: string) => void;
}) {
  const { db, onModeratorRevoked } = options;
  const limiter = new TokenRateLimiter();

  // Autentica o host por hostToken. Devolve sempre a mesma resposta para sala
  // inexistente e token errado: quem não tem o segredo não descobre se a sala existe.
  function asHost(request: Request, rawRoomId: string) {
    const roomId = roomIdSchema.safeParse(rawRoomId);
    if (!roomId.success)
      return {
        ok: false as const,
        response: json({ error: 'not-found' }, 404),
      };
    const key = clientKey(request, roomId.data);
    if (limiter.blocked(key))
      return {
        ok: false as const,
        response: json({ error: 'rate-limited' }, 429),
      };
    const token = bearer(request);
    if (!token || !db.verifyHostToken(roomId.data, token)) {
      limiter.fail(key);
      return {
        ok: false as const,
        response: json({ error: 'unauthorized' }, 401),
      };
    }
    return { ok: true as const, roomId: roomId.data };
  }

  return {
    listModerators(request: Request, rawRoomId: string): Response {
      const auth = asHost(request, rawRoomId);
      if (!auth.ok) return auth.response;
      // `id` é o handle opaco de room_moderators, nunca o memberId.
      return json({ moderators: db.listModerators(auth.roomId) });
    },

    revokeModerator(request: Request, rawRoomId: string, id: string): Response {
      const auth = asHost(request, rawRoomId);
      if (!auth.ok) return auth.response;
      const memberIdHash = db.revokeModeratorById(auth.roomId, id);
      if (!memberIdHash) return json({ error: 'not-found' }, 404);
      onModeratorRevoked?.(auth.roomId, memberIdHash);
      return new Response(null, { status: 204 });
    },

    async recover(request: Request, rawRoomId: string): Promise<Response> {
      const roomId = roomIdSchema.safeParse(rawRoomId);
      if (!roomId.success) return json({ error: 'unauthorized' }, 401);
      const key = clientKey(request, roomId.data);
      if (limiter.blocked(key)) return json({ error: 'rate-limited' }, 429);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        limiter.fail(key);
        return json({ error: 'unauthorized' }, 401);
      }
      const parsed = recoverBodySchema.safeParse(body);
      if (
        !parsed.success ||
        !db.verifyRecoveryCode(roomId.data, parsed.data.recoveryCode)
      ) {
        limiter.fail(key);
        // Deliberadamente o mesmo 401 de "sala não existe": um código errado não
        // revela se a sala existe, senão o endpoint viraria um oráculo de roomIds.
        return json({ error: 'unauthorized' }, 401);
      }
      // Uso único: os dois segredos giram juntos, então um código de recuperação
      // exposto (colado em algum log) para de valer no instante em que é usado.
      const hostToken = generateRoomSecret();
      const recoveryCode = generateRoomSecret();
      if (!db.rotateHostCredentials(roomId.data, hostToken, recoveryCode))
        return json({ error: 'unauthorized' }, 401);
      return json({ hostToken, recoveryCode });
    },
  };
}
