import { useState, type CSSProperties } from 'react';
import type { Participant, RoomRole } from '../../lib/signaling/messages';
import { MAX_WATCHED_STREAMS } from '../../lib/signaling/messages';
import {
  avatarColor,
  displayName,
  initialsOf,
} from '../participantPresentation';
import { ScreenIcon } from './icons';

type ModerationProps = {
  // Papel de quem está olhando. Gatilho de UI apenas: o servidor reautoriza toda ação
  // pelo papel que resolveu no join.
  role: RoomRole;
  onKick: (peerId: string) => void;
  onGrantModerator: (peerId: string, permanent: boolean) => void;
  onRevokeModerator: (peerId: string) => void;
};

type SelectionProps = {
  members: Participant[];
  selfId: string;
  selectedIds: string[];
  connected: boolean;
  onWatch: (peerId: string) => void;
};

const ROLE_LABELS: Record<RoomRole, string> = {
  host: 'Dono',
  moderator: 'Moderador',
  guest: '',
};

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="7,4 20,12 7,20" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6Z" />
    </svg>
  );
}

function MemberRow({
  member,
  isSelf,
  isSelected,
  connected,
  selectedCount,
  onWatch,
  moderation,
}: {
  member: Participant;
  isSelf: boolean;
  isSelected: boolean;
  connected: boolean;
  selectedCount: number;
  onWatch: (peerId: string) => void;
  moderation?: ModerationProps;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canWatch = member.sharing && !isSelf;
  const name = displayName(member);
  // O dono nunca é alvo: nem expulsão nem rebaixamento, para não existir caminho em
  // que a sala fica sem quem a controla.
  const targetable = Boolean(moderation) && !isSelf && member.role !== 'host';
  const canKick = targetable && moderation!.role !== 'guest';
  const canModerate = targetable && moderation!.role === 'host';
  const act = (run: () => void) => {
    run();
    setMenuOpen(false);
  };

  return (
    <li
      className={`member${canWatch ? ' is-live' : ''}${isSelected ? ' is-selected' : ''}`}
    >
      <div className="member-row">
        <div className="avatar" style={{ background: avatarColor(name) }}>
          {initialsOf(name)}
          <div className={`dot${member.sharing ? ' is-live' : ''}`} />
        </div>
        <div className="info">
          <span className="name-row">
            <span className="name">{name}</span>
            {member.role !== 'guest' && (
              <span className={`role-badge is-${member.role}`}>
                {ROLE_LABELS[member.role]}
              </span>
            )}
          </span>
          <span className="status">
            {member.sharing ? 'Transmitindo' : 'Sem transmissão'}
          </span>
        </div>
        {(canKick || canModerate) && (
          <button
            type="button"
            className={`member-admin-btn${menuOpen ? ' is-active' : ''}`}
            aria-expanded={menuOpen}
            title={`Moderar ${name}`}
            aria-label={`Moderar ${name}`}
            onClick={() => setMenuOpen(open => !open)}
          >
            <ShieldIcon />
          </button>
        )}
        {canWatch && (
          <button
            type="button"
            className="watch-btn"
            disabled={
              !connected ||
              (!isSelected && selectedCount >= MAX_WATCHED_STREAMS)
            }
            aria-pressed={isSelected}
            title={`${isSelected ? 'Reconectar a' : 'Assistir a'} ${name}`}
            onClick={() => onWatch(member.peerId)}
          >
            <PlayIcon />
          </button>
        )}
      </div>
      {menuOpen && moderation && (
        <div className="member-admin-menu">
          {canModerate &&
            (member.role === 'moderator' ? (
              <button
                type="button"
                onClick={() =>
                  act(() => moderation.onRevokeModerator(member.peerId))
                }
              >
                Remover moderação
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() =>
                    act(() => moderation.onGrantModerator(member.peerId, false))
                  }
                >
                  Moderador nesta sessão
                </button>
                <button
                  type="button"
                  onClick={() =>
                    act(() => moderation.onGrantModerator(member.peerId, true))
                  }
                >
                  Moderador permanente
                </button>
              </>
            ))}
          {canKick && (
            <button
              type="button"
              className="is-danger"
              onClick={() => act(() => moderation.onKick(member.peerId))}
            >
              Remover da sala
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function ParticipantList({
  members,
  selfId,
  selectedIds,
  connected,
  onWatch,
  moderation,
}: SelectionProps & { moderation?: ModerationProps }) {
  return members.map(member => (
    <MemberRow
      key={member.peerId}
      member={member}
      isSelf={member.peerId === selfId}
      isSelected={selectedIds.includes(member.peerId)}
      connected={connected}
      selectedCount={selectedIds.length}
      onWatch={onWatch}
      moderation={moderation}
    />
  ));
}

export function ScreenPicker({
  members,
  selfId,
  selectedIds,
  connected,
  onWatch,
}: SelectionProps) {
  const live = members.filter(
    member => member.sharing && member.peerId !== selfId,
  );
  const columns = Math.ceil(Math.sqrt(live.length)) || 1;
  const rows = Math.ceil(live.length / columns) || 1;
  const style = {
    '--picker-columns': columns,
    '--picker-rows': rows,
  } as CSSProperties;
  return (
    <div className="screen-picker-grid" style={style}>
      {live.map(member => {
        const selected = selectedIds.includes(member.peerId);
        const name = displayName(member);
        return (
          <button
            key={member.peerId}
            type="button"
            className={`screen-tile${selected ? ' is-selected' : ''}`}
            disabled={
              !connected ||
              (!selected && selectedIds.length >= MAX_WATCHED_STREAMS)
            }
            onClick={() => onWatch(member.peerId)}
          >
            <div
              className="screen-tile-thumb"
              style={{ background: `${avatarColor(name)}22` }}
            >
              <div className="screen-tile-overlay">
                <span
                  className={`screen-tile-cta${selected ? ' is-current' : ''}`}
                >
                  {selected ? (
                    '✓ Assistindo'
                  ) : (
                    <>
                      <PlayIcon /> Assistir transmissão
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="screen-tile-tag">
              <ScreenIcon size={16} />
              <span>{name}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function WatcherList({
  watcherIds,
  nameOf,
}: {
  watcherIds: string[];
  nameOf: (peerId: string) => string;
}) {
  return (
    <>
      <div className="watchers-stack">
        {watcherIds.map(peerId => {
          const name = nameOf(peerId);
          return (
            <div
              key={peerId}
              className="watcher-avatar"
              title={name}
              style={{ background: avatarColor(name) }}
            >
              {initialsOf(name)}
            </div>
          );
        })}
      </div>
      <span className="watchers-label">
        {watcherIds.length === 0
          ? 'Ninguém assistindo ainda'
          : `Assistindo à sua tela (${watcherIds.length})`}
      </span>
    </>
  );
}
