import type { CSSProperties } from 'react';
import type { Participant } from '../../lib/signaling/messages';
import { avatarColor, displayName, initialsOf } from '../participantPresentation';
import { ScreenIcon } from './icons';

type SelectionProps = {
  members: Participant[];
  selfId: string;
  selectedId: string | null;
  connected: boolean;
  onWatch: (peerId: string | null) => void;
};

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="7,4 20,12 7,20" />
    </svg>
  );
}

export function ParticipantList({ members, selfId, selectedId, connected, onWatch }: SelectionProps) {
  return members.map(member => {
    const isSelf = member.peerId === selfId;
    const isSelected = selectedId === member.peerId;
    const canWatch = member.sharing && !isSelf;
    const name = displayName(member);
    return (
      <li key={member.peerId} className={`member${canWatch ? ' is-live' : ''}${isSelected ? ' is-selected' : ''}`}>
        <div className="avatar" style={{ background: avatarColor(name) }}>
          {initialsOf(name)}
          <div className={`dot${member.sharing ? ' is-live' : ''}`} />
        </div>
        <div className="info">
          <span className="name">{name}</span>
          <span className="status">{member.sharing ? 'Transmitindo' : 'Sem transmissão'}</span>
        </div>
        {canWatch && (
          <button
            type="button"
            className="watch-btn"
            disabled={!connected}
            aria-pressed={isSelected}
            title={`${isSelected ? 'Reconectar a' : 'Assistir a'} ${name}`}
            onClick={() => onWatch(member.peerId)}
          >
            <PlayIcon />
          </button>
        )}
      </li>
    );
  });
}

export function ScreenPicker({ members, selfId, selectedId, connected, onWatch }: SelectionProps) {
  const live = members.filter(member => member.sharing && member.peerId !== selfId);
  const columns = Math.ceil(Math.sqrt(live.length)) || 1;
  const rows = Math.ceil(live.length / columns) || 1;
  const style = { '--picker-columns': columns, '--picker-rows': rows } as CSSProperties;
  return (
    <div className="screen-picker-grid" style={style}>
      {live.map(member => {
        const selected = selectedId === member.peerId;
        const name = displayName(member);
        return (
          <button
            key={member.peerId}
            type="button"
            className={`screen-tile${selected ? ' is-selected' : ''}`}
            disabled={!connected}
            onClick={() => onWatch(selected ? null : member.peerId)}
          >
            <div className="screen-tile-thumb" style={{ background: `${avatarColor(name)}22` }}>
              <div className="screen-tile-overlay">
                <span className={`screen-tile-cta${selected ? ' is-current' : ''}`}>
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

export function WatcherList({ watcherIds, nameOf }: { watcherIds: string[]; nameOf: (peerId: string) => string }) {
  return (
    <>
      <div className="watchers-stack">
        {watcherIds.map(peerId => {
          const name = nameOf(peerId);
          return (
            <div key={peerId} className="watcher-avatar" title={name} style={{ background: avatarColor(name) }}>
              {initialsOf(name)}
            </div>
          );
        })}
      </div>
      <span className="watchers-label">
        {watcherIds.length === 0 ? 'Ninguém assistindo ainda' : `Assistindo à sua tela (${watcherIds.length})`}
      </span>
    </>
  );
}
