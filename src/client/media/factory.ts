import { ScreenShareController } from '../screenShare';
import { CloudflareMediaProvider } from './cloudflare/CloudflareMediaProvider';
import { getMediaConfig } from './config';
import type { MediaProvider } from './types';

// Escolhe a implementação de mídia a partir de /config.json. O restante do app só
// enxerga a interface MediaProvider, então a troca de transporte é invisível para a UI.
export function createMediaProvider(
  roomId: string,
  credential: string,
  password?: string,
  accessToken?: string,
): MediaProvider {
  if (getMediaConfig().mediaProvider === 'cloudflare') {
    return new CloudflareMediaProvider(roomId, credential, password, accessToken);
  }
  return new ScreenShareController(roomId, credential, password, accessToken);
}
