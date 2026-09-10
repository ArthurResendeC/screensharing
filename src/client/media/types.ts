import type { Participant } from '../../lib/signaling/messages';
import type { VideoCodecPreference } from '../../lib/webrtc/codecs';
import type { Peers } from '../../lib/webrtc/peers';
import type { VideoDegradation } from '../../lib/webrtc/rtcConfiguration';
import type { Theme } from '../theme';

// Qual implementação de mídia está ativa. Escolhida em /config.json e lida por
// createMediaProvider(); os componentes só precisam disso para ajustar duas frases.
export type MediaProviderKind = 'webrtc' | 'cloudflare';

export type CaptureQuality = 'fluid' | 'balanced' | 'sharp';

export const ACCENTS = [
  { color: '#3aa0b4', label: 'Teal' },
  { color: '#7b8ce8', label: 'Índigo' },
  { color: '#c08a5a', label: 'Âmbar' },
  { color: '#8fb98a', label: 'Verde' },
] as const;

type EndedReason = 'me' | 'remote' | null;
export type Selection = { peerId: string; sessionId: string };
export type RemoteStream = Selection & { stream: MediaStream };

export type ScreenShareState = {
  mediaProvider: MediaProviderKind;
  socketState: string;
  selfId: string;
  members: Participant[];
  selectedIds: string[];
  alias: string;
  capturing: boolean;
  sharing: boolean;
  localStream: MediaStream | null;
  remoteStreams: RemoteStream[];
  captureInfo: string;
  connectionState: string;
  watcherIds: string[];
  error: string;
  joinError: string;
  accessError: '' | 'invalid-invite' | 'password-required' | 'wrong-password' | 'too-many-attempts';
  roomName: string;
  passwordProtected: boolean;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  endedReason: EndedReason;
  endedPeerId: string | null;
  theme: Theme;
  accent: string;
  degradation: VideoDegradation;
  captureQuality: CaptureQuality;
  codecPreference: VideoCodecPreference;
  inviteCopied: boolean;
};

// Superfície que a camada React (hook + componentes) consome. Tanto o provedor mesh
// WebRTC quanto o provedor Cloudflare implementam exatamente isto, então nenhum
// componente muda de comportamento ao trocar de transporte.
export interface MediaProvider {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ScreenShareState;
  start(): void;
  dispose(): void;
  share(): Promise<void>;
  stopSharing(notify?: boolean): void;
  toggleShare(): Promise<void>;
  watch(peerId: string, resuming?: boolean): void;
  setAlias(value: string): void;
  setTheme(theme: Theme): void;
  setAccent(accent: string): void;
  setDegradation(value: VideoDegradation): void;
  setCaptureQuality(value: CaptureQuality): Promise<void>;
  setCodecPreference(value: VideoCodecPreference): void;
  reconnect(): void;
  retryRoomPassword(password: string): void;
  dismissJoinError(): void;
  dismissEnded(): void;
  copyInvite(): Promise<void>;
  nameOf(peerId: string | null): string;
  // Somente o provedor mesh expõe o mapa de RTCPeerConnections; o cloudflare devolve
  // null e o painel de debug aponta para chrome://webrtc-internals.
  getPeers(): Peers | null;
}
