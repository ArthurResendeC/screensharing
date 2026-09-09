import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { roomIdSchema, roomNameSchema } from '../src/lib/signaling/messages';

const payloadSchema = z
  .object({
    v: z.literal(1),
    roomId: roomIdSchema,
    roomName: roomNameSchema,
    passwordProof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export type RoomDescriptor = z.infer<typeof payloadSchema>;

function mac(secret: string, purpose: string, value: string) {
  return createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('base64url');
}

function same(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueRoomCredential(secret: string, roomId: string, roomName: string, password: string) {
  const payload: RoomDescriptor = {
    v: 1,
    roomId,
    roomName,
    passwordProof: mac(secret, 'room-password:v1', `${roomId}\0${password}`),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${mac(secret, 'room-credential:v1', encoded)}`;
}

export function verifyRoomCredential(
  secret: string,
  roomId: string,
  credential: string,
  password: string,
): { ok: true; room: RoomDescriptor } | { ok: false; reason: 'invalid-invite' | 'wrong-password' } {
  const [encoded, signature, extra] = credential.split('.');
  if (!encoded || !signature || extra || !same(signature, mac(secret, 'room-credential:v1', encoded))) {
    return { ok: false, reason: 'invalid-invite' };
  }
  try {
    const room = payloadSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
    if (room.roomId !== roomId) return { ok: false, reason: 'invalid-invite' };
    const proof = mac(secret, 'room-password:v1', `${roomId}\0${password}`);
    return same(room.passwordProof, proof) ? { ok: true, room } : { ok: false, reason: 'wrong-password' };
  } catch {
    return { ok: false, reason: 'invalid-invite' };
  }
}
