import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { createRealtimeProxy } from '../server/realtime/proxy';
import { issueRoomCredential } from '../server/roomCredentials';

const ROOM_SECRET = 'test-room-token-secret-at-least-32-chars-long';
const APP_ID = 'app-123';
const APP_SECRET = 'cf-app-secret';
const OFFER = {
  type: 'offer' as const,
  sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n',
};

const proxy = createRealtimeProxy({
  roomTokenSecret: ROOM_SECRET,
  appId: APP_ID,
  appSecret: APP_SECRET,
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
});

type CfCall = {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
};
let cfCalls: CfCall[] = [];
let cfResponder: (call: CfCall) => Response = () =>
  Response.json({ sessionId: 'cf-sess-1' }, { status: 201 });

beforeEach(() => {
  cfCalls = [];
  cfResponder = () =>
    Response.json({ sessionId: 'cf-sess-1' }, { status: 201 });
  // O proxy sempre chama fetch(url: string, { method, headers, body: string }).
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : undefined;
    const call: CfCall = {
      url: input as string,
      method: init?.method ?? 'GET',
      auth: new Headers(init?.headers).get('authorization'),
      body: bodyText ? JSON.parse(bodyText) : undefined,
    };
    cfCalls.push(call);
    return cfResponder(call);
  }) as unknown as typeof fetch;
});

afterEach(() => mock.restore());

function req(path: string, method: string, body: unknown, ip = '203.0.113.5') {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

async function newSession(
  overrides: Record<string, unknown> = {},
  ip?: string,
) {
  const roomId = crypto.randomUUID();
  const credential = issueRoomCredential(
    ROOM_SECRET,
    roomId,
    'Sala',
    overrides.password as string | undefined,
  );
  return {
    roomId,
    credential,
    response: await proxy(
      req(
        '/realtime/session',
        'POST',
        { roomId, credential, ...overrides },
        ip,
      ),
    ),
  };
}

test('forged credential is rejected with invalid-invite', async () => {
  const response = await proxy(
    req('/realtime/session', 'POST', {
      roomId: crypto.randomUUID(),
      credential: 'nope.nope',
    }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ reason: 'invalid-invite' });
  expect(cfCalls).toHaveLength(0);
});

test('public room: creates a CF session and returns a ticket + answer', async () => {
  cfResponder = () =>
    Response.json(
      {
        sessionId: 'cf-sess-9',
        sessionDescription: { type: 'answer', sdp: 'v=0\r\n' },
      },
      { status: 201 },
    );
  const { response } = await newSession();
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.sessionId).toBe('cf-sess-9');
  expect(typeof body.ticket).toBe('string');
  expect(body.answer).toEqual({ type: 'answer', sdp: 'v=0\r\n' });

  expect(cfCalls[0]!.url).toBe(
    'https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/new',
  );
  expect(cfCalls[0]!.auth).toBe('Bearer cf-app-secret');
  // Cloudflare's /sessions/new rejects "{}" — send no body when there is no offer.
  expect(cfCalls[0]!.body).toBeUndefined();
});

test('password room: requires the password and rejects the wrong one', async () => {
  const roomId = crypto.randomUUID();
  const credential = issueRoomCredential(
    ROOM_SECRET,
    roomId,
    'Secreta',
    'hunter2',
  );

  const missing = await proxy(
    req('/realtime/session', 'POST', { roomId, credential }, '198.51.100.1'),
  );
  expect(missing.status).toBe(403);
  expect(await missing.json()).toEqual({ reason: 'password-required' });

  const wrong = await proxy(
    req(
      '/realtime/session',
      'POST',
      { roomId, credential, password: 'x' },
      '198.51.100.2',
    ),
  );
  expect(await wrong.json()).toEqual({ reason: 'wrong-password' });

  const ok = await proxy(
    req(
      '/realtime/session',
      'POST',
      { roomId, credential, password: 'hunter2' },
      '198.51.100.3',
    ),
  );
  expect(ok.status).toBe(200);
});

test('blocks a client after five failed attempts on the same room', async () => {
  const roomId = crypto.randomUUID();
  const credential = issueRoomCredential(ROOM_SECRET, roomId, 'Sala', 'right');
  for (let i = 0; i < 5; i++) {
    const r = await proxy(
      req(
        '/realtime/session',
        'POST',
        { roomId, credential, password: 'wrong' },
        '192.0.2.7',
      ),
    );
    expect(r.status).toBe(403);
  }
  const blocked = await proxy(
    req(
      '/realtime/session',
      'POST',
      { roomId, credential, password: 'right' },
      '192.0.2.7',
    ),
  );
  expect(blocked.status).toBe(429);
});

test('track calls need a valid ticket and forward to the bound session', async () => {
  cfResponder = () =>
    Response.json({ sessionId: 'cf-sess-42' }, { status: 201 });
  const { response } = await newSession({}, '203.0.113.9');
  const { ticket } = (await response.json()) as { ticket: string };

  const bad = await proxy(
    req('/realtime/tracks/new', 'POST', {
      ticket: 'forged.ticket',
      tracks: [{ location: 'local', mid: '0', trackName: 't' }],
    }),
  );
  expect(bad.status).toBe(401);

  cfResponder = () =>
    Response.json(
      {
        requiresImmediateRenegotiation: false,
        tracks: [{ mid: '0', trackName: 't' }],
      },
      { status: 200 },
    );
  const ok = await proxy(
    req('/realtime/tracks/new', 'POST', {
      ticket,
      sessionDescription: OFFER,
      tracks: [{ location: 'local', mid: '0', trackName: 't' }],
    }),
  );
  expect(ok.status).toBe(200);
  const forwarded = cfCalls.at(-1)!;
  expect(forwarded.url).toBe(
    'https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/cf-sess-42/tracks/new',
  );
  expect(forwarded.method).toBe('POST');
});

test('renegotiate and tracks/close proxy to the bound session', async () => {
  cfResponder = () =>
    Response.json({ sessionId: 'cf-sess-7' }, { status: 201 });
  const { response } = await newSession({}, '203.0.113.11');
  const { ticket } = (await response.json()) as { ticket: string };

  cfResponder = () => Response.json({}, { status: 200 });
  await proxy(
    req('/realtime/renegotiate', 'PUT', {
      ticket,
      sessionDescription: { type: 'answer', sdp: 'v=0\r\n' },
    }),
  );
  expect(cfCalls.at(-1)!.url).toBe(
    'https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/cf-sess-7/renegotiate',
  );
  expect(cfCalls.at(-1)!.method).toBe('PUT');

  await proxy(
    req('/realtime/tracks/close', 'PUT', {
      ticket,
      tracks: [{ mid: '3' }],
      force: true,
    }),
  );
  expect(cfCalls.at(-1)!.url).toBe(
    'https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/cf-sess-7/tracks/close',
  );
});
