import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Peers } from '../src/lib/webrtc/peers';
import type { ClientMessage } from '../src/lib/signaling/messages';

class FakeConnection {
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  signalingState = 'stable';
  closed = false;
  added: RTCIceCandidateInit[] = [];
  async setRemoteDescription(sdp: RTCSessionDescriptionInit) { this.remoteDescription = sdp; this.signalingState = 'stable'; }
  async setLocalDescription(sdp: RTCSessionDescriptionInit) { this.localDescription = sdp; this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async addIceCandidate(candidate: RTCIceCandidateInit) { assert(this.remoteDescription, 'ICE applied before remote SDP'); this.added.push(candidate); }
  addTrack() {}
  getTransceivers() { return []; }
  getSenders() { return []; }
  getReceivers() { return []; }
  close() { this.closed = true; }
}
test('single receiver, reciprocal sessions, early ICE, stale signaling and independent cleanup', async () => {
  const original = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakeConnection as unknown as typeof RTCPeerConnection;
  try {
    const sent: ClientMessage[] = [];
    const peers = new Peers(message => sent.push(message), () => {}, () => {}, error => { throw error; });
    const peerId = randomUUID(), sessionId = randomUUID();
    const candidate = { candidate: 'candidate:test', sdpMid: '0' };
    const offer = { type: 'offer' as const, peerId, sessionId, sdp: { type: 'offer' as const, sdp: 'offer' } };
    await peers.receive(offer); // No unsolicited connection creation.
    assert.equal(peers.peers.size, 0);
    peers.select(peerId, sessionId);
    await peers.receive({ type: 'ice-candidate', peerId, sessionId, candidate });
    const receiver = peers.peers.get(sessionId)!.pc as unknown as FakeConnection;
    assert.equal(receiver.added.length, 0);
    await peers.receive(offer);
    assert.equal(receiver.added.length, 1);
    assert.equal(sent[0].type, 'answer');
    const sendingId = randomUUID();
    await peers.offer(peerId, sendingId, { getTracks: () => [] } as unknown as MediaStream);
    const sender = peers.peers.get(sendingId)!.pc as unknown as FakeConnection;
    assert.equal(peers.peers.size, 2); // Same participant, separate directions.
    await peers.receive({ type: 'ice-candidate', peerId, sessionId: sendingId, candidate });
    assert.equal(sender.added.length, 0);
    await peers.receive({ type: 'answer', peerId, sessionId: randomUUID(), sdp: { type: 'answer', sdp: 'stale' } });
    assert.equal(sender.remoteDescription, null);
    await peers.receive({ type: 'answer', peerId, sessionId: sendingId, sdp: { type: 'answer', sdp: 'answer' } });
    assert.equal(sender.added.length, 1);
    const nextId = randomUUID();
    peers.select(randomUUID(), nextId);
    assert(receiver.closed);
    assert(!sender.closed);
    assert.equal([...peers.peers.values()].filter(entry => entry.direction === 'receive').length, 1);
    await peers.receive(offer);
    assert(!peers.peers.has(sessionId));
    peers.closeDirection('send');
    assert(sender.closed);
    assert(peers.peers.has(nextId));
    peers.closeAllPeers();
    assert.equal(peers.peers.size, 0);
  } finally { globalThis.RTCPeerConnection = original; }
});

test('selection change while remote SDP is pending cannot emit an old answer', async () => {
  const original = globalThis.RTCPeerConnection;
  let resolveDescription!: () => void;
  class DelayedConnection extends FakeConnection {
    async setRemoteDescription(sdp: RTCSessionDescriptionInit) {
      await new Promise<void>(resolve => { resolveDescription = resolve; });
      this.remoteDescription = sdp;
    }
  }
  globalThis.RTCPeerConnection = DelayedConnection as unknown as typeof RTCPeerConnection;
  try {
    const sent: ClientMessage[] = [];
    const peers = new Peers(message => sent.push(message), () => {}, () => {}, error => { throw error; });
    const peerId = randomUUID(), sessionId = randomUUID();
    peers.select(peerId, sessionId);
    const receiving = peers.receive({ type: 'offer', peerId, sessionId, sdp: { type: 'offer', sdp: 'offer' } });
    peers.select(randomUUID(), randomUUID());
    resolveDescription();
    await receiving;
    assert.equal(sent.length, 0);
    peers.closeAllPeers();
  } finally { globalThis.RTCPeerConnection = original; }
});
