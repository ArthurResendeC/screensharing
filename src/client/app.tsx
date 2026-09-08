import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { roomIdSchema } from '../lib/signaling/messages';
import { configureRtc } from '../lib/webrtc/rtcConfiguration';
import { recallRoom } from './screenShare';
import { Room } from './room';
import './styles.css';
import { applyTheme, loadTheme, type Theme } from './theme';

const publicConfigSchema = z.object({
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

function roomFromPath() {
  const match = location.pathname.match(/^\/room\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return '';
  }
}

function Lobby() {
  const [theme, setTheme] = useState(loadTheme);
  const [error, setError] = useState('');
  const lastRoom = recallRoom();
  const canRejoin = lastRoom.length > 0 && roomIdSchema.safeParse(lastRoom).success;

  const changeTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  const join = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = form.get('room');
    let id = typeof value === 'string' ? value.trim() : '';
    try {
      id = new URL(id).pathname.split('/').filter(Boolean).at(-1) ?? '';
    } catch {
      // The value may be only a room ID.
    }
    if (!roomIdSchema.safeParse(id).success) {
      setError('Informe um ID de sala válido ou o link de convite.');
      return;
    }
    location.assign(`/room/${id}`);
  };

  const createRoom = () => {
    if (!crypto.randomUUID) {
      setError('Abra em HTTPS ou localhost para criar a sala.');
      return;
    }
    location.assign(`/room/${crypto.randomUUID()}`);
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
      <button type="button" className="btn btn-primary" onClick={createRoom}>
        Criar sala
      </button>
      {canRejoin && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => location.assign(`/room/${encodeURIComponent(lastRoom)}`)}
        >
          Voltar à última sala
        </button>
      )}
      <form onSubmit={join}>
        <label htmlFor="room">ID ou URL da sala</label>
        <input id="room" name="room" required />
        <button type="submit" className="btn btn-outline">
          Entrar
        </button>
      </form>
      <p>O convite permite acesso à sala. Envie somente aos seus amigos.</p>
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

function App() {
  const roomId = roomFromPath();
  if (roomId === null) return <Lobby />;
  if (!roomIdSchema.safeParse(roomId).success) return <InvalidRoom />;
  return <Room roomId={roomId} />;
}

async function bootstrap() {
  applyTheme(loadTheme());
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    configureRtc(publicConfigSchema.parse(await response.json()));
  } catch {
    configureRtc({
      maxVideoBitrate: 15_000_000,
      minVideoBitrate: 2_500_000,
      startVideoBitrate: 8_000_000,
      turn: null,
    });
  }

  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Contêiner da aplicação ausente.');
  createRoot(root).render(<App />);
}

void bootstrap();
