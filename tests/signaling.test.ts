import { test, expect } from 'bun:test';
import {
  serverMessageSchema,
  type ServerMessage,
} from '../src/lib/signaling/messages';
import {
  SignalingHub,
  type Client,
  type SignalingSocket,
} from '../server/signaling';
import { RoomDb } from '../server/roomDb';
import {
  issueRoomAccessToken,
  issueRoomCredential,
} from '../server/roomCredentials';

const ROOM_SECRET = 'test-room-token-secret-at-least-32-characters';

// Um banco em memória por hub: `bun:sqlite` aceita ':memory:', então nenhum teste
// toca o disco nem compartilha estado com outro.
const memoryDb = () => new RoomDb(ROOM_SECRET);
const hubWith = (
  options: Partial<ConstructorParameters<typeof SignalingHub>[1]> = {},
) => new SignalingHub(ROOM_SECRET, { db: memoryDb(), ...options });
const ROOM_PASSWORD = 'correct horse battery staple';

function authorized(message: unknown) {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'join-room'
  )
    return message;
  const join = message as {
    type: 'join-room';
    roomId: string;
    clientId?: string;
    credential?: string;
    password?: string;
  };
  return {
    ...join,
    credential:
      join.credential ??
      issueRoomCredential(
        ROOM_SECRET,
        join.roomId,
        'Sala de teste',
        ROOM_PASSWORD,
      ),
    password: join.password ?? ROOM_PASSWORD,
  };
}

class FakeSocket implements SignalingSocket {
  inbox: ServerMessage[] = [];
  closed = false;
  buffered = 0;
  send(message: string) {
    this.inbox.push(serverMessageSchema.parse(JSON.parse(message)));
    return message.length;
  }
  close() {
    this.closed = true;
  }
  terminate() {
    this.closed = true;
  }
  ping() {
    return 1;
  }
  getBufferedAmount() {
    return this.buffered;
  }
  take(type: ServerMessage['type']) {
    const index = this.inbox.findIndex(message => message.type === type);
    if (index < 0) throw new Error(`Mensagem ${type} não encontrada`);
    return this.inbox.splice(index, 1)[0];
  }
}

type Peer = {
  client: Client;
  socket: FakeSocket;
  send(message: unknown): void;
  take(type: ServerMessage['type']): ServerMessage;
};

