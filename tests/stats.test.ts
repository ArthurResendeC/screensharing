import { expect, test } from 'bun:test';
import { collectStats, type Sample } from '../src/lib/webrtc/stats';

const report = (timestamp: number, bytesSent: number, packetsSent: number, packetsLost: number) =>
  new Map<string, RTCStats>([
    ['transport', { id: 'transport', type: 'transport', timestamp, selectedCandidatePairId: 'pair' } as RTCStats],
    [
      'pair',
      {
        id: 'pair',
        type: 'candidate-pair',
        timestamp,
        state: 'succeeded',
        nominated: true,
        protocol: 'udp',
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        currentRoundTripTime: 0.042,
        availableOutgoingBitrate: 8_000_000,
      } as RTCStats,
    ],
    [
      'local',
      {
        id: 'local',
        type: 'local-candidate',
        timestamp,
        candidateType: 'host',
        address: '192.0.2.1',
        port: 5000,
      } as RTCStats,
    ],
    [
      'remote',
      {
        id: 'remote',
        type: 'remote-candidate',
        timestamp,
        candidateType: 'srflx',
        address: '198.51.100.1',
        port: 6000,
      } as RTCStats,
    ],
    [
      'source',
      {
        id: 'source',
        type: 'media-source',
        timestamp,
        kind: 'video',
        width: 2560,
        height: 1440,
        framesPerSecond: 60,
      } as RTCStats,
    ],
    ['codec', { id: 'codec', type: 'codec', timestamp, mimeType: 'video/VP9' } as RTCStats],
    [
      'outbound',
      {
        id: 'outbound',
        type: 'outbound-rtp',
        timestamp,
        kind: 'video',
        codecId: 'codec',
        bytesSent,
        packetsSent,
        framesEncoded: packetsSent,
        totalEncodeTime: packetsSent * 0.005,
        framesPerSecond: 60,
        frameWidth: 2560,
        frameHeight: 1440,
        qualityLimitationReason: 'none',
      } as RTCStats,
    ],
    [
      'remote-inbound',
      {
        id: 'remote-inbound',
        type: 'remote-inbound-rtp',
        timestamp,
        kind: 'video',
        localId: 'outbound',
        packetsLost,
        roundTripTime: 0.05,
        jitter: 0.004,
      } as RTCStats,
    ],
  ]) as unknown as RTCStatsReport;

test('collects route, capture and interval video bottleneck metrics', async () => {
  let current = report(1_000, 1_000_000, 100, 1);
  const pc = { getStats: async () => current } as RTCPeerConnection;
  const samples = new Map<string, Sample>();

  const first = await collectStats(pc, samples);
  expect(first.capture).toMatchObject({ width: 2560, height: 1440, fps: 60 });
  expect(first.network).toMatchObject({
    protocol: 'udp',
    localCandidateType: 'host',
    remoteCandidateType: 'srflx',
    currentRoundTripTimeMs: 42,
  });

  current = report(3_000, 2_000_000, 200, 5);
  const second = await collectStats(pc, samples);
  expect(second.video[0]).toMatchObject({
    codec: 'video/VP9',
    bitrate: 4_000_000,
    frameProcessingMs: 5,
    roundTripTimeMs: 50,
    jitterMs: 4,
  });
  expect(second.video[0]!.packetLossPercent).toBeCloseTo(3.85, 1);
});
