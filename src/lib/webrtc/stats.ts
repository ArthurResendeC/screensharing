export type VideoStats = { codec?: string; width?: number; height?: number; fps?: number; packets?: number; bitrate?: number; direction: string };
export type Sample = { bytes: number; timestamp: number };
export async function collectStats(pc: RTCPeerConnection, previous: Map<string, Sample>): Promise<VideoStats[]> {
  const report = await pc.getStats();
  const rows: VideoStats[] = [];
  report.forEach((stat: RTCStats & { kind?: string; mediaType?: string; codecId?: string; bytesSent?: number; bytesReceived?: number; packetsSent?: number; packetsReceived?: number; frameWidth?: number; frameHeight?: number; framesPerSecond?: number }) => {
    if (!['inbound-rtp', 'outbound-rtp'].includes(stat.type) || (stat.kind ?? stat.mediaType) !== 'video') return;
    const bytes = stat.bytesSent ?? stat.bytesReceived ?? 0;
    const last = previous.get(stat.id);
    const bitrate = last && stat.timestamp > last.timestamp && bytes >= last.bytes ? (bytes - last.bytes) * 8000 / (stat.timestamp - last.timestamp) : undefined;
    previous.set(stat.id, { bytes, timestamp: stat.timestamp });
    const codec: { mimeType?: string } | undefined = stat.codecId ? report.get(stat.codecId) : undefined;
    rows.push({ codec: codec?.mimeType, width: stat.frameWidth, height: stat.frameHeight, fps: stat.framesPerSecond, packets: stat.packetsSent ?? stat.packetsReceived, bitrate, direction: stat.type === 'outbound-rtp' ? 'Enviado' : 'Recebido' });
  });
  return rows;
}
