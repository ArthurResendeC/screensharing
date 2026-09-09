import { z } from 'zod';

export const roomIdSchema = z.string().uuid();
const id = z.string().uuid();
export const ROOM_NAME_MAX_LENGTH = 64;
export const ROOM_PASSWORD_MAX_LENGTH = 128;
export const ROOM_CREDENTIAL_MAX_LENGTH = 2048;
export const ROOM_ACCESS_TOKEN_MAX_LENGTH = 1024;
export const MAX_ROOM_PARTICIPANTS = 10;
export const MAX_WATCHED_STREAMS = 2;
export const roomNameSchema = z
  .string()
  .max(2000)
  .trim()
  .min(1)
  .transform(value => value.normalize('NFC'))
  .pipe(z.string().max(ROOM_NAME_MAX_LENGTH));
export const roomPasswordSchema = z.string().min(1).max(ROOM_PASSWORD_MAX_LENGTH);
export const roomCredentialSchema = z.string().min(1).max(ROOM_CREDENTIAL_MAX_LENGTH);
export const roomAccessTokenSchema = z.string().min(1).max(ROOM_ACCESS_TOKEN_MAX_LENGTH);
const candidateSchema = z
  .object({
    candidate: z.string().max(4096),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strict();
export const ALIAS_MAX_LENGTH = 32;
// Accept any reasonable string and normalise it; the client already caps input length.
export const aliasSchema = z
  .string()
  .max(2000)
  .trim()
  .transform(value => value.slice(0, ALIAS_MAX_LENGTH));
const route = { targetPeerId: id, sessionId: id };
const offer = z
  .object({
    type: z.literal('offer'),
    ...route,
    sdp: z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(60000) }).strict(),
  })
  .strict();
const answer = z
  .object({
    type: z.literal('answer'),
    ...route,
    sdp: z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(60000) }).strict(),
  })
  .strict();
const ice = z.object({ type: z.literal('ice-candidate'), ...route, candidate: candidateSchema }).strict();
const participant = z
  .object({ peerId: id, sharing: z.boolean(), alias: z.string().max(ALIAS_MAX_LENGTH).nullable() })
  .strict();
export type Participant = z.infer<typeof participant>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create-room'), name: roomNameSchema, password: roomPasswordSchema.optional() }).strict(),
  z
    .object({
      type: z.literal('join-room'),
      roomId: roomIdSchema,
      credential: roomCredentialSchema,
      password: roomPasswordSchema.optional(),
      accessToken: roomAccessTokenSchema.optional(),
      clientId: id.optional(),
    })
    .strict(),
  offer,
  answer,
  ice,
  z.object({ type: z.literal('sharing-started') }).strict(),
  z.object({ type: z.literal('sharing-stopped') }).strict(),
  z.object({ type: z.literal('set-alias'), alias: aliasSchema }).strict(),
  z.object({ type: z.literal('watch'), targetPeerId: id.nullable(), sessionId: id }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type RelayMessage = Extract<ClientMessage, { targetPeerId: string }>;
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('room-created'),
    roomId: id,
    roomName: roomNameSchema,
    credential: roomCredentialSchema,
    passwordProtected: z.boolean(),
  }),
  z.object({
    type: z.literal('joined'),
    roomId: id,
    roomName: roomNameSchema,
    passwordProtected: z.boolean(),
    accessToken: roomAccessTokenSchema.nullable(),
    accessTokenExpiresAt: z.number().int().positive().nullable(),
    peerId: id,
    peers: z.array(participant).max(MAX_ROOM_PARTICIPANTS),
  }),
  z
    .object({
      type: z.literal('room-access-denied'),
      reason: z.enum(['invalid-invite', 'password-required', 'wrong-password', 'too-many-attempts']),
    })
    .strict(),
  z.object({ type: z.literal('room-state'), peers: z.array(participant).max(MAX_ROOM_PARTICIPANTS) }),
  z.object({ type: z.literal('watching'), peerId: id.nullable(), sessionId: id }),
  z.object({ type: z.literal('subscriber-joined'), peerId: id, sessionId: id }),
  z.object({ type: z.literal('subscription-ended'), peerId: id, sessionId: id }),
  z.object({ type: z.literal('error'), message: z.string().max(300) }),
  z.object({ type: z.literal('pong') }).strict(),
  offer.omit({ targetPeerId: true }).extend({ peerId: id }),
  answer.omit({ targetPeerId: true }).extend({ peerId: id }),
  ice.omit({ targetPeerId: true }).extend({ peerId: id }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type PeerSignal = Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>;
