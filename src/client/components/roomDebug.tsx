import { useEffect, useRef, useState } from 'react';
import { collectStats, type PeerStats, type Sample, type VideoStats } from '../../lib/webrtc/stats';
import type { MediaProvider } from '../media/types';

type Row = {
  id: string;
  peerId: string;
  direction: string;
  connectionState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
  stats: PeerStats;
};

type Finding = { area: 'Browser/encoder' | 'Rede/infra' | 'Receptor'; level: 'info' | 'warning'; text: string };
type BrowserEnvironment = {
  browser: string;
  platform?: string;
  logicalProcessors?: number;
  memoryGb?: number;
  gpu?: string;
  effectiveConnection?: string;
  estimatedDownlinkMbps?: number;
  estimatedRttMs?: number;
  dataSaver?: boolean;
};

type NavigatorDiagnostics = Navigator & {
  deviceMemory?: number;
  userAgentData?: { platform?: string };
  connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
};

const value = (number: number | undefined, suffix = '', digits = 0) =>
  number === undefined ? 'indisponível' : `${number.toFixed(digits)}${suffix}`;
const bitrate = (number: number | undefined) => value(number === undefined ? undefined : number / 1e6, ' Mbps', 2);
const bytes = (number: number | undefined) => value(number === undefined ? undefined : number / 1e6, ' MB', 1);
const percent = (number: number | undefined) => value(number, '%', 1);

function browserEnvironment(): BrowserEnvironment {
  const diagnostics = navigator as NavigatorDiagnostics;
  let gpu: string | undefined;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info') as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null
      | undefined;
    const renderer = gl && extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : undefined;
    if (typeof renderer === 'string') gpu = renderer;
  } catch {
    // Some browsers intentionally hide renderer details for privacy.
  }
  return {
    browser: navigator.userAgent,
    platform: diagnostics.userAgentData?.platform ?? navigator.platform,
    logicalProcessors: navigator.hardwareConcurrency,
    memoryGb: diagnostics.deviceMemory,
    gpu,
    effectiveConnection: diagnostics.connection?.effectiveType,
    estimatedDownlinkMbps: diagnostics.connection?.downlink,
    estimatedRttMs: diagnostics.connection?.rtt,
    dataSaver: diagnostics.connection?.saveData,
  };
}

function diagnose(row: Row): Finding[] {
  const findings: Finding[] = [];
  const { network, capture, video } = row.stats;
  if (row.connectionState !== 'connected')
    findings.push({ area: 'Rede/infra', level: 'warning', text: `Conexão WebRTC em ${row.connectionState}.` });
  if (network?.localCandidateType === 'relay' || network?.remoteCandidateType === 'relay')
    findings.push({
      area: 'Rede/infra',
      level: 'info',
      text: `Mídia passando por TURN${network.relayProtocol ? ` via ${network.relayProtocol.toUpperCase()}` : ''}; verifique a região e a capacidade do relay.`,
    });
  if (network?.protocol?.toLowerCase() === 'tcp')
    findings.push({
      area: 'Rede/infra',
      level: 'warning',
      text: 'Rota de mídia em TCP; perda de pacotes pode causar bloqueio e aumento de latência.',
    });
  if ((network?.currentRoundTripTimeMs ?? 0) >= 150)
    findings.push({
      area: 'Rede/infra',
      level: 'warning',
      text: `RTT elevado (${value(network?.currentRoundTripTimeMs, ' ms')}); confira distância, Wi-Fi e TURN.`,
    });

  for (const item of video) {
    const loss = item.packetLossPercent ?? 0;
    if (loss >= 2)
      findings.push({
        area: 'Rede/infra',
        level: 'warning',
        text: `${item.direction}: ${percent(loss)} de perda na última amostra.`,
      });
    if ((item.jitterMs ?? 0) >= 30)
      findings.push({
        area: 'Rede/infra',
        level: 'warning',
        text: `${item.direction}: jitter elevado (${value(item.jitterMs, ' ms', 1)}).`,
      });
    if (item.direction === 'Enviado' && item.qualityLimitationReason === 'cpu')
      findings.push({
        area: 'Browser/encoder',
        level: 'warning',
        text: 'O próprio navegador informa limitação por CPU; isso também pode incluir o pipeline de GPU/encoder.',
      });
    if (item.direction === 'Enviado' && item.qualityLimitationReason === 'bandwidth')
      findings.push({
        area: 'Rede/infra',
        level: 'warning',
        text: 'O próprio navegador está reduzindo qualidade por falta de banda estimada.',
      });
    if (
      item.direction === 'Enviado' &&
      capture?.fps !== undefined &&
      item.fps !== undefined &&
      capture.fps - item.fps >= 8
    )
      findings.push({
        area: 'Browser/encoder',
        level: 'warning',
        text: `A captura entrega ${capture.fps.toFixed(0)} FPS, mas o encoder envia ${item.fps.toFixed(0)} FPS.`,
      });
    if (item.fps && item.frameProcessingMs !== undefined && item.frameProcessingMs > (1000 / item.fps) * 0.8)
      findings.push({
        area: item.direction === 'Enviado' ? 'Browser/encoder' : 'Receptor',
        level: 'warning',
        text: `${item.direction}: ${value(item.frameProcessingMs, ' ms', 1)} por frame está próximo do orçamento de ${value(1000 / item.fps, ' ms', 1)}.`,
      });
    if (item.direction === 'Recebido' && (item.framesDropped ?? 0) > 0)
      findings.push({
        area: 'Receptor',
        level: 'info',
        text: `${item.framesDropped} frames descartados no receptor; observe se o contador cresce rapidamente.`,
      });
    if (item.powerEfficient === false)
      findings.push({
        area: item.direction === 'Enviado' ? 'Browser/encoder' : 'Receptor',
        level: 'info',
        text: `${item.direction}: o navegador não indica um codec energeticamente eficiente/acelerado.`,
      });
  }
  if (!findings.length)
    findings.push({
      area: 'Rede/infra',
      level: 'info',
      text: 'Nenhum gargalo evidente nesta amostra. Observe os valores durante o problema.',
    });
  return findings;
}

