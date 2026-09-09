import { useState, type CSSProperties } from 'react';
import { DebugModal, JoinErrorModal, NameGate, RoomPasswordGate } from './components/roomModals';
import { RoomDebug } from './components/roomDebug';
import { RoomSidebar } from './components/roomSidebar';
import { RoomStage } from './components/roomStage';
import { useScreenShareController } from './hooks/useScreenShareController';
import { isFavoriteRoom, removeFavoriteRoom, saveFavoriteRoom } from './roomStorage';

export function Room({ roomId, credential, password }: { roomId: string; credential: string; password: string }) {
  const { controller, state } = useScreenShareController(roomId, credential, password);
  const [debugOpen, setDebugOpen] = useState(false);
  const [favorite, setFavorite] = useState(() => isFavoriteRoom(roomId));
  const toggleFavorite = () => {
    if (favorite) removeFavoriteRoom(roomId);
    else if (state.roomName) saveFavoriteRoom({ roomId, roomName: state.roomName, credential });
    setFavorite(value => !value);
  };

  return (
    <div>
      <div className="shell" style={{ '--accent': state.accent } as CSSProperties}>
        <RoomSidebar roomId={roomId} state={state} controller={controller} onDebug={() => setDebugOpen(true)} />
        <RoomStage state={state} controller={controller} favorite={favorite} onToggleFavorite={toggleFavorite} />
      </div>
      {state.accessError && (
        <RoomPasswordGate error={state.accessError} onSubmit={value => controller.retryRoomPassword(value)} />
      )}
      {state.selfId && <NameGate state={state} controller={controller} />}
      <JoinErrorModal message={state.joinError} onRetry={() => controller.reconnect()} />
      <DebugModal open={debugOpen} onClose={() => setDebugOpen(false)}>
        <RoomDebug controller={controller} socketState={state.socketState} />
      </DebugModal>
    </div>
  );
}
