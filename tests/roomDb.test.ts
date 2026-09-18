import { expect, test } from 'bun:test';
import { RoomDb } from '../server/roomDb';

const SECRET = 'test-room-token-secret-at-least-32-characters';
const DAY = 24 * 60 * 60 * 1000;

const db = () => new RoomDb(SECRET);

test('host and recovery secrets round-trip through their hashes only', () => {
  const store = db();
  const roomId = crypto.randomUUID();
  expect(store.createRoom(roomId, 'host-token', 'recovery-code')).toBeTrue();

  expect(store.verifyHostToken(roomId, 'host-token')).toBeTrue();
  expect(store.verifyHostToken(roomId, 'recovery-code')).toBeFalse();
  expect(store.verifyRecoveryCode(roomId, 'recovery-code')).toBeTrue();
  expect(store.verifyHostToken(crypto.randomUUID(), 'host-token')).toBeFalse();

  // Uma segunda criação não pode sobrescrever a dona: é o que impede dois
  // `claim-host` simultâneos de criarem duas salas.
  expect(store.createRoom(roomId, 'other-token', 'other-code')).toBeFalse();
  expect(store.verifyHostToken(roomId, 'other-token')).toBeFalse();
  store.close();
});

test('recovery rotates both secrets, so a used code stops working', () => {
  const store = db();
  const roomId = crypto.randomUUID();
  store.createRoom(roomId, 'host-1', 'code-1');

  expect(store.rotateHostCredentials(roomId, 'host-2', 'code-2')).toBeTrue();
  expect(store.verifyHostToken(roomId, 'host-1')).toBeFalse();
  expect(store.verifyRecoveryCode(roomId, 'code-1')).toBeFalse();
  expect(store.verifyHostToken(roomId, 'host-2')).toBeTrue();
  expect(store.verifyRecoveryCode(roomId, 'code-2')).toBeTrue();

  expect(
    store.rotateHostCredentials(crypto.randomUUID(), 'host-3', 'code-3'),
  ).toBeFalse();
  store.close();
});

test('moderator grants are keyed by member hash and revoke idempotently', () => {
  const store = db();
  const roomId = crypto.randomUUID();
  store.createRoom(roomId, 'host', 'code');
  const member = crypto.randomUUID();
  const other = crypto.randomUUID();

  const id = store.grantModerator(roomId, member)!;
  // Conceder de novo devolve o mesmo grant em vez de duplicar a linha ativa.
  expect(store.grantModerator(roomId, member)).toBe(id);
  expect(store.isActiveModerator(roomId, member)).toBeTrue();
  expect(store.isActiveModerator(roomId, other)).toBeFalse();
  expect(store.listModerators(roomId).map(entry => entry.id)).toEqual([id]);

  // Sem linha de sala não há grant permanente possível — e nada explode.
  expect(store.grantModerator(crypto.randomUUID(), member)).toBeNull();

  expect(store.revokeModerator(roomId, member)).toBeTrue();
  expect(store.revokeModerator(roomId, member)).toBeFalse();
  expect(store.isActiveModerator(roomId, member)).toBeFalse();
  expect(store.listModerators(roomId)).toEqual([]);

  // Depois da revogação, uma nova concessão é um grant novo e volta a valer.
  const second = store.grantModerator(roomId, member)!;
  expect(second).not.toBe(id);
  expect(store.revokeModeratorById(roomId, second)).toBe(
    store.hashMemberId(member),
  );
  expect(store.revokeModeratorById(roomId, second)).toBeNull();
  store.close();
});

test('the retention sweep deletes only stale rooms and cascades their grants', () => {
  const store = db();
  const now = Date.now();
  const stale = crypto.randomUUID();
  const active = crypto.randomUUID();
  store.createRoom(stale, 'host-a', 'code-a', now - 40 * DAY);
  store.createRoom(active, 'host-b', 'code-b', now - 40 * DAY);
  store.grantModerator(stale, crypto.randomUUID(), now - 40 * DAY);
  // Qualquer join ou ação de host empurra last_active_at, então uma sala em uso
  // nunca expira — só o abandono real.
  store.touchRoom(active, now);

  expect(store.pruneStaleRooms(30, now)).toBe(1);
  expect(store.getRoom(stale)).toBeNull();
  expect(store.listModerators(stale)).toEqual([]);
  expect(store.getRoom(active)?.roomId).toBe(active);
  store.close();
});

test('the media provider override defaults to null and survives reads', () => {
  const store = db();
  const roomId = crypto.randomUUID();
  store.createRoom(roomId, 'host', 'code');
  expect(store.getRoom(roomId)?.mediaProvider).toBeNull();

  expect(store.setMediaProvider(roomId, 'cloudflare')).toBeTrue();
  expect(store.getRoom(roomId)?.mediaProvider).toBe('cloudflare');
  expect(store.setMediaProvider(crypto.randomUUID(), 'webrtc')).toBeFalse();
  store.close();
});
