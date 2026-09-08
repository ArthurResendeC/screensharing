import { useState, type CSSProperties } from 'react';
import { ALIAS_MAX_LENGTH } from '../../lib/signaling/messages';
import { ACCENTS, type ScreenShareController, type ScreenShareState } from '../screenShare';
import { avatarColor, initialsOf, participantName } from '../participantPresentation';
import { ParticipantList } from './roomParticipants';
import { ArrowLeftIcon, GearIcon, LeaveIcon, ScreenIcon } from './icons';

type Props = { roomId: string; state: ScreenShareState; controller: ScreenShareController; onDebug: () => void };

export function RoomSidebar({ roomId, state, controller, onDebug }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connected = state.socketState === 'connected' && Boolean(state.selfId);
  const selfName = state.selfId ? controller.nameOf(state.selfId) : 'Você';
  const fallbackName = state.selfId ? participantName(state.selfId) : 'Participante';
  const saveAlias = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('alias-rename');
    controller.setAlias(typeof value === 'string' ? value : '');
  };

  return (
    <>
      <div className="rail">
        <div className="logo">
          <ScreenIcon />
        </div>
        <div className="rail-sep" />
        <a className="rail-btn rail-btn-danger" href="/" title="Sair da sala">
          <ArrowLeftIcon />
        </a>
      </div>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="title-row">
            <span>Sala de transmissão</span>
          </div>
          <span className="room-id mono" data-room>
            {roomId}
          </span>
        </div>
        <div className="sidebar-section">
          <div className="section-title">
            <span>Participantes</span>
            <span className="count mono" data-participants>
              {state.members.length} / 5
            </span>
          </div>
          <ul className="members" data-members>
            <ParticipantList
              members={state.members}
              selfId={state.selfId}
              selectedId={state.selectedId}
              connected={connected}
              onWatch={peerId => controller.watch(peerId)}
            />
          </ul>
        </div>
        <button type="button" className="debug-toggle-btn" onClick={onDebug}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Debug WebRTC
        </button>
        {settingsOpen && (
          <div className="settings-panel">
            <span className="label">Seu nome na sala</span>
            <form className="alias-row" onSubmit={saveAlias}>
              <input
                key={state.alias}
                name="alias-rename"
                aria-label="Alterar seu nome na sala"
                defaultValue={state.alias}
                placeholder={fallbackName}
                maxLength={ALIAS_MAX_LENGTH}
                autoComplete="nickname"
              />
              <button type="submit" className="theme-btn">
                Salvar
              </button>
            </form>
            <span className="label">Cor de destaque</span>
            <div className="swatches">
              {ACCENTS.map(({ color, label }) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch${color === state.accent ? ' is-active' : ''}`}
                  title={label}
                  style={{ background: color, '--swatch-color': color } as CSSProperties}
                  onClick={() => controller.setAccent(color)}
                />
              ))}
            </div>
            <span className="label">Tema</span>
            <div className="theme-row">
              {(['dark', 'light'] as const).map(theme => (
                <button
                  key={theme}
                  type="button"
                  className={`theme-btn${theme === state.theme ? ' is-active' : ''}`}
                  onClick={() => controller.setTheme(theme)}
                >
                  {theme === 'dark' ? 'Escuro' : 'Claro'}
                </button>
              ))}
            </div>
            <span className="label">Sob carga, priorizar</span>
            <select
              className="settings-select"
              aria-label="O que priorizar sob carga de CPU ou rede"
              value={state.degradation}
              onChange={event =>
                controller.setDegradation(event.currentTarget.value as ScreenShareState['degradation'])
              }
            >
              <option value="framerate">Fluidez — FPS estável, imagem pode borrar</option>
              <option value="balanced">Equilíbrio entre FPS e nitidez</option>
              <option value="resolution">Nitidez — imagem nítida, FPS pode cair</option>
            </select>
            <span className="label">Qualidade da captura</span>
            <select
              className="settings-select"
              aria-label="Resolução e taxa de quadros da captura"
              value={state.captureQuality}
              onChange={event =>
                void controller.setCaptureQuality(event.currentTarget.value as ScreenShareState['captureQuality'])
              }
            >
              <option value="fluid">Fluida — 1080p · 60 FPS</option>
              <option value="balanced">Equilibrada — 1440p · 30 FPS</option>
              <option value="sharp">Nítida — 1440p · 60 FPS</option>
            </select>
          </div>
        )}
        <div className="sidebar-footer">
          <div className="avatar" style={{ background: state.selfId ? avatarColor(selfName) : undefined }}>
            {state.selfId ? initialsOf(selfName) : ''}
          </div>
          <div className="info">
            <span className="name" data-identity-name>
              {selfName}
            </span>
            <span className="id mono">{state.selfId.slice(0, 8)}</span>
          </div>
          <div className="actions">
            <button
              type="button"
              className={`btn-icon${state.sharing ? ' is-active' : ''}`}
              title="Compartilhar tela"
              onClick={() => void controller.toggleShare()}
            >
              <ScreenIcon size={16} />
            </button>
            <button
              type="button"
              className={`btn-icon${settingsOpen ? ' is-active' : ''}`}
              title="Configurações"
              onClick={() => setSettingsOpen(open => !open)}
            >
              <GearIcon />
            </button>
            <a className="btn-icon" href="/" title="Início / sair da sala">
              <LeaveIcon />
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