function VideoMetrics({ video }: { video: VideoStats }) {
  return (
    <div className="debug-metrics">
      <span>Resolução</span>
      <strong>
        {video.width ?? '?'} × {video.height ?? '?'}
      </strong>
      <span>FPS</span>
      <strong>{video.fps ?? 'indisponível'}</strong>
      <span>Bitrate atual / alvo</span>
      <strong>
        {bitrate(video.bitrate)} / {bitrate(video.targetBitrate)}
      </strong>
      <span>Perda na amostra / total</span>
      <strong>
        {percent(video.packetLossPercent)} / {video.packetsLost ?? 'indisponível'} pacotes
      </strong>
      <span>RTT (latência) / jitter</span>
      <strong>
        {value(video.roundTripTimeMs, ' ms', 1)} / {value(video.jitterMs, ' ms', 1)}
      </strong>
      <span>Tempo por frame</span>
      <strong>{value(video.frameProcessingMs, ' ms', 2)}</strong>
      <span>Frames processados / descartados</span>
      <strong>
        {video.frames ?? 'indisponível'} / {video.framesDropped ?? 'indisponível'}
      </strong>
      <span>Retransmitidos · NACK · PLI · FIR</span>
      <strong>
        {video.retransmittedPackets ?? '?'} · {video.nackCount ?? '?'} · {video.pliCount ?? '?'} ·{' '}
        {video.firCount ?? '?'}
      </strong>
      <span>Codec</span>
      <strong title={video.codecParameters}>{video.codec ?? 'indisponível'}</strong>
      <span>{video.direction === 'Enviado' ? 'Encoder' : 'Decoder'}</span>
      <strong>{video.encoder ?? video.decoder ?? 'não exposto pelo browser'}</strong>
      <span>Aceleração eficiente</span>
      <strong>{video.powerEfficient === undefined ? 'não exposta' : video.powerEfficient ? 'sim' : 'não'}</strong>
      {video.direction === 'Enviado' && (
        <>
          <span>Limitador de qualidade</span>
          <strong>{video.qualityLimitationReason ?? 'não exposto'}</strong>
        </>
      )}
    </div>
  );
}

