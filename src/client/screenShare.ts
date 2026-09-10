import { connectSignaling } from '../lib/signaling/client';
import { ALIAS_MAX_LENGTH, MAX_WATCHED_STREAMS, type Participant, type ServerMessage } from '../lib/signaling/messages';
import { normalizeVideoCodecPreference, type VideoCodecPreference } from '../lib/webrtc/codecs';
import { Peers } from '../lib/webrtc/peers';
import { setVideoDegradation, type VideoDegradation } from '../lib/webrtc/rtcConfiguration';
import {
  CAPTURE_PRESETS,
  persistAlias,
  persistCaptureQuality,
  persistCodecPreference,
  persistDegradation,
  storedAlias,
  storedCaptureQuality,
  storedCodecPreference,
  storedDegradation,
} from './media/preferences';
import type { CaptureQuality, MediaProvider, ScreenShareState, Selection } from './media/types';
import { ACCENTS } from './media/types';
import { displayName, participantName } from './participantPresentation';
import { inviteUrl, rememberRoomAccess } from './roomStorage';
import { playSound, unlockSounds } from './sounds';
import { loadTheme, type Theme } from './theme';

// Compatibilidade: componentes importam estes nomes de './screenShare'.
export { ACCENTS } from './media/types';
export type { ScreenShareState } from './media/types';
type Session = {
  peers: Peers;
  channel: ReturnType<typeof connectSignaling> | null;
  members: Participant[];
  stream: MediaStream | null;
  selections: Map<string, Selection>;
  disposed: boolean;
  capture: number;
  joined: boolean;
  membersSeeded: boolean;
  codecPreference: VideoCodecPreference;
};

type Listener = () => void;

export class ScreenShareController implements MediaProvider {
  private session: Session | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly clientId = crypto.randomUUID?.() ?? '';
  private localStream: MediaStream | null = null;
  private readonly watchTargets = new Map<string, string>();
  private resumeWatch = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private disposed = false;
  private accessTerminal = false;
  private started = false;
  private settingsTimer?: ReturnType<typeof setInterval>;
  private knownWatcherIds = new Set<string>();
  private activeCodecPreference: VideoCodecPreference | null = null;
  private state: ScreenShareState = {
    mediaProvider: 'webrtc',
    socketState: 'connecting',
    selfId: '',
    members: [],
    selectedIds: [],
    alias: storedAlias(),
    capturing: false,
    sharing: false,
    localStream: null,
    remoteStreams: [],
    captureInfo: '',
    connectionState: 'aguardando',
    watcherIds: [],
    error: '',
    joinError: '',
    accessError: '',
    roomName: '',
    passwordProtected: false,
    endedReason: null,
    endedPeerId: null,
    theme: loadTheme(),
    accent: ACCENTS[0].color,
    degradation: storedDegradation(),
    captureQuality: storedCaptureQuality(),
    codecPreference: storedCodecPreference(),
    inviteCopied: false,
  };

