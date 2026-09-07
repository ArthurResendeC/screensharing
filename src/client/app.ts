import { z } from 'zod';
import { roomIdSchema } from '../lib/signaling/messages';
import { configureRtc } from '../lib/webrtc/rtcConfiguration';
import { ScreenShareController } from './screenShare';

const publicConfigSchema = z.object({
  maxVideoBitrate: z.number(),
  turn: z.object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  }).nullable(),
});

function requiredRoot() {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('Contêiner da aplicação ausente.');
  return root;
}

function roomFromPath() {
  const match = location.pathname.match(/^\/room\/([^/]+)\/?$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); }
  catch { return ''; }
}

function renderLobby(root: HTMLElement) {
  root.innerHTML = `
    <main>
      <h1>WebRTC Screen Share</h1>
      <p>Compartilhe sua tela com até quatro amigos. Todos podem transmitir e escolher uma tela para assistir.</p>
      <button data-create>Criar sala</button>
      <form data-join>
        <label for="room">ID ou URL da sala</label>
        <input id="room" name="room" required />
        <button>Entrar</button>
      </form>
      <p>O convite permite acesso à sala. Envie somente aos seus amigos.</p>
      <p role="alert" class="error" data-error hidden></p>
    </main>`;
  const error = root.querySelector<HTMLElement>('[data-error]')!;
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
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
    try { id = new URL(id).pathname.split('/').filter(Boolean).at(-1) ?? ''; }
    catch { /* O valor pode ser somente o ID. */ }
    if (!roomIdSchema.safeParse(id).success) {
      showError('Informe um ID de sala válido ou o link de convite.');
      return;
    }
    location.assign(`/room/${id}`);
  });
}

async function main() {
  const root = requiredRoot();
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    configureRtc(publicConfigSchema.parse(await response.json()));
  } catch {
    configureRtc({ maxVideoBitrate: 15_000_000, turn: null });
  }
  const roomId = roomFromPath();
  if (roomId === null) {
    renderLobby(root);
    return;
  }
  if (!roomIdSchema.safeParse(roomId).success) {
    document.title = 'Sala inválida — WebRTC Screen Share';
    root.innerHTML = '<main><a href="/">← Início</a><h1>Sala inválida</h1><p>Use um convite válido ou crie uma nova sala.</p></main>';
    return;
  }
  const controller = new ScreenShareController(root, roomId);
  window.addEventListener('pagehide', () => controller.dispose(), { once: true });
}

void main();
