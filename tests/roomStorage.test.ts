import { beforeEach, expect, test } from 'bun:test';
import {
  listFavoriteRooms,
  findRoomAccess,
  recallRecentRoom,
  rememberRecentRoom,
  rememberRoomAccess,
  removeFavoriteRoom,
  roomPasswordProtected,
  saveFavoriteRoom,
  validRoomAccessToken,
} from '../src/client/roomStorage';
import { issueRoomCredential } from '../server/roomCredentials';

const values = new Map<string, string>();
const storage: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: key => values.get(key) ?? null,
  key: index => [...values.keys()][index] ?? null,
  removeItem: key => void values.delete(key),
  setItem: (key, value) => void values.set(key, value),
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

const first = {
  roomId: '00000000-0000-4000-8000-000000000001',
  roomName: 'Sala favorita',
  credential: 'signed.credential',
};

beforeEach(() => storage.clear());

test('favorites and recent rooms persist only room metadata and signed credentials', () => {
  saveFavoriteRoom(first);
  rememberRecentRoom(first);

  expect(listFavoriteRooms()).toHaveLength(1);
  expect(listFavoriteRooms()[0]).toMatchObject(first);
  expect(recallRecentRoom()).toMatchObject(first);
  expect([...values.values()].join(' ')).not.toContain('password');

  removeFavoriteRoom(first.roomId);
  expect(listFavoriteRooms()).toEqual([]);
  expect(recallRecentRoom()).toMatchObject(first);
});

test('corrupt or legacy storage is ignored', () => {
  storage.setItem('screen-share:favorite-rooms', '{invalid');
  storage.setItem('screen-share:last-room', first.roomId);
  expect(listFavoriteRooms()).toEqual([]);
  expect(recallRecentRoom()).toBeNull();
});

test('recognizes optional password protection and only reuses unexpired access tokens', () => {
  const secret = 'test-room-token-secret-at-least-32-characters';
  const protectedCredential = issueRoomCredential(secret, first.roomId, first.roomName, 'password-for-test');
  const publicCredential = issueRoomCredential(secret, first.roomId, first.roomName);
  expect(roomPasswordProtected(protectedCredential)).toBeTrue();
  expect(roomPasswordProtected(publicCredential)).toBeFalse();
  expect(roomPasswordProtected('invalid')).toBeNull();

  expect(validRoomAccessToken({ ...first, accessToken: 'access', accessTokenExpiresAt: 2_000 }, 1_000)).toBe('access');
  expect(validRoomAccessToken({ ...first, accessToken: 'access', accessTokenExpiresAt: 2_000 }, 2_000)).toBeUndefined();

  const expires = Date.now() + 60_000;
  rememberRoomAccess({ ...first, accessToken: 'first-access', accessTokenExpiresAt: expires });
  const second = {
    roomId: '00000000-0000-4000-8000-000000000002',
    roomName: 'Outra sala',
    credential: 'other.credential',
    accessToken: 'second-access',
    accessTokenExpiresAt: expires,
  };
  rememberRoomAccess(second);
  expect(findRoomAccess(first.roomId, first.credential)?.accessToken).toBe('first-access');
  expect(findRoomAccess(second.roomId, second.credential)?.accessToken).toBe('second-access');
});
