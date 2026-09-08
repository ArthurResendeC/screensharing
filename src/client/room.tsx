import { useState, type CSSProperties } from 'react';
import { DebugModal, JoinErrorModal, NameGate } from './components/roomModals';
import { RoomDebug } from './components/roomDebug';
import { RoomSidebar } from './components/roomSidebar';
import { RoomStage } from './components/roomStage';
import { useScreenShareController } from './hooks/useScreenShareController';

export function Room({ roomId }: { roomId: string }) {
  const { controller, state } = useScreenShareController(roomId);
  const [debugOpen, setDebugOpen] = useState(false);

  return (
    <div>
      <div className="shell" style={{ '--accent': state.accent } as CSSProperties}>
        <RoomSidebar roomId={roomId} state={state} controller={controller} onDebug={() => setDebugOpen(true)} />
        <RoomStage state={state} controller={controller} />
      </div>
      <NameGate state={state} controller={controller} />
      <JoinErrorModal message={state.joinError} onRetry={() => controller.reconnect()} />
      <DebugModal open={debugOpen} onClose={() => setDebugOpen(false)}>
        <RoomDebug controller={controller} socketState={state.socketState} />
      </DebugModal>
    </div>
  );
}
