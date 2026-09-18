import { ScreenShareController } from '../screenShare';
import { CloudflareMediaProvider } from './cloudflare/CloudflareMediaProvider';
import { getMediaConfig } from './config';
import type { MediaProvider, MediaProviderKind } from './types';

// Tudo o que um provedor precisa para entrar numa sala. `clientId` é estável entre
// trocas de transporte para o servidor reconhecer a reconexão como a mesma aba, e
// `adoptedStream` carrega a captura viva de um provedor para o seguinte.
export type MediaProviderOptions = {
  roomId: string;
  credential: string;
  password?: string;
  accessToken?: string;
  clientId: string;
  memberId?: string;
  hostToken?: string;
  adoptedStream?: MediaStream | null;
};

// Escolhe a implementação de mídia. O restante do app só enxerga a interface
// MediaProvider, então a troca de transporte é invisível para a UI.
export function createMediaProvider(
  options: MediaProviderOptions,
  kind: MediaProviderKind = getMediaConfig().mediaProvider,
): MediaProvider {
  return kind === 'cloudflare'
    ? new CloudflareMediaProvider(options)
    : new ScreenShareController(options);
}
