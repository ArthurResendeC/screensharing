import type { MediaProviderKind } from './types';

// Configuração pública de mídia entregue por /config.json. `mediaProvider` é o padrão
// do servidor para salas novas; o transporte que vale numa sala é o que o `joined`
// devolve. `availableMediaProviders` é o que o backend realmente consegue servir, para
// a UI nunca oferecer uma opção que ele não tem configurada.
export type MediaConfig = {
  mediaProvider: MediaProviderKind;
  availableMediaProviders?: MediaProviderKind[];
  maxVideoBitrate?: number;
};

let current: MediaConfig = {
  mediaProvider: 'webrtc',
  availableMediaProviders: ['webrtc'],
};

function normalizeKind(value: unknown): MediaProviderKind {
  return value === 'cloudflare' ? 'cloudflare' : 'webrtc';
}

export function configureMedia(config: MediaConfig) {
  const mediaProvider = normalizeKind(config.mediaProvider);
  const available = (config.availableMediaProviders ?? [mediaProvider]).map(
    normalizeKind,
  );
  current = {
    mediaProvider,
    // O padrão sempre consta como disponível: se o servidor está configurado para
    // ele, ele é servível por definição.
    availableMediaProviders: [
      ...new Set<MediaProviderKind>([mediaProvider, ...available]),
    ],
    maxVideoBitrate:
      typeof config.maxVideoBitrate === 'number' && config.maxVideoBitrate > 0
        ? config.maxVideoBitrate
        : undefined,
  };
}

export function getMediaConfig(): MediaConfig {
  return current;
}

export function availableMediaProviders(): MediaProviderKind[] {
  return current.availableMediaProviders ?? [current.mediaProvider];
}
