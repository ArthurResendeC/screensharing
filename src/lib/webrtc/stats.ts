export type VideoStats = {
  id: string;
  codec?: string;
  codecParameters?: string;
  decoder?: string;
  encoder?: string;
  powerEfficient?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  packets?: number;
  packetsLost?: number;
  packetLossPercent?: number;
  bitrate?: number;
  targetBitrate?: number;
  jitterMs?: number;
  roundTripTimeMs?: number;
  frames?: number;
  framesDropped?: number;
  frameProcessingMs?: number;
  retransmittedPackets?: number;
  nackCount?: number;
  pliCount?: number;
  firCount?: number;
  keyFrames?: number;
  qualityLimitationReason?: string;
  direction: 'Enviado' | 'Recebido';
};

type NetworkStats = {
  protocol?: string;
  localCandidateType?: string;
  remoteCandidateType?: string;
  localAddress?: string;
  remoteAddress?: string;
  networkType?: string;
  relayProtocol?: string;
  currentRoundTripTimeMs?: number;
  availableOutgoingBitrate?: number;
  availableIncomingBitrate?: number;
  bytesSent?: number;
  bytesReceived?: number;
};

type CaptureStats = { width?: number; height?: number; fps?: number; frames?: number };
export type PeerStats = { video: VideoStats[]; network?: NetworkStats; capture?: CaptureStats };

export type Sample = {
  bytes: number;
  timestamp: number;
  packets?: number;
  packetsLost?: number;
  frames?: number;
  totalProcessingTime?: number;
};

type ExtendedStat = RTCStats & {
  kind?: string;
  mediaType?: string;
  codecId?: string;
  remoteId?: string;
  localId?: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  bytesSent?: number;
  bytesReceived?: number;
  packetsSent?: number;
  packetsReceived?: number;
  packetsLost?: number;
  frameWidth?: number;
  frameHeight?: number;
  width?: number;
  height?: number;
  framesPerSecond?: number;
  framesSent?: number;
  framesEncoded?: number;
  framesReceived?: number;
  framesDecoded?: number;
  framesDropped?: number;
  frames?: number;
  totalEncodeTime?: number;
  totalDecodeTime?: number;
  retransmittedPacketsSent?: number;
  retransmittedPacketsReceived?: number;
  nackCount?: number;
  pliCount?: number;
  firCount?: number;
  keyFramesEncoded?: number;
  keyFramesDecoded?: number;
  qualityLimitationReason?: string;
  targetBitrate?: number;
  jitter?: number;
  roundTripTime?: number;
  currentRoundTripTime?: number;
  availableOutgoingBitrate?: number;
  availableIncomingBitrate?: number;
  encoderImplementation?: string;
  decoderImplementation?: string;
  powerEfficientEncoder?: boolean;
  powerEfficientDecoder?: boolean;
  mimeType?: string;
  sdpFmtpLine?: string;
  protocol?: string;
  candidateType?: string;
  address?: string;
  ip?: string;
  port?: number;
  networkType?: string;
  relayProtocol?: string;
  nominated?: boolean;
  selected?: boolean;
  state?: string;
};

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const milliseconds = (seconds: number | undefined) => (seconds === undefined ? undefined : seconds * 1000);

function selectedPair(report: RTCStatsReport): ExtendedStat | undefined {
  let transport: ExtendedStat | undefined;
  let fallback: ExtendedStat | undefined;
  report.forEach(raw => {
    const stat = raw as ExtendedStat;
    if (stat.type === 'transport' && stat.selectedCandidatePairId) transport = stat;
    if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.selected || stat.nominated) && !fallback)
      fallback = stat;
  });
  return (
    (transport?.selectedCandidatePairId
      ? (report.get(transport.selectedCandidatePairId) as ExtendedStat | undefined)
      : undefined) ?? fallback
  );
}

function candidateAddress(candidate: ExtendedStat | undefined) {
  if (!candidate) return undefined;
  const address = candidate.address ?? candidate.ip;
  return address && candidate.port ? `${address}:${candidate.port}` : address;
}