test('signed rooms preserve their name across hubs and reject invalid access', () => {
  const connect = (hub: SignalingHub) => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      client,
      socket,
      send: (message: unknown) => hub.message(client, JSON.stringify(message)),
    };
  };
  const firstHub = hubWith();
  const creator = connect(firstHub);
  creator.send({
    type: 'create-room',
    name: '  Sala permanente  ',
    password: ROOM_PASSWORD,
  });
  const created = creator.socket.take('room-created');
  if (created.type !== 'room-created') throw new Error();
  expect(created.roomName).toBe('Sala permanente');
  expect(created.passwordProtected).toBeTrue();
  expect(created.credential).not.toContain(ROOM_PASSWORD);

  const wrong = connect(firstHub);
  wrong.send({
    type: 'join-room',
    roomId: created.roomId,
    credential: created.credential,
    password: 'another-password',
  });
  expect(wrong.socket.take('room-access-denied')).toEqual({
    type: 'room-access-denied',
    reason: 'wrong-password',
  });
  expect(firstHub.rooms.has(created.roomId)).toBeFalse();
  for (let attempt = 1; attempt < 5; attempt++) {
    wrong.send({
      type: 'join-room',
      roomId: created.roomId,
      credential: created.credential,
      password: 'another-password',
    });
    expect(wrong.socket.take('room-access-denied').type).toBe(
      'room-access-denied',
    );
  }
  wrong.send({
    type: 'join-room',
    roomId: created.roomId,
    credential: created.credential,
    password: 'another-password',
  });
  expect(wrong.socket.take('room-access-denied')).toEqual({
    type: 'room-access-denied',
    reason: 'too-many-attempts',
  });
  expect(wrong.socket.closed).toBeTrue();

  const tampered = connect(firstHub);
  tampered.send({
    type: 'join-room',
    roomId: created.roomId,
    credential: `${created.credential.slice(0, -1)}x`,
    password: ROOM_PASSWORD,
  });
  expect(tampered.socket.take('room-access-denied')).toEqual({
    type: 'room-access-denied',
    reason: 'invalid-invite',
  });
  firstHub.close();

  const restartedHub = hubWith();
  try {
    const participant = connect(restartedHub);
    participant.send({
      type: 'join-room',
      roomId: created.roomId,
      credential: created.credential,
      password: ROOM_PASSWORD,
    });
    const joined = participant.socket.take('joined');
    expect(joined.type === 'joined' && joined.roomName).toBe('Sala permanente');
    if (joined.type !== 'joined') throw new Error();
    expect(joined.passwordProtected).toBeTrue();
    expect(joined.accessToken).not.toBeNull();
    expect(joined.accessTokenExpiresAt).toBeGreaterThan(Date.now());

    restartedHub.leave(participant.client);
    const remembered = connect(restartedHub);
    remembered.send({
      type: 'join-room',
      roomId: created.roomId,
      credential: created.credential,
      accessToken: joined.accessToken,
    });
    expect(remembered.socket.take('joined').type).toBe('joined');

    const expired = connect(restartedHub);
    expired.send({
      type: 'join-room',
      roomId: created.roomId,
      credential: created.credential,
      accessToken: issueRoomAccessToken(ROOM_SECRET, created.roomId, 0).token,
    });
    expect(expired.socket.take('room-access-denied')).toEqual({
      type: 'room-access-denied',
      reason: 'password-required',
    });

    const foreignSecret = 'different-room-token-secret-at-least-32-chars';
    const foreignHub = new SignalingHub(foreignSecret, {
      db: new RoomDb(foreignSecret),
    });
    const foreign = connect(foreignHub);
    foreign.send({
      type: 'join-room',
      roomId: created.roomId,
      credential: created.credential,
      password: ROOM_PASSWORD,
    });
    expect(foreign.socket.take('room-access-denied')).toEqual({
      type: 'room-access-denied',
      reason: 'invalid-invite',
    });
    foreignHub.close();
  } finally {
    restartedHub.close();
  }
});

test('rooms without a password can be joined directly and do not issue access tokens', () => {
  const hub = hubWith();
  const connect = () => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      socket,
      send: (message: unknown) => hub.message(client, JSON.stringify(message)),
    };
  };
  try {
    const creator = connect();
    creator.send({ type: 'create-room', name: 'Sala pública' });
    const created = creator.socket.take('room-created');
    if (created.type !== 'room-created') throw new Error();
    expect(created.passwordProtected).toBeFalse();

    const participant = connect();
    participant.send({
      type: 'join-room',
      roomId: created.roomId,
      credential: created.credential,
    });
    const joined = participant.socket.take('joined');
    if (joined.type !== 'joined') throw new Error();
    expect(joined.passwordProtected).toBeFalse();
    expect(joined.accessToken).toBeNull();
    expect(joined.accessTokenExpiresAt).toBeNull();
  } finally {
    hub.close();
  }
});

test('a protected room accepts a single-character password', () => {
  const hub = hubWith();
  const client = hub.createClient();
  const socket = new FakeSocket();
  hub.open(client, socket);
  try {
    hub.message(
      client,
      JSON.stringify({
        type: 'create-room',
        name: 'Senha curta',
        password: 'x',
      }),
    );
    const created = socket.take('room-created');
    if (created.type !== 'room-created') throw new Error();
    hub.message(
      client,
      JSON.stringify({
        type: 'join-room',
        roomId: created.roomId,
        credential: created.credential,
        password: 'x',
      }),
    );
    expect(socket.take('joined').type).toBe('joined');
  } finally {
    hub.close();
  }
});

