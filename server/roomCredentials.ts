import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { roomIdSchema, roomNameSchema } from '../src/lib/signaling/messages';

const payloadSchema = z
  .object({
    v: z.literal(1),
    roomId: roomIdSchema,
    roomName: roomNameSchema,
    passwordProof: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable(),
  })
  .strict();

const accessPayloadSchema = z
  .object({
    v: z.literal(1),
    roomId: roomIdSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict();

const ROOM_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RoomDescriptor = z.infer<typeof payloadSchema>;

function mac(secret: string, purpose: string, value: string) {
  return createHmac('sha256', secret)
    .update(`${purpose}\0${value}`)
    .digest('base64url');
}

function same(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueRoomCredential(
  secret: string,
  roomId: string,
  roomName: string,
  password?: string,
) {
  const payload: RoomDescriptor = {
    v: 1,
    roomId,
    roomName,
    passwordProof: password
      ? mac(secret, 'room-password:v1', `${roomId}\0${password}`)
      : null,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${mac(secret, 'room-credential:v1', encoded)}`;
}

export function verifyRoomCredential(
  secret: string,
  roomId: string,
  credential: string,
):
  | { ok: true; room: RoomDescriptor }
  | { ok: false; reason: 'invalid-invite' } {
  const [encoded, signature, extra] = credential.split('.');
  if (
    !encoded ||
    !signature ||
    extra ||
    !same(signature, mac(secret, 'room-credential:v1', encoded))
  ) {
    return { ok: false, reason: 'invalid-invite' };
  }
  try {
    const room = payloadSchema.parse(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    );
    if (room.roomId !== roomId) return { ok: false, reason: 'invalid-invite' };
    return { ok: true, room };
  } catch {
    return { ok: false, reason: 'invalid-invite' };
  }
}

export function verifyRoomPassword(
  secret: string,
  room: RoomDescriptor,
  password: string,
) {
  if (!room.passwordProof) return true;
  return same(
    room.passwordProof,
    mac(secret, 'room-password:v1', `${room.roomId}\0${password}`),
  );
}

export function issueRoomAccessToken(
  secret: string,
  roomId: string,
  now = Date.now(),
) {
  const payload = {
    v: 1 as const,
    roomId,
    expiresAt: now + ROOM_ACCESS_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    token: `${encoded}.${mac(secret, 'room-access:v1', encoded)}`,
    expiresAt: payload.expiresAt,
  };
}

export function verifyRoomAccessToken(
  secret: string,
  roomId: string,
  token: string,
  now = Date.now(),
) {
  const [encoded, signature, extra] = token.split('.');
  if (
    !encoded ||
    !signature ||
    extra ||
    !same(signature, mac(secret, 'room-access:v1', encoded))
  )
    return null;
  try {
    const payload = accessPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    );
    return payload.roomId === roomId && payload.expiresAt > now
      ? payload
      : null;
  } catch {
    return null;
  }
}

// Ticket de sessão do Cloudflare Realtime: emitido uma vez, depois que o convite/senha
// foram validados, e apresentado nas chamadas de track (que só re-verificam este HMAC
// barato, sem re-checar a senha a cada renegociação).
const REALTIME_TICKET_TTL_MS = 15 * 60 * 1000;
const realtimeTicketSchema = z
  .object({
    v: z.literal(1),
    roomId: roomIdSchema,
    sessionId: z.string().min(1).max(128),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export function issueRealtimeTicket(
  secret: string,
  roomId: string,
  sessionId: string,
  now = Date.now(),
) {
  const payload = {
    v: 1 as const,
    roomId,
    sessionId,
    expiresAt: now + REALTIME_TICKET_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${mac(secret, 'realtime-ticket:v1', encoded)}`;
}

export function verifyRealtimeTicket(
  secret: string,
  ticket: string,
  now = Date.now(),
) {
  const [encoded, signature, extra] = ticket.split('.');
  if (
    !encoded ||
    !signature ||
    extra ||
    !same(signature, mac(secret, 'realtime-ticket:v1', encoded))
  )
    return null;
  try {
    const payload = realtimeTicketSchema.parse(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    );
    return payload.expiresAt > now ? payload : null;
  } catch {
    return null;
  }
}