export function RoomDebug({ controller, socketState }: { controller: MediaProvider; socketState: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [environment] = useState(browserEnvironment);
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
            stats: await collectStats(pc, samples.current.get(pc)!),
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
      <p className="debug-note">
        Atualização a cada 2 s. CPU/GPU não expõem utilização direta: os diagnósticos usam sinais do pipeline WebRTC e
        devem ser tratados como indícios.
      </p>
      <details open>
        <summary>Ambiente local</summary>
        <div className="debug-metrics">
          <span>WebSocket</span>
          <strong>{socketState}</strong>
          <span>Plataforma</span>
          <strong>{environment.platform || 'indisponível'}</strong>
          <span>CPU lógica / memória</span>
          <strong>
            {environment.logicalProcessors ?? '?'} threads / {value(environment.memoryGb, ' GB')}
          </strong>
          <span>GPU/renderizador</span>
          <strong>{environment.gpu ?? 'ocultado pelo browser'}</strong>
          <span>Rede estimada pelo browser</span>
          <strong>
            {environment.effectiveConnection ?? '?'} · {value(environment.estimatedDownlinkMbps, ' Mbps', 1)} · RTT{' '}
            {value(environment.estimatedRttMs, ' ms')}
            {environment.dataSaver ? ' · economia de dados ativa' : ''}
          </strong>
          <span>User agent</span>
          <strong>{environment.browser}</strong>
          <span>Codecs disponíveis</span>
          <strong>{[...new Set(capabilities)].join(', ') || 'indisponível'}</strong>
        </div>
      </details>
      {controller.getPeers() === null ? (
        <p>
          O transporte de mídia é gerenciado pelo servidor de mídia. Para estatísticas RTP detalhadas, use
          <code> chrome://webrtc-internals</code> ou <code>about:webrtc</code> no navegador.
        </p>
      ) : (
        !rows.length && <p>Nenhuma conexão de mídia ativa.</p>
      )}
      {rows.map(row => {
        const { network, capture } = row.stats;
        return (
          <section className="debug-peer" key={row.id}>
            <h3>
              {row.direction === 'send' ? 'Envio para' : 'Recebimento de'} {controller.nameOf(row.peerId)}
            </h3>
            <div className="debug-findings">
              {diagnose(row).map((finding, index) => (
                <p className={finding.level} key={`${finding.area}-${index}`}>
                  <strong>{finding.area}:</strong> {finding.text}
                </p>
              ))}
            </div>
            <details open>
              <summary>Conexão e rota selecionada</summary>
              <div className="debug-metrics">
                <span>Estados conexão / ICE / signaling</span>
                <strong>
                  {row.connectionState} / {row.iceConnectionState} / {row.signalingState}
                </strong>
                <span>Coleta ICE</span>
                <strong>{row.iceGatheringState}</strong>
                <span>Protocolo / rede</span>
                <strong>
                  {network?.protocol?.toUpperCase() ?? '?'} / {network?.networkType ?? '?'}
                  {network?.relayProtocol ? ` / relay ${network.relayProtocol}` : ''}
                </strong>
                <span>Candidatos local → remoto</span>
                <strong>
                  {network?.localCandidateType ?? '?'} ({network?.localAddress ?? '?'}) →{' '}
                  {network?.remoteCandidateType ?? '?'} ({network?.remoteAddress ?? '?'})
                </strong>
                <span>RTT atual</span>
                <strong>{value(network?.currentRoundTripTimeMs, ' ms', 1)}</strong>
                <span>Banda estimada saída / entrada</span>
                <strong>
                  {bitrate(network?.availableOutgoingBitrate)} / {bitrate(network?.availableIncomingBitrate)}
                </strong>
                <span>Tráfego acumulado saída / entrada</span>
                <strong>
                  {bytes(network?.bytesSent)} / {bytes(network?.bytesReceived)}
                </strong>
              </div>
            </details>
            {capture && (
              <p>
                Captura antes do encoder: {capture.width ?? '?'} × {capture.height ?? '?'} · {capture.fps ?? '?'} FPS ·{' '}
                {capture.frames ?? '?'} frames
              </p>
            )}
            {row.stats.video.map(video => (
              <details open key={video.id}>
                <summary>{video.direction}: vídeo RTP</summary>
                <VideoMetrics video={video} />
              </details>
            ))}
          </section>
        );
      })}
    </div>
  );
}
