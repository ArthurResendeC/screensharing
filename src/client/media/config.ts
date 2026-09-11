import type { MediaProviderKind } from './types';

// Configuração pública de mídia entregue por /config.json. O backend é a fonte da
// verdade: trocar MEDIA_PROVIDER lá e reiniciar troca o transporte de toda sessão
// nova, sem novo build do frontend.
export type MediaConfig = {
  mediaProvider: MediaProviderKind;
  maxVideoBitrate?: number;
};

let current: MediaConfig = { mediaProvider: 'webrtc' };

export function configureMedia(config: MediaConfig) {
  current = {
    mediaProvider:
      config.mediaProvider === 'cloudflare' ? 'cloudflare' : 'webrtc',
    maxVideoBitrate:
      typeof config.maxVideoBitrate === 'number' && config.maxVideoBitrate > 0
        ? config.maxVideoBitrate
        : undefined,
  };
}

export function getMediaConfig(): MediaConfig {
  return current;
}
