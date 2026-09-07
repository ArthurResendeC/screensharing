import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createSignalingServer } from '../server/signaling';
import { serverMessageSchema, type ServerMessage } from '../src/lib/signaling/messages';

test('room subscriptions: one selection, reciprocal watching, isolation and independent lifecycle', async () => {
  const server = createServer();
  const wss = createSignalingServer(server, ['http://localhost:3000']);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}`;
  const sockets: WebSocket[] = [];
  async function connect() {
    const ws = new WebSocket(url, { origin: 'http://localhost:3000' });
    sockets.push(ws);
    const inbox: ServerMessage[] = [];
    ws.on('message', data => inbox.push(serverMessageSchema.parse(JSON.parse(data.toString()))));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return {
      ws,
      inbox,
      send: (message: unknown) => ws.send(JSON.stringify(message)),
      async take(type: ServerMessage['type']) {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          const index = inbox.findIndex(message => message.type === type);
          if (index !== -1) return inbox.splice(index, 1)[0];
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error(`Timeout waiting for ${type}`);
      },
    };
  }
  try {
    const rejected = new WebSocket(url, { origin: 'https://untrusted.example' });
    await new Promise<void>(resolve => rejected.once('error', () => resolve()));
    const roomId = randomUUID();
    async function join(room = roomId) {
      const peer = await connect();
      peer.send({ type: 'join-room', roomId: room });
      const message = await peer.take('joined');
      if (message.type !== 'joined') throw new Error();
      return { ...peer, id: message.peerId };
    }
    const a = await join();
    const b = await join();
    const c = await join();
    const d = await join();
    const e = await join();
    const extra = await connect();
    extra.send({ type: 'join-room', roomId });
    await extra.take('error');
    a.ws.send('{invalid');
    await a.take('error');
    a.send({ type: 'join-room', roomId });
    await a.take('error');
    a.send({ type: 'sharing-started' });
    b.send({ type: 'sharing-started' });
    // The state snapshot is also available to late arrivals.
    const outsider = await join(randomUUID());
    const rejectedSession = randomUUID();
    outsider.send({ type: 'watch', targetPeerId: a.id, sessionId: rejectedSession });
    assert.deepEqual(await outsider.take('watching'), { type: 'watching', peerId: null, sessionId: rejectedSession });
    await outsider.take('error');
    a.send({ type: 'watch', targetPeerId: a.id, sessionId: randomUUID() });
    await a.take('watching');
    await a.take('error');
    c.send({ type: 'watch', targetPeerId: d.id, sessionId: randomUUID() });
    await c.take('watching');
    await c.take('error');
    async function watch(viewer: typeof a, publisher: typeof a) {
      const sessionId = randomUUID();
      viewer.send({ type: 'watch', targetPeerId: publisher.id, sessionId });
      assert.deepEqual(await viewer.take('watching'), { type: 'watching', peerId: publisher.id, sessionId });
      assert.deepEqual(await publisher.take('subscriber-joined'), { type: 'subscriber-joined', peerId: viewer.id, sessionId });
      return sessionId;
    }
    const ca = await watch(c, a);
    const offer = { type: 'offer', targetPeerId: c.id, sessionId: ca, sdp: { type: 'offer', sdp: 'v=0\r\n' } };
    a.send(offer);
    assert.deepEqual(await c.take('offer'), { type: 'offer', peerId: a.id, sessionId: ca, sdp: offer.sdp });
    c.send({ type: 'answer', targetPeerId: a.id, sessionId: ca, sdp: { type: 'answer', sdp: 'v=0\r\n' } });
    await a.take('answer');
    c.send({ type: 'ice-candidate', targetPeerId: a.id, sessionId: ca, candidate: { candidate: '', sdpMid: '0' } });
    await a.take('ice-candidate');
    // A and B may watch each other without overwriting either subscription.
    const ab = await watch(a, b);
    const ba = await watch(b, a);
    const cb = await watch(c, b);
    assert.deepEqual(await a.take('subscription-ended'), { type: 'subscription-ended', peerId: c.id, sessionId: ca });
    assert.deepEqual(await c.take('subscription-ended'), { type: 'subscription-ended', peerId: a.id, sessionId: ca });
    a.send(offer); // Revoked session must no longer be relayed.
    b.send({ ...offer, sessionId: cb });
    const nextOffer = await c.take('offer');
    assert(nextOffer.type === 'offer' && nextOffer.peerId === b.id && nextOffer.sessionId === cb);
    // Wrong role, wrong session and unrequested offers are silently discarded.
    c.send({ ...offer, targetPeerId: b.id, sessionId: cb });
    d.send({ ...offer, targetPeerId: c.id, sessionId: randomUUID() });
    b.send({ type: 'sharing-stopped' });
    assert.deepEqual(await a.take('subscription-ended'), { type: 'subscription-ended', peerId: b.id, sessionId: ab });
    const endedByB = await c.take('subscription-ended');
    assert(endedByB.type === 'subscription-ended' && endedByB.sessionId === cb);
    assert.equal(b.inbox.filter(message => message.type === 'offer').length, 0);
    assert.equal(c.inbox.filter(message => message.type === 'offer').length, 0);
    for (const expected of [ab, cb]) {
      const ended = await b.take('subscription-ended');
      assert(ended.type === 'subscription-ended' && ended.sessionId === expected);
    }
    // Stopping B's publication leaves B watching A.
    a.send({ ...offer, targetPeerId: b.id, sessionId: ba });
    await b.take('offer');
    a.ws.close(); // Original creator leaving does not close the room.
    const endedByA = await b.take('subscription-ended');
    assert(endedByA.type === 'subscription-ended' && endedByA.sessionId === ba);
    b.send({ type: 'sharing-started' });
    await watch(c, b);
    extra.send({ type: 'join-room', roomId });
    const snapshot = await extra.take('joined');
    assert(snapshot.type === 'joined' && snapshot.peers.length === 5 && snapshot.peers.some(peer => peer.peerId === b.id && peer.sharing));
    const stopId = randomUUID();
    c.send({ type: 'watch', targetPeerId: null, sessionId: stopId });
    await c.take('subscription-ended');
    await c.take('watching');
    // Duplicate session IDs cannot overwrite another viewer's connection.
    const db = await watch(d, b);
    e.send({ type: 'watch', targetPeerId: b.id, sessionId: db });
    await e.take('watching');
    await e.take('error');
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