  constructor(
    private readonly roomId: string,
    private readonly credential: string,
    private roomPassword?: string,
    private roomAccessToken?: string,
  ) {}

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ScreenShareState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.disposed = false;
    unlockSounds();
    setVideoDegradation(this.state.degradation);
    document.addEventListener('visibilitychange', this.wakeReconnect);
    window.addEventListener('online', this.wakeReconnect);
    window.addEventListener('pageshow', this.wakeReconnect);
    this.startSession();
  }

  nameOf(peerId: string | null) {
    if (!peerId) return '';
    const member = this.state.members.find(entry => entry.peerId === peerId);
    return member ? displayName(member) : participantName(peerId);
  }

  setAlias(value: string) {
    const alias = value.trim().slice(0, ALIAS_MAX_LENGTH);
    persistAlias(alias);
    this.update({ alias });
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    try {
      session.channel?.send({ type: 'set-alias', alias });
    } catch {
      // Reconnection sends it again.
    }
  }

  setTheme(theme: Theme) {
    this.update({ theme });
  }

  setAccent(accent: string) {
    if (ACCENTS.some(entry => entry.color === accent)) this.update({ accent });
  }

  setDegradation(value: VideoDegradation) {
    setVideoDegradation(value);
    persistDegradation(value);
    this.update({ degradation: value });
    void this.session?.peers.reapplyEncodeParameters();
  }

  async setCaptureQuality(value: CaptureQuality) {
    persistCaptureQuality(value);
    this.update({ captureQuality: value });
    const track = this.localStream?.getVideoTracks()[0];
    if (track?.readyState !== 'live') return;
    try {
      await track.applyConstraints(CAPTURE_PRESETS[value]);
    } catch {
      this.setError(
        'O navegador não reconfigurou a captura ao vivo; a nova qualidade vale no próximo compartilhamento.',
      );
    }
  }

  setCodecPreference(value: VideoCodecPreference) {
    const codecPreference = normalizeVideoCodecPreference(value);
    persistCodecPreference(codecPreference);
    this.update({ codecPreference });
  }

  reconnect() {
    this.reconnectAttempts = 0;
    this.startSession();
  }

  dismissJoinError() {
    this.update({ joinError: '' });
  }

  retryRoomPassword(password: string) {
    const session = this.session;
    if (!session?.channel || session.disposed || this.state.accessError === 'too-many-attempts') return;
    this.roomPassword = password;
    this.roomAccessToken = undefined;
    this.accessTerminal = false;
    this.update({ accessError: '', joinError: '' });
    session.channel.send({
      type: 'join-room',
      roomId: this.roomId,
      credential: this.credential,
      password,
      ...(this.clientId ? { clientId: this.clientId } : {}),
    });
  }

  dismissEnded() {
    this.update({ endedReason: null, endedPeerId: null });
  }

  async copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl({ roomId: this.roomId, credential: this.credential }));
      this.update({ inviteCopied: true });
    } catch {
      this.setError('Não foi possível copiar. Copie a URL da barra do navegador.');
    }
  }

  async toggleShare() {
    if (this.session?.stream) this.stopSharing(true);
    else await this.share();
  }

  stopSharing(notify = true) {
    const session = this.session;
    if (session) this.stopSessionSharing(session, notify);
  }

  watch(peerId: string, resuming = false) {
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    const current = session.selections.get(peerId);
    if (current) {
      session.selections.delete(peerId);
      this.watchTargets.delete(peerId);
      session.peers.removeSession(current.sessionId);
      this.update({
        selectedIds: [...session.selections.keys()],
        remoteStreams: this.state.remoteStreams.filter(item => item.sessionId !== current.sessionId),
        error: '',
      });
      try {
        session.channel!.send({ type: 'watch', targetPeerId: null, sessionId: current.sessionId });
        playSound('viewer-leave');
      } catch (error) {
        this.setError(error instanceof Error ? error.message : 'Não foi possível encerrar a transmissão.');
      }
      return;
    }
    if (session.selections.size >= MAX_WATCHED_STREAMS) {
      this.setError(`Você pode assistir a até ${MAX_WATCHED_STREAMS} transmissões ao mesmo tempo.`);
      return;
    }
    if (!resuming) this.resumeWatch = false;
    const sessionId = crypto.randomUUID();
    const selection = { peerId, sessionId };
    session.selections.set(peerId, selection);
    this.watchTargets.set(peerId, this.nameOf(peerId));
    this.update({ selectedIds: [...session.selections.keys()], error: '', endedReason: null, endedPeerId: null });
    try {
      session.peers.select(peerId, sessionId);
      session.channel!.send({ type: 'watch', targetPeerId: peerId, sessionId });
      if (!resuming) playSound('viewer-join');
    } catch (error) {
      session.peers.removeSession(sessionId);
      session.selections.delete(peerId);
      this.watchTargets.delete(peerId);
      this.update({ selectedIds: [...session.selections.keys()] });
      this.setError(error instanceof Error ? error.message : 'Não foi possível assistir.');
    }
  }

  async share() {
    const session = this.session;
    if (!session?.joined || session.disposed || session.stream || this.state.capturing) return;
    this.update({ error: '', endedReason: null, endedPeerId: null });
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      this.setError('Captura de tela exige HTTPS (ou localhost) e um navegador compatível.');
      return;
    }
    const capture = ++session.capture;
    this.update({ capturing: true });
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: CAPTURE_PRESETS[this.state.captureQuality],
        audio: true,
      });
      if (!this.isCurrent(session) || !session.joined || session.capture !== capture) {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      this.beginPublishing(session, captured);
    } catch (error) {
      if (this.isCurrent(session) && session.capture === capture) {
        this.stopSessionSharing(session, false);
        this.setError(error instanceof Error ? `Não foi possível capturar: ${error.message}` : 'Captura cancelada.');
      }
    } finally {
      if (this.isCurrent(session) && session.capture === capture) this.update({ capturing: false });
    }
  }

  getPeers() {
    return this.session?.peers ?? null;
  }

  private setError(error: string) {
    this.update({ error });
  }

  private isCurrent(session: Session) {
    return this.session === session && !session.disposed;
  }

  private renderPeerState(peers: Peers) {
    const entries = [...peers.peers.values()];
    const receiving = entries.filter(entry => entry.direction === 'receive');
    const connected = receiving.filter(entry => entry.pc.connectionState === 'connected').length;
    const connectionState = receiving.some(entry => entry.pc.connectionState === 'failed')
      ? 'failed'
      : receiving.length
        ? `${connected}/${receiving.length} conectadas`
        : 'aguardando';
    const nextWatchers = new Set(entries.filter(entry => entry.direction === 'send').map(entry => entry.peerId));
    for (const peerId of nextWatchers) if (!this.knownWatcherIds.has(peerId)) playSound('viewer-join');
    for (const peerId of this.knownWatcherIds) if (!nextWatchers.has(peerId)) playSound('viewer-leave');
    this.knownWatcherIds = nextWatchers;
    this.update({ connectionState, watcherIds: [...nextWatchers] });
  }

  private detachPublishing(session: Session) {
    session.capture++;
    session.peers.closeDirection('send');
    session.stream = null;
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.settingsTimer = undefined;
    this.update({ sharing: false, captureInfo: '' });
  }

  private stopCapture() {
    this.localStream?.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    this.localStream = null;
    this.activeCodecPreference = null;
    this.update({ localStream: null });
  }

  private stopSessionSharing(session: Session, notify: boolean) {
    const wasActive = Boolean(session.stream) || this.state.capturing;
    this.detachPublishing(session);
    this.stopCapture();
    if (this.session === session) {
      this.update({ capturing: false });
      if (notify && wasActive) this.update({ endedReason: 'me', endedPeerId: null });
    }
    if (notify && session.joined) {
      try {
        session.channel?.send({ type: 'sharing-stopped' });
      } catch {
        // Signaling disconnect also ends publication.
      }
    }
  }

  private beginPublishing(session: Session, captured: MediaStream) {
    const screenTrack = captured.getVideoTracks()[0];
    if (!screenTrack) throw new Error('A captura não retornou uma track de vídeo.');
    screenTrack.contentHint = 'motion';
    this.localStream = captured;
    session.stream = captured;
    this.activeCodecPreference ??= this.state.codecPreference;
    session.codecPreference = this.activeCodecPreference;
    screenTrack.onended = () => {
      if (this.session) this.stopSessionSharing(this.session, true);
      else this.stopCapture();
    };
    const updateSettings = () => {
      const settings = screenTrack.getSettings();
      this.update({
        captureInfo: `Captura real: ${settings.width ?? '?'} × ${settings.height ?? '?'} · ${settings.frameRate ?? 'indisponível'} FPS · ${captured.getAudioTracks().length ? 'Áudio incluído' : 'Sem áudio disponível nesta captura'}`,
      });
    };
    updateSettings();
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.settingsTimer = setInterval(updateSettings, 2000);
    this.update({ localStream: captured, sharing: true });
    try {
      session.channel?.send({ type: 'sharing-started' });
    } catch {
      // Rejoining announces it again.
    }
  }

  private disposeSession(session: Session) {
    if (session.disposed) return;
    session.disposed = true;
    this.detachPublishing(session);
    session.peers.closeAllPeers();
    session.channel?.close();
    session.channel = null;
  }

  private readonly wakeReconnect = () => {
    if (this.disposed || navigator.onLine === false) return;
    if (this.state.socketState === 'connected' || this.state.socketState === 'connecting') return;
    if (document.visibilityState === 'hidden') return;
    this.reconnectAttempts = 0;
    this.startSession();
  };

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer || navigator.onLine === false) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.startSession();
    }, delay);
  }

  private startSession() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.knownWatcherIds = new Set();
    if (this.session) this.disposeSession(this.session);
    if (navigator.onLine === false) {
      this.session = null;
      this.update({
        socketState: 'disconnected',
        selfId: '',
        members: [],
        selectedIds: [],
        capturing: false,
        sharing: false,
        remoteStreams: [],
        connectionState: 'aguardando',
        watcherIds: [],
        error: 'Você está offline. A conexão será retomada quando a internet voltar.',
        joinError: '',
        accessError: '',
        endedReason: null,
        endedPeerId: null,
        inviteCopied: false,
      });
      return;
    }
    this.update({
      socketState: 'connecting',
      selfId: '',
      members: [],
      selectedIds: [],
      capturing: false,
      sharing: false,
      remoteStreams: [],
      connectionState: 'aguardando',
      watcherIds: [],
      error: this.reconnectAttempts > 0 ? 'Reconectando à sala…' : '',
      joinError: '',
      accessError: '',
      endedReason: null,
      endedPeerId: null,
      inviteCopied: false,
    });
    let queue = Promise.resolve();
    const holder: { session?: Session } = {};
    const reportError = (error: unknown) => {
      if (holder.session && this.isCurrent(holder.session))
        this.setError(error instanceof Error ? error.message : 'Falha na conexão WebRTC.');
    };
    const peers = new Peers(
      message => holder.session!.channel!.send(message),
      (sessionId, peerId, stream) => {
        if (!holder.session || !this.isCurrent(holder.session)) return;
        const remoteStreams = this.state.remoteStreams.filter(item => item.sessionId !== sessionId);
        if (stream) remoteStreams.push({ sessionId, peerId, stream });
        this.update({ remoteStreams });
      },
      () => {
        if (holder.session && this.isCurrent(holder.session)) this.renderPeerState(peers);
      },
      reportError,
    );
    const session: Session = {
      peers,
      channel: null,
      members: [],
      stream: null,
      selections: new Map(),
      disposed: false,
      capture: 0,
      joined: false,
      membersSeeded: false,
      codecPreference: 'auto',
    };
    holder.session = session;
    this.session = session;
    try {
      session.channel = connectSignaling(
        this.roomId,
        this.credential,
        this.roomPassword,
        this.roomAccessToken,
        this.clientId,
        message => {
          queue = queue.then(() => this.receive(session, message)).catch(reportError);
        },
        socketState => this.onSocketState(session, socketState),
      );
    } catch (error) {
      reportError(error);
      this.update({ socketState: 'error' });
      if (!this.disposed) this.scheduleReconnect();
    }
  }

  private onSocketState(session: Session, socketState: string) {
    if (!this.isCurrent(session)) return;
    this.update({ socketState });
    if (socketState === 'connected') return;
    session.joined = false;
    if (this.watchTargets.size) this.resumeWatch = true;
    this.detachPublishing(session);
    session.peers.closeAllPeers();
    session.selections.clear();
    session.members = [];
    session.disposed = true;
    session.channel?.close();
    this.update({ selfId: '', selectedIds: [], members: [], remoteStreams: [] });
    if (this.disposed || this.accessTerminal) return;
    this.setError(
      socketState === 'restarting'
        ? 'Nova versão publicada. Reconectando à sala…'
        : 'Conexão perdida. Reconectando à sala…',
    );
    this.scheduleReconnect();
  }

  private updateMembers(session: Session, next: Participant[]) {
    const previous = session.members;
    for (const member of previous)
      if (!next.some(peer => peer.peerId === member.peerId)) session.peers.removePeer(member.peerId);
    if (session.membersSeeded) {
      for (const member of next) {
        const before = previous.find(peer => peer.peerId === member.peerId);
        if (!before && member.peerId !== this.state.selfId) playSound('connect');
        if (before && !before.sharing && member.sharing) playSound('share-start');
        if (before && before.sharing && !member.sharing) playSound('share-stop');
      }
      for (const member of previous)
        if (member.peerId !== this.state.selfId && !next.some(peer => peer.peerId === member.peerId))
          playSound('disconnect');
    }
    session.membersSeeded = true;
    session.members = next;
    this.update({ members: next });
  }

  private async receive(session: Session, message: ServerMessage) {
    if (!this.isCurrent(session) || !session.channel) return;
    switch (message.type) {
      case 'joined':
        session.joined = true;
        this.reconnectAttempts = 0;
        this.roomAccessToken = message.accessToken ?? undefined;
        rememberRoomAccess({
          roomId: message.roomId,
          roomName: message.roomName,
          credential: this.credential,
          ...(message.accessToken ? { accessToken: message.accessToken } : {}),
          ...(message.accessTokenExpiresAt ? { accessTokenExpiresAt: message.accessTokenExpiresAt } : {}),
        });
        this.update({
          selfId: message.peerId,
          roomName: message.roomName,
          passwordProtected: message.passwordProtected,
          accessToken: message.accessToken ?? undefined,
          accessTokenExpiresAt: message.accessTokenExpiresAt ?? undefined,
          accessError: '',
          error: '',
        });
        this.updateMembers(session, message.peers);
        if (this.state.alias) session.channel.send({ type: 'set-alias', alias: this.state.alias });
        this.resumeAfterReconnect(session, message.peers);
        break;
      case 'room-access-denied':
        this.accessTerminal = message.reason === 'too-many-attempts';
        this.update({ accessError: message.reason });
        break;
      case 'room-created':
        break;
      case 'room-state':
        this.updateMembers(session, message.peers);
        this.maybeResumeWatch(message.peers);
        break;
      case 'watching':
        if (message.peerId) break;
        session.peers.removeSession(message.sessionId);
        for (const [peerId, selection] of session.selections)
          if (selection.sessionId === message.sessionId) {
            session.selections.delete(peerId);
            this.watchTargets.delete(peerId);
          }
        this.update({ selectedIds: [...session.selections.keys()] });
        break;
      case 'subscriber-joined':
        if (session.stream)
          void session.peers.offer(message.peerId, message.sessionId, session.stream, session.codecPreference);
        break;
      case 'subscription-ended':
        session.peers.removeSession(message.sessionId);
        let endedSelection = false;
        for (const [peerId, selection] of session.selections)
          if (selection.sessionId === message.sessionId) {
            session.selections.delete(peerId);
            this.watchTargets.delete(peerId);
            endedSelection = true;
          }
        if (endedSelection)
          this.update({
            selectedIds: [...session.selections.keys()],
            endedReason: session.selections.size ? null : 'remote',
            endedPeerId: message.peerId,
          });
        break;
      case 'error':
        this.update(session.joined ? { error: message.message } : { joinError: message.message });
        break;
      case 'pong':
        break;
      default:
        if (session.joined) await session.peers.receive(message);
    }
  }

  private resumeAfterReconnect(session: Session, peers: Participant[]) {
    const track = this.localStream?.getVideoTracks()[0];
    if (this.localStream && track?.readyState === 'live' && !session.stream) {
      try {
        this.beginPublishing(session, this.localStream);
      } catch {
        this.stopCapture();
      }
    } else if (this.localStream && track?.readyState !== 'live') this.stopCapture();
    this.maybeResumeWatch(peers);
  }

  private maybeResumeWatch(peers: Participant[]) {
    if (!this.resumeWatch || !this.watchTargets.size) return;
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    const available = peers.filter(peer => peer.sharing && peer.peerId !== this.state.selfId);
    for (const [peerId, name] of this.watchTargets) {
      if (session.selections.has(peerId)) continue;
      const byName = available.filter(peer => displayName(peer) === name);
      const target = available.find(peer => peer.peerId === peerId) ?? (byName.length === 1 ? byName[0] : undefined);
      if (target && !session.selections.has(target.peerId)) {
        if (target.peerId !== peerId) this.watchTargets.delete(peerId);
        this.watch(target.peerId, true);
      }
    }
    this.resumeWatch = session.selections.size < this.watchTargets.size;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    document.removeEventListener('visibilitychange', this.wakeReconnect);
    window.removeEventListener('online', this.wakeReconnect);
    window.removeEventListener('pageshow', this.wakeReconnect);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    if (this.session) this.disposeSession(this.session);
    this.stopCapture();
    this.listeners.clear();
  }
}
