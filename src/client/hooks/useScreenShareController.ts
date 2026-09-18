import { useEffect, useState, useSyncExternalStore } from 'react';
import { getMediaConfig } from '../media/config';
import { createMediaProvider } from '../media/factory';
import type { MediaProviderKind } from '../media/types';
import { ensureMemberId, findHostToken } from '../roomStorage';
import { applyTheme } from '../theme';

export function useScreenShareController(
  roomId: string,
  credential: string,
  password?: string,
  accessToken?: string,
) {
  // Estável por aba e reusado quando o transporte troca: é assim que o servidor
  // reconhece a reconexão como a mesma pessoa e as assinaturas retomam limpas.
  const [clientId] = useState(() => crypto.randomUUID());
  const [memberId] = useState(() => ensureMemberId(roomId));
  // Só o padrão do servidor; o `joined` da sala corrige isto logo em seguida.
  const [kind, setKind] = useState<MediaProviderKind>(
    () => getMediaConfig().mediaProvider,
  );
  const [controller, setController] = useState(() =>
    createMediaProvider(
      {
        roomId,
        credential,
        password,
        accessToken,
        clientId,
        memberId,
        hostToken: findHostToken(roomId),
      },
      kind,
    ),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    const dispose = () => controller.dispose();
    window.addEventListener('pagehide', dispose, { once: true });
    return () => {
      window.removeEventListener('pagehide', dispose);
      controller.dispose();
    };
  }, [controller]);

  // A sala mudou de transporte (no join, ou porque o dono/moderador trocou e o
  // `room-settings-changed` chegou). Mesh e SFU são grafos de conexão diferentes,
  // então não há troca a quente: derruba o provedor atual e recria com o novo. A
  // captura viva é adotada pelo provedor seguinte, e o hostToken é relido porque
  // pode ter acabado de ser emitido por um `claim-host` nesta sessão.
  useEffect(() => {
    if (state.mediaProvider === kind) return;
    const next = state.mediaProvider;
    const adoptedStream = controller.detach();
    setKind(next);
    setController(
      createMediaProvider(
        {
          roomId,
          credential,
          password,
          accessToken,
          clientId,
          memberId,
          hostToken: findHostToken(roomId),
          adoptedStream,
        },
        next,
      ),
    );
  }, [
    state.mediaProvider,
    kind,
    controller,
    roomId,
    credential,
    password,
    accessToken,
    clientId,
    memberId,
  ]);

  useEffect(() => applyTheme(state.theme), [state.theme]);
  return { controller, state };
}
