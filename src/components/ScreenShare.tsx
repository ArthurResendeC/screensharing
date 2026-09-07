'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { connectSignaling } from '@/lib/signaling/client';
import type { Participant, ServerMessage } from '@/lib/signaling/messages';
import { Peers } from '@/lib/webrtc/peers';
import { Viewer } from './Viewer';
import { ConnectionDebug } from './ConnectionDebug';

type Selection = { peerId: string; sessionId: string };
type Session = {
  peers: Peers;
  channel: ReturnType<typeof connectSignaling> | null;
  members: Participant[];
  stream: MediaStream | null;
  selection: Selection | null;
  watchRequest: string;
  disposed: boolean;
  capture: number;
  joined: boolean;
};
const participantName = (id: string) => `Participante ${id.slice(0, 8)}`;

export function ScreenShare({ roomId }: { roomId: string }) {
  const sessionRef = useRef<Session | null>(null);
  const [socketState, setSocketState] = useState('connecting');
  const [selfId, setSelfId] = useState('');
  const [members, setMembers] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<MediaTrackSettings>({});
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [receivingState, setReceivingState] = useState('aguardando');
  const [watchers, setWatchers] = useState(0);
  const [manager, setManager] = useState<Peers | null>(null);
  const [attempt, setAttempt] = useState(0);

  function stopSharing(session: Session, notify: boolean) {
    session.capture++;
    session.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    session.stream = null;
    session.peers.closeDirection('send');
    if (!session.disposed) {
      setLocalStream(null);
      setSettings({});
      setCapturing(false);
    }
    if (notify && session.joined) {
      try { session.channel?.send({ type: 'sharing-stopped' }); }
      catch { /* Signaling disconnection also stops publishing. */ }
    }
  }

  useEffect(() => {
    const reportError = (error: unknown) => {
      if (!session.disposed) setError(error instanceof Error ? error.message : 'Falha na conexão WebRTC.');
    };
    const peers = new Peers(
      message => session.channel!.send(message),
      stream => { if (!session.disposed) setRemoteStream(stream); },
      () => {
        if (session.disposed) return;
        const entries = [...peers.peers.values()];
        setReceivingState(entries.find(entry => entry.direction === 'receive')?.pc.connectionState ?? 'aguardando');
        setWatchers(entries.filter(entry => entry.direction === 'send').length);
      },
      reportError,
    );
    const session: Session = {
      peers, channel: null, members: [], stream: null, selection: null,
      watchRequest: '', disposed: false, capture: 0, joined: false,
    };
    sessionRef.current = session;
    let queue = Promise.resolve();

    function updateMembers(next: Participant[]) {
      for (const member of session.members) {
        if (!next.some(peer => peer.peerId === member.peerId)) peers.removePeer(member.peerId);
      }
      session.members = next;
      setMembers(next);
    }
    async function receive(message: ServerMessage) {
      if (session.disposed || !session.channel) return;
      switch (message.type) {
        case 'joined':
          session.joined = true;
          setSelfId(message.peerId);
          updateMembers(message.peers);
          break;
        case 'room-state':
          updateMembers(message.peers);
          break;
        case 'watching':
          if (message.sessionId !== session.watchRequest) break;
          if (!message.peerId) {
            peers.closeDirection('receive');
            session.selection = null;
            setSelectedId(null);
          }
          break;
        case 'subscriber-joined':
          if (session.stream) void peers.offer(message.peerId, message.sessionId, session.stream);
          break;
        case 'subscription-ended':
          peers.removeSession(message.sessionId);
          if (session.selection?.sessionId === message.sessionId) {
            session.selection = null;
            setSelectedId(null);
          }
          break;
        case 'error':
          setError(message.message);
          break;
        default:
          if (session.joined) await peers.receive(message);
      }
    }
    // Defer socket setup so Strict Mode's discarded setup never joins a room.
    queueMicrotask(() => {
      if (session.disposed) return;
      setManager(peers);
      setSocketState('connecting');
      setSelfId('');
      setMembers([]);
      setLocalStream(null);
      setRemoteStream(null);
      setSelectedId(null);
      setSettings({});
      setReceivingState('aguardando');
      setWatchers(0);
      setError('');
      setCopied(false);
      setCapturing(false);
      try {
        session.channel = connectSignaling(roomId, message => {
          queue = queue.then(() => receive(message)).catch(reportError);
        }, state => {
          if (session.disposed) return;
          setSocketState(state);
          if (state === 'connected') return;
          session.joined = false;
          stopSharing(session, false);
          peers.closeAllPeers();
          session.selection = null;
          setSelectedId(null);
          setMembers([]);
          setError('Signaling desconectado. Verifique o servidor, HTTPS/WSS e a origem permitida.');
          session.disposed = true;
          session.channel?.close();
        });
      } catch (error) { reportError(error); setSocketState('error'); }
    });
    const unload = () => {
      session.disposed = true;
      stopSharing(session, false);
      peers.closeAllPeers();
      session.channel?.close();
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setAttempt(value => value + 1); };
    window.addEventListener('pagehide', unload);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', unload);
      window.removeEventListener('pageshow', restore);
      unload();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [roomId, attempt]);

  useEffect(() => {
    if (!localStream) return;
    const timer = setInterval(() => setSettings(localStream.getVideoTracks()[0]?.getSettings() ?? {}), 2000);
    return () => clearInterval(timer);
  }, [localStream]);

  function watch(peerId: string | null) {
    const session = sessionRef.current;
    if (!session?.joined || session.disposed) return;
    const sessionId = crypto.randomUUID();
    session.watchRequest = sessionId;
    session.selection = peerId ? { peerId, sessionId } : null;
    setError('');
    setSelectedId(peerId);
    try {
      session.peers.select(peerId, sessionId);
      session.channel!.send({ type: 'watch', targetPeerId: peerId, sessionId });
    } catch (error) {
      session.peers.closeDirection('receive');
      session.selection = null;
      setSelectedId(null);
      setError(error instanceof Error ? error.message : 'Não foi possível assistir.');
    }
  }

  async function share() {
    const session = sessionRef.current;
    if (!session?.joined || session.disposed || session.stream || capturing) return;
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      setError('Captura de tela exige HTTPS (ou localhost) e um navegador compatível.');
      return;
    }
    const capture = ++session.capture;
    setCapturing(true);
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 60 } },
        audio: true,
      });
      if (session.disposed || !session.joined || session.capture !== capture) {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      session.stream = captured;
      const screenTrack = captured.getVideoTracks()[0];
      screenTrack.onended = () => stopSharing(session, true);
      setLocalStream(captured);
      setSettings(screenTrack.getSettings());
      session.channel!.send({ type: 'sharing-started' });
    } catch (error) {
      if (!session.disposed && session.capture === capture) {
        stopSharing(session, false);
        setError(error instanceof Error ? `Não foi possível capturar: ${error.message}` : 'Captura cancelada.');
      }
    } finally {
      if (!session.disposed && session.capture === capture) setCapturing(false);
    }
  }

  const connected = socketState === 'connected' && !!selfId;
  return <main>
    <Link href="/">← Início / sair da sala</Link>
    <h1>WebRTC Screen Share</h1>
    <p>Sala: <code>{roomId}</code></p>
    <button disabled={!connected} onClick={async () => {
      try { await navigator.clipboard.writeText(location.href); setCopied(true); }
      catch { setError('Não foi possível copiar. Copie a URL da barra do navegador.'); }
    }}>{copied ? 'Link copiado' : 'Copiar convite'}</button>
    <p>Participantes: {members.length} / 5</p>
    {selfId && <p>Você: {participantName(selfId)}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {socketState !== 'connected' && socketState !== 'connecting' && <button onClick={() => setAttempt(value => value + 1)}>Reconectar à sala</button>}

    <section aria-label="Minha transmissão">
      <h2>Minha transmissão</h2>
      <div className="actions">
        <button disabled={!connected || !!localStream || capturing} onClick={() => void share()}>{capturing ? 'Selecionando tela…' : 'Compartilhar tela'}</button>
        <button disabled={!localStream && !capturing} onClick={() => { const session = sessionRef.current; if (session) stopSharing(session, true); }}>Parar compartilhamento</button>
      </div>
      {localStream && <>
        <p>Captura real: {settings.width ?? '?'} × {settings.height ?? '?'} · {settings.frameRate ?? 'indisponível'} FPS · {localStream.getAudioTracks().length ? 'Áudio incluído' : 'Sem áudio disponível nesta captura'}</p>
        <p>Assistindo à sua tela: {watchers}</p>
        <details><summary>Preview local (sem som)</summary><Viewer stream={localStream} local /></details>
      </>}
    </section>

    <section aria-label="Transmissões da sala">
      <h2>Transmissões da sala</h2>
      <p>Escolha uma tela para assistir. Você pode transmitir e assistir ao mesmo tempo.</p>
      <ul>{members.map(member => <li key={member.peerId}>
        {participantName(member.peerId)}{member.peerId === selfId ? ' (você)' : ''} — {member.sharing ? 'Transmitindo' : 'Sem transmissão'}{' '}
        {member.sharing && member.peerId !== selfId && <button disabled={!connected} aria-pressed={selectedId === member.peerId} onClick={() => watch(member.peerId)}>
          {selectedId === member.peerId ? 'Reconectar a' : 'Assistir a'} {participantName(member.peerId)}
        </button>}
      </li>)}</ul>
      {selectedId && <>
        <p>Assistindo: {participantName(selectedId)}</p>
        <button onClick={() => watch(null)}>Parar de assistir</button>
      </>}
      <p>Conexão: {receivingState}{receivingState === 'failed' && ' — tente reconectar à transmissão; esta rede pode exigir TURN.'}</p>
      <Viewer stream={remoteStream} />
    </section>
    <ConnectionDebug peers={manager} socketState={socketState} />
  </main>;
}
