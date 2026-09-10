import {
  ConnectionState,
  DisconnectReason,
  LocalVideoTrack,
  type LocalTrackPublication,
  type RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  type VideoCodec,
} from 'livekit-client';
import { ALIAS_MAX_LENGTH, type Participant } from '../../../lib/signaling/messages';
import type { VideoCodecPreference } from '../../../lib/webrtc/codecs';
import { setVideoDegradation, type VideoDegradation } from '../../../lib/webrtc/rtcConfiguration';
import { displayName, participantName } from '../../participantPresentation';
import { inviteUrl, rememberRoomAccess } from '../../roomStorage';
import { playSound, unlockSounds } from '../../sounds';
import { loadTheme, type Theme } from '../../theme';
import { getMediaConfig } from '../config';
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
} from '../preferences';
import { ACCENTS, type CaptureQuality, type MediaProvider, type RemoteStream, type ScreenShareState } from '../types';
import { fetchLiveKitToken, LiveKitTokenError } from './token';
import { isSharing, screenShareTrackSid, toParticipant } from './participants';

type Listener = () => void;

const DEGRADATION_MAP: Record<VideoDegradation, RTCDegradationPreference> = {
  framerate: 'maintain-framerate',
  balanced: 'balanced',
  resolution: 'maintain-resolution',
};

function mapCodec(preference: VideoCodecPreference): VideoCodec | undefined {
  return preference === 'auto' ? undefined : preference;
}

// Provedor de mídia baseado no SFU LiveKit. Produz exatamente o mesmo ScreenShareState
// que o provedor mesh, então a UI não muda. Transporte, ICE, SDP, TURN, simulcast,
// adaptação e reconexão ficam a cargo do LiveKit.
export class LiveKitMediaProvider implements MediaProvider {
  private room: Room | null = null;
  private sessionId = 0;
  private readonly clientId = crypto.randomUUID?.() ?? crypto.randomUUID();
  private readonly listeners = new Set<Listener>();
  private localStream: MediaStream | null = null;
  private screenPublications: LocalTrackPublication[] = [];
  private readonly hidden = new Set<string>();
  // MediaStream estável por publicação: MediaVideo re-anexa o <video> sempre que a
  // prop stream muda de identidade, então reaproveitamos o mesmo objeto enquanto as
  // tracks da tela remota não mudarem.
  private readonly streamCache = new Map<string, { key: string; stream: MediaStream }>();
  private members: Participant[] = [];
  private membersSeeded = false;
  private captureSeq = 0;
  private disposed = false;
  private started = false;
  private accessTerminal = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private settingsTimer?: ReturnType<typeof setInterval>;
  private wantsToShare = false;