test('room subscriptions: two selections, reciprocal watching, isolation and independent lifecycle', () => {
  const hub = hubWith();
  const connect = (): Peer => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      client,
      socket,
      send: message => hub.message(client, JSON.stringify(authorized(message))),
      take: type => socket.take(type),
    };
  };
  const roomId = crypto.randomUUID();
  const join = (room = roomId) => {
    const peer = connect();
    peer.send({ type: 'join-room', roomId: room });
    const message = peer.take('joined');
    if (message.type !== 'joined') throw new Error();
    return { ...peer, id: message.peerId };
  };
  try {
    const a = join();
    const b = join();
    const c = join();
    const d = join();
    const e = join();
    a.send('{invalid');
    expect(a.take('error').type).toBe('error');
    a.send({ type: 'join-room', roomId });
    expect(a.take('error').type).toBe('error');
    a.send({ type: 'sharing-started' });
    b.send({ type: 'sharing-started' });

    const outsider = join(crypto.randomUUID());
    const rejectedSession = crypto.randomUUID();
    outsider.send({
      type: 'watch',
      targetPeerId: a.id,
      sessionId: rejectedSession,
    });
    expect(outsider.take('watching')).toEqual({
      type: 'watching',
      peerId: null,
      sessionId: rejectedSession,
    });
    expect(outsider.take('error').type).toBe('error');
    a.send({
      type: 'watch',
      targetPeerId: a.id,
      sessionId: crypto.randomUUID(),
    });
    a.take('watching');
    a.take('error');
    c.send({
      type: 'watch',
      targetPeerId: d.id,
      sessionId: crypto.randomUUID(),
    });
    c.take('watching');
    c.take('error');

    const watch = (viewer: typeof a, publisher: typeof a) => {
      const sessionId = crypto.randomUUID();
      viewer.send({ type: 'watch', targetPeerId: publisher.id, sessionId });
      expect(viewer.take('watching')).toEqual({
        type: 'watching',
        peerId: publisher.id,
        sessionId,
      });
      expect(publisher.take('subscriber-joined')).toEqual({
        type: 'subscriber-joined',
        peerId: viewer.id,
        sessionId,
      });
      return sessionId;
    };
    const ca = watch(c, a);
    const offer = {
      type: 'offer' as const,
      targetPeerId: c.id,
      sessionId: ca,
      sdp: { type: 'offer' as const, sdp: 'v=0\r\n' },
    };
    a.send(offer);
    expect(c.take('offer')).toEqual({
      type: 'offer',
      peerId: a.id,
      sessionId: ca,
      sdp: offer.sdp,
    });
    c.send({
      type: 'answer',
      targetPeerId: a.id,
      sessionId: ca,
      sdp: { type: 'answer', sdp: 'v=0\r\n' },
    });
    expect(a.take('answer').type).toBe('answer');
    c.send({
      type: 'ice-candidate',
      targetPeerId: a.id,
      sessionId: ca,
      candidate: { candidate: '', sdpMid: '0' },
    });
    expect(a.take('ice-candidate').type).toBe('ice-candidate');

    const ab = watch(a, b);
    const ba = watch(b, a);
    const cb = watch(c, b);
    d.send({ type: 'sharing-started' });
    const rejectedThird = crypto.randomUUID();
    c.send({ type: 'watch', targetPeerId: d.id, sessionId: rejectedThird });
    expect(c.take('watching')).toEqual({
      type: 'watching',
      peerId: null,
      sessionId: rejectedThird,
    });
    expect(c.take('error').type).toBe('error');
    expect(
      d.socket.inbox.filter(message => message.type === 'subscriber-joined'),
    ).toHaveLength(0);
    a.send(offer);
    expect(c.take('offer').type).toBe('offer');
    b.send({ ...offer, sessionId: cb });
    const nextOffer = c.take('offer');
    expect(
      nextOffer.type === 'offer' &&
        nextOffer.peerId === b.id &&
        nextOffer.sessionId === cb,
    ).toBeTrue();

    c.send({ ...offer, targetPeerId: b.id, sessionId: cb });
    d.send({ ...offer, targetPeerId: c.id, sessionId: crypto.randomUUID() });
    b.send({ type: 'sharing-stopped' });
    expect(a.take('subscription-ended')).toEqual({
      type: 'subscription-ended',
      peerId: b.id,
      sessionId: ab,
    });
    expect(c.take('subscription-ended').type).toBe('subscription-ended');
    expect(
      b.socket.inbox.filter(message => message.type === 'offer'),
    ).toHaveLength(0);
    expect(
      c.socket.inbox.filter(message => message.type === 'offer'),
    ).toHaveLength(0);
    for (const expected of [ab, cb]) {
      const ended = b.take('subscription-ended');
      expect(
        ended.type === 'subscription-ended' && ended.sessionId === expected,
      ).toBeTrue();
    }

    a.send({ ...offer, targetPeerId: b.id, sessionId: ba });
    b.take('offer');
    hub.leave(a.client);
    const endedByA = b.take('subscription-ended');
    expect(
      endedByA.type === 'subscription-ended' && endedByA.sessionId === ba,
    ).toBeTrue();
    const endedForC = c.take('subscription-ended');
    expect(
      endedForC.type === 'subscription-ended' && endedForC.sessionId === ca,
    ).toBeTrue();
    b.send({ type: 'sharing-started' });
    const resumedCb = watch(c, b);

    c.send({ type: 'watch', targetPeerId: null, sessionId: resumedCb });
    c.take('subscription-ended');
    c.take('watching');
    const db = watch(d, b);
    e.send({ type: 'watch', targetPeerId: b.id, sessionId: db });
    e.take('watching');
    e.take('error');
  } finally {
    hub.close();
  }
});

