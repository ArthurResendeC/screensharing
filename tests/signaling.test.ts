import { test, expect } from 'bun:test';
import { serverMessageSchema, type ServerMessage } from '../src/lib/signaling/messages';
import { SignalingHub, type Client, type SignalingSocket } from '../server/signaling';

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

test('room subscriptions: one selection, reciprocal watching, isolation and independent lifecycle', () => {
  const hub = new SignalingHub();
  const connect = (): Peer => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return {
      client,
      socket,
      send: message => hub.message(client, JSON.stringify(message)),
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
    const extra = connect();
    extra.send({ type: 'join-room', roomId });
    expect(extra.take('error').type).toBe('error');
    a.send('{invalid');
    expect(a.take('error').type).toBe('error');
    a.send({ type: 'join-room', roomId });
    expect(a.take('error').type).toBe('error');
    a.send({ type: 'sharing-started' });
    b.send({ type: 'sharing-started' });

    const outsider = join(crypto.randomUUID());
    const rejectedSession = crypto.randomUUID();
    outsider.send({ type: 'watch', targetPeerId: a.id, sessionId: rejectedSession });
    expect(outsider.take('watching')).toEqual({ type: 'watching', peerId: null, sessionId: rejectedSession });
    expect(outsider.take('error').type).toBe('error');
    a.send({ type: 'watch', targetPeerId: a.id, sessionId: crypto.randomUUID() });
    a.take('watching');
    a.take('error');
    c.send({ type: 'watch', targetPeerId: d.id, sessionId: crypto.randomUUID() });
    c.take('watching');
    c.take('error');

    const watch = (viewer: typeof a, publisher: typeof a) => {
      const sessionId = crypto.randomUUID();
      viewer.send({ type: 'watch', targetPeerId: publisher.id, sessionId });
      expect(viewer.take('watching')).toEqual({ type: 'watching', peerId: publisher.id, sessionId });
      expect(publisher.take('subscriber-joined')).toEqual({ type: 'subscriber-joined', peerId: viewer.id, sessionId });
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
    expect(c.take('offer')).toEqual({ type: 'offer', peerId: a.id, sessionId: ca, sdp: offer.sdp });
    c.send({ type: 'answer', targetPeerId: a.id, sessionId: ca, sdp: { type: 'answer', sdp: 'v=0\r\n' } });
    expect(a.take('answer').type).toBe('answer');
    c.send({ type: 'ice-candidate', targetPeerId: a.id, sessionId: ca, candidate: { candidate: '', sdpMid: '0' } });
    expect(a.take('ice-candidate').type).toBe('ice-candidate');

    const ab = watch(a, b);
    const ba = watch(b, a);
    const cb = watch(c, b);
    expect(a.take('subscription-ended')).toEqual({ type: 'subscription-ended', peerId: c.id, sessionId: ca });
    expect(c.take('subscription-ended')).toEqual({ type: 'subscription-ended', peerId: a.id, sessionId: ca });
    a.send(offer);
    b.send({ ...offer, sessionId: cb });
    const nextOffer = c.take('offer');
    expect(nextOffer.type === 'offer' && nextOffer.peerId === b.id && nextOffer.sessionId === cb).toBeTrue();

    c.send({ ...offer, targetPeerId: b.id, sessionId: cb });
    d.send({ ...offer, targetPeerId: c.id, sessionId: crypto.randomUUID() });
    b.send({ type: 'sharing-stopped' });
    expect(a.take('subscription-ended')).toEqual({ type: 'subscription-ended', peerId: b.id, sessionId: ab });
    expect(c.take('subscription-ended').type).toBe('subscription-ended');
    expect(b.socket.inbox.filter(message => message.type === 'offer')).toHaveLength(0);
    expect(c.socket.inbox.filter(message => message.type === 'offer')).toHaveLength(0);
    for (const expected of [ab, cb]) {
      const ended = b.take('subscription-ended');
      expect(ended.type === 'subscription-ended' && ended.sessionId === expected).toBeTrue();
    }

    a.send({ ...offer, targetPeerId: b.id, sessionId: ba });
    b.take('offer');
    hub.leave(a.client);
    const endedByA = b.take('subscription-ended');
    expect(endedByA.type === 'subscription-ended' && endedByA.sessionId === ba).toBeTrue();
    b.send({ type: 'sharing-started' });
    watch(c, b);
    extra.send({ type: 'join-room', roomId });
    const snapshot = extra.take('joined');
    expect(
      snapshot.type === 'joined' &&
        snapshot.peers.length === 5 &&
        snapshot.peers.some(peer => peer.peerId === b.id && peer.sharing),
    ).toBeTrue();

    const stopId = crypto.randomUUID();
    c.send({ type: 'watch', targetPeerId: null, sessionId: stopId });
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

test('participant aliases: trimmed, capped, broadcast to the room and reset on leave', () => {
  const hub = new SignalingHub();
  const connect = () => {
    const client = hub.createClient();
    const socket = new FakeSocket();
    hub.open(client, socket);
    return { client, socket, send: (message: unknown) => hub.message(client, JSON.stringify(message)) };
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

test('rate, payload and backpressure failures do not crash the hub', () => {
  const hub = new SignalingHub();
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
