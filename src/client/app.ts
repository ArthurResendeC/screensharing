import { z } from 'zod';
import { roomIdSchema } from '../lib/signaling/messages';
import { configureRtc } from '../lib/webrtc/rtcConfiguration';
import { recallRoom, ScreenShareController } from './screenShare';
import { applyTheme, loadTheme } from './theme';

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

const MOON_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"></path></svg>';
const SUN_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"></path></svg>';

function requiredRoot() {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Contêiner da aplicação ausente.');
  return root;
}

function roomFromPath() {
  const match = location.pathname.match(/^\/room\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function renderLobby(root: HTMLElement) {
  const lastRoom = recallRoom();
  const canRejoin = lastRoom.length > 0 && roomIdSchema.safeParse(lastRoom).success;
  root.innerHTML = `
    <main class="lobby">
      <div class="theme-switch">
        <button type="button" class="btn-icon" data-theme-dark title="Tema escuro">${MOON_ICON}</button>
        <button type="button" class="btn-icon" data-theme-light title="Tema claro">${SUN_ICON}</button>
      </div>
      <h1>WebRTC Screen Share</h1>
      <p>Compartilhe sua tela com até quatro amigos. Todos podem transmitir e escolher uma tela para assistir.</p>
      <button type="button" class="btn btn-primary" data-create>Criar sala</button>
      ${canRejoin ? `<button type="button" class="btn btn-outline" data-rejoin>Voltar à última sala</button>` : ''}
      <form data-join>
        <label for="room">ID ou URL da sala</label>
        <input id="room" name="room" required />
        <button type="submit" class="btn btn-outline">Entrar</button>
      </form>
      <p>O convite permite acesso à sala. Envie somente aos seus amigos.</p>
      <p role="alert" class="error" data-error hidden></p>
    </main>`;
  const darkButton = root.querySelector<HTMLButtonElement>('[data-theme-dark]')!;
  const lightButton = root.querySelector<HTMLButtonElement>('[data-theme-light]')!;
  const syncThemeButtons = () => {
    const theme = loadTheme();
    darkButton.classList.toggle('is-active', theme === 'dark');
    lightButton.classList.toggle('is-active', theme === 'light');
  };
  darkButton.addEventListener('click', () => {
    applyTheme('dark');
    syncThemeButtons();
  });
  lightButton.addEventListener('click', () => {
    applyTheme('light');
    syncThemeButtons();
  });
  syncThemeButtons();
  const error = root.querySelector<HTMLElement>('[data-error]')!;
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
  if (canRejoin) {
    root.querySelector<HTMLButtonElement>('[data-rejoin]')!.addEventListener('click', () => {
      location.assign(`/room/${encodeURIComponent(lastRoom)}`);
    });
  }
  root.querySelector<HTMLButtonElement>('[data-create]')!.addEventListener('click', () => {
    if (!crypto.randomUUID) {
      showError('Abra em HTTPS ou localhost para criar a sala.');
      return;
    }
    location.assign(`/room/${crypto.randomUUID()}`);
  });
  const form = root.querySelector<HTMLFormElement>('[data-join]')!;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const input = new FormData(form).get('room');
    let id = typeof input === 'string' ? input.trim() : '';
    try {
      id = new URL(id).pathname.split('/').filter(Boolean).at(-1) ?? '';
    } catch {
      /* O valor pode ser somente o ID. */
    }
    if (!roomIdSchema.safeParse(id).success) {
      showError('Informe um ID de sala válido ou o link de convite.');
      return;
    }
    location.assign(`/room/${id}`);
  });
}

async function main() {
  applyTheme(loadTheme());
  const root = requiredRoot();
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    configureRtc(publicConfigSchema.parse(await response.json()));
  } catch {
    configureRtc({ maxVideoBitrate: 15_000_000, minVideoBitrate: 2_500_000, startVideoBitrate: 8_000_000, turn: null });
  }
  const roomId = roomFromPath();
  if (roomId === null) {
    renderLobby(root);
    return;
  }
  if (!roomIdSchema.safeParse(roomId).success) {
    document.title = 'Sala inválida — WebRTC Screen Share';
    root.innerHTML =
      '<main class="simple-page"><a href="/">← Início</a><h1>Sala inválida</h1><p>Use um convite válido ou crie uma nova sala.</p></main>';
    return;
  }
  const controller = new ScreenShareController(root, roomId);
  window.addEventListener('pagehide', () => controller.dispose(), { once: true });
}

void main();
