import { beforeEach, expect, test } from 'bun:test';
import {
  listFavoriteRooms,
  recallRecentRoom,
  rememberRecentRoom,
  removeFavoriteRoom,
  saveFavoriteRoom,
} from '../src/client/roomStorage';

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