test('rooms accept ten participants and reject the eleventh', () => {
  const hub = hubWith({ maxRoomParticipants: 10 });
  try {
    const roomId = crypto.randomUUID();
    for (let index = 0; index < 10; index++) {
      const client = hub.createClient();
      const socket = new FakeSocket();
      hub.open(client, socket);
      hub.message(
        client,
        JSON.stringify(authorized({ type: 'join-room', roomId })),
      );
      const joined = socket.take('joined');
      expect(joined.type === 'joined' && joined.peers.length).toBe(index + 1);
    }
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    hub.message(
      client,
      JSON.stringify(authorized({ type: 'join-room', roomId })),
    );
    expect(socket.take('error')).toEqual({
      type: 'error',
      message: 'Sala cheia: limite de 10 participantes.',
    });
  } finally {
    hub.close();
  }
});

test('without a configured cap the room accepts more than ten participants', () => {
  const hub = hubWith();
  try {
    const roomId = crypto.randomUUID();
    for (let index = 0; index < 13; index++) {
      const client = hub.createClient();
      const socket = new FakeSocket();
      hub.open(client, socket);
      hub.message(
        client,
        JSON.stringify(authorized({ type: 'join-room', roomId })),
      );
      const joined = socket.take('joined');
      expect(joined.type === 'joined' && joined.peers.length).toBe(index + 1);
    }
  } finally {
    hub.close();
  }
});

test('participant aliases: trimmed, capped, broadcast to the room and reset on leave', () => {
  const hub = hubWith();
  const connect = () => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      client,
      socket,
      send: (message: unknown) =>
        hub.message(client, JSON.stringify(authorized(message))),
    };
  };
  const roomId = crypto.randomUUID();
  const join = () => {
    const peer = connect();
    peer.send({ type: 'join-room', roomId });
    const joined = peer.socket.take('joined');
    if (joined.type !== 'joined') throw new Error();
    return { ...peer, id: joined.peerId };
  };
  try {
    const a = join();
    const b = join();
    b.socket.inbox.length = 0;

    a.send({ type: 'set-alias', alias: `  ${'x'.repeat(40)}  ` });
    const seenByB = b.socket.take('room-state');
    if (seenByB.type !== 'room-state') throw new Error();
    const aliasForA = seenByB.peers.find(peer => peer.peerId === a.id)?.alias;
    expect(aliasForA).toBe('x'.repeat(32));

    // Idempotent updates do not re-broadcast.
    b.socket.inbox.length = 0;
    a.send({ type: 'set-alias', alias: 'x'.repeat(32) });
    expect(b.socket.inbox).toHaveLength(0);

    // Clearing the alias falls back to null.
    a.send({ type: 'set-alias', alias: '' });
    const cleared = b.socket.take('room-state');
    if (cleared.type !== 'room-state') throw new Error();
    expect(cleared.peers.find(peer => peer.peerId === a.id)?.alias).toBeNull();

    // Alias outside a room is rejected.
    const outsider = connect();
    outsider.send({ type: 'set-alias', alias: 'nope' });
    expect(outsider.socket.take('error').type).toBe('error');

    hub.leave(a.client);
    const afterLeave = b.socket.take('room-state');
    if (afterLeave.type !== 'room-state') throw new Error();
    expect(afterLeave.peers.some(peer => peer.peerId === a.id)).toBeFalse();
  } finally {
    hub.close();
  }
});

