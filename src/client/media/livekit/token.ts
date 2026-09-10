import { z } from 'zod';
import {
  roomAccessTokenSchema,
  roomCredentialSchema,
  roomIdSchema,
  roomNameSchema,
} from '../../../lib/signaling/messages';

// Resposta de GET /livekit/token. O backend refaz exatamente a validação de convite,
// senha e token de acesso do fluxo WebSocket join-room antes de assinar o JWT.
const tokenResponseSchema = z
  .object({
    token: z.string().min(1),
    url: z.string().min(1),
    identity: z.string().uuid(),
    roomName: roomNameSchema,
    passwordProtected: z.boolean(),
    accessToken: roomAccessTokenSchema.nullable(),
    accessTokenExpiresAt: z.number().int().positive().nullable(),
  })
  .strict();

export type LiveKitTokenResponse = z.infer<typeof tokenResponseSchema>;

export type LiveKitAccessReason =
  | 'invalid-invite'
  | 'password-required'
  | 'wrong-password'
  | 'too-many-attempts'
  | 'unavailable';

export class LiveKitTokenError extends Error {
  constructor(
    readonly reason: LiveKitAccessReason,
    readonly status: number,
  ) {
    super(reason);
    this.name = 'LiveKitTokenError';
  }
}

const errorReasonSchema = z.object({
  reason: z.enum(['invalid-invite', 'password-required', 'wrong-password', 'too-many-attempts']),
});

export async function fetchLiveKitToken(params: {
  roomId: string;
  credential: string;
  identity: string;
  displayName?: string;
  password?: string;
  accessToken?: string;
}): Promise<LiveKitTokenResponse> {
  // Valida a entrada antes da rede para falhar cedo com o mesmo vocabulário de erro.
  const parsedInput = z
    .object({ roomId: roomIdSchema, credential: roomCredentialSchema, identity: z.string().uuid() })
    .safeParse(params);
  if (!parsedInput.success) throw new LiveKitTokenError('invalid-invite', 400);

  const url = new URL('/livekit/token', location.href);
  url.searchParams.set('roomId', params.roomId);
  url.searchParams.set('credential', params.credential);
  url.searchParams.set('identity', params.identity);
  if (params.displayName) url.searchParams.set('displayName', params.displayName);
  if (params.password) url.searchParams.set('password', params.password);
  if (params.accessToken) url.searchParams.set('accessToken', params.accessToken);

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new LiveKitTokenError('unavailable', 0);
  }

  if (!response.ok) {
    if (response.status === 429) throw new LiveKitTokenError('too-many-attempts', 429);
    if (response.status === 403) {
      const body = errorReasonSchema.safeParse(await response.json().catch(() => null));
      throw new LiveKitTokenError(body.success ? body.data.reason : 'invalid-invite', 403);
    }
    throw new LiveKitTokenError('unavailable', response.status);
  }

  const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new LiveKitTokenError('unavailable', response.status);
  return parsed.data;
}
