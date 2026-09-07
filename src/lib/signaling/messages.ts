import { z } from 'zod';

export const roomIdSchema = z.string().uuid();
const id = z.string().uuid();
const candidateSchema = z.object({
  candidate: z.string().max(4096),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();
const route = { targetPeerId: id, sessionId: id };
const offer = z.object({ type: z.literal('offer'), ...route, sdp: z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(60000) }).strict() }).strict();
const answer = z.object({ type: z.literal('answer'), ...route, sdp: z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(60000) }).strict() }).strict();
const ice = z.object({ type: z.literal('ice-candidate'), ...route, candidate: candidateSchema }).strict();
const participant = z.object({ peerId: id, sharing: z.boolean() }).strict();
export type Participant = z.infer<typeof participant>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join-room'), roomId: roomIdSchema }).strict(),
  offer, answer, ice,
  z.object({ type: z.literal('sharing-started') }).strict(),
  z.object({ type: z.literal('sharing-stopped') }).strict(),
  z.object({ type: z.literal('watch'), targetPeerId: id.nullable(), sessionId: id }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type RelayMessage = Extract<ClientMessage, { targetPeerId: string }>;
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('joined'), roomId: id, peerId: id, peers: z.array(participant).max(5) }),
  z.object({ type: z.literal('room-state'), peers: z.array(participant).max(5) }),
  z.object({ type: z.literal('watching'), peerId: id.nullable(), sessionId: id }),
  z.object({ type: z.literal('subscriber-joined'), peerId: id, sessionId: id }),
  z.object({ type: z.literal('subscription-ended'), peerId: id, sessionId: id }),
  z.object({ type: z.literal('error'), message: z.string().max(300) }),
  offer.omit({ targetPeerId: true }).extend({ peerId: id }),
  answer.omit({ targetPeerId: true }).extend({ peerId: id }),
  ice.omit({ targetPeerId: true }).extend({ peerId: id }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type PeerSignal = Extract<ServerMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>;