test('rt-publish / rt-unpublish carry the Cloudflare tracks and reset on leave', () => {
  const hub = hubWith();
  const connect = () => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      client,
      socket,
      send: (message: unknown) =>
        hub.message(client, JSON.stringify(authorized(message))),
    };
  };
  const roomId = crypto.randomUUID();
  const join = () => {
    const peer = connect();
    peer.send({ type: 'join-room', roomId });
    const joined = peer.socket.take('joined');
    if (joined.type !== 'joined') throw new Error();
    return { ...peer, id: joined.peerId };
  };
  try {
    const a = join();
    const b = join();
    b.socket.inbox.length = 0;

    a.send({
      type: 'rt-publish',
      sessionId: 'cf-sess-a',
      video: 'vid-a',
      audio: null,
    });
    const published = b.socket.take('room-state');
    if (published.type !== 'room-state') throw new Error();
    const entry = published.peers.find(peer => peer.peerId === a.id);
    expect(entry?.sharing).toBeTrue();
    expect(entry?.rt).toEqual({
      sessionId: 'cf-sess-a',
      video: 'vid-a',
      audio: null,
    });

    b.socket.inbox.length = 0;
    a.send({ type: 'rt-unpublish' });
    const unpublished = b.socket.take('room-state');
    if (unpublished.type !== 'room-state') throw new Error();
    const after = unpublished.peers.find(peer => peer.peerId === a.id);
    expect(after?.sharing).toBeFalse();
    expect(after?.rt).toBeNull();

    a.send({
      type: 'rt-publish',
      sessionId: 'cf-sess-a2',
      video: 'vid-a2',
      audio: 'aud-a2',
    });
    b.socket.take('room-state');
    hub.leave(a.client);
    const afterLeave = b.socket.take('room-state');
    if (afterLeave.type !== 'room-state') throw new Error();
    expect(afterLeave.peers.some(peer => peer.peerId === a.id)).toBeFalse();
  } finally {
    hub.close();
  }
});

test('rate, payload and backpressure failures do not crash the hub', () => {
  const hub = hubWith();
  const client = hub.createClient();
  const socket = new FakeSocket();
  hub.open(client, socket);
  hub.message(client, new Uint8Array([1]));
  expect(socket.take('error').type).toBe('error');
  for (let index = 0; index < 151; index++) hub.message(client, '{}');
  expect(socket.closed).toBeTrue();

  const slow = hub.createClient();
  const slowSocket = new FakeSocket();
  slowSocket.buffered = 2 * 1024 * 1024;
  hub.open(slow, slowSocket);
  hub.message(slow, '{}');
  expect(slowSocket.closed).toBeTrue();
  hub.close();
});

test('ping is answered with pong without needing a room', () => {
  const hub = hubWith();
  const client = hub.createClient();
  const socket = new FakeSocket();
  hub.open(client, socket);
  hub.message(client, JSON.stringify({ type: 'ping' }));
  expect(socket.take('pong').type).toBe('pong');
  hub.close();
});

