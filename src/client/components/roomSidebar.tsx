import { useState, type CSSProperties } from 'react';
import { ALIAS_MAX_LENGTH } from '../../lib/signaling/messages';
import {
  isVideoCodecSupported,
  type VideoCodecPreference,
  VIDEO_CODEC_PREFERENCES,
} from '../../lib/webrtc/codecs';
import type { MediaProvider } from '../media/types';
import { ACCENTS, type ScreenShareState } from '../screenShare';
import { inviteUrl, listFavoriteRooms } from '../roomStorage';
import {
  avatarColor,
  initialsOf,
  participantName,
} from '../participantPresentation';
import { ParticipantList } from './roomParticipants';
import { ArrowLeftIcon, GearIcon, LeaveIcon, ScreenIcon } from './icons';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

type Props = {
  roomId: string;
  state: ScreenShareState;
  controller: MediaProvider;
  collapsed: boolean;
  onDebug: () => void;
};

const CODEC_LABELS: Record<VideoCodecPreference, string> = {
  auto: 'Automático — recomendado',
  vp8: 'VP8',
  vp9: 'VP9',
  h264: 'H.264',
  av1: 'AV1',
};

const DEGRADATION_ITEMS: Array<{
  label: string;
  value: ScreenShareState['degradation'];
}> = [
  { value: 'framerate', label: 'Fluidez — FPS estável, imagem pode borrar' },
  { value: 'balanced', label: 'Equilíbrio entre FPS e nitidez' },
  { value: 'resolution', label: 'Nitidez — imagem nítida, FPS pode cair' },
];

const CAPTURE_ITEMS: Array<{
  label: string;
  value: ScreenShareState['captureQuality'];
}> = [
  { value: 'fluid', label: 'Fluida — 1080p · 60 FPS' },
  { value: 'balanced', label: 'Equilibrada — 1440p · 30 FPS' },
  { value: 'sharp', label: 'Nítida — 1440p · 60 FPS' },
];

export function RoomSidebar({
  roomId,
  state,
  controller,
  collapsed,
  onDebug,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const favoriteRooms = listFavoriteRooms();
  const connected = state.socketState === 'connected' && Boolean(state.selfId);
  const selfName = state.selfId ? controller.nameOf(state.selfId) : 'Você';
  const fallbackName = state.selfId
    ? participantName(state.selfId)
    : 'Participante';
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
        {favoriteRooms.length > 0 && (
          <>
            <nav className="rail-favorites" aria-label="Salas favoritas">
              {favoriteRooms.map(room => (
                <a
                  key={room.roomId}
                  className={`rail-btn rail-room${room.roomId === roomId ? ' is-active' : ''}`}
                  href={inviteUrl(room)}
                  title={room.roomName}
                  aria-label={`Abrir sala favorita ${room.roomName}`}
                  style={{ background: 'var(--card-2)', color: 'var(--ink)' }}
                >
                  <span className="rail-room-initials" aria-hidden="true">
                    {initialsOf(room.roomName)}
                  </span>
                </a>
              ))}
            </nav>
            <div className="rail-sep" />
          </>
        )}
        <a className="rail-btn rail-btn-danger" href="/" title="Sair da sala">
          <ArrowLeftIcon />
        </a>
      </div>
      <aside
        id="room-sidebar"
        className={`sidebar${collapsed ? ' is-collapsed' : ''}`}
        aria-hidden={collapsed}
      >
        <div className="sidebar-header">
          <div className="title-row">
            <span>{state.roomName || 'Sala de transmissão'}</span>
          </div>
          <span className="room-id mono" data-room>
            {roomId}
          </span>
        </div>
        <div className="sidebar-section">
          <div className="section-title">
            <span>Participantes</span>
            <span className="count mono" data-participants>
              {state.members.length}
            </span>
          </div>
          <ul className="members" data-members>
            <ParticipantList
              members={state.members}
              selfId={state.selfId}
              selectedIds={state.selectedIds}
              connected={connected}
              onWatch={peerId => controller.watch(peerId)}
            />
          </ul>
        </div>
        <button type="button" className="debug-toggle-btn" onClick={onDebug}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
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
                  style={
                    {
                      background: color,
                      '--swatch-color': color,
                    } as CSSProperties
                  }
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
            <Select
              items={DEGRADATION_ITEMS}
              value={state.degradation}
              onValueChange={value => value && controller.setDegradation(value)}
            >
              <SelectTrigger aria-label="O que priorizar sob carga de CPU ou rede">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DEGRADATION_ITEMS.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="label">Qualidade da captura</span>
            <Select
              items={CAPTURE_ITEMS}
              value={state.captureQuality}
              onValueChange={value =>
                value && void controller.setCaptureQuality(value)
              }
            >
              <SelectTrigger aria-label="Resolução e taxa de quadros da captura">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CAPTURE_ITEMS.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="label">Codec de vídeo</span>
            <Select
              items={VIDEO_CODEC_PREFERENCES.map(value => ({
                label: CODEC_LABELS[value],
                value,
              }))}
              value={state.codecPreference}
              onValueChange={value =>
                value && controller.setCodecPreference(value)
              }
            >
              <SelectTrigger aria-label="Codec preferido para o próximo compartilhamento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {VIDEO_CODEC_PREFERENCES.map(codec => (
                    <SelectItem
                      key={codec}
                      value={codec}
                      disabled={!isVideoCodecSupported(codec)}
                    >
                      {CODEC_LABELS[codec]}
                      {isVideoCodecSupported(codec) ? '' : ' — indisponível'}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="settings-hint">
              A alteração vale no próximo compartilhamento.
            </span>
          </div>
        )}
        <div className="sidebar-footer">
          <div
            className="avatar"
            style={{
              background: state.selfId ? avatarColor(selfName) : undefined,
            }}
          >
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
