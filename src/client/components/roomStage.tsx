import type { ScreenShareController, ScreenShareState } from '../screenShare';
import { MediaVideo } from './mediaVideo';
import { ScreenPicker, WatcherList } from './roomParticipants';
import { EndedIcon, PlusIcon, ScreenIcon, StarIcon, StopIcon } from './icons';

export function RoomStage({
  state,
  controller,
  favorite,
  onToggleFavorite,
}: {
  state: ScreenShareState;
  controller: ScreenShareController;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  const connected = state.socketState === 'connected' && Boolean(state.selfId);
  const live = state.members.filter(member => member.sharing && member.peerId !== state.selfId);
  const watching = Boolean(state.selectedId);
  const ended = Boolean(state.endedReason) && !watching;
  const connection = `Conexão: ${state.connectionState}${state.connectionState === 'failed' ? ' — tente reconectar à transmissão; esta rede pode exigir TURN.' : ''}`;
  const title = state.selectedId ? controller.nameOf(state.selectedId) : 'Minha transmissão';
  const subtitle = state.selectedId ? 'assistindo' : state.sharing ? 'transmitindo sua tela' : 'nenhuma tela ativa';
  const endedTitle = state.endedReason === 'remote' ? 'Transmissão encerrada' : 'Você encerrou o compartilhamento';
  const endedBody =
    state.endedReason === 'remote'
      ? `${state.endedPeerId ? controller.nameOf(state.endedPeerId) : 'Participante'} parou de compartilhar a tela. Escolha outra transmissão na lista de participantes.`
      : 'Sua tela não está mais sendo transmitida para a sala. Os outros participantes continuam conectados.';

  return (
    <div className="main">
      <div className="topbar">
        <ScreenIcon size={17} className="icon" />
        <span className="title">{title}</span>
        <div className="divider" />
        <span className="sub">{subtitle}</span>
        <div className="actions">
          <button type="button" className="btn btn-outline" disabled={!state.roomName} onClick={onToggleFavorite}>
            <StarIcon filled={favorite} /> {favorite ? 'Favoritada' : 'Favoritar'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!connected}
            onClick={() => void controller.copyInvite()}
          >
            <PlusIcon /> {state.inviteCopied ? 'Convite copiado' : 'Copiar convite'}
          </button>
        </div>
      </div>
      <div className="stage">
        {state.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
        {!['connecting', 'connected'].includes(state.socketState) && (
          <button type="button" className="btn btn-outline" onClick={() => controller.reconnect()}>
            Reconectar à sala
          </button>
        )}
        {state.selfId && <p className="info-line">Você: {controller.nameOf(state.selfId)}</p>}
        <div className="video-card">
          {!watching && !ended && (
            <div className={`video-empty${live.length ? ' is-grid' : ''}`}>
              {live.length === 0 ? (
                <div className="empty-placeholder">
                  <div className="icon">
                    <ScreenIcon size={28} />
                  </div>
                  <div>
                    <h2>Nenhuma transmissão no momento</h2>
                    <p>Assim que alguém compartilhar a tela, ela aparece aqui para você escolher.</p>
                  </div>
                </div>
              ) : (
                <div className="screen-picker">
                  <ScreenPicker
                    members={state.members}
                    selfId={state.selfId}
                    selectedId={state.selectedId}
                    connected={connected}
                    onWatch={peerId => controller.watch(peerId)}
                  />
                </div>
              )}
            </div>
          )}
          {ended && (
            <div className="video-empty">
              <div className="icon">
                <EndedIcon />
              </div>
              <div>
                <h2>{endedTitle}</h2>
                <p>{endedBody}</p>
              </div>
              <div className="modal-actions room-ended-actions">
                {state.endedReason === 'remote' ? (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => controller.dismissEnded()}>
                      Voltar para a lista
                    </button>
                    <button type="button" className="btn btn-outline" onClick={() => void controller.share()}>
                      Compartilhar minha tela
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => void controller.share()}>
                      Compartilhar novamente
                    </button>
                    <button type="button" className="btn btn-outline" onClick={() => controller.dismissEnded()}>
                      Voltar para a lista
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <MediaVideo
            stream={state.remoteStream}
            label="Transmissão selecionada"
            onStopWatching={() => controller.watch(null)}
          />
        </div>
        <div className="action-bar">
          <button
            type="button"
            className="btn btn-primary"
            data-share
            disabled={!connected || state.sharing || state.capturing}
            onClick={() => void controller.share()}
          >
            <ScreenIcon size={16} /> {state.capturing ? 'Selecionando tela…' : 'Compartilhar tela'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            data-stop-share
            disabled={!state.sharing && !state.capturing}
            onClick={() => controller.stopSharing()}
          >
            <StopIcon /> Parar compartilhamento
          </button>
          <span className="conn-label">{connection}</span>
        </div>
        {state.localStream && (
          <details className="local-preview">
            <summary>Preview local (sem som)</summary>
            <MediaVideo stream={state.localStream} local label="Preview local" />
            <p className="info-line" data-capture-info>
              {state.captureInfo}
            </p>
            <div className="watchers-row">
              <WatcherList watcherIds={state.watcherIds} nameOf={peerId => controller.nameOf(peerId)} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
