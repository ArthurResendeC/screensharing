import { z } from 'zod';
import { roomCredentialSchema, roomIdSchema, roomNameSchema } from '../lib/signaling/messages';

const FAVORITES_KEY = 'screen-share:favorite-rooms';
const RECENT_KEY = 'screen-share:last-room-v2';
const LEGACY_RECENT_KEY = 'screen-share:last-room';

const storedRoomSchema = z
  .object({
    roomId: roomIdSchema,
    roomName: roomNameSchema,
    credential: roomCredentialSchema,
    favoritedAt: z.number().finite().nonnegative(),
  })
  .strict();
const favoritesSchema = z.object({ version: z.literal(1), rooms: z.array(z.unknown()) }).strict();

export type StoredRoom = z.infer<typeof storedRoomSchema>;
export type RoomInvite = Pick<StoredRoom, 'roomId' | 'credential'>;

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

export function recallRecentRoom() {
  const parsed = storedRoomSchema.safeParse(readJson(RECENT_KEY));
  return parsed.success ? parsed.data : null;
}

export function findStoredInvite(roomId: string): StoredRoom | null {
  const recent = recallRecentRoom();
  return listFavoriteRooms().find(room => room.roomId === roomId) ?? (recent?.roomId === roomId ? recent : null);
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
