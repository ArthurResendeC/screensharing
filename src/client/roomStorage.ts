import { z } from 'zod';
import { roomAccessTokenSchema, roomCredentialSchema, roomIdSchema, roomNameSchema } from '../lib/signaling/messages';

const FAVORITES_KEY = 'screen-share:favorite-rooms';
const RECENT_KEY = 'screen-share:last-room-v2';
const LEGACY_RECENT_KEY = 'screen-share:last-room';
const ACCESS_KEY = 'screen-share:room-access-v1';

const storedRoomSchema = z
  .object({
    roomId: roomIdSchema,
    roomName: roomNameSchema,
    credential: roomCredentialSchema,
    accessToken: roomAccessTokenSchema.optional(),
    accessTokenExpiresAt: z.number().int().positive().optional(),
    favoritedAt: z.number().finite().nonnegative(),
  })
  .strict();
const favoritesSchema = z.object({ version: z.literal(1), rooms: z.array(z.unknown()) }).strict();
const roomAccessSchema = z
  .object({
    roomId: roomIdSchema,
    credential: roomCredentialSchema,
    accessToken: roomAccessTokenSchema,
    accessTokenExpiresAt: z.number().int().positive(),
  })
  .strict();
const accessListSchema = z.object({ version: z.literal(1), rooms: z.array(z.unknown()) }).strict();

export type StoredRoom = z.infer<typeof storedRoomSchema>;
export type RoomInvite = Pick<StoredRoom, 'roomId' | 'credential' | 'accessToken' | 'accessTokenExpiresAt'>;

function readJson(key: string): unknown {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function listFavoriteRooms() {
  const parsed = favoritesSchema.safeParse(readJson(FAVORITES_KEY));
  if (!parsed.success) return [];
  return parsed.data.rooms
    .flatMap(room => {
      const entry = storedRoomSchema.safeParse(room);
      return entry.success ? [entry.data] : [];
    })
    .sort((a, b) => b.favoritedAt - a.favoritedAt);
}

export function isFavoriteRoom(roomId: string) {
  return listFavoriteRooms().some(room => room.roomId === roomId);
}

export function saveFavoriteRoom(room: Omit<StoredRoom, 'favoritedAt'>) {
  const rooms = listFavoriteRooms().filter(entry => entry.roomId !== room.roomId);
  rooms.unshift({ ...room, favoritedAt: Date.now() });
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify({ version: 1, rooms }));
  } catch {
    // Favoriting remains unavailable when storage is blocked or full.
  }
}

export function removeFavoriteRoom(roomId: string) {
  const rooms = listFavoriteRooms().filter(room => room.roomId !== roomId);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify({ version: 1, rooms }));
  } catch {
    // Keep the current UI usable when storage is unavailable.
  }
}

export function rememberRecentRoom(room: Omit<StoredRoom, 'favoritedAt'>) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ ...room, favoritedAt: Date.now() }));
    localStorage.removeItem(LEGACY_RECENT_KEY);
  } catch {
    // The room remains usable in this tab.
  }
}

export function rememberRoomAccess(room: Omit<StoredRoom, 'favoritedAt'>) {
  rememberRecentRoom(room);
  if (room.accessToken && room.accessTokenExpiresAt) {
    const rooms = listRoomAccess()
      .filter(entry => entry.accessTokenExpiresAt > Date.now() && entry.roomId !== room.roomId)
      .concat({
        roomId: room.roomId,
        credential: room.credential,
        accessToken: room.accessToken,
        accessTokenExpiresAt: room.accessTokenExpiresAt,
      });
    try {
      localStorage.setItem(ACCESS_KEY, JSON.stringify({ version: 1, rooms }));
    } catch {
      // The current session remains authenticated even if storage is unavailable.
    }
  }
  const favorite = listFavoriteRooms().find(entry => entry.roomId === room.roomId);
  if (!favorite) return;
  const rooms = listFavoriteRooms().map(entry =>
    entry.roomId === room.roomId ? { ...room, favoritedAt: entry.favoritedAt } : entry,
  );
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify({ version: 1, rooms }));
  } catch {
    // The current session remains authenticated even if storage is unavailable.
  }
}

function listRoomAccess() {
  const parsed = accessListSchema.safeParse(readJson(ACCESS_KEY));
  if (!parsed.success) return [];
  return parsed.data.rooms.flatMap(room => {
    const entry = roomAccessSchema.safeParse(room);
    return entry.success ? [entry.data] : [];
  });
}

export function findRoomAccess(roomId: string, credential: string) {
  return listRoomAccess().find(entry => entry.roomId === roomId && entry.credential === credential);
}

export function recallRecentRoom() {
  const parsed = storedRoomSchema.safeParse(readJson(RECENT_KEY));
  return parsed.success ? parsed.data : null;
}

export function findStoredInvite(roomId: string): StoredRoom | null {
  const recent = recallRecentRoom();
  return listFavoriteRooms().find(room => room.roomId === roomId) ?? (recent?.roomId === roomId ? recent : null);
}

export function validRoomAccessToken(invite: RoomInvite, now = Date.now()) {
  return invite.accessToken && invite.accessTokenExpiresAt && invite.accessTokenExpiresAt > now
    ? invite.accessToken
    : undefined;
}

export function roomPasswordProtected(credential: string): boolean | null {
  try {
    const encoded = credential.split('.')[0];
    if (!encoded) return null;
    const base64 = encoded
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const payload = z
      .object({ v: z.literal(1), passwordProof: z.string().nullable() })
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(bytes)));
    return payload.passwordProof !== null;
  } catch {
    return null;
  }
}

export function inviteUrl({ roomId, credential }: RoomInvite) {
  const url = new URL(`/room/${encodeURIComponent(roomId)}`, location.origin);
  url.hash = new URLSearchParams({ credential }).toString();
  return url.href;
}

export function parseInvite(value: string): RoomInvite | null {
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return null;
    const match = url.pathname.match(/^\/room\/([^/]+)\/?$/);
    const roomId = match ? decodeURIComponent(match[1]!) : '';
    const credential = new URLSearchParams(url.hash.slice(1)).get('credential') ?? '';
    const parsed = z.object({ roomId: roomIdSchema, credential: roomCredentialSchema }).safeParse({
      roomId,
      credential,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