test('a reconnecting client reclaims its previous peer id', () => {
  const hub = hubWith();
  const roomId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const join = () => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    hub.message(
      client,
      JSON.stringify(authorized({ type: 'join-room', roomId, clientId })),
    );
    return { client, socket };
  };
  try {
    const first = join();
    const joined = first.socket.take('joined');
    if (joined.type !== 'joined') throw new Error();
    expect(joined.peerId).toBe(clientId);
    hub.leave(first.client);

    const second = join();
    const rejoined = second.socket.take('joined');
    if (rejoined.type !== 'joined') throw new Error();
    expect(rejoined.peerId).toBe(clientId);
  } finally {
    hub.close();
  }
});

test('a reconnect race evicts the stale connection instead of duplicating the participant', () => {
  const hub = hubWith();
  const roomId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const join = () => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    hub.message(
      client,
      JSON.stringify(authorized({ type: 'join-room', roomId, clientId })),
    );
    return { client, socket };
  };
  try {
    const first = join();
    const joined = first.socket.take('joined');
    if (joined.type !== 'joined') throw new Error();
    expect(joined.peerId).toBe(clientId);

    // The old socket's close event has not fired yet (network blip, not a clean
    // close), so the stale member is still in the room when the client reconnects.
    const second = join();
    const rejoined = second.socket.take('joined');
    if (rejoined.type !== 'joined') throw new Error();
    expect(rejoined.peerId).toBe(clientId);
    expect(rejoined.peers).toHaveLength(1);
    expect(first.socket.closed).toBe(true);
    const state = second.socket.take('room-state');
    if (state.type !== 'room-state') throw new Error();
    expect(state.peers).toHaveLength(1);
    expect(state.peers[0]?.peerId).toBe(clientId);

    // The stale socket's belated close event must be a no-op: it must not remove
    // the member that already reclaimed this identity.
    second.socket.inbox.length = 0;
    hub.leave(first.client);
    expect(second.socket.inbox).toHaveLength(0);
  } finally {
    hub.close();
  }
});

// ---- dono, moderadores e transporte por sala ----

type RoomPeer = {
  client: Client;
  socket: FakeSocket;
  send(message: unknown): void;
};

// `take` devolve a primeira ocorrência; nestes testes cada join da sala já empilhou
// vários room-state, então o que interessa é sempre o mais recente.
function latest(socket: FakeSocket, type: ServerMessage['type']) {
  const found = [...socket.inbox].reverse().find(entry => entry.type === type);
  if (!found) throw new Error(`Mensagem ${type} não encontrada`);
  socket.inbox = socket.inbox.filter(entry => entry.type !== type);
  return found;
}

function hostFixture(
  options: Partial<ConstructorParameters<typeof SignalingHub>[1]> = {},
) {
  const db = new RoomDb(ROOM_SECRET);
  const hub = new SignalingHub(ROOM_SECRET, { db, ...options });
  const connect = (): RoomPeer => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      client,
      socket,
      send: message => hub.message(client, JSON.stringify(message)),
    };
  };
  const creator = connect();
  creator.send({ type: 'create-room', name: 'Sala com dono' });
  const created = creator.socket.take('room-created');
  if (created.type !== 'room-created') throw new Error();
  const join = (peer: RoomPeer, extra: Record<string, unknown> = {}) => {
    peer.send({
      type: 'join-room',
      roomId: created.roomId,
      credential: created.credential,
      ...extra,
    });
    const joined = peer.socket.take('joined');
    if (joined.type !== 'joined') throw new Error();
    return joined;
  };
  return { db, hub, connect, created, join };
}

test('create-room issues host secrets and only the right token yields the host role', () => {
  const { hub, connect, created, join } = hostFixture();
  try {
    expect(created.hostToken).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(created.recoveryCode).not.toBe(created.hostToken);

    const host = connect();
    const asHost = join(host, { hostToken: created.hostToken });
    expect(asHost.role).toBe('host');
    expect(asHost.hostClaimable).toBeFalse();
    expect(asHost.mediaProvider).toBe('webrtc');

    const guest = connect();
    expect(join(guest).role).toBe('guest');

    const impostor = connect();
    expect(join(impostor, { hostToken: created.recoveryCode }).role).toBe(
      'guest',
    );

    // O papel aparece no room-state, e nada além dele: nem memberId nem token.
    const state = latest(host.socket, 'room-state');
    if (state.type !== 'room-state') throw new Error();
    expect(state.peers.map(peer => peer.role).sort()).toEqual([
      'guest',
      'guest',
      'host',
    ]);
    for (const peer of state.peers)
      expect(Object.keys(peer).sort()).toEqual([
        'alias',
        'peerId',
        'role',
        'rt',
        'sharing',
      ]);
  } finally {
    hub.close();
  }
});

