import { useEffect, useRef, useState } from 'react';
import { collectStats, type Sample, type VideoStats } from '../../lib/webrtc/stats';
import type { ScreenShareController } from '../screenShare';

type Row = {
  id: string;
  peerId: string;
  direction: string;
  connectionState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
  video: VideoStats[];
};

export function RoomDebug({ controller, socketState }: { controller: ScreenShareController; socketState: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const samples = useRef(new Map<RTCPeerConnection, Map<string, Sample>>());
  const capabilities = RTCRtpSender.getCapabilities?.('video')?.codecs.map(codec => codec.mimeType) ?? [];

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const peers = controller.getPeers();
      const entries = [...(peers?.peers.entries() ?? [])];
      for (const pc of samples.current.keys())
        if (!entries.some(([, entry]) => entry.pc === pc)) samples.current.delete(pc);
      const next: Row[] = [];
      for (const [id, { pc, peerId, direction }] of entries) {
        if (!samples.current.has(pc)) samples.current.set(pc, new Map());
        try {
          next.push({
            id,
            peerId,
            direction,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState,
            video: await collectStats(pc, samples.current.get(pc)!),
          });
        } catch {
          // The connection may close while stats are pending.
        }
      }
      if (active) setRows(next);
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
      samples.current.clear();
    };
  }, [controller]);

  return (
    <div className="debug-content">
      <p>WebSocket: {socketState}</p>
      <p>
        Codecs disponíveis (não necessariamente negociados): {[...new Set(capabilities)].join(', ') || 'indisponível'}
      </p>
      {rows.map(row => (
        <section key={row.id}>
          <h3>
            {row.direction === 'send' ? 'Envio para' : 'Recebimento de'} {controller.nameOf(row.peerId)}
          </h3>
          <pre>
            {JSON.stringify(
              {
                connectionState: row.connectionState,
                iceConnectionState: row.iceConnectionState,
                iceGatheringState: row.iceGatheringState,
                signalingState: row.signalingState,
              },
              null,
              2,
            )}
          </pre>
          {row.video.map((video, index) => (
            <p key={`${video.direction}-${index}`}>
              {video.direction}: {video.width ?? '?'} × {video.height ?? '?'} · {video.fps ?? '?'} FPS · Codec:{' '}
              {video.codec ?? '?'} · Pacotes: {video.packets ?? '?'} · Bitrate:{' '}
              {video.bitrate === undefined ? 'aguardando amostra' : `${(video.bitrate / 1e6).toFixed(2)} Mbps`}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
