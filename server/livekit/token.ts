import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import { aliasSchema, roomCredentialSchema, roomIdSchema } from '../../src/lib/signaling/messages';
import {
  issueRoomAccessToken,
  verifyRoomAccessToken,
  verifyRoomCredential,
  verifyRoomPassword,
} from '../roomCredentials';
import { clientKey, TokenRateLimiter } from './rateLimit';

export type LiveKitTokenOptions = {
  roomTokenSecret: string;
  apiKey: string;
  apiSecret: string;
  livekitUrl: string;
  tokenTtl: string;
};

const querySchema = z.object({
  roomId: roomIdSchema,
  credential: roomCredentialSchema,
  identity: z.string().uuid().optional(),
  displayName: aliasSchema.optional(),
  password: z.string().min(1).max(128).optional(),
  accessToken: z.string().min(1).max(1024).optional(),
});

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// GET /livekit/token — refaz a mesma verificação de convite/senha/token de acesso do
// fluxo WebSocket join-room (server/signaling.ts) e devolve um JWT do LiveKit. Sem
// estado: nenhuma sala é criada no servidor; o LiveKit cria a sala no primeiro join.
export function createLiveKitTokenHandler(options: LiveKitTokenOptions) {
  const limiter = new TokenRateLimiter();

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return json({ reason: 'invalid-invite' }, 400);
    const query = parsed.data;

    const key = clientKey(request, query.roomId);
    if (limiter.blocked(key)) return json({ reason: 'too-many-attempts' }, 429);

    const verified = verifyRoomCredential(options.roomTokenSecret, query.roomId, query.credential);
    if (!verified.ok) {
      limiter.fail(key);
      return json({ reason: 'invalid-invite' }, 403);
    }

    let accessToken: string | null = null;
    let accessTokenExpiresAt: number | null = null;
    if (verified.room.passwordProof) {
      const validToken = query.accessToken
        ? verifyRoomAccessToken(options.roomTokenSecret, query.roomId, query.accessToken)
        : null;
      if (validToken) {
        accessToken = query.accessToken ?? null;
        accessTokenExpiresAt = validToken.expiresAt;
      } else if (query.password && verifyRoomPassword(options.roomTokenSecret, verified.room, query.password)) {
        const issued = issueRoomAccessToken(options.roomTokenSecret, query.roomId);
        accessToken = issued.token;
        accessTokenExpiresAt = issued.expiresAt;
      } else {
        limiter.fail(key);
        return json({ reason: query.password ? 'wrong-password' : 'password-required' }, 403);
      }
    }

    const identity = query.identity ?? crypto.randomUUID();
    const token = new AccessToken(options.apiKey, options.apiSecret, {
      identity,
      name: query.displayName || undefined,
      ttl: options.tokenTtl,
    });
    token.addGrant({
      roomJoin: true,
      room: query.roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });

    return json(
      {
        token: await token.toJwt(),
        url: options.livekitUrl,
        identity,
        roomName: verified.room.roomName,
        passwordProtected: Boolean(verified.room.passwordProof),
        accessToken,
        accessTokenExpiresAt,
      },
      200,
    );
  };
}
