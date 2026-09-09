import { useState } from 'react';
import type { ScreenShareController, ScreenShareState } from '../screenShare';
import { MediaVideo } from './mediaVideo';
import { ScreenPicker, WatcherList } from './roomParticipants';
import {
  EndedIcon,
  LayoutColumnsIcon,
  LayoutRowsIcon,
  PanelIcon,
  PlusIcon,
  ScreenIcon,
  StarIcon,
  StopIcon,
} from './icons';

type StreamLayout = 'columns' | 'rows';

export function RoomStage({
  state,
  controller,
  favorite,
  sidebarCollapsed,
  onToggleSidebar,
  onToggleFavorite,
}: {
  state: ScreenShareState;
  controller: ScreenShareController;
  favorite: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleFavorite: () => void;
}) {
  const [streamLayout, setStreamLayout] = useState<StreamLayout>('rows');
  const connected = state.socketState === 'connected' && Boolean(state.selfId);
  const live = state.members.filter(member => member.sharing && member.peerId !== state.selfId);
  const watching = state.selectedIds.length > 0;
  const ended = Boolean(state.endedReason) && !watching;
  const connection = `Conexão: ${state.connectionState}${state.connectionState === 'failed' ? ' — tente reconectar à transmissão; esta rede pode exigir TURN.' : ''}`;
  const title = watching ? state.selectedIds.map(peerId => controller.nameOf(peerId)).join(' + ') : 'Minha transmissão';
  const subtitle = watching
    ? `assistindo ${state.selectedIds.length} transmissão${state.selectedIds.length > 1 ? 'ões' : ''}`
    : state.sharing
      ? 'transmitindo sua tela'
      : 'nenhuma tela ativa';
  const endedTitle = state.endedReason === 'remote' ? 'Transmissão encerrada' : 'Você encerrou o compartilhamento';
  const endedBody =
    state.endedReason === 'remote'
      ? `${state.endedPeerId ? controller.nameOf(state.endedPeerId) : 'Participante'} parou de compartilhar a tela. Escolha outra transmissão na lista de participantes.`
      : 'Sua tela não está mais sendo transmitida para a sala. Os outros participantes continuam conectados.';

  return (
    <div className="main">
      <div className="topbar">
        <button
          type="button"
          className={`btn-icon sidebar-toggle${sidebarCollapsed ? ' is-active' : ''}`}
          title={sidebarCollapsed ? 'Expandir painel de participantes' : 'Recolher painel de participantes'}
          aria-label={sidebarCollapsed ? 'Expandir painel de participantes' : 'Recolher painel de participantes'}
          aria-controls="room-sidebar"
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <PanelIcon collapsed={sidebarCollapsed} />
        </button>
        <ScreenIcon size={17} className="icon" />
        <span className="title">{title}</span>
        <div className="divider" />
        <span className="sub">{subtitle}</span>
        {state.selectedIds.length > 1 && (
          <div className="layout-switch" role="group" aria-label="Layout das transmissões">
            <button
              type="button"
              className={streamLayout === 'columns' ? 'is-active' : ''}
              title="Exibir transmissões lado a lado"
              aria-label="Exibir transmissões lado a lado"
              aria-pressed={streamLayout === 'columns'}
              onClick={() => setStreamLayout('columns')}
            >
              <LayoutColumnsIcon />
              <span>Lado a lado</span>
            </button>
            <button
              type="button"
              className={streamLayout === 'rows' ? 'is-active' : ''}
              title="Empilhar transmissões"
              aria-label="Empilhar transmissões"
              aria-pressed={streamLayout === 'rows'}
              onClick={() => setStreamLayout('rows')}
            >
              <LayoutRowsIcon />
              <span>Empilhado</span>
            </button>
          </div>
        )}
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
                    selectedIds={state.selectedIds}
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
          {watching && (
            <div
              className={`remote-stream-grid${state.selectedIds.length > 1 ? ` has-two layout-${streamLayout}` : ''}`}
            >
              {state.selectedIds.map((peerId, index) => {
                const remote = state.remoteStreams.find(item => item.peerId === peerId);
                return (
                  <div className="remote-stream-cell" key={peerId}>
                    {!remote && (
                      <span className="remote-stream-loading">Conectando a {controller.nameOf(peerId)}…</span>
                    )}
                    <MediaVideo
                      stream={remote?.stream ?? null}
                      label={index === 0 ? 'Transmissão selecionada' : 'Segunda transmissão selecionada'}
                      onStopWatching={() => controller.watch(peerId)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <p className="stream-limit-notice" role="note">
          Até duas lives simultâneas. Assistir a duas pode dobrar o uso de internet e processamento; os áudios podem se
          sobrepor. Silencie uma transmissão se necessário.
        </p>
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
