import { connectSignaling } from '../lib/signaling/client';
import { ALIAS_MAX_LENGTH, type Participant, type ServerMessage } from '../lib/signaling/messages';
import { Peers } from '../lib/webrtc/peers';
import { setVideoDegradation, type VideoDegradation } from '../lib/webrtc/rtcConfiguration';
import { displayName, participantName } from './participantPresentation';
import { playSound, unlockSounds } from './sounds';
import { loadTheme, type Theme } from './theme';

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
  membersSeeded: boolean;
};

export const ACCENTS = [
  { color: '#3aa0b4', label: 'Teal' },
  { color: '#7b8ce8', label: 'Índigo' },
  { color: '#c08a5a', label: 'Âmbar' },
  { color: '#8fb98a', label: 'Verde' },
] as const;

const ALIAS_STORAGE_KEY = 'screen-share:alias';
const LAST_ROOM_STORAGE_KEY = 'screen-share:last-room';
const DEGRADATION_STORAGE_KEY = 'screen-share:degradation';
const CAPTURE_STORAGE_KEY = 'screen-share:capture';
const DEGRADATION_CHOICES = ['framerate', 'balanced', 'resolution'] as const;
export type CaptureQuality = 'fluid' | 'balanced' | 'sharp';
const CAPTURE_CHOICES = ['fluid', 'balanced', 'sharp'] as const;
const CAPTURE_PRESETS: Record<CaptureQuality, MediaTrackConstraints> = {
  fluid: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
  balanced: { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } },
  sharp: { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 60 } },
};

function storedChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T;
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function rememberRoom(roomId: string) {
  try {
    localStorage.setItem(LAST_ROOM_STORAGE_KEY, roomId);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function recallRoom() {
  try {
    return localStorage.getItem(LAST_ROOM_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storedAlias() {
  try {
    return (localStorage.getItem(ALIAS_STORAGE_KEY) ?? '').trim().slice(0, ALIAS_MAX_LENGTH);
  } catch {
    return '';
  }
}

export type EndedReason = 'me' | 'remote' | null;
export type ScreenShareState = {
  socketState: string;
  selfId: string;
  members: Participant[];
  selectedId: string | null;
  alias: string;
  capturing: boolean;
  sharing: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  captureInfo: string;
  connectionState: string;
  watcherIds: string[];
  error: string;
  joinError: string;
  endedReason: EndedReason;
  endedPeerId: string | null;
  theme: Theme;
  accent: string;
  degradation: VideoDegradation;
  captureQuality: CaptureQuality;
  inviteCopied: boolean;
};

type Listener = () => void;

export class ScreenShareController {
  private session: Session | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly clientId = crypto.randomUUID?.() ?? '';
  private localStream: MediaStream | null = null;
  private watchId: string | null = null;
  private watchName: string | null = null;
  private resumeWatch = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private disposed = false;
  private started = false;
  private settingsTimer?: ReturnType<typeof setInterval>;
  private knownWatcherIds = new Set<string>();
  private state: ScreenShareState = {
    socketState: 'connecting',
    selfId: '',
    members: [],
    selectedId: null,
    alias: storedAlias(),
    capturing: false,
    sharing: false,
    localStream: null,
    remoteStream: null,
    captureInfo: '',
    connectionState: 'aguardando',
    watcherIds: [],
    error: '',
    joinError: '',
    endedReason: null,
    endedPeerId: null,
    theme: loadTheme(),
    accent: ACCENTS[0].color,
    degradation: storedChoice(DEGRADATION_STORAGE_KEY, DEGRADATION_CHOICES, 'framerate'),
    captureQuality: storedChoice(CAPTURE_STORAGE_KEY, CAPTURE_CHOICES, 'fluid'),
    inviteCopied: false,
  };

  constructor(private readonly roomId: string) {}

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
    rememberRoom(this.roomId);
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
    try {
      localStorage.setItem(ALIAS_STORAGE_KEY, alias);
    } catch {
      // The name still applies to the current tab.
    }
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
    try {
      localStorage.setItem(DEGRADATION_STORAGE_KEY, value);
    } catch {
      // Preference remains valid for this tab.
    }
    this.update({ degradation: value });
    void this.session?.peers.reapplyEncodeParameters();
  }

  async setCaptureQuality(value: CaptureQuality) {
    try {
      localStorage.setItem(CAPTURE_STORAGE_KEY, value);
    } catch {
      // Preference remains valid for this tab.
    }
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

  reconnect() {
    this.reconnectAttempts = 0;
    this.startSession();
  }

  dismissJoinError() {
    this.update({ joinError: '' });
  }

  dismissEnded() {
    this.update({ endedReason: null, endedPeerId: null });
  }

  async copyInvite() {
    try {
      await navigator.clipboard.writeText(location.href);
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

  watch(peerId: string | null, resuming = false) {
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    if (!resuming) this.resumeWatch = false;
    this.watchId = peerId;
    this.watchName = peerId ? this.nameOf(peerId) : null;
    const sessionId = crypto.randomUUID();
    session.watchRequest = sessionId;
    session.selection = peerId ? { peerId, sessionId } : null;
    this.update({ selectedId: peerId, error: '', endedReason: null, endedPeerId: null });
    try {
      session.peers.select(peerId, sessionId);
      session.channel!.send({ type: 'watch', targetPeerId: peerId, sessionId });
      if (!resuming) playSound(peerId ? 'viewer-join' : 'viewer-leave');
    } catch (error) {
      session.peers.closeDirection('receive');
      session.selection = null;
      this.watchId = null;
      this.watchName = null;
      this.update({ selectedId: null });
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
    const connectionState = entries.find(entry => entry.direction === 'receive')?.pc.connectionState ?? 'aguardando';
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
        selectedId: null,
        capturing: false,
        sharing: false,
        remoteStream: null,
        connectionState: 'aguardando',
        watcherIds: [],
        error: 'Você está offline. A conexão será retomada quando a internet voltar.',
        joinError: '',
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
      selectedId: null,
      capturing: false,
      sharing: false,
      remoteStream: null,
      connectionState: 'aguardando',
      watcherIds: [],
      error: this.reconnectAttempts > 0 ? 'Reconectando à sala…' : '',
      joinError: '',
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
      stream => {
        if (holder.session && this.isCurrent(holder.session)) this.update({ remoteStream: stream });
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
      selection: null,
      watchRequest: '',
      disposed: false,
      capture: 0,
      joined: false,
      membersSeeded: false,
    };
    holder.session = session;
    this.session = session;
    try {
      session.channel = connectSignaling(
        this.roomId,
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
    if (this.watchId) this.resumeWatch = true;
    this.detachPublishing(session);
    session.peers.closeAllPeers();
    session.selection = null;
    session.members = [];
    session.disposed = true;
    session.channel?.close();
    this.update({ selfId: '', selectedId: null, members: [], remoteStream: null });
    if (this.disposed) return;
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
        this.update({ selfId: message.peerId, error: '' });
        this.updateMembers(session, message.peers);
        if (this.state.alias) session.channel.send({ type: 'set-alias', alias: this.state.alias });
        this.resumeAfterReconnect(session, message.peers);
        break;
      case 'room-state':
        this.updateMembers(session, message.peers);
        this.maybeResumeWatch(message.peers);
        break;
      case 'watching':
        if (message.sessionId !== session.watchRequest) break;
        if (message.peerId) this.resumeWatch = false;
        else {
          session.peers.closeDirection('receive');
          session.selection = null;
          this.update({ selectedId: null });
        }
        break;
      case 'subscriber-joined':
        if (session.stream) void session.peers.offer(message.peerId, message.sessionId, session.stream);
        break;
      case 'subscription-ended':
        session.peers.removeSession(message.sessionId);
        if (session.selection?.sessionId === message.sessionId) {
          session.selection = null;
          this.watchId = null;
          this.watchName = null;
          this.resumeWatch = false;
          this.update({ selectedId: null, endedReason: 'remote', endedPeerId: message.peerId });
        }
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
    if (!this.resumeWatch || this.state.selectedId || (!this.watchId && !this.watchName)) return;
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    const available = peers.filter(peer => peer.sharing && peer.peerId !== this.state.selfId);
    const byName = this.watchName ? available.filter(peer => displayName(peer) === this.watchName) : [];
    const target =
      available.find(peer => peer.peerId === this.watchId) ?? (byName.length === 1 ? byName[0] : undefined);
    if (target) this.watch(target.peerId, true);
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
