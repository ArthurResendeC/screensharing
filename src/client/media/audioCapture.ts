import {
  AUDIO_PROFILE_SETTINGS,
  type AudioProfile,
} from '../../lib/webrtc/audio';

// De onde sai o áudio da transmissão. Nenhum navegador separa áudio por aplicativo:
// no Windows, capturar uma janela ou a tela devolve o loopback do dispositivo de
// saída inteiro — é assim que a chamada do Discord entra junto com o jogo. Só a
// captura de aba é isolada, e 'capture' tira a opção do mix do sistema do seletor.
// 'input' existe para o caminho oposto: mandar um programa para um cabo virtual no
// mixer do Windows e capturar só esse cabo.
export const AUDIO_SOURCES = [
  'capture',
  'capture-with-system',
  'input',
  'none',
] as const;
export type AudioSource = (typeof AUDIO_SOURCES)[number];

export const usesAudioInput = (source: AudioSource) => source === 'input';
const usesCaptureAudio = (source: AudioSource) =>
  source === 'capture' || source === 'capture-with-system';

// A lib do TypeScript ainda não descreve as dicas de seletor do Chromium.
type DisplayMediaOptions = DisplayMediaStreamOptions & {
  systemAudio?: 'include' | 'exclude';
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
};

export function displayMediaConstraints(
  video: MediaTrackConstraints,
  source: AudioSource,
): DisplayMediaOptions {
  return {
    video,
    audio: usesCaptureAudio(source) && {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    },
    systemAudio: source === 'capture-with-system' ? 'include' : 'exclude',
    // Sem isso a própria aba entra no loopback e o áudio volta em eco.
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  };
}

export type AudioInput = { deviceId: string; label: string };

// Enumerar só devolve rótulos depois que alguma permissão de áudio foi concedida;
// sem rótulo não há como reconhecer o cabo virtual, então o nome cai no id.
export async function listAudioInputs(): Promise<AudioInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(device => device.kind === 'audioinput' && device.deviceId)
      .map(device => ({
        deviceId: device.deviceId,
        label: device.label || `Entrada ${device.deviceId.slice(0, 6)}`,
      }));
  } catch {
    return [];
  }
}

// Processamento de voz (cancelamento de eco, ganho automático, supressão de ruído)
// destrói som de jogo e música, então o perfil estéreo pede a entrada crua.
export async function captureAudioInput(
  deviceId: string,
  profile: AudioProfile,
): Promise<MediaStreamTrack | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const raw = AUDIO_PROFILE_SETTINGS[profile].stereo;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
      echoCancellation: !raw,
      autoGainControl: !raw,
      noiseSuppression: !raw,
      channelCount: raw ? 2 : 1,
    },
  });
  return stream.getAudioTracks()[0] ?? null;
}

// Frase para o rodapé da captura nos dois provedores: diz o que está no ar agora,
// não o que foi pedido nas preferências.
export function describeShareAudio(
  source: AudioSource,
  live: boolean,
  muted: boolean,
): string {
  if (source === 'none') return 'Sem áudio';
  if (!live)
    return usesAudioInput(source)
      ? 'Sem entrada de áudio'
      : 'Sem áudio nesta captura';
  return `${usesAudioInput(source) ? 'Áudio da entrada' : 'Áudio da captura'}${muted ? ' (mudo)' : ''}`;
}
