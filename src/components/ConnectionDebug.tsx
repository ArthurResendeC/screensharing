'use client';
import { useEffect, useState } from 'react';
import type { Peers } from '@/lib/webrtc/peers';
import { collectStats, type Sample, type VideoStats } from '@/lib/webrtc/stats';
type Row = { id: string; peerId: string; direction: string; connectionState: string; iceConnectionState: string; iceGatheringState: string; signalingState: string; video: VideoStats[] };
export function ConnectionDebug({ peers, socketState }: { peers: Peers | null; socketState: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [codecs, setCodecs] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const samples = new Map<RTCPeerConnection, Map<string, Sample>>();
    async function poll() {
      const rows: Row[] = [];
      for (const pc of samples.keys()) if (![...(peers?.peers.values() ?? [])].some(entry => entry.pc === pc)) samples.delete(pc);
      for (const [id, { pc, peerId, direction }] of peers?.peers ?? []) {
        if (!samples.has(pc)) samples.set(pc, new Map());
        try {
          const video = await collectStats(pc, samples.get(pc)!);
          rows.push({ id, peerId, direction, connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, iceGatheringState: pc.iceGatheringState, signalingState: pc.signalingState, video });
        } catch { /* A peer can close while getStats is pending. */ }
      }
      if (active) {
        setRows(rows);
        setCodecs([...new Set(RTCRtpSender.getCapabilities?.('video')?.codecs.map(codec => codec.mimeType) ?? [])]);
        timer = setTimeout(() => void poll(), 2000);
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [open, peers]);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Debug WebRTC</summary>
    <p>WebSocket: {socketState}</p>
    <p>Codecs disponíveis (não necessariamente negociados): {codecs.join(', ') || 'indisponível'}</p>
    {rows.map(row => <section key={row.id}><h3>{row.direction === 'send' ? 'Envio para' : 'Recebimento de'} {row.peerId.slice(0, 8)}</h3>
      <pre>{JSON.stringify({ connectionState: row.connectionState, iceConnectionState: row.iceConnectionState, iceGatheringState: row.iceGatheringState, signalingState: row.signalingState }, null, 2)}</pre>
      {row.video.map((video, index) => <p key={index}>{video.direction}: {video.width ?? '?'} × {video.height ?? '?'} · {video.fps ?? '?'} FPS · Codec: {video.codec ?? '?'} · Pacotes: {video.packets ?? '?'} · Bitrate: {video.bitrate === undefined ? 'aguardando amostra' : `${(video.bitrate / 1e6).toFixed(2)} Mbps`}</p>)}
    </section>)}
  </details>;
}