  private state: ScreenShareState = {
    mediaProvider: 'livekit',
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

  private setError(error: string) {
    this.update({ error });
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
    void this.startSession();
  }

  nameOf(peerId: string | null) {
    if (!peerId) return '';
    const member = this.state.members.find(entry => entry.peerId === peerId);
    return member ? displayName(member) : participantName(peerId);
  }

  // ---- preferences (identical persistence semantics to the mesh provider) ----

  setAlias(value: string) {
    const alias = value.trim().slice(0, ALIAS_MAX_LENGTH);
    persistAlias(alias);
    this.update({ alias });
    if (this.room?.state === ConnectionState.Connected) void this.room.localParticipant.setName(alias).catch(() => {});
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
    for (const publication of this.screenPublications) {
      const track = publication.videoTrack;
      if (track instanceof LocalVideoTrack) void track.setDegradationPreference(DEGRADATION_MAP[value]).catch(() => {});
    }
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
    persistCodecPreference(value);
    this.update({ codecPreference: value });
  }

  // ---- room access ----

  reconnect() {
    this.reconnectAttempts = 0;
    this.accessTerminal = false;
    void this.startSession();
  }

  retryRoomPassword(password: string) {
    if (this.disposed || this.state.accessError === 'too-many-attempts') return;
    this.roomPassword = password;
    this.roomAccessToken = undefined;
    this.accessTerminal = false;
    this.reconnectAttempts = 0;
    this.update({ accessError: '', joinError: '' });
    void this.startSession();
  }

  dismissJoinError() {
    this.update({ joinError: '' });
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

  getPeers() {
    return null;
  }

  // ---- sharing ----

  async toggleShare() {
    if (this.state.sharing || this.state.capturing) this.stopSharing(true);
    else await this.share();
  }

  async share() {
    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected || this.state.sharing || this.state.capturing) return;
    this.update({ error: '', endedReason: null, endedPeerId: null });
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      this.setError('Captura de tela exige HTTPS (ou localhost) e um navegador compatível.');
      return;
    }
    const capture = ++this.captureSeq;
    this.update({ capturing: true });
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: CAPTURE_PRESETS[this.state.captureQuality],
        audio: true,
      });
      if (this.disposed || this.room !== room || this.captureSeq !== capture) {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      await this.publish(room, captured);
    } catch (error) {
      if (!this.disposed && this.room === room && this.captureSeq === capture) {
        this.teardownCapture(false);
        this.setError(error instanceof Error ? `Não foi possível capturar: ${error.message}` : 'Captura cancelada.');
      }
    } finally {
      if (!this.disposed && this.room === room && this.captureSeq === capture) this.update({ capturing: false });
    }
  }

  private async publish(room: Room, captured: MediaStream) {
    const screenTrack = captured.getVideoTracks()[0];
    if (!screenTrack) throw new Error('A captura não retornou uma track de vídeo.');
    screenTrack.contentHint = 'motion';
    this.localStream = captured;
    this.wantsToShare = true;
    screenTrack.onended = () => this.stopSharing(true);

    const maxBitrate = getMediaConfig().maxVideoBitrate;
    const publishOptions = {
      simulcast: true,
      videoCodec: mapCodec(this.state.codecPreference),
      degradationPreference: DEGRADATION_MAP[this.state.degradation],
      ...(maxBitrate ? { screenShareEncoding: { maxBitrate, maxFramerate: 60 } } : {}),
    };

    const publications: LocalTrackPublication[] = [
      await room.localParticipant.publishTrack(screenTrack, { source: Track.Source.ScreenShare, ...publishOptions }),
    ];
    const audioTrack = captured.getAudioTracks()[0];
    if (audioTrack) {
      publications.push(
        await room.localParticipant.publishTrack(audioTrack, { source: Track.Source.ScreenShareAudio }),
      );
    }
    if (this.disposed || this.room !== room) {
      for (const publication of publications) await room.localParticipant.unpublishTrack(publication.track!, false);
      return;
    }
    this.screenPublications = publications;
    this.update({ localStream: captured, sharing: true });
    this.startCaptureInfo(captured);
    this.sync();
  }

  private startCaptureInfo(captured: MediaStream) {
    const screenTrack = captured.getVideoTracks()[0];
    if (!screenTrack) return;
    const updateSettings = () => {
      const settings = screenTrack.getSettings();
      this.update({
        captureInfo: `Captura real: ${settings.width ?? '?'} × ${settings.height ?? '?'} · ${settings.frameRate ?? 'indisponível'} FPS · ${captured.getAudioTracks().length ? 'Áudio incluído' : 'Sem áudio disponível nesta captura'}`,
      });
    };
    updateSettings();
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.settingsTimer = setInterval(updateSettings, 2000);
  }

  stopSharing(notify = true) {
    const wasActive = this.state.sharing || this.state.capturing;
    this.wantsToShare = false;
    void this.unpublishScreen();
    this.teardownCapture(true);
    if (notify && wasActive) this.update({ endedReason: 'me', endedPeerId: null });
    this.sync();
  }

  private async unpublishScreen() {
    const room = this.room;
    const publications = this.screenPublications.splice(0);
    if (!room) return;
    for (const publication of publications) {
      if (publication.track) await room.localParticipant.unpublishTrack(publication.track, true).catch(() => undefined);
    }
  }

  private teardownCapture(clearStream: boolean) {
    this.captureSeq++;
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.settingsTimer = undefined;
    if (clearStream) {
      this.localStream?.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
      });
      this.localStream = null;
    }
    this.update({
      sharing: false,
      capturing: false,
      captureInfo: '',
      localStream: clearStream ? null : this.state.localStream,
    });
  }

  // ---- watching (no cap: every remote share is shown unless the viewer hides it) ----

  watch(peerId: string) {
    const sharing = this.state.members.some(member => member.peerId === peerId && member.sharing);
    if (!sharing && !this.hidden.has(peerId)) return;
    if (this.hidden.has(peerId)) {
      this.hidden.delete(peerId);
      playSound('viewer-join');
    } else {
      this.hidden.add(peerId);
      playSound('viewer-leave');
    }
    this.update({ endedReason: null, endedPeerId: null });
    this.sync();
  }

  // ---- session lifecycle ----

  private readonly wakeReconnect = () => {
    if (this.disposed || navigator.onLine === false || this.accessTerminal) return;
    if (this.state.socketState === 'connected' || this.state.socketState === 'connecting') return;
    if (document.visibilityState === 'hidden') return;
    this.reconnectAttempts = 0;
    void this.startSession();
  };

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer || navigator.onLine === false || this.accessTerminal) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.startSession();
    }, delay);
  }

  private async startSession() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.disposed) return;
    const session = ++this.sessionId;
    this.membersSeeded = false;
    this.members = [];

    await this.detachRoom(false);

    if (navigator.onLine === false) {
      this.update({
        socketState: 'disconnected',
        selfId: '',
        members: [],
        selectedIds: [],
        remoteStreams: [],
        watcherIds: [],
        connectionState: 'aguardando',
        error: 'Você está offline. A conexão será retomada quando a internet voltar.',
        joinError: '',
        accessError: '',
      });
      return;
    }

    this.update({
      socketState: 'connecting',
      selfId: '',
      members: [],
      selectedIds: [],
      remoteStreams: [],
      watcherIds: [],
      connectionState: 'aguardando',
      error: this.reconnectAttempts > 0 ? 'Reconectando à sala…' : '',
      joinError: '',
      accessError: '',
      endedReason: null,
      endedPeerId: null,
    });

    let credentials;
    try {
      credentials = await fetchLiveKitToken({
        roomId: this.roomId,
        credential: this.credential,
        identity: this.clientId,
        displayName: this.state.alias || undefined,
        password: this.roomPassword,
        accessToken: this.roomAccessToken,
      });
    } catch (error) {
      if (session !== this.sessionId || this.disposed) return;
      this.handleAccessError(error);
      return;
    }
    if (session !== this.sessionId || this.disposed) return;

    this.roomAccessToken = credentials.accessToken ?? undefined;
    rememberRoomAccess({
      roomId: this.roomId,
      roomName: credentials.roomName,
      credential: this.credential,
      ...(credentials.accessToken ? { accessToken: credentials.accessToken } : {}),
      ...(credentials.accessTokenExpiresAt ? { accessTokenExpiresAt: credentials.accessTokenExpiresAt } : {}),
    });
    this.update({
      roomName: credentials.roomName,
      passwordProtected: credentials.passwordProtected,
      accessToken: credentials.accessToken ?? undefined,
      accessTokenExpiresAt: credentials.accessTokenExpiresAt ?? undefined,
      accessError: '',
    });

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    this.wireRoom(room, session);

    try {
      await room.connect(credentials.url, credentials.token);
    } catch (error) {
      if (session !== this.sessionId || this.disposed) return;
      this.setError(error instanceof Error ? error.message : 'Falha ao conectar ao servidor de mídia.');
      this.update({ socketState: 'disconnected' });
      this.scheduleReconnect();
      return;
    }
    if (session !== this.sessionId || this.disposed) {
      void room.disconnect();
      return;
    }

    this.reconnectAttempts = 0;
    this.update({ socketState: 'connected', selfId: room.localParticipant.identity, error: '' });
    if (this.state.alias) void room.localParticipant.setName(this.state.alias).catch(() => {});
    await this.resumeShare(room);
    this.sync();
  }

  private handleAccessError(error: unknown) {
    if (error instanceof LiveKitTokenError) {
      if (error.reason === 'unavailable') {
        this.setError('Servidor de mídia indisponível. Tentando novamente…');
        this.update({ socketState: 'disconnected' });
        this.scheduleReconnect();
        return;
      }
      this.accessTerminal = error.reason === 'invalid-invite' || error.reason === 'too-many-attempts';
      this.update({ socketState: 'disconnected', accessError: error.reason });
      return;
    }
    this.setError('Falha ao obter acesso à sala.');
    this.update({ socketState: 'disconnected' });
    this.scheduleReconnect();
  }

  private async resumeShare(room: Room) {
    const track = this.localStream?.getVideoTracks()[0];
    if (!this.wantsToShare || !this.localStream || track?.readyState !== 'live') {
      if (this.wantsToShare) this.teardownCapture(true);
      return;
    }
    try {
      await this.publish(room, this.localStream);
    } catch {
      this.teardownCapture(true);
    }
  }

  private wireRoom(room: Room, session: number) {
    const guard = (fn: () => void) => () => {
      if (session === this.sessionId && !this.disposed) fn();
    };
    room
      .on(
        RoomEvent.ParticipantConnected,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.ParticipantDisconnected,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.TrackPublished,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.TrackUnpublished,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.TrackSubscribed,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.TrackUnsubscribed,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.TrackStreamStateChanged,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.LocalTrackPublished,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.LocalTrackUnpublished,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.ParticipantNameChanged,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.ParticipantMetadataChanged,
        guard(() => this.sync()),
      )
      .on(
        RoomEvent.ConnectionStateChanged,
        guard(() => {
          const map: Record<ConnectionState, string> = {
            [ConnectionState.Connecting]: 'connecting',
            [ConnectionState.Connected]: 'connected',
            [ConnectionState.Reconnecting]: 'connected',
            [ConnectionState.SignalReconnecting]: 'connected',
            [ConnectionState.Disconnected]: 'disconnected',
          };
          if (room.state === ConnectionState.Reconnecting) this.setError('Conexão instável. Reconectando…');
          this.update({ socketState: map[room.state] });
        }),
      )
      .on(
        RoomEvent.Reconnected,
        guard(() => {
          this.update({ socketState: 'connected', error: '' });
          this.sync();
        }),
      )
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (session !== this.sessionId || this.disposed) return;
        this.handleDisconnected(reason);
      })
      .on(RoomEvent.MediaDevicesError, (error: Error) => {
        if (session === this.sessionId && !this.disposed) this.setError(error.message);
      });
  }

  private handleDisconnected(reason?: DisconnectReason) {
    if (reason === DisconnectReason.CLIENT_INITIATED) return;
    this.update({ socketState: reason === DisconnectReason.SERVER_SHUTDOWN ? 'restarting' : 'disconnected' });
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      this.setError('Esta sala foi aberta em outra aba ou dispositivo com a mesma identidade.');
      return;
    }
    this.setError(
      reason === DisconnectReason.SERVER_SHUTDOWN
        ? 'Nova versão publicada. Reconectando à sala…'
        : 'Conexão perdida. Reconectando à sala…',
    );
    this.scheduleReconnect();
  }

  // ---- derived state ----

  private sync() {
    const room = this.room;
    if (!room || this.disposed) return;
    const remotes = [...room.remoteParticipants.values()];
    const nextMembers: Participant[] = [toParticipant(room.localParticipant), ...remotes.map(toParticipant)];

    this.diffMembersForSounds(nextMembers);
    this.members = nextMembers;

    for (const id of this.hidden) if (!nextMembers.some(member => member.peerId === id)) this.hidden.delete(id);

    const sharerIds = remotes.filter(isSharing).map(participant => participant.identity);
    const selectedIds = sharerIds.filter(id => !this.hidden.has(id));
    const remoteStreams: RemoteStream[] = [];
    const liveIdentities = new Set(remotes.map(participant => participant.identity));
    for (const identity of this.streamCache.keys())
      if (!liveIdentities.has(identity)) this.streamCache.delete(identity);
    for (const participant of remotes) {
      if (!selectedIds.includes(participant.identity)) continue;
      const stream = this.stableStream(participant);
      const sessionId = screenShareTrackSid(participant);
      if (stream && sessionId) remoteStreams.push({ peerId: participant.identity, sessionId, stream });
    }

    const previousSelected = this.state.selectedIds;
    const endedPeer = previousSelected.find(id => !sharerIds.includes(id) && !this.hidden.has(id));
    const endedReason = endedPeer && selectedIds.length === 0 ? 'remote' : this.state.endedReason;
    const endedPeerId = endedPeer && selectedIds.length === 0 ? endedPeer : this.state.endedPeerId;

    const selfId = room.localParticipant.identity;
    const watcherIds = this.state.sharing ? nextMembers.filter(m => m.peerId !== selfId).map(m => m.peerId) : [];
    const connectionState =
      selectedIds.length === 0
        ? 'aguardando'
        : `${remoteStreams.length}/${selectedIds.length} conectada${selectedIds.length > 1 ? 's' : ''}`;

    this.update({
      members: nextMembers,
      selectedIds,
      remoteStreams,
      watcherIds,
      connectionState,
      endedReason,
      endedPeerId,
    });
  }

  // Reaproveita o mesmo MediaStream enquanto as tracks (vídeo + áudio) da tela
  // remota não mudarem, evitando que o <video> seja re-anexado a cada sync().
  private stableStream(participant: RemoteParticipant): MediaStream | null {
    const video = participant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack?.mediaStreamTrack;
    if (!video) return null;
    const audio = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack?.mediaStreamTrack;
    const key = audio ? `${video.id}+${audio.id}` : video.id;
    const cached = this.streamCache.get(participant.identity);
    if (cached?.key === key) return cached.stream;
    const stream = new MediaStream(audio ? [video, audio] : [video]);
    this.streamCache.set(participant.identity, { key, stream });
    return stream;
  }

  private diffMembersForSounds(next: Participant[]) {
    const previous = this.members;
    const selfId = this.state.selfId || this.room?.localParticipant.identity;
    if (this.membersSeeded) {
      for (const member of next) {
        const before = previous.find(entry => entry.peerId === member.peerId);
        if (!before && member.peerId !== selfId) playSound('connect');
        if (before && !before.sharing && member.sharing && member.peerId !== selfId) playSound('share-start');
        if (before && before.sharing && !member.sharing && member.peerId !== selfId) playSound('share-stop');
      }
      for (const member of previous) {
        if (member.peerId !== selfId && !next.some(entry => entry.peerId === member.peerId)) playSound('disconnect');
      }
    }
    this.membersSeeded = true;
  }

  private async detachRoom(stopTracks: boolean) {
    const room = this.room;
    this.room = null;
    this.screenPublications = [];
    if (room) {
      room.removeAllListeners();
      await room.disconnect(stopTracks).catch(() => undefined);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    this.sessionId++;
    document.removeEventListener('visibilitychange', this.wakeReconnect);
    window.removeEventListener('online', this.wakeReconnect);
    window.removeEventListener('pageshow', this.wakeReconnect);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.localStream?.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    this.localStream = null;
    this.streamCache.clear();
    void this.detachRoom(true);
    this.listeners.clear();
  }
}
