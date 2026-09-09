import type { ClientMessage, PeerSignal } from '../signaling/messages';
import { setVideoCodecPreference, type VideoCodecPreference } from './codecs';
import { MAX_VIDEO_BITRATE, VIDEO_DEGRADATION_PREFERENCE, rtcConfiguration } from './rtcConfiguration';
import { tuneVideoBitrate } from './sdp';

type Entry = {
  peerId: string;
  sessionId: string;
  direction: 'send' | 'receive';
  pc: RTCPeerConnection;
  candidates: RTCIceCandidateInit[];
  remoteStream?: MediaStream;
};

export class Peers {
  // Key by subscription, not participant: A watching B and B watching A are independent.
  readonly peers = new Map<string, Entry>();
  constructor(
    private send: (message: ClientMessage) => void,
    private onStream: (sessionId: string, peerId: string, stream: MediaStream | null) => void,
    private onChange: () => void,
    private onError: (error: unknown) => void,
  ) {}
  private current(entry: Entry) {
    return this.peers.get(entry.sessionId) === entry;
  }
  private createPeerConnection(peerId: string, sessionId: string, direction: Entry['direction']) {
    this.removeSession(sessionId);
    const pc = new RTCPeerConnection(rtcConfiguration);
    const entry: Entry = { pc, peerId, sessionId, direction, candidates: [] };
    this.peers.set(sessionId, entry);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || !this.current(entry)) return;
      try {
        this.send({
          type: 'ice-candidate',
          targetPeerId: peerId,
          sessionId,
          candidate: { ...candidate.toJSON(), candidate: candidate.candidate },
        });
      } catch (error) {
        this.onError(error);
      }
    };
    pc.ontrack = ({ track, streams }) => {
      if (!this.current(entry) || direction !== 'receive') return;
      entry.remoteStream ??= streams[0] ?? new MediaStream();
      if (!entry.remoteStream.getTracks().includes(track)) entry.remoteStream.addTrack(track);
      this.onStream(entry.sessionId, entry.peerId, entry.remoteStream);
    };
    pc.onconnectionstatechange =
      pc.oniceconnectionstatechange =
      pc.onicegatheringstatechange =
      pc.onsignalingstatechange =
        this.onChange;
    this.onChange();
    return entry;
  }
  select(peerId: string | null, sessionId: string) {
    // Create before sending watch: ICE can precede the offer, but never the selection.
    if (peerId) this.createPeerConnection(peerId, sessionId, 'receive');
  }
  async offer(peerId: string, sessionId: string, stream: MediaStream, codecPreference: VideoCodecPreference = 'auto') {
    const entry = this.createPeerConnection(peerId, sessionId, 'send');
    try {
      for (const track of stream.getTracks()) entry.pc.addTrack(track, stream);
      // Every subscription has exactly one offerer, including reciprocal viewing.
      for (const transceiver of entry.pc.getTransceivers()) {
        transceiver.direction = 'sendonly';
        if (transceiver.sender.track?.kind === 'video' && !setVideoCodecPreference(transceiver, codecPreference))
          this.onError(
            new Error('O navegador não aplicou o codec preferido; a transmissão usará a negociação automática.'),
          );
      }
      const offer = await entry.pc.createOffer();
      if (!this.current(entry)) return;
      if (offer.sdp) offer.sdp = tuneVideoBitrate(offer.sdp);
      await entry.pc.setLocalDescription(offer);
      if (!this.current(entry)) return;
      this.send({
        type: 'offer',
        targetPeerId: peerId,
        sessionId,
        sdp: { type: 'offer', sdp: entry.pc.localDescription!.sdp },
      });
    } catch (error) {
      if (this.current(entry)) {
        this.removeSession(sessionId);
        this.onError(error);
      }
    }
  }
  private async flush(entry: Entry) {
    for (const candidate of entry.candidates.splice(0)) {
      if (!this.current(entry)) return;
      await entry.pc.addIceCandidate(candidate);
    }
  }
  async receive(message: PeerSignal) {
    const entry = this.peers.get(message.sessionId);
    // Never recreate a connection from unsolicited or stale SDP/ICE.
    if (!entry || entry.peerId !== message.peerId) return;
    try {
      const { pc } = entry;
      if (message.type === 'ice-candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
        else if (entry.candidates.length < 128) entry.candidates.push(message.candidate);
        return;
      }
      if (message.type === 'offer') {
        if (entry.direction !== 'receive' || pc.remoteDescription) return;
        await pc.setRemoteDescription(message.sdp);
        if (!this.current(entry)) return;
        await this.flush(entry);
        if (!this.current(entry)) return;
        const answer = await pc.createAnswer();
        if (!this.current(entry)) return;
        await pc.setLocalDescription(answer);
        if (this.current(entry))
          this.send({
            type: 'answer',
            targetPeerId: entry.peerId,
            sessionId: entry.sessionId,
            sdp: { type: 'answer', sdp: pc.localDescription!.sdp },
          });
        return;
      }
      if (entry.direction !== 'send' || pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription({ type: 'answer', sdp: tuneVideoBitrate(message.sdp.sdp) });
      if (!this.current(entry)) return;
      await this.flush(entry);
      if (this.current(entry)) await this.applyEncodeParameters(entry);
    } catch (error) {
      if (this.current(entry)) {
        this.removeSession(entry.sessionId);
        this.onError(error);
      }
    }
  }
  // The sender only honours maxBitrate/degradationPreference once it has a transceiver,
  // so this runs after negotiation and again whenever the encode settings change.
  private async applyEncodeParameters(entry: Entry) {
    for (const sender of entry.pc.getSenders()) {
      if (!this.current(entry)) return;
      if (sender.track?.kind !== 'video') continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) continue;
      parameters.degradationPreference = VIDEO_DEGRADATION_PREFERENCE;
      if (MAX_VIDEO_BITRATE) for (const encoding of parameters.encodings) encoding.maxBitrate = MAX_VIDEO_BITRATE;
      try {
        await sender.setParameters(parameters);
      } catch {
        if (this.current(entry))
          this.onError(
            new Error('O navegador não aplicou as preferências opcionais de codificação; a transmissão continua.'),
          );
      }
    }
  }
  async reapplyEncodeParameters() {
    for (const entry of this.peers.values()) if (entry.direction === 'send') await this.applyEncodeParameters(entry);
  }
  removeSession(sessionId: string) {
    const entry = this.peers.get(sessionId);
    if (!entry) return;
    this.peers.delete(sessionId);
    entry.candidates.length = 0;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange =
      entry.pc.oniceconnectionstatechange =
      entry.pc.onicegatheringstatechange =
      entry.pc.onsignalingstatechange =
        null;
    for (const receiver of entry.pc.getReceivers()) receiver.track?.stop();
    entry.pc.close();
    if (entry.direction === 'receive') this.onStream(entry.sessionId, entry.peerId, null);
    this.onChange();
  }
  removePeer(peerId: string) {
    for (const entry of this.peers.values()) if (entry.peerId === peerId) this.removeSession(entry.sessionId);
  }
  closeDirection(direction: Entry['direction']) {
    for (const entry of this.peers.values()) if (entry.direction === direction) this.removeSession(entry.sessionId);
  }
  closeAllPeers() {
    for (const sessionId of this.peers.keys()) this.removeSession(sessionId);
  }
}
