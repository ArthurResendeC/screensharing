import { z } from 'zod';
import {
  roomCredentialSchema,
  roomIdSchema,
} from '../../../lib/signaling/messages';

// Respostas do proxy /realtime/* (que repassa o SFU Cloudflare Realtime). O App
// Secret fica no servidor; o cliente só fala com a mesma origem.
const sdpSchema = z
  .object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1) })
  .strict();

const iceServerSchema = z
  .object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
  .strict();
const sessionSchema = z
  .object({
    sessionId: z.string().min(1),
    answer: sdpSchema.nullable(),
    ticket: z.string().min(1),
    iceServers: z.array(iceServerSchema),
  })
  .strict();
export type RealtimeSession = {
  sessionId: string;
  answer: RTCSessionDescriptionInit | null;
  ticket: string;
  iceServers: RTCIceServer[];
};

const trackResultSchema = z.object({
  mid: z.string().optional(),
  trackName: z.string().optional(),
  sessionId: z.string().optional(),
  errorCode: z.string().optional(),
  errorDescription: z.string().optional(),
});
const tracksResponseSchema = z.object({
  requiresImmediateRenegotiation: z.boolean().optional(),
  sessionDescription: sdpSchema.optional(),
  tracks: z.array(trackResultSchema).optional(),
  errorCode: z.string().optional(),
});
export type TracksResponse = z.infer<typeof tracksResponseSchema>;

export type TrackRequest =
  | { location: 'local'; mid: string; trackName: string }
  | { location: 'remote'; sessionId: string; trackName: string };

export type RealtimeAccessReason =
  | 'invalid-invite'
  | 'password-required'
  | 'wrong-password'
  | 'too-many-attempts'
  | 'session-gone'
  | 'not-ready'
  | 'unavailable';

export class RealtimeError extends Error {
  constructor(
    readonly reason: RealtimeAccessReason,
    readonly status: number,
  ) {
    super(reason);
    this.name = 'RealtimeError';
  }
}

const accessReasonSchema = z.object({
  reason: z.enum([
    'invalid-invite',
    'password-required',
    'wrong-password',
    'too-many-attempts',
  ]),
});

async function send(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
): Promise<Response> {
  try {
    return await fetch(new URL(path, location.href), {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new RealtimeError('unavailable', 0);
  }
}

function fail(response: Response): never {
  if (response.status === 429)
    throw new RealtimeError('too-many-attempts', 429);
  // The SFU GCs a session after ~30s with no media; the caller re-establishes.
  if (response.status === 404) throw new RealtimeError('session-gone', 404);
  throw new RealtimeError('unavailable', response.status);
}

export async function createRealtimeSession(params: {
  roomId: string;
  credential: string;
  password?: string;
  accessToken?: string;
}): Promise<RealtimeSession> {
  const parsed = z
    .object({ roomId: roomIdSchema, credential: roomCredentialSchema })
    .safeParse(params);
  if (!parsed.success) throw new RealtimeError('invalid-invite', 400);

  const response = await send('POST', '/realtime/session', {
    roomId: params.roomId,
    credential: params.credential,
    ...(params.password ? { password: params.password } : {}),
    ...(params.accessToken ? { accessToken: params.accessToken } : {}),
  });
  if (!response.ok) {
    if (response.status === 403) {
      const body = accessReasonSchema.safeParse(
        await response.json().catch(() => null),
      );
      throw new RealtimeError(
        body.success ? body.data.reason : 'invalid-invite',
        403,
      );
    }
    fail(response);
  }
  const data = sessionSchema.safeParse(await response.json().catch(() => null));
  if (!data.success) throw new RealtimeError('unavailable', response.status);
  return data.data;
}

export async function realtimeTracksNew(
  ticket: string,
  body: {
    sessionDescription?: RTCSessionDescriptionInit;
    tracks: TrackRequest[];
  },
): Promise<TracksResponse> {
  const response = await send('POST', '/realtime/tracks/new', {
    ticket,
    ...(body.sessionDescription
      ? {
          sessionDescription: {
            type: 'offer',
            sdp: body.sessionDescription.sdp,
          },
        }
      : {}),
    tracks: body.tracks,
  });
  if (!response.ok) fail(response);
  const data = tracksResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!data.success || data.data.errorCode)
    throw new RealtimeError('unavailable', response.status);
  return data.data;
}

export async function realtimeRenegotiate(
  ticket: string,
  answer: RTCSessionDescriptionInit,
): Promise<void> {
  const response = await send('PUT', '/realtime/renegotiate', {
    ticket,
    sessionDescription: { type: 'answer', sdp: answer.sdp },
  });
  if (!response.ok) fail(response);
}

export async function realtimeTracksClose(
  ticket: string,
  mids: string[],
): Promise<void> {
  if (!mids.length) return;
  const response = await send('PUT', '/realtime/tracks/close', {
    ticket,
    tracks: mids.map(mid => ({ mid })),
    force: true,
  });
  if (!response.ok) fail(response);
}
