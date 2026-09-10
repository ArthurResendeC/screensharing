import { Fragment, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import {
  ROOM_NAME_MAX_LENGTH,
  ROOM_PASSWORD_MAX_LENGTH,
  roomIdSchema,
  roomNameSchema,
  roomPasswordSchema,
} from '../lib/signaling/messages';
import { createRoom } from '../lib/signaling/client';
import { configureRtc } from '../lib/webrtc/rtcConfiguration';
import { configureMedia } from './media/config';
import { Room } from './room';
import { RoomPasswordGate } from './components/roomModals';
import { EyeIcon } from './components/icons';
import {
  findStoredInvite,
  findRoomAccess,
  inviteUrl,
  listFavoriteRooms,
  parseInvite,
  recallRecentRoom,
  removeFavoriteRoom,
  roomPasswordProtected,
  saveFavoriteRoom,
  type RoomInvite,
  validRoomAccessToken,
} from './roomStorage';
import './styles.css';
import { applyTheme, loadTheme, type Theme } from './theme';

const publicConfigSchema = z.object({
  mediaProvider: z.enum(['webrtc', 'cloudflare']).optional(),
  maxVideoBitrate: z.number(),
  minVideoBitrate: z.number().optional(),
  startVideoBitrate: z.number().optional(),
  turn: z
    .object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    })
    .nullable(),
});

function Icon({ kind }: { kind: Theme }) {
  return kind === 'dark' ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
    </svg>
  );
}

function roomIdFromPath() {
  const match = location.pathname.match(/^\/room\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return '';
  }
}

function inviteFromLocation(roomId: string) {
  const incoming = parseInvite(location.href);
  const stored = roomIdSchema.safeParse(roomId).success ? findStoredInvite(roomId) : null;
  if (!incoming) return stored;
  const access =
    stored?.credential === incoming.credential ? stored : findRoomAccess(incoming.roomId, incoming.credential);
  return access
    ? {
        ...incoming,
        accessToken: access.accessToken,
        accessTokenExpiresAt: access.accessTokenExpiresAt,
      }
    : incoming;
}

type OpenRoom = (invite: RoomInvite, password?: string) => void;

