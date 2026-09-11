import { z } from 'zod';
import {
  roomCredentialSchema,
  roomIdSchema,
} from '../../src/lib/signaling/messages';
import {
  issueRealtimeTicket,
  verifyRealtimeTicket,
  verifyRoomAccessToken,
  verifyRoomCredential,
  verifyRoomPassword,
} from '../roomCredentials';
import { clientKey, TokenRateLimiter } from './rateLimit';

export type RealtimeProxyOptions = {
  roomTokenSecret: string;
  appId: string;
  appSecret: string;
  iceServers: RTCIceServer[];
};

const CF_BASE = 'https://rtc.live.cloudflare.com/v1';

const sessionDescriptionSchema = z
  .object({
    type: z.enum(['offer', 'answer']),
    sdp: z.string().min(1).max(64_000),
  })
  .strict();

// Objetos de track do Cloudflare (subconjunto que o cliente envia).
const trackSchema = z
  .object({
    location: z.enum(['local', 'remote']),
    mid: z.string().max(64).optional(),
    sessionId: z.string().max(128).optional(),
    trackName: z.string().max(128).optional(),
  })
  .strict();

const closeTrackSchema = z.object({ mid: z.string().max(64) }).strict();

const sessionRequestSchema = z
  .object({
    roomId: roomIdSchema,
    credential: roomCredentialSchema,
    password: z.string().min(1).max(128).optional(),
    accessToken: z.string().min(1).max(1024).optional(),
    // O cliente cria a sessão sem offer; a primeira operação de track estabelece o PC.
    offer: sessionDescriptionSchema.optional(),
  })
  .strict();

const tracksNewSchema = z
  .object({
    ticket: z.string().min(1).max(2048),
    sessionDescription: sessionDescriptionSchema.optional(),
    tracks: z.array(trackSchema).min(1).max(16),
  })
  .strict();

const renegotiateSchema = z
  .object({
    ticket: z.string().min(1).max(2048),
    sessionDescription: sessionDescriptionSchema,
  })
  .strict();

const tracksCloseSchema = z
  .object({
    ticket: z.string().min(1).max(2048),
    tracks: z.array(closeTrackSchema).min(1).max(16),
    force: z.boolean().optional(),
  })
  .strict();

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// Proxy sem estado para o SFU Cloudflare Realtime. O App Secret nunca chega ao
// navegador; a autorização de sala é feita uma vez em /realtime/session e depois
// carregada num ticket HMAC. A sinalização de presença continua no WebSocket.
export function createRealtimeProxy(options: RealtimeProxyOptions) {
  const limiter = new TokenRateLimiter();
  const bearer = { authorization: `Bearer ${options.appSecret}` };
  const jsonAuth = { ...bearer, 'content-type': 'application/json' };

  // body === undefined → sem corpo (o /sessions/new do Cloudflare recusa "{}").
  async function cf(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    let upstream: Response;
    try {
      upstream = await fetch(`${CF_BASE}/apps/${options.appId}${path}`, {
        method,
        headers: body === undefined ? bearer : jsonAuth,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return json({ reason: 'sfu-unavailable' }, 502);
    }
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.ok ? 200 : upstream.status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  }

  async function readBody<T>(
    request: Request,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    try {
      return schema.parse(await request.json());
    } catch {
      return null;
    }
  }

  async function createSession(request: Request): Promise<Response> {
    const body = await readBody(request, sessionRequestSchema);
    if (!body) return json({ reason: 'invalid-invite' }, 400);

    const key = clientKey(request, body.roomId);
    if (limiter.blocked(key)) return json({ reason: 'too-many-attempts' }, 429);

    const verified = verifyRoomCredential(
      options.roomTokenSecret,
      body.roomId,
      body.credential,
    );
    if (!verified.ok) {
      limiter.fail(key);
      return json({ reason: 'invalid-invite' }, 403);
    }
    if (verified.room.passwordProof) {
      const validToken = body.accessToken
        ? verifyRoomAccessToken(
            options.roomTokenSecret,
            body.roomId,
            body.accessToken,
          )
        : null;
      const validPassword =
        body.password &&
        verifyRoomPassword(
          options.roomTokenSecret,
          verified.room,
          body.password,
        );
      if (!validToken && !validPassword) {
        limiter.fail(key);
        return json(
          { reason: body.password ? 'wrong-password' : 'password-required' },
          403,
        );
      }
    }

    const upstream = await cf(
      '/sessions/new',
      'POST',
      body.offer ? { sessionDescription: body.offer } : undefined,
    );
    if (!upstream.ok) return upstream;
    const created = z
      .object({
        sessionId: z.string().min(1),
        sessionDescription: sessionDescriptionSchema.optional(),
      })
      .safeParse(await upstream.json());
    if (!created.success) return json({ reason: 'sfu-error' }, 502);

    return json(
      {
        sessionId: created.data.sessionId,
        answer: created.data.sessionDescription ?? null,
        ticket: issueRealtimeTicket(
          options.roomTokenSecret,
          body.roomId,
          created.data.sessionId,
        ),
        iceServers: options.iceServers,
      },
      200,
    );
  }

  function sessionOf(ticket: string): string | null {
    return (
      verifyRealtimeTicket(options.roomTokenSecret, ticket)?.sessionId ?? null
    );
  }

  return async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method === 'POST' && path === '/realtime/session')
      return createSession(request);

    if (request.method === 'POST' && path === '/realtime/tracks/new') {
      const body = await readBody(request, tracksNewSchema);
      if (!body) return json({ reason: 'invalid-request' }, 400);
      const sessionId = sessionOf(body.ticket);
      if (!sessionId) return json({ reason: 'expired' }, 401);
      return cf(`/sessions/${sessionId}/tracks/new`, 'POST', {
        ...(body.sessionDescription
          ? { sessionDescription: body.sessionDescription }
          : {}),
        tracks: body.tracks,
      });
    }

    if (request.method === 'PUT' && path === '/realtime/renegotiate') {
      const body = await readBody(request, renegotiateSchema);
      if (!body) return json({ reason: 'invalid-request' }, 400);
      const sessionId = sessionOf(body.ticket);
      if (!sessionId) return json({ reason: 'expired' }, 401);
      return cf(`/sessions/${sessionId}/renegotiate`, 'PUT', {
        sessionDescription: body.sessionDescription,
      });
    }

    if (request.method === 'PUT' && path === '/realtime/tracks/close') {
      const body = await readBody(request, tracksCloseSchema);
      if (!body) return json({ reason: 'invalid-request' }, 400);
      const sessionId = sessionOf(body.ticket);
      if (!sessionId) return json({ reason: 'expired' }, 401);
      return cf(`/sessions/${sessionId}/tracks/close`, 'PUT', {
        tracks: body.tracks,
        force: body.force ?? true,
      });
    }

    return json({ reason: 'not-found' }, 404);
  };
}