test('a temporary moderator grant is lost on reconnect; a permanent one is restored', () => {
  const { hub, connect, created, join } = hostFixture();
  try {
    const host = connect();
    join(host, { hostToken: created.hostToken });

    const temporaryMember = crypto.randomUUID();
    const temporary = connect();
    join(temporary, { memberId: temporaryMember });
    host.send({
      type: 'grant-moderator',
      targetPeerId: temporary.client.id,
      permanent: false,
    });
    const promoted = latest(temporary.socket, 'room-state');
    if (promoted.type !== 'room-state') throw new Error();
    expect(
      promoted.peers.find(peer => peer.peerId === temporary.client.id)?.role,
    ).toBe('moderator');

    // Uma conexão nova é um Client novo: a promoção temporária não sobrevive a ela.
    hub.leave(temporary.client);
    const rejoinedTemporary = connect();
    expect(join(rejoinedTemporary, { memberId: temporaryMember }).role).toBe(
      'guest',
    );

    const permanentMember = crypto.randomUUID();
    const permanent = connect();
    join(permanent, { memberId: permanentMember });
    host.send({
      type: 'grant-moderator',
      targetPeerId: permanent.client.id,
      permanent: true,
    });
    hub.leave(permanent.client);
    const rejoinedPermanent = connect();
    expect(join(rejoinedPermanent, { memberId: permanentMember }).role).toBe(
      'moderator',
    );
    // O grant é do memberId, não do navegador que por acaso reconectou.
    const stranger = connect();
    expect(join(stranger, { memberId: crypto.randomUUID() }).role).toBe(
      'guest',
    );
  } finally {
    hub.close();
  }
});

test('privileged actions are authorized by role, and the host is never a target', () => {
  const { hub, connect, created, join } = hostFixture({
    availableMediaProviders: ['webrtc', 'cloudflare'],
  });
  try {
    const host = connect();
    join(host, { hostToken: created.hostToken });
    const moderator = connect();
    join(moderator, { memberId: crypto.randomUUID() });
    const guest = connect();
    join(guest, { memberId: crypto.randomUUID() });
    host.send({
      type: 'grant-moderator',
      targetPeerId: moderator.client.id,
      permanent: false,
    });

    // Promover é só do dono, mesmo para quem já modera.
    moderator.send({
      type: 'grant-moderator',
      targetPeerId: guest.client.id,
      permanent: false,
    });
    expect(moderator.socket.take('error').type).toBe('error');
    guest.send({ type: 'kick-peer', targetPeerId: moderator.client.id });
    expect(guest.socket.take('error').type).toBe('error');
    guest.send({ type: 'set-room-media-provider', provider: 'cloudflare' });
    expect(guest.socket.take('error').type).toBe('error');
    moderator.send({ type: 'kick-peer', targetPeerId: host.client.id });
    expect(moderator.socket.take('error').type).toBe('error');
    expect(host.socket.closed).toBeFalse();

    // Moderador pode trocar o transporte, e todo mundo é avisado — inclusive quem
    // pediu, porque todos precisam refazer a conexão no transporte novo.
    moderator.send({ type: 'set-room-media-provider', provider: 'cloudflare' });
    for (const peer of [host, moderator, guest])
      expect(peer.socket.take('room-settings-changed')).toEqual({
        type: 'room-settings-changed',
        mediaProvider: 'cloudflare',
      });
    const rejoin = connect();
    expect(join(rejoin, {}).mediaProvider).toBe('cloudflare');

    // Moderador pode expulsar: o alvo recebe o aviso e sai da sala.
    moderator.send({ type: 'kick-peer', targetPeerId: guest.client.id });
    expect(guest.socket.take('kicked')).toEqual({
      type: 'kicked',
      by: 'moderator',
    });
    expect(guest.socket.closed).toBeTrue();
    const afterKick = latest(host.socket, 'room-state');
    if (afterKick.type !== 'room-state') throw new Error();
    expect(
      afterKick.peers.some(peer => peer.peerId === guest.client.id),
    ).toBeFalse();
  } finally {
    hub.close();
  }
});

