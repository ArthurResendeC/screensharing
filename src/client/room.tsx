import { useState, type CSSProperties } from 'react';
import {
  DebugModal,
  HostSecretsModal,
  JoinErrorModal,
  KickedModal,
  NameGate,
  RoomPasswordGate,
} from './components/roomModals';
import { RoomDebug } from './components/roomDebug';
import { RoomSidebar } from './components/roomSidebar';
import { RoomStage } from './components/roomStage';
import { useScreenShareController } from './hooks/useScreenShareController';
import type { HostSecrets } from './media/types';
import {
  isFavoriteRoom,
  removeFavoriteRoom,
  saveFavoriteRoom,
} from './roomStorage';

export function Room({
  roomId,
  credential,
  password,
  accessToken,
  initialHostSecrets,
}: {
  roomId: string;
  credential: string;
  password?: string;
  accessToken?: string;
  // Criação e recuperação acontecem no lobby, fora da conexão da sala, então os
  // segredos entregues lá chegam por aqui para o mesmo diálogo de uso único.
  initialHostSecrets?: HostSecrets;
}) {
  const { controller, state } = useScreenShareController(
    roomId,
    credential,
    password,
    accessToken,
  );
  const [debugOpen, setDebugOpen] = useState(false);
  const [lobbySecrets, setLobbySecrets] = useState<HostSecrets | null>(
    initialHostSecrets ?? null,
  );
  // O nome gravado é lido na primeira renderização, então o portão só abre para quem
  // ainda não escolheu um; daí em diante quem manda é o envio do formulário.
  const [aliasKnown] = useState(() => Boolean(state.alias));
  const [aliasSubmitted, setAliasSubmitted] = useState(false);
  const nameGateOpen = Boolean(state.selfId) && !aliasKnown && !aliasSubmitted;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [favorite, setFavorite] = useState(() => isFavoriteRoom(roomId));
  const toggleFavorite = () => {
    if (favorite) removeFavoriteRoom(roomId);
    else if (state.roomName)
      saveFavoriteRoom({
        roomId,
        roomName: state.roomName,
        credential,
        ...(state.accessToken ? { accessToken: state.accessToken } : {}),
        ...(state.accessTokenExpiresAt
          ? { accessTokenExpiresAt: state.accessTokenExpiresAt }
          : {}),
      });
    setFavorite(value => !value);
  };

  return (
    <div>
      <div
        className="shell"
        style={{ '--accent': state.accent } as CSSProperties}
      >
        <RoomSidebar
          roomId={roomId}
          state={state}
          controller={controller}
          collapsed={sidebarCollapsed}
          onDebug={() => setDebugOpen(true)}
        />
        <RoomStage
          state={state}
          controller={controller}
          favorite={favorite}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(collapsed => !collapsed)}
          onToggleFavorite={toggleFavorite}
        />
      </div>
      {state.accessError && (
        <RoomPasswordGate
          error={state.accessError}
          onSubmit={value => controller.retryRoomPassword(value)}
        />
      )}
      {state.selfId && (
        <NameGate
          open={nameGateOpen}
          state={state}
          controller={controller}
          onSubmit={() => setAliasSubmitted(true)}
        />
      )}
      <HostSecretsModal
        secrets={nameGateOpen ? null : (state.hostSecrets ?? lobbySecrets)}
        onDismiss={() => {
          setLobbySecrets(null);
          controller.dismissHostSecrets();
        }}
      />
      <KickedModal by={state.kickedBy} />
      <JoinErrorModal
        message={state.joinError}
        onRetry={() => controller.reconnect()}
      />
      <DebugModal open={debugOpen} onClose={() => setDebugOpen(false)}>
        <RoomDebug controller={controller} socketState={state.socketState} />
      </DebugModal>
    </div>
  );
}
