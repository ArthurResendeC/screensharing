import { expect, test } from 'bun:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { createLiveKitTokenHandler } from '../server/livekit/token';
import { issueRoomCredential } from '../server/roomCredentials';

const ROOM_SECRET = 'test-room-token-secret-at-least-32-chars-long';
const API_KEY = 'devkey';
const API_SECRET = 'devsecret-devsecret-devsecret-32c';

const handler = createLiveKitTokenHandler({
  roomTokenSecret: ROOM_SECRET,
  apiKey: API_KEY,
  apiSecret: API_SECRET,
  livekitUrl: 'wss://livekit.example.test',
  tokenTtl: '10m',
});

const verifier = new TokenVerifier(API_KEY, API_SECRET);

function get(params: Record<string, string>, ip = '203.0.113.7') {
  const url = new URL('http://localhost/livekit/token');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return handler(new Request(url, { headers: { 'x-forwarded-for': ip } }));
}

test('rejects a missing or forged credential with invalid-invite', async () => {
  const roomId = crypto.randomUUID();
  expect((await get({ roomId, credential: 'not-a-real-credential' })).status).toBe(403);
  const response = await get({ roomId, credential: 'a.b' });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ reason: 'invalid-invite' });
});

test('rejects a credential meant for another room', async () => {
  const credential = issueRoomCredential(ROOM_SECRET, crypto.randomUUID(), 'Sala');
  const response = await get({ roomId: crypto.randomUUID(), credential });
  expect(response.status).toBe(403);
});

test('mints a join token for a public room with the expected grants', async () => {
  const roomId = crypto.randomUUID();
  const credential = issueRoomCredential(ROOM_SECRET, roomId, 'Planejamento');
  const response = await get({ roomId, credential, displayName: '  Alice  ' });
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.url).toBe('wss://livekit.example.test');
  expect(body.roomName).toBe('Planejamento');
  expect(body.passwordProtected).toBe(false);
  expect(body.accessToken).toBeNull();

  const claims = await verifier.verify(body.token as string);
  expect(claims.sub).toBe(body.identity as string);
  expect(claims.name).toBe('Alice');
  expect(claims.video?.roomJoin).toBe(true);
  expect(claims.video?.room).toBe(roomId);
  expect(claims.video?.canPublish).toBe(true);
  expect(claims.video?.canSubscribe).toBe(true);
  expect(claims.video?.canUpdateOwnMetadata).toBe(true);
});

test('echoes a supplied identity and generates one otherwise', async () => {
  const roomId = crypto.randomUUID();
  const credential = issueRoomCredential(ROOM_SECRET, roomId, 'Sala');
  const identity = crypto.randomUUID();
  expect(((await (await get({ roomId, credential, identity })).json()) as { identity: string }).identity).toBe(
    identity,
  );
  const generated = ((await (await get({ roomId, credential })).json()) as { identity: string }).identity;
  expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  expect(generated).not.toBe(identity);
});

test('password-protected room: requires a password, rejects the wrong one, issues an access token', async () => {
  const roomId = crypto.randomUUID();
  const credential = issueRoomCredential(ROOM_SECRET, roomId, 'Sala secreta', 'hunter2');

  const missing = await get({ roomId, credential }, '198.51.100.1');
  expect(missing.status).toBe(403);
  expect(await missing.json()).toEqual({ reason: 'password-required' });

  const wrong = await get({ roomId, credential, password: 'nope' }, '198.51.100.2');
  expect(wrong.status).toBe(403);
  expect(await wrong.json()).toEqual({ reason: 'wrong-password' });

  const ok = await get({ roomId, credential, password: 'hunter2' }, '198.51.100.3');
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as { accessToken: string; accessTokenExpiresAt: number };
  expect(typeof body.accessToken).toBe('string');
  expect(body.accessTokenExpiresAt).toBeGreaterThan(Date.now());

  // The issued access token unlocks later joins without the password.
  const reuse = await get({ roomId, credential, accessToken: body.accessToken }, '198.51.100.4');
  expect(reuse.status).toBe(200);
});

test('blocks a client after five failed attempts on the same room', async () => {
  const roomId = crypto.randomUUID();
  const credential = issueRoomCredential(ROOM_SECRET, roomId, 'Sala', 'senha-certa');
  for (let attempt = 0; attempt < 5; attempt++) {
    expect((await get({ roomId, credential, password: 'errada' }, '192.0.2.55')).status).toBe(403);
  }
  const blocked = await get({ roomId, credential, password: 'senha-certa' }, '192.0.2.55');
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toEqual({ reason: 'too-many-attempts' });
});
