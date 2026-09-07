import type { Peers } from '../lib/webrtc/peers';
import { collectStats, type Sample, type VideoStats } from '../lib/webrtc/stats';

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

export class ConnectionDebug {
  private timer?: ReturnType<typeof setTimeout>;
  private samples = new Map<RTCPeerConnection, Map<string, Sample>>();

  constructor(
    private readonly details: HTMLDetailsElement,
    private readonly content: HTMLElement,
    private readonly getPeers: () => Peers | null,
    private readonly getSocketState: () => string,
  ) {
    details.addEventListener('toggle', () => {
      if (details.open) void this.poll();
      else this.stop();
    });
  }

  private async poll() {
    this.stop();
    const peers = this.getPeers();
    const active = [...(peers?.peers.values() ?? [])];
    for (const pc of this.samples.keys()) {
      if (!active.some(entry => entry.pc === pc)) this.samples.delete(pc);
    }
    const rows: Row[] = [];
    for (const [id, { pc, peerId, direction }] of peers?.peers ?? []) {
      if (!this.samples.has(pc)) this.samples.set(pc, new Map());
      try {
        rows.push({
          id,
          peerId,
          direction,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          video: await collectStats(pc, this.samples.get(pc)!),
        });
      } catch { /* A conexão pode fechar enquanto getStats está pendente. */ }
    }
    this.render(rows);
    if (this.details.open) this.timer = setTimeout(() => void this.poll(), 2000);
  }

  private render(rows: Row[]) {
    this.content.replaceChildren();
    const socket = document.createElement('p');
    socket.textContent = `WebSocket: ${this.getSocketState()}`;
    this.content.append(socket);
    const capabilities = RTCRtpSender.getCapabilities?.('video')?.codecs.map(codec => codec.mimeType) ?? [];
    const codecs = document.createElement('p');
    codecs.textContent = `Codecs disponíveis (não necessariamente negociados): ${[...new Set(capabilities)].join(', ') || 'indisponível'}`;
    this.content.append(codecs);
    for (const row of rows) {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = `${row.direction === 'send' ? 'Envio para' : 'Recebimento de'} ${row.peerId.slice(0, 8)}`;
      const state = document.createElement('pre');
      state.textContent = JSON.stringify({
        connectionState: row.connectionState,
        iceConnectionState: row.iceConnectionState,
        iceGatheringState: row.iceGatheringState,
        signalingState: row.signalingState,
      }, null, 2);
      section.append(title, state);
      for (const video of row.video) {
        const line = document.createElement('p');
        line.textContent = `${video.direction}: ${video.width ?? '?'} × ${video.height ?? '?'} · ${video.fps ?? '?'} FPS · Codec: ${video.codec ?? '?'} · Pacotes: ${video.packets ?? '?'} · Bitrate: ${video.bitrate === undefined ? 'aguardando amostra' : `${(video.bitrate / 1e6).toFixed(2)} Mbps`}`;
        section.append(line);
      }
      this.content.append(section);
    }
  }

  refresh() {
    if (this.details.open) void this.poll();
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose() {
    this.stop();
    this.samples.clear();
  }
}
