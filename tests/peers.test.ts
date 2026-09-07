import { test, expect } from 'bun:test';
import { Peers } from '../src/lib/webrtc/peers';
import type { ClientMessage } from '../src/lib/signaling/messages';

class FakeConnection {
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  signalingState = 'stable';
  closed = false;
  added: RTCIceCandidateInit[] = [];
  async setRemoteDescription(sdp: RTCSessionDescriptionInit) {
    this.remoteDescription = sdp;
    this.signalingState = 'stable';
  }
  async setLocalDescription(sdp: RTCSessionDescriptionInit) {
    this.localDescription = sdp;
    this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer' };
  }
  async createOffer() {
    return { type: 'offer', sdp: 'offer' };
  }
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    expect(this.remoteDescription).not.toBeNull();
    this.added.push(candidate);
  }
  addTrack() {}
  getTransceivers() {
    return [];
  }
  getSenders() {
    return [];
  }
  getReceivers() {
    return [];
  }
  close() {
    this.closed = true;
  }
}
test('single receiver, reciprocal sessions, early ICE, stale signaling and independent cleanup', async () => {
  const original = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakeConnection as unknown as typeof RTCPeerConnection;
  try {
    const sent: ClientMessage[] = [];
    const peers = new Peers(
      message => sent.push(message),
      () => {},
      () => {},
      error => {
        throw error;
      },
    );
    const peerId = crypto.randomUUID(),
      sessionId = crypto.randomUUID();
    const candidate = { candidate: 'candidate:test', sdpMid: '0' };
    const offer = { type: 'offer' as const, peerId, sessionId, sdp: { type: 'offer' as const, sdp: 'offer' } };
    await peers.receive(offer); // No unsolicited connection creation.
    expect(peers.peers.size).toBe(0);
    peers.select(peerId, sessionId);
    await peers.receive({ type: 'ice-candidate', peerId, sessionId, candidate });
    const receiver = peers.peers.get(sessionId)!.pc as unknown as FakeConnection;
    expect(receiver.added.length).toBe(0);
    await peers.receive(offer);
    expect(receiver.added.length).toBe(1);
    expect(sent[0].type).toBe('answer');
    const sendingId = crypto.randomUUID();
    await peers.offer(peerId, sendingId, { getTracks: () => [] } as unknown as MediaStream);
    const sender = peers.peers.get(sendingId)!.pc as unknown as FakeConnection;
    expect(peers.peers.size).toBe(2); // Same participant, separate directions.
    await peers.receive({ type: 'ice-candidate', peerId, sessionId: sendingId, candidate });
    expect(sender.added.length).toBe(0);
    await peers.receive({
      type: 'answer',
      peerId,
      sessionId: crypto.randomUUID(),
      sdp: { type: 'answer', sdp: 'stale' },
    });
    expect(sender.remoteDescription).toBeNull();
    await peers.receive({ type: 'answer', peerId, sessionId: sendingId, sdp: { type: 'answer', sdp: 'answer' } });
    expect(sender.added.length).toBe(1);
    const nextId = crypto.randomUUID();
    peers.select(crypto.randomUUID(), nextId);
    expect(receiver.closed).toBeTrue();
    expect(sender.closed).toBeFalse();
    expect([...peers.peers.values()].filter(entry => entry.direction === 'receive').length).toBe(1);
    await peers.receive(offer);
    expect(peers.peers.has(sessionId)).toBeFalse();
    peers.closeDirection('send');
    expect(sender.closed).toBeTrue();
    expect(peers.peers.has(nextId)).toBeTrue();
    peers.closeAllPeers();
    expect(peers.peers.size).toBe(0);
  } finally {
    globalThis.RTCPeerConnection = original;
  }
});

test('selection change while remote SDP is pending cannot emit an old answer', async () => {
  const original = globalThis.RTCPeerConnection;
  let resolveDescription!: () => void;
  class DelayedConnection extends FakeConnection {
    async setRemoteDescription(sdp: RTCSessionDescriptionInit) {
      await new Promise<void>(resolve => {
        resolveDescription = resolve;
      });
      this.remoteDescription = sdp;
    }
  }
  globalThis.RTCPeerConnection = DelayedConnection as unknown as typeof RTCPeerConnection;
  try {
    const sent: ClientMessage[] = [];
    const peers = new Peers(
      message => sent.push(message),
      () => {},
      () => {},
      error => {
        throw error;
      },
    );
    const peerId = crypto.randomUUID(),
      sessionId = crypto.randomUUID();
    peers.select(peerId, sessionId);
    const receiving = peers.receive({ type: 'offer', peerId, sessionId, sdp: { type: 'offer', sdp: 'offer' } });
    peers.select(crypto.randomUUID(), crypto.randomUUID());
    resolveDescription();
    await receiving;
    expect(sent.length).toBe(0);
    peers.closeAllPeers();
  } finally {
    globalThis.RTCPeerConnection = original;
  }
});