test('a transport the server cannot serve is refused', () => {
  const { hub, connect, created, join } = hostFixture();
  try {
    const host = connect();
    join(host, { hostToken: created.hostToken });
    host.send({ type: 'set-room-media-provider', provider: 'cloudflare' });
    expect(host.socket.take('error').type).toBe('error');
    const rejoin = connect();
    expect(join(rejoin, {}).mediaProvider).toBe('webrtc');
  } finally {
    hub.close();
  }
});

test('revoking a moderator drops both the live role and the permanent grant', () => {
  const { db, hub, connect, created, join } = hostFixture();
  try {
    const host = connect();
    join(host, { hostToken: created.hostToken });
    const memberId = crypto.randomUUID();
    const moderator = connect();
    join(moderator, { memberId });
    host.send({
      type: 'grant-moderator',
      targetPeerId: moderator.client.id,
      permanent: true,
    });
    expect(db.isActiveModerator(created.roomId, memberId)).toBeTrue();

    host.send({ type: 'revoke-moderator', targetPeerId: moderator.client.id });
    expect(moderator.client.role).toBe('guest');
    expect(db.isActiveModerator(created.roomId, memberId)).toBeFalse();

    // Revogar pelo endpoint HTTP rebaixa a conexão ao vivo pelo hash do memberId.
    host.send({
      type: 'grant-moderator',
      targetPeerId: moderator.client.id,
      permanent: true,
    });
    const grant = db.listModerators(created.roomId)[0]!;
    const hash = db.revokeModeratorById(created.roomId, grant.id);
    hub.demoteModeratorByHash(created.roomId, hash!);
    expect(moderator.client.role).toBe('guest');
  } finally {
    hub.close();
  }
});

test('a room with no row is claimable exactly once', () => {
  const db = new RoomDb(ROOM_SECRET);
  const hub = new SignalingHub(ROOM_SECRET, { db });
  const connect = (): RoomPeer => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      client,
      socket,
      send: message => hub.message(client, JSON.stringify(message)),
    };
  };
  try {
    // Uma sala aberta de um convite salvo de antes deste recurso: credencial válida,
    // nenhuma linha no banco, portanto ninguém é dono.
    const roomId = crypto.randomUUID();
    const credential = issueRoomCredential(ROOM_SECRET, roomId, 'Sala antiga');
    const join = (peer: RoomPeer) => {
      peer.send({ type: 'join-room', roomId, credential });
      const joined = peer.socket.take('joined');
      if (joined.type !== 'joined') throw new Error();
      return joined;
    };

    const first = connect();
    const second = connect();
    // Todos veem a opção, não só quem entrou primeiro.
    const firstJoin = join(first);
    expect(firstJoin.hostClaimable).toBeTrue();
    expect(firstJoin.role).toBe('guest');
    expect(join(second).hostClaimable).toBeTrue();

    first.send({ type: 'claim-host' });
    const claimed = first.socket.take('host-claimed');
    if (claimed.type !== 'host-claimed') throw new Error();
    expect(first.client.role).toBe('host');
    expect(db.verifyHostToken(roomId, claimed.hostToken)).toBeTrue();

    // Quem perde a corrida recebe um erro simples e continua guest; o room-state que
    // já está a caminho mostra o crachá do novo dono.
    second.send({ type: 'claim-host' });
    expect(second.socket.take('error').type).toBe('error');
    expect(second.client.role).toBe('guest');

    const late = connect();
    const lateJoin = join(late);
    expect(lateJoin.hostClaimable).toBeFalse();
    expect(
      lateJoin.peers.find(peer => peer.peerId === first.client.id)?.role,
    ).toBe('host');
  } finally {
    hub.close();
  }
});