function Lobby({ onOpenRoom }: { onOpenRoom: OpenRoom }) {
  const [theme, setTheme] = useState(loadTheme);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [favorites, setFavorites] = useState(listFavoriteRooms);
  const lastRoom = recallRecentRoom();

  const changeTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  const join = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = form.get('room');
    const invite = typeof value === 'string' ? parseInvite(value.trim()) : null;
    if (!invite) {
      setError('Informe um link de convite completo e válido.');
      return;
    }
    onOpenRoom(invite);
  };

  const submitCreate = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsedName = roomNameSchema.safeParse(form.get('room-name'));
    const passwordValue = form.get('room-password');
    const parsedPassword =
      passwordValue === '' ? { success: true as const, data: undefined } : roomPasswordSchema.safeParse(passwordValue);
    if (!parsedName.success || !parsedPassword.success) {
      setError(
        `Informe um nome e, se quiser proteger a sala, use uma senha de até ${ROOM_PASSWORD_MAX_LENGTH} caracteres.`,
      );
      return;
    }
    setCreating(true);
    setError('');
    try {
      const created = await createRoom(parsedName.data, parsedPassword.data);
      const invite = { roomId: created.roomId, credential: created.credential };
      saveFavoriteRoom({ ...invite, roomName: created.roomName });
      onOpenRoom(invite, parsedPassword.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a sala.');
    } finally {
      setCreating(false);
    }
  };

  const removeFavorite = (roomId: string) => {
    removeFavoriteRoom(roomId);
    setFavorites(listFavoriteRooms());
  };

  return (
    <main className="lobby">
      <div className="theme-switch">
        {(['dark', 'light'] as const).map(kind => (
          <button
            key={kind}
            type="button"
            className={`btn-icon${theme === kind ? ' is-active' : ''}`}
            title={kind === 'dark' ? 'Tema escuro' : 'Tema claro'}
            onClick={() => changeTheme(kind)}
          >
            <Icon kind={kind} />
          </button>
        ))}
      </div>
      <h1>ReShare</h1>
      <p>Compartilhe sua tela com até quatro amigos. Todos podem transmitir e escolher uma tela para assistir.</p>
      <form className="lobby-card" onSubmit={event => void submitCreate(event)}>
        <h2>Criar sala</h2>
        <label htmlFor="room-name">Nome da sala</label>
        <input id="room-name" name="room-name" maxLength={ROOM_NAME_MAX_LENGTH} required />
        <label htmlFor="new-room-password">Senha (opcional)</label>
        <div className="password-input">
          <input
            id="new-room-password"
            name="room-password"
            type={passwordVisible ? 'text' : 'password'}
            maxLength={ROOM_PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="password-visibility"
            aria-label={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={passwordVisible}
            onClick={() => setPasswordVisible(visible => !visible)}
          >
            <EyeIcon visible={passwordVisible} />
          </button>
        </div>
        <button type="submit" className="btn btn-primary" disabled={creating}>
          {creating ? 'Criando…' : 'Criar sala'}
        </button>
      </form>
      {lastRoom && !favorites.some(room => room.roomId === lastRoom.roomId) && (
        <button type="button" className="btn btn-outline" onClick={() => onOpenRoom(lastRoom)}>
          Voltar à última sala
        </button>
      )}
      <form className="lobby-card" onSubmit={join}>
        <h2>Entrar por convite</h2>
        <label htmlFor="room">Link da sala</label>
        <input id="room" name="room" type="url" required />
        <button type="submit" className="btn btn-outline">
          Entrar
        </button>
      </form>
      {favorites.length > 0 && (
        <section className="favorite-rooms" aria-labelledby="favorite-rooms-title">
          <h2 id="favorite-rooms-title">Salas favoritas</h2>
          {favorites.map(room => (
            <div className="favorite-room" key={room.roomId}>
              <button type="button" className="favorite-room-open" onClick={() => onOpenRoom(room)}>
                <strong>{room.roomName}</strong>
                <span className="mono">{room.roomId.slice(0, 8)}</span>
              </button>
              <button type="button" className="btn btn-outline" onClick={() => removeFavorite(room.roomId)}>
                Remover
              </button>
            </div>
          ))}
        </section>
      )}
      <p>Compartilhe o link e a senha separadamente. A senha não é salva pelo ReShare.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}

function InvalidRoom() {
  document.title = 'Sala inválida — ReShare';
  return (
    <main className="simple-page">
      <a href="/">← Início</a>
      <h1>Sala inválida</h1>
      <p>Use um convite válido ou crie uma nova sala.</p>
    </main>
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function App() {
  const online = useOnlineStatus();
  const [route, setRoute] = useState(() => {
    const roomId = roomIdFromPath();
    if (roomId === null) return null;
    const invite = inviteFromLocation(roomId);
    return { roomId, invite, password: undefined as string | undefined };
  });

  useEffect(() => {
    const navigate = () => {
      const roomId = roomIdFromPath();
      if (roomId === null) setRoute(null);
      else
        setRoute({
          roomId,
          invite: inviteFromLocation(roomId),
          password: undefined,
        });
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);

  const openRoom: OpenRoom = (invite, password) => {
    history.pushState(null, '', inviteUrl(invite));
    setRoute({ roomId: invite.roomId, invite, password });
  };

  let page;
  if (!route) page = <Lobby onOpenRoom={openRoom} />;
  else if (!roomIdSchema.safeParse(route.roomId).success || !route.invite) page = <InvalidRoom />;
  else if (
    roomPasswordProtected(route.invite.credential) === true &&
    !route.password &&
    !validRoomAccessToken(route.invite)
  )
    page = (
      <RoomPasswordGate onSubmit={password => setRoute(current => (current ? { ...current, password } : current))} />
    );
  else
    page = (
      <Room
        roomId={route.roomId}
        credential={route.invite.credential}
        password={route.password}
        accessToken={validRoomAccessToken(route.invite)}
      />
    );
  return (
    <Fragment>
      {!online && (
        <div className="connectivity-banner" role="status" aria-live="polite">
          Você está offline. Salas e transmissões exigem internet; a conexão será retomada automaticamente.
        </div>
      )}
      {page}
    </Fragment>
  );
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
  } catch {
    // A aplicação continua funcional em navegadores sem suporte ou com o recurso bloqueado.
  }
}

async function bootstrap() {
  applyTheme(loadTheme());
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const config = publicConfigSchema.parse(await response.json());
    configureRtc(config);
    configureMedia({
      mediaProvider: config.mediaProvider ?? 'webrtc',
      maxVideoBitrate: config.maxVideoBitrate,
    });
  } catch {
    configureRtc({
      maxVideoBitrate: 15_000_000,
      minVideoBitrate: 2_500_000,
      startVideoBitrate: 8_000_000,
      turn: null,
    });
    configureMedia({ mediaProvider: 'webrtc' });
  }

  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Contêiner da aplicação ausente.');
  createRoot(root).render(<App />);
  void registerServiceWorker();
}

void bootstrap();