export async function collectStats(pc: RTCPeerConnection, previous: Map<string, Sample>): Promise<PeerStats> {
  const report = await pc.getStats();
  const video: VideoStats[] = [];
  let capture: CaptureStats | undefined;
  const pair = selectedPair(report);
  const local = pair?.localCandidateId ? (report.get(pair.localCandidateId) as ExtendedStat | undefined) : undefined;
  const remote = pair?.remoteCandidateId ? (report.get(pair.remoteCandidateId) as ExtendedStat | undefined) : undefined;
  const network: NetworkStats | undefined = pair
    ? {
        protocol: pair.protocol ?? local?.protocol,
        localCandidateType: local?.candidateType,
        remoteCandidateType: remote?.candidateType,
        localAddress: candidateAddress(local),
        remoteAddress: candidateAddress(remote),
        networkType: local?.networkType,
        relayProtocol: local?.relayProtocol,
        currentRoundTripTimeMs: milliseconds(finite(pair.currentRoundTripTime)),
        availableOutgoingBitrate: finite(pair.availableOutgoingBitrate),
        availableIncomingBitrate: finite(pair.availableIncomingBitrate),
        bytesSent: finite(pair.bytesSent),
        bytesReceived: finite(pair.bytesReceived),
      }
    : undefined;

  report.forEach(raw => {
    const stat = raw as ExtendedStat;
    const kind = stat.kind ?? stat.mediaType;
    if (stat.type === 'media-source' && kind === 'video') {
      capture = {
        width: finite(stat.width ?? stat.frameWidth),
        height: finite(stat.height ?? stat.frameHeight),
        fps: finite(stat.framesPerSecond),
        frames: finite(stat.frames),
      };
      return;
    }
    if (!['inbound-rtp', 'outbound-rtp'].includes(stat.type) || kind !== 'video') return;

    const outbound = stat.type === 'outbound-rtp';
    let remoteRtp = stat.remoteId ? (report.get(stat.remoteId) as ExtendedStat | undefined) : undefined;
    if (outbound && !remoteRtp)
      report.forEach(candidate => {
        const related = candidate as ExtendedStat;
        if (related.type === 'remote-inbound-rtp' && related.localId === stat.id) remoteRtp = related;
      });
    const bytes = stat.bytesSent ?? stat.bytesReceived ?? 0;
    const packets = stat.packetsSent ?? stat.packetsReceived;
    const packetsLost = outbound ? remoteRtp?.packetsLost : stat.packetsLost;
    const frames = outbound ? (stat.framesEncoded ?? stat.framesSent) : (stat.framesDecoded ?? stat.framesReceived);
    const totalProcessingTime = outbound ? stat.totalEncodeTime : stat.totalDecodeTime;
    const last = previous.get(stat.id);
    const elapsed = last && stat.timestamp > last.timestamp ? stat.timestamp - last.timestamp : undefined;
    const bitrate = last && elapsed && bytes >= last.bytes ? ((bytes - last.bytes) * 8000) / elapsed : undefined;
    const packetDelta = last?.packets === undefined || packets === undefined ? undefined : packets - last.packets;
    const lostDelta =
      last?.packetsLost === undefined || packetsLost === undefined ? undefined : packetsLost - last.packetsLost;
    const packetLossPercent =
      packetDelta !== undefined && lostDelta !== undefined && packetDelta + lostDelta > 0
        ? (Math.max(0, lostDelta) * 100) / (packetDelta + Math.max(0, lostDelta))
        : undefined;
    const frameDelta = last?.frames === undefined || frames === undefined ? undefined : frames - last.frames;
    const processingDelta =
      last?.totalProcessingTime === undefined || totalProcessingTime === undefined
        ? undefined
        : totalProcessingTime - last.totalProcessingTime;
    const frameProcessingMs =
      frameDelta !== undefined && frameDelta > 0 && processingDelta !== undefined
        ? (processingDelta * 1000) / frameDelta
        : undefined;
    previous.set(stat.id, { bytes, timestamp: stat.timestamp, packets, packetsLost, frames, totalProcessingTime });

    const codec = stat.codecId ? (report.get(stat.codecId) as ExtendedStat | undefined) : undefined;
    video.push({
      id: stat.id,
      codec: codec?.mimeType,
      codecParameters: codec?.sdpFmtpLine,
      width: finite(stat.frameWidth),
      height: finite(stat.frameHeight),
      fps: finite(stat.framesPerSecond),
      packets: finite(packets),
      packetsLost: finite(packetsLost),
      packetLossPercent,
      bitrate,
      targetBitrate: finite(stat.targetBitrate),
      jitterMs: milliseconds(finite(outbound ? remoteRtp?.jitter : stat.jitter)),
      roundTripTimeMs: milliseconds(finite(remoteRtp?.roundTripTime)) ?? network?.currentRoundTripTimeMs,
      frames: finite(frames),
      framesDropped: finite(stat.framesDropped),
      frameProcessingMs,
      retransmittedPackets: finite(stat.retransmittedPacketsSent ?? stat.retransmittedPacketsReceived),
      nackCount: finite(stat.nackCount),
      pliCount: finite(stat.pliCount),
      firCount: finite(stat.firCount),
      keyFrames: finite(stat.keyFramesEncoded ?? stat.keyFramesDecoded),
      qualityLimitationReason: stat.qualityLimitationReason,
      encoder: stat.encoderImplementation,
      decoder: stat.decoderImplementation,
      powerEfficient: stat.powerEfficientEncoder ?? stat.powerEfficientDecoder,
      direction: outbound ? 'Enviado' : 'Recebido',
    });
  });
  return { video, network, capture };
}
