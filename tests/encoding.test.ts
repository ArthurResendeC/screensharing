import { test, expect } from 'bun:test';
import { Peers } from '../src/lib/webrtc/peers';
import { setVideoDegradation } from '../src/lib/webrtc/rtcConfiguration';

class FakeSender {
  constructor(public track: { kind: string } | null) {}
  params: RTCRtpSendParameters = { encodings: [{}], transactionId: '', codecs: [], headerExtensions: [], rtcp: {} };
  getParameters() {
    return this.params;
  }
  async setParameters(params: RTCRtpSendParameters) {
    this.params = params;
  }
}

class FakeConnection {
  signalingState = 'have-local-offer';
  senders = [new FakeSender({ kind: 'video' }), new FakeSender({ kind: 'audio' })];
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  async setRemoteDescription(sdp: RTCSessionDescriptionInit) {
    this.remoteDescription = sdp;
    this.signalingState = 'stable';
  }
  async setLocalDescription(sdp: RTCSessionDescriptionInit) {
    this.localDescription = sdp;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'offer' };
  }
  async addIceCandidate() {}
  addTrack() {}
  getTransceivers() {
    return [];
  }
  getSenders() {
    return this.senders;
  }
  getReceivers() {
    return [];
  }
  close() {}
}

test('degradationPreference and maxBitrate reach the video sender and follow live changes', async () => {
  const original = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakeConnection as unknown as typeof RTCPeerConnection;
  try {
    setVideoDegradation('framerate');
    const peers = new Peers(
      () => {},
      () => {},
      () => {},
      error => {
        throw error;
      },
    );
    const peerId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    await peers.offer(peerId, sessionId, { getTracks: () => [] } as unknown as MediaStream);
    await peers.receive({ type: 'answer', peerId, sessionId, sdp: { type: 'answer', sdp: 'answer' } });

    const connection = peers.peers.get(sessionId)!.pc as unknown as FakeConnection;
    const [video, audio] = connection.senders;
    expect(video!.params.degradationPreference).toBe('maintain-framerate');
    expect(video!.params.encodings[0]!.maxBitrate).toBeGreaterThan(0);
    expect(audio!.params.degradationPreference).toBeUndefined();

    setVideoDegradation('resolution');
    await peers.reapplyEncodeParameters();
    expect(video!.params.degradationPreference).toBe('maintain-resolution');

    setVideoDegradation('framerate');
    peers.closeAllPeers();
  } finally {
    globalThis.RTCPeerConnection = original;
  }
});
