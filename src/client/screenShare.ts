import { connectSignaling } from '../lib/signaling/client';
import type { Participant, ServerMessage } from '../lib/signaling/messages';
import { Peers } from '../lib/webrtc/peers';
import { ConnectionDebug } from './connectionDebug';
import { Viewer } from './viewer';

type Selection = { peerId: string; sessionId: string };
type Session = {
  peers: Peers;
  channel: ReturnType<typeof connectSignaling> | null;
  members: Participant[];
  stream: MediaStream | null;
  selection: Selection | null;
  watchRequest: string;
  disposed: boolean;
  capture: number;
  joined: boolean;
};

const participantName = (id: string) => `Participante ${id.slice(0, 8)}`;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Elemento ausente: ${selector}`);
  return element;
}

export class ScreenShareController {
  private session: Session | null = null;
  private socketState = 'connecting';
  private selfId = '';
  private selectedId: string | null = null;
  private capturing = false;
  private settingsTimer?: ReturnType<typeof setInterval>;
  private readonly localViewer: Viewer;
  private readonly remoteViewer: Viewer;
  private readonly debug: ConnectionDebug;

  private readonly copyButton: HTMLButtonElement;
  private readonly participants: HTMLElement;
  private readonly identity: HTMLElement;
  private readonly error: HTMLElement;
  private readonly reconnectButton: HTMLButtonElement;
  private readonly shareButton: HTMLButtonElement;
  private readonly stopShareButton: HTMLButtonElement;
  private readonly sharingInfo: HTMLElement;
  private readonly captureInfo: HTMLElement;
  private readonly watchersInfo: HTMLElement;
  private readonly membersList: HTMLUListElement;
  private readonly watching: HTMLElement;
  private readonly watchingName: HTMLElement;
  private readonly stopWatchingButton: HTMLButtonElement;
  private readonly connection: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly roomId: string) {
    root.innerHTML = `
      <main>
        <a href="/">← Início / sair da sala</a>
        <h1>WebRTC Screen Share</h1>
        <p>Sala: <code data-room></code></p>
        <button data-copy>Copiar convite</button>
        <p data-participants>Participantes: 0 / 5</p>
        <p data-identity hidden></p>
        <p role="alert" class="error" data-error hidden></p>
        <button data-reconnect hidden>Reconectar à sala</button>

        <section aria-label="Minha transmissão">
          <h2>Minha transmissão</h2>
          <div class="actions">
            <button data-share disabled>Compartilhar tela</button>
            <button data-stop-share disabled>Parar compartilhamento</button>
          </div>
          <div data-sharing-info hidden>
            <p data-capture-info></p>
            <p data-watchers></p>
            <details><summary>Preview local (sem som)</summary>
              <video autoplay playsinline muted aria-label="Preview local"></video>
              <p data-local-empty hidden></p>
              <button data-local-play hidden>Reproduzir preview</button>
            </details>
          </div>
        </section>

        <section aria-label="Transmissões da sala">
          <h2>Transmissões da sala</h2>
          <p>Escolha uma tela para assistir. Você pode transmitir e assistir ao mesmo tempo.</p>
          <ul data-members></ul>
          <div data-watching hidden>
            <p>Assistindo: <span data-watching-name></span></p>
            <button data-stop-watching>Parar de assistir</button>
          </div>
          <p data-connection>Conexão: aguardando</p>
          <video autoplay playsinline controls aria-label="Transmissão selecionada"></video>
          <p data-remote-empty>Selecione uma transmissão disponível para assistir.</p>
          <button data-remote-play hidden>Reproduzir vídeo e áudio</button>
        </section>
        <details data-debug><summary>Debug WebRTC</summary><div data-debug-content></div></details>
      </main>`;
    required<HTMLElement>(root, '[data-room]').textContent = roomId;
    this.copyButton = required(root, '[data-copy]');
    this.participants = required(root, '[data-participants]');
    this.identity = required(root, '[data-identity]');
    this.error = required(root, '[data-error]');
    this.reconnectButton = required(root, '[data-reconnect]');
    this.shareButton = required(root, '[data-share]');
    this.stopShareButton = required(root, '[data-stop-share]');
    this.sharingInfo = required(root, '[data-sharing-info]');
    this.captureInfo = required(root, '[data-capture-info]');
    this.watchersInfo = required(root, '[data-watchers]');
    this.membersList = required(root, '[data-members]');
    this.watching = required(root, '[data-watching]');
    this.watchingName = required(root, '[data-watching-name]');
    this.stopWatchingButton = required(root, '[data-stop-watching]');
    this.connection = required(root, '[data-connection]');
    this.localViewer = new Viewer(
      required(root, 'video[aria-label="Preview local"]'),
      required(root, '[data-local-empty]'),
      required(root, '[data-local-play]'),
      true,
    );
    this.remoteViewer = new Viewer(
      required(root, 'video[aria-label="Transmissão selecionada"]'),
      required(root, '[data-remote-empty]'),
      required(root, '[data-remote-play]'),
    );
    this.debug = new ConnectionDebug(
      required(root, '[data-debug]'),
      required(root, '[data-debug-content]'),
      () => this.session?.peers ?? null,
      () => this.socketState,
    );
    this.copyButton.addEventListener('click', () => void this.copyInvite());
    this.reconnectButton.addEventListener('click', () => this.startSession());
    this.shareButton.addEventListener('click', () => void this.share());
    this.stopShareButton.addEventListener('click', () => {
      if (this.session) this.stopSharing(this.session, true);
    });
    this.stopWatchingButton.addEventListener('click', () => this.watch(null));
    this.startSession();
  }

  private isCurrent(session: Session) {
    return this.session === session && !session.disposed;
  }

  private setError(message: string) {
    this.error.textContent = message;
    this.error.hidden = !message;
  }

  private connected() {
    return this.socketState === 'connected' && Boolean(this.selfId);
  }

  private renderControls() {
    const connected = this.connected();
    const sharing = Boolean(this.session?.stream);
    this.copyButton.disabled = !connected;
    this.shareButton.disabled = !connected || sharing || this.capturing;
    this.shareButton.textContent = this.capturing ? 'Selecionando tela…' : 'Compartilhar tela';
    this.stopShareButton.disabled = !sharing && !this.capturing;
    this.reconnectButton.hidden = this.socketState === 'connecting' || this.socketState === 'connected';
  }

  private renderMembers() {
    const members = this.session?.members ?? [];
    this.participants.textContent = `Participantes: ${members.length} / 5`;
    this.identity.textContent = this.selfId ? `Você: ${participantName(this.selfId)}` : '';
    this.identity.hidden = !this.selfId;
    this.membersList.replaceChildren();
    for (const member of members) {
      const item = document.createElement('li');
      item.append(`${participantName(member.peerId)}${member.peerId === this.selfId ? ' (você)' : ''} — ${member.sharing ? 'Transmitindo' : 'Sem transmissão'} `);
      if (member.sharing && member.peerId !== this.selfId) {
        const button = document.createElement('button');
        button.disabled = !this.connected();
        button.ariaPressed = String(this.selectedId === member.peerId);
        button.textContent = `${this.selectedId === member.peerId ? 'Reconectar a' : 'Assistir a'} ${participantName(member.peerId)}`;
        button.addEventListener('click', () => this.watch(member.peerId));
        item.append(button);
      }
      this.membersList.append(item);
    }
    this.watching.hidden = !this.selectedId;
    this.watchingName.textContent = this.selectedId ? participantName(this.selectedId) : '';
  }

  private renderPeerState(peers: Peers) {
    const entries = [...peers.peers.values()];
    const state = entries.find(entry => entry.direction === 'receive')?.pc.connectionState ?? 'aguardando';
    this.connection.textContent = `Conexão: ${state}${state === 'failed' ? ' — tente reconectar à transmissão; esta rede pode exigir TURN.' : ''}`;
    this.watchersInfo.textContent = `Assistindo à sua tela: ${entries.filter(entry => entry.direction === 'send').length}`;
    this.debug.refresh();
  }

  private stopSharing(session: Session, notify: boolean) {
    session.capture++;
    session.stream?.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    session.stream = null;
    session.peers.closeDirection('send');
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.settingsTimer = undefined;
    if (this.session === session) {
      this.localViewer.setStream(null);
      this.sharingInfo.hidden = true;
      this.capturing = false;
      this.renderControls();
    }
    if (notify && session.joined) {
      try { session.channel?.send({ type: 'sharing-stopped' }); }
      catch { /* A desconexão do signaling também encerra a publicação. */ }
    }
  }

  private disposeSession(session: Session) {
    if (session.disposed) return;
    session.disposed = true;
    this.stopSharing(session, false);
    session.peers.closeAllPeers();
    session.channel?.close();
    session.channel = null;
  }

  private startSession() {
    if (this.session) this.disposeSession(this.session);
    this.socketState = 'connecting';
    this.selfId = '';
    this.selectedId = null;
    this.capturing = false;
    this.remoteViewer.setStream(null);
    this.localViewer.setStream(null);
    this.setError('');
    this.copyButton.textContent = 'Copiar convite';
    let queue = Promise.resolve();
    const holder: { session?: Session } = {};
    const reportError = (error: unknown) => {
      if (holder.session && this.isCurrent(holder.session)) this.setError(error instanceof Error ? error.message : 'Falha na conexão WebRTC.');
    };
    const peers = new Peers(
      message => holder.session!.channel!.send(message),
      stream => { if (holder.session && this.isCurrent(holder.session)) this.remoteViewer.setStream(stream); },
      () => { if (holder.session && this.isCurrent(holder.session)) this.renderPeerState(peers); },
      reportError,
    );
    const session: Session = {
      peers,
      channel: null,
      members: [],
      stream: null,
      selection: null,
      watchRequest: '',
      disposed: false,
      capture: 0,
      joined: false,
    };
    holder.session = session;
    this.session = session;
    this.renderMembers();
    this.renderPeerState(peers);
    this.renderControls();
    try {
      session.channel = connectSignaling(
        this.roomId,
        message => { queue = queue.then(() => this.receive(session, message)).catch(reportError); },
        state => this.onSocketState(session, state),
      );
    } catch (error) {
      reportError(error);
      this.socketState = 'error';
      this.renderControls();
    }
  }

  private onSocketState(session: Session, state: string) {
    if (!this.isCurrent(session)) return;
    this.socketState = state;
    if (state === 'connected') {
      this.renderControls();
      this.debug.refresh();
      return;
    }
    session.joined = false;
    this.stopSharing(session, false);
    session.peers.closeAllPeers();
    session.selection = null;
    this.selectedId = null;
    session.members = [];
    session.disposed = true;
    session.channel?.close();
    this.setError('Signaling desconectado. Verifique o servidor e a conexão HTTPS/WSS.');
    this.renderMembers();
    this.renderControls();
    this.debug.refresh();
  }

  private updateMembers(session: Session, next: Participant[]) {
    for (const member of session.members) {
      if (!next.some(peer => peer.peerId === member.peerId)) session.peers.removePeer(member.peerId);
    }
    session.members = next;
    this.renderMembers();
  }

  private async receive(session: Session, message: ServerMessage) {
    if (!this.isCurrent(session) || !session.channel) return;
    switch (message.type) {
      case 'joined':
        session.joined = true;
        this.selfId = message.peerId;
        this.updateMembers(session, message.peers);
        this.renderControls();
        break;
      case 'room-state':
        this.updateMembers(session, message.peers);
        break;
      case 'watching':
        if (message.sessionId === session.watchRequest && !message.peerId) {
          session.peers.closeDirection('receive');
          session.selection = null;
          this.selectedId = null;
          this.renderMembers();
        }
        break;
      case 'subscriber-joined':
        if (session.stream) void session.peers.offer(message.peerId, message.sessionId, session.stream);
        break;
      case 'subscription-ended':
        session.peers.removeSession(message.sessionId);
        if (session.selection?.sessionId === message.sessionId) {
          session.selection = null;
          this.selectedId = null;
          this.renderMembers();
        }
        break;
      case 'error':
        this.setError(message.message);
        break;
      default:
        if (session.joined) await session.peers.receive(message);
    }
  }

  private watch(peerId: string | null) {
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    const sessionId = crypto.randomUUID();
    session.watchRequest = sessionId;
    session.selection = peerId ? { peerId, sessionId } : null;
    this.selectedId = peerId;
    this.setError('');
    this.renderMembers();
    try {
      session.peers.select(peerId, sessionId);
      session.channel!.send({ type: 'watch', targetPeerId: peerId, sessionId });
    } catch (error) {
      session.peers.closeDirection('receive');
      session.selection = null;
      this.selectedId = null;
      this.renderMembers();
      this.setError(error instanceof Error ? error.message : 'Não foi possível assistir.');
    }
  }

  private async share() {
    const session = this.session;
    if (!session?.joined || session.disposed || session.stream || this.capturing) return;
    this.setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      this.setError('Captura de tela exige HTTPS (ou localhost) e um navegador compatível.');
      return;
    }
    const capture = ++session.capture;
    this.capturing = true;
    this.renderControls();
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 60 } },
        audio: true,
      });
      if (!this.isCurrent(session) || !session.joined || session.capture !== capture) {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      const screenTrack = captured.getVideoTracks()[0];
      if (!screenTrack) throw new Error('A captura não retornou uma track de vídeo.');
      session.stream = captured;
      screenTrack.onended = () => this.stopSharing(session, true);
      this.localViewer.setStream(captured);
      this.sharingInfo.hidden = false;
      const updateSettings = () => {
        const settings = screenTrack.getSettings();
        this.captureInfo.textContent = `Captura real: ${settings.width ?? '?'} × ${settings.height ?? '?'} · ${settings.frameRate ?? 'indisponível'} FPS · ${captured.getAudioTracks().length ? 'Áudio incluído' : 'Sem áudio disponível nesta captura'}`;
      };
      updateSettings();
      this.settingsTimer = setInterval(updateSettings, 2000);
      session.channel!.send({ type: 'sharing-started' });
    } catch (error) {
      if (this.isCurrent(session) && session.capture === capture) {
        this.stopSharing(session, false);
        this.setError(error instanceof Error ? `Não foi possível capturar: ${error.message}` : 'Captura cancelada.');
      }
    } finally {
      if (this.isCurrent(session) && session.capture === capture) {
        this.capturing = false;
        this.renderControls();
      }
    }
  }

  private async copyInvite() {
    try {
      await navigator.clipboard.writeText(location.href);
      this.copyButton.textContent = 'Link copiado';
    } catch {
      this.setError('Não foi possível copiar. Copie a URL da barra do navegador.');
    }
  }

  dispose() {
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    if (this.session) this.disposeSession(this.session);
    this.localViewer.dispose();
    this.remoteViewer.dispose();
    this.debug.dispose();
    this.root.replaceChildren();
  }
}
