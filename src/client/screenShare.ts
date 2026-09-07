import { connectSignaling } from '../lib/signaling/client';
import { ALIAS_MAX_LENGTH, type Participant, type ServerMessage } from '../lib/signaling/messages';
import { Peers } from '../lib/webrtc/peers';
import { ConnectionDebug } from './connectionDebug';
import { playSound, unlockSounds } from './sounds';
import { applyTheme, loadTheme, type Theme } from './theme';
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
  membersSeeded: boolean;
};

const ACCENTS = [
  { color: '#3aa0b4', label: 'Teal' },
  { color: '#7b8ce8', label: 'Índigo' },
  { color: '#c08a5a', label: 'Âmbar' },
  { color: '#8fb98a', label: 'Verde' },
];

const AVATAR_COLORS = ['#8fb98a', '#b98a9a', '#c8b48a', '#7b8ce8', '#c08a5a'];

const CAMERA_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="4" width="19" height="13" rx="2"></rect><line x1="8" y1="20.5" x2="16" y2="20.5"></line><line x1="12" y1="17" x2="12" y2="20.5"></line></svg>';
const CAMERA_ICON_SMALL =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="4" width="19" height="13" rx="2"></rect><line x1="8" y1="20.5" x2="16" y2="20.5"></line></svg>';
const CAMERA_ICON_TOPBAR =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="icon"><rect x="2.5" y="4" width="19" height="13" rx="2"></rect><line x1="8" y1="20.5" x2="16" y2="20.5"></line></svg>';
const PLUS_ICON_SMALL =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
const ARROW_LEFT_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
const PLAY_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"></polygon></svg>';
const GEAR_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
const LEAVE_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path><polyline points="9 8 4.5 12 9 16"></polyline><line x1="4.5" y1="12" x2="14.5" y2="12"></line></svg>';
const STOP_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
const EMPTY_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="4" width="19" height="13" rx="2"></rect><line x1="8" y1="20.5" x2="16" y2="20.5"></line><line x1="12" y1="17" x2="12" y2="20.5"></line></svg>';
const ENDED_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="4" width="19" height="13" rx="2"></rect><line x1="8" y1="20.5" x2="16" y2="20.5"></line><line x1="4" y1="3" x2="20" y2="18"></line></svg>';
const CHECK_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const GRID_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>';
const CLOSE_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>';

const participantName = (id: string) => `Participante ${id.slice(0, 8)}`;
const displayName = (participant: Participant) => participant.alias || participantName(participant.peerId);
const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, char => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;'));
const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
};
const avatarColor = (name: string) => {
  let sum = 0;
  for (let index = 0; index < name.length; index++) sum += name.charCodeAt(index);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
};

const ALIAS_STORAGE_KEY = 'screen-share:alias';
function storedAlias() {
  try {
    return (localStorage.getItem(ALIAS_STORAGE_KEY) ?? '').trim().slice(0, ALIAS_MAX_LENGTH);
  } catch {
    return '';
  }
}

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
  private alias = storedAlias();
  private capturing = false;
  // Stable across reconnects: lets peers re-pair after a redeploy drops every socket at once.
  private readonly clientId = crypto.randomUUID?.() ?? '';
  private localStream: MediaStream | null = null;
  private watchId: string | null = null;
  private watchName: string | null = null;
  private resumeWatch = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private disposed = false;
  private settingsTimer?: ReturnType<typeof setInterval>;
  private settingsOpen = false;
  private endedReason: 'me' | 'remote' | null = null;
  private knownWatcherIds = new Set<string>();
  private theme: Theme = loadTheme();
  private accent = ACCENTS[0]!.color;
  private readonly localViewer: Viewer;
  private readonly remoteViewer: Viewer;
  private readonly debug: ConnectionDebug;

  private readonly copyButton: HTMLButtonElement;
  private readonly listToggleButton: HTMLButtonElement;
  private readonly leaveStreamButton: HTMLButtonElement;
  private readonly participants: HTMLElement;
  private readonly identity: HTMLElement;
  private readonly identityId: HTMLElement;
  private readonly identityName: HTMLElement;
  private readonly nameGate: HTMLElement;
  private readonly aliasForm: HTMLFormElement;
  private readonly aliasInput: HTMLInputElement;
  private readonly renameForm: HTMLFormElement;
  private readonly renameInput: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly reconnectButton: HTMLButtonElement;
  private readonly shareButton: HTMLButtonElement;
  private readonly stopShareButton: HTMLButtonElement;
  private readonly footerShareButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsPanel: HTMLElement;
  private readonly swatches: HTMLElement;
  private readonly themeDarkButton: HTMLButtonElement;
  private readonly themeLightButton: HTMLButtonElement;
  private readonly sharingInfo: HTMLElement;
  private readonly captureInfo: HTMLElement;
  private readonly watchersRow: HTMLElement;
  private readonly membersList: HTMLUListElement;
  private readonly headerTitle: HTMLElement;
  private readonly headerSub: HTMLElement;
  private readonly emptyState: HTMLElement;
  private readonly emptyPlaceholder: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly pickerGrid: HTMLElement;
  private readonly endedState: HTMLElement;
  private readonly endedTitle: HTMLElement;
  private readonly endedBody: HTMLElement;
  private readonly endedPrimary: HTMLButtonElement;
  private readonly endedSecondary: HTMLButtonElement;
  private readonly connection: HTMLElement;
  private readonly joinErrorModal: HTMLElement;
  private readonly joinErrorTitle: HTMLElement;
  private readonly joinErrorBody: HTMLElement;
  private readonly joinErrorRetry: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly roomId: string,
  ) {
    root.innerHTML = `
      <div class="shell">
        <div class="rail">
          <div class="logo">${CAMERA_ICON}</div>
          <div class="rail-sep"></div>
          <a class="rail-btn rail-btn-danger" href="/" title="Sair da sala">${ARROW_LEFT_ICON}</a>
        </div>

        <aside class="sidebar">
          <div class="sidebar-header">
            <div class="title-row">
              <span>Sala de transmissão</span>
            </div>
            <span class="room-id mono" data-room></span>
          </div>

          <div class="sidebar-section">
            <div class="section-title">
              <span>Participantes</span>
              <span class="count mono" data-participants>0 / 5</span>
            </div>
            <ul class="members" data-members></ul>
          </div>

          <details class="debug-toggle" data-debug>
            <summary>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
              Debug WebRTC
            </summary>
            <div class="debug-content" data-debug-content></div>
          </details>

          <div class="settings-panel" data-settings hidden>
            <span class="label">Seu nome na sala</span>
            <form class="alias-row" data-rename>
              <input
                id="alias-rename"
                name="alias-rename"
                aria-label="Alterar seu nome na sala"
                maxlength="${ALIAS_MAX_LENGTH}"
                autocomplete="nickname"
              />
              <button type="submit" class="theme-btn" data-rename-save>Salvar</button>
            </form>
            <span class="label">Cor de destaque</span>
            <div class="swatches" data-swatches></div>
            <span class="label">Tema</span>
            <div class="theme-row">
              <button type="button" class="theme-btn" data-theme-dark>Escuro</button>
              <button type="button" class="theme-btn" data-theme-light>Claro</button>
            </div>
          </div>

          <div class="sidebar-footer">
            <div class="avatar" data-identity-avatar></div>
            <div class="info">
              <span class="name" data-identity-name>Você</span>
              <span class="id mono" data-identity-id></span>
            </div>
            <div class="actions">
              <button type="button" class="btn-icon" data-footer-share title="Compartilhar tela">${CAMERA_ICON_SMALL}</button>
              <button type="button" class="btn-icon" data-settings-toggle title="Configurações">${GEAR_ICON}</button>
              <a class="btn-icon" href="/" title="Início / sair da sala">${LEAVE_ICON}</a>
            </div>
          </div>
        </aside>

        <div class="main">
          <div class="topbar">
            ${CAMERA_ICON_TOPBAR}
            <span class="title" data-header-title>Minha transmissão</span>
            <div class="divider"></div>
            <span class="sub" data-header-sub>nenhuma tela ativa</span>
            <div class="actions">
              <button type="button" class="btn btn-outline" data-list-toggle hidden>${GRID_ICON} Ver lista</button>
              <button type="button" class="btn btn-primary" data-copy>${PLUS_ICON_SMALL} Copiar convite</button>
            </div>
          </div>

          <div class="stage">
            <p role="alert" class="error" data-error hidden></p>
            <button type="button" class="btn btn-outline" data-reconnect hidden>Reconectar à sala</button>
            <p class="info-line" data-identity hidden></p>

            <div class="video-card">
              <div class="video-empty" data-empty-state>
                <div class="empty-placeholder" data-empty-placeholder>
                  <div class="icon">${EMPTY_ICON}</div>
                  <div>
                    <h2>Nenhuma transmissão no momento</h2>
                    <p>Assim que alguém compartilhar a tela, ela aparece aqui para você escolher.</p>
                  </div>
                </div>
                <div class="screen-picker" data-picker hidden>
                  <div class="screen-picker-grid" data-picker-grid></div>
                </div>
              </div>
              <div class="video-empty" data-ended-state hidden>
                <div class="icon">${ENDED_ICON}</div>
                <div>
                  <h2 data-ended-title></h2>
                  <p data-ended-body></p>
                </div>
                <div class="modal-actions" style="margin-top:2px;">
                  <button type="button" class="btn btn-primary" data-ended-primary></button>
                  <button type="button" class="btn btn-outline" data-ended-secondary></button>
                </div>
              </div>
              <video autoplay playsinline controls aria-label="Transmissão selecionada" data-remote-video></video>
              <button type="button" class="btn-icon leave-stream-btn" data-leave-stream hidden title="Sair da transmissão">${CLOSE_ICON}</button>
            </div>

            <div class="action-bar">
              <button type="button" class="btn btn-primary" data-share disabled>${CAMERA_ICON_SMALL} Compartilhar tela</button>
              <button type="button" class="btn btn-outline" data-stop-share disabled>${STOP_ICON} Parar compartilhamento</button>
              <span class="conn-label" data-connection>Conexão: aguardando</span>
            </div>

            <details class="local-preview" data-sharing-info hidden>
              <summary>Preview local (sem som)</summary>
              <video autoplay playsinline muted aria-label="Preview local"></video>
              <p class="info-line" data-capture-info></p>
              <div class="watchers-row" data-watchers></div>
              <p class="info-line" data-local-empty hidden></p>
              <button type="button" class="btn btn-outline" data-local-play hidden>Reproduzir preview</button>
            </details>
            <p class="info-line" data-remote-empty hidden></p>
            <button type="button" class="btn btn-outline" data-remote-play hidden>Reproduzir vídeo e áudio</button>
          </div>
        </div>
      </div>
      <div class="name-gate" data-name-gate>
        <form class="name-gate-card" data-alias>
          <div class="name-gate-icon">${CAMERA_ICON}</div>
          <h2>Como você quer aparecer?</h2>
          <p>Escolha o nome que os outros participantes vão ver nesta sala.</p>
          <input
            id="alias"
            name="alias"
            aria-label="Seu nome na sala"
            maxlength="${ALIAS_MAX_LENGTH}"
            autocomplete="nickname"
            placeholder="Seu nome"
          />
          <button type="submit" class="btn btn-primary" data-alias-save>Entrar na sala</button>
        </form>

        <div class="modal-overlay" data-join-error-modal hidden>
          <div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="join-error-title">
            <div class="icon">${ENDED_ICON}</div>
            <h2 id="join-error-title" data-join-error-title></h2>
            <p data-join-error-body></p>
            <div class="modal-actions">
              <a class="btn btn-primary" href="/">Voltar ao início</a>
              <button type="button" class="btn btn-outline" data-join-error-retry>Tentar novamente</button>
            </div>
          </div>
        </div>
      </div>`;
    required<HTMLElement>(root, '[data-room]').textContent = roomId;
    this.copyButton = required(root, '[data-copy]');
    this.listToggleButton = required(root, '[data-list-toggle]');
    this.leaveStreamButton = required(root, '[data-leave-stream]');
    this.participants = required(root, '[data-participants]');
    this.identity = required(root, '[data-identity]');
    this.identityId = required(root, '[data-identity-id]');
    this.identityName = required(root, '[data-identity-name]');
    this.nameGate = required(root, '[data-name-gate]');
    this.aliasForm = required(root, '[data-alias]');
    this.aliasInput = required(root, '#alias');
    this.renameForm = required(root, '[data-rename]');
    this.renameInput = required(root, '#alias-rename');
    this.aliasInput.value = this.alias;
    this.renameInput.value = this.alias;
    this.nameGate.hidden = this.alias.length > 0;
    this.error = required(root, '[data-error]');
    this.reconnectButton = required(root, '[data-reconnect]');
    this.shareButton = required(root, '[data-share]');
    this.stopShareButton = required(root, '[data-stop-share]');
    this.footerShareButton = required(root, '[data-footer-share]');
    this.settingsButton = required(root, '[data-settings-toggle]');
    this.settingsPanel = required(root, '[data-settings]');
    this.swatches = required(root, '[data-swatches]');
    this.themeDarkButton = required(root, '[data-theme-dark]');
    this.themeLightButton = required(root, '[data-theme-light]');
    this.sharingInfo = required(root, '[data-sharing-info]');
    this.captureInfo = required(root, '[data-capture-info]');
    this.watchersRow = required(root, '[data-watchers]');
    this.membersList = required(root, '[data-members]');
    this.headerTitle = required(root, '[data-header-title]');
    this.headerSub = required(root, '[data-header-sub]');
    this.emptyState = required(root, '[data-empty-state]');
    this.emptyPlaceholder = required(root, '[data-empty-placeholder]');
    this.picker = required(root, '[data-picker]');
    this.pickerGrid = required(root, '[data-picker-grid]');
    this.endedState = required(root, '[data-ended-state]');
    this.endedTitle = required(root, '[data-ended-title]');
    this.endedBody = required(root, '[data-ended-body]');
    this.endedPrimary = required(root, '[data-ended-primary]');
    this.endedSecondary = required(root, '[data-ended-secondary]');
    this.connection = required(root, '[data-connection]');
    this.joinErrorModal = required(root, '[data-join-error-modal]');
    this.joinErrorTitle = required(root, '[data-join-error-title]');
    this.joinErrorBody = required(root, '[data-join-error-body]');
    this.joinErrorRetry = required(root, '[data-join-error-retry]');
    this.localViewer = new Viewer(
      required(root, 'video[aria-label="Preview local"]'),
      required(root, '[data-local-empty]'),
      required(root, '[data-local-play]'),
      true,
    );
    this.remoteViewer = new Viewer(
      required(root, '[data-remote-video]'),
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
    this.reconnectButton.addEventListener('click', () => {
      this.reconnectAttempts = 0;
      this.startSession();
    });
    this.listToggleButton.addEventListener('click', () => this.watch(null));
    this.leaveStreamButton.addEventListener('click', () => this.watch(null));
    this.shareButton.addEventListener('click', () => void this.share());
    this.footerShareButton.addEventListener('click', () => void this.toggleShare());
    this.stopShareButton.addEventListener('click', () => {
      if (this.session) this.stopSharing(this.session, true);
    });
    this.endedPrimary.addEventListener('click', () => {
      if (this.endedReason === 'remote') this.showEnded(null);
      else void this.share();
    });
    this.endedSecondary.addEventListener('click', () => {
      if (this.endedReason === 'remote') void this.share();
      else this.showEnded(null);
    });
    this.settingsButton.addEventListener('click', () => {
      this.settingsOpen = !this.settingsOpen;
      this.renderSettings();
    });
    this.aliasForm.addEventListener('submit', event => {
      event.preventDefault();
      this.setAlias(this.aliasInput.value);
      this.nameGate.hidden = true;
    });
    this.renameForm.addEventListener('submit', event => {
      event.preventDefault();
      this.setAlias(this.renameInput.value);
    });
    this.themeDarkButton.addEventListener('click', () => this.setTheme('dark'));
    this.themeLightButton.addEventListener('click', () => this.setTheme('light'));
    this.joinErrorRetry.addEventListener('click', () => this.startSession());
    // A backgrounded tab (common while you present your screen) has its reconnect
    // timers throttled or frozen, so also retry the moment the tab is looked at again
    // or the network returns.
    document.addEventListener('visibilitychange', this.wakeReconnect);
    window.addEventListener('online', this.wakeReconnect);
    window.addEventListener('pageshow', this.wakeReconnect);
    this.renderSwatches();
    this.renderSettings();
    if (!this.nameGate.hidden) this.aliasInput.focus();
    this.aliasInput.focus();
    unlockSounds();
    this.startSession();
  }

  private isCurrent(session: Session) {
    return this.session === session && !session.disposed;
  }

  private setError(message: string) {
    this.error.textContent = message;
    this.error.hidden = !message;
  }

  private showJoinError(message: string) {
    const isFull = /cheia/i.test(message);
    this.joinErrorTitle.textContent = isFull ? 'Sala cheia' : 'Não foi possível entrar';
    this.joinErrorBody.textContent = isFull ? `${message} Aguarde alguém sair ou peça um novo convite.` : message;
    this.joinErrorModal.hidden = false;
  }

  private hideJoinError() {
    this.joinErrorModal.hidden = true;
  }

  private connected() {
    return this.socketState === 'connected' && Boolean(this.selfId);
  }

  private setTheme(theme: Theme) {
    this.theme = theme;
    applyTheme(theme);
    this.renderSettings();
  }

  private nameOf(peerId: string | null) {
    if (!peerId) return '';
    const member = this.session?.members.find(entry => entry.peerId === peerId);
    return member ? displayName(member) : participantName(peerId);
  }

  private setAlias(value: string) {
    const alias = value.trim().slice(0, ALIAS_MAX_LENGTH);
    this.alias = alias;
    this.aliasInput.value = alias;
    this.renameInput.value = alias;
    try {
      localStorage.setItem(ALIAS_STORAGE_KEY, alias);
    } catch {
      /* Sem persistência: o nome vale só para esta aba. */
    }
    this.renderMembers();
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    try {
      session.channel?.send({ type: 'set-alias', alias });
    } catch {
      /* A reconexão reenviará o nome salvo. */
    }
  }

  private setAccent(color: string) {
    this.accent = color;
    this.root.querySelector<HTMLElement>('.shell')!.style.setProperty('--accent', color);
    this.renderSwatches();
  }

  private renderSwatches() {
    this.swatches.replaceChildren();
    for (const { color, label } of ACCENTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `swatch${color.toLowerCase() === this.accent.toLowerCase() ? ' is-active' : ''}`;
      button.title = label;
      button.style.background = color;
      button.style.setProperty('--swatch-color', color);
      button.addEventListener('click', () => this.setAccent(color));
      this.swatches.append(button);
    }
  }

  private renderSettings() {
    this.settingsPanel.hidden = !this.settingsOpen;
    this.settingsButton.classList.toggle('is-active', this.settingsOpen);
    this.themeDarkButton.classList.toggle('is-active', this.theme === 'dark');
    this.themeLightButton.classList.toggle('is-active', this.theme === 'light');
  }

  private async toggleShare() {
    if (this.session?.stream) this.stopSharing(this.session, true);
    else await this.share();
  }

  private renderControls() {
    const connected = this.connected();
    const sharing = Boolean(this.session?.stream);
    this.copyButton.disabled = !connected;
    this.shareButton.disabled = !connected || sharing || this.capturing;
    this.shareButton.innerHTML = `${CAMERA_ICON_SMALL} ${this.capturing ? 'Selecionando tela…' : 'Compartilhar tela'}`;
    this.stopShareButton.disabled = !sharing && !this.capturing;
    this.footerShareButton.classList.toggle('is-active', sharing);
    this.reconnectButton.hidden = this.socketState === 'connecting' || this.socketState === 'connected';
    this.headerTitle.textContent = this.selectedId ? this.nameOf(this.selectedId) : 'Minha transmissão';
    this.headerSub.textContent = this.selectedId
      ? 'assistindo'
      : sharing
        ? 'transmitindo sua tela'
        : 'nenhuma tela ativa';
    this.emptyState.hidden = Boolean(this.selectedId);
    this.listToggleButton.hidden = !this.selectedId;
    this.leaveStreamButton.hidden = !this.selectedId;
  }

  private renderMembers() {
    const members = this.session?.members ?? [];
    this.participants.textContent = `${members.length} / 5`;
    this.identity.textContent = this.selfId ? `Você: ${this.nameOf(this.selfId)}` : '';
    this.identity.hidden = !this.selfId;
    this.identityId.textContent = this.selfId ? this.selfId.slice(0, 8) : '';
    this.identityName.textContent = this.selfId ? this.nameOf(this.selfId) : 'Você';
    const fallbackName = this.selfId ? participantName(this.selfId) : 'Participante';
    this.aliasInput.placeholder = fallbackName;
    this.renameInput.placeholder = fallbackName;
    const avatar = required<HTMLElement>(this.root, '[data-identity-avatar]');
    avatar.textContent = this.selfId ? initialsOf(this.nameOf(this.selfId)) : '';
    avatar.style.background = this.selfId ? avatarColor(this.nameOf(this.selfId)) : '';
    this.membersList.replaceChildren();
    for (const member of members) {
      const isSelf = member.peerId === this.selfId;
      const isSelected = this.selectedId === member.peerId;
      const canWatch = member.sharing && !isSelf;
      const item = document.createElement('li');
      item.className = `member${canWatch ? ' is-live' : ''}${isSelected ? ' is-selected' : ''}`;
      const memberName = displayName(member);
      item.innerHTML = `
        <div class="avatar" style="background:${avatarColor(memberName)}">${initialsOf(memberName)}
          <div class="dot${member.sharing ? ' is-live' : ''}"></div>
        </div>
        <div class="info">
          <span class="name">${escapeHtml(memberName)}</span>
          <span class="status">${member.sharing ? 'Transmitindo' : 'Sem transmissão'}</span>
        </div>`;
      if (canWatch) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'watch-btn';
        button.disabled = !this.connected();
        button.ariaPressed = String(isSelected);
        button.title = `${isSelected ? 'Reconectar a' : 'Assistir a'} ${displayName(member)}`;
        button.innerHTML = PLAY_ICON;
        button.addEventListener('click', () => this.watch(member.peerId));
        item.append(button);
      }
      this.membersList.append(item);
    }
    this.renderPicker(members);
  }

  private renderPicker(members: Participant[]) {
    const live = members.filter(member => member.sharing && member.peerId !== this.selfId);
    this.emptyPlaceholder.hidden = live.length > 0;
    this.picker.hidden = live.length === 0;
    this.emptyState.classList.toggle('is-grid', live.length > 0);
    const columns = Math.ceil(Math.sqrt(live.length)) || 1;
    const rows = Math.ceil(live.length / columns) || 1;
    this.pickerGrid.style.setProperty('--picker-columns', String(columns));
    this.pickerGrid.style.setProperty('--picker-rows', String(rows));
    this.pickerGrid.replaceChildren();
    for (const member of live) {
      const isSelected = this.selectedId === member.peerId;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `screen-tile${isSelected ? ' is-selected' : ''}`;
      tile.disabled = !this.connected();
      tile.innerHTML = `
        <div class="screen-tile-thumb" style="background:${avatarColor(displayName(member))}22">
          <div class="screen-tile-overlay">
            ${
              isSelected
                ? `<span class="screen-tile-cta is-current">${CHECK_ICON} Assistindo</span>`
                : `<span class="screen-tile-cta">${PLAY_ICON} Assistir transmissão</span>`
            }
          </div>
        </div>
        <div class="screen-tile-tag">
          ${CAMERA_ICON_SMALL}
          <span>${escapeHtml(displayName(member))}</span>
        </div>`;
      tile.addEventListener('click', () => this.watch(isSelected ? null : member.peerId));
      this.pickerGrid.append(tile);
    }
  }

  private renderPeerState(peers: Peers) {
    const entries = [...peers.peers.values()];
    const state = entries.find(entry => entry.direction === 'receive')?.pc.connectionState ?? 'aguardando';
    this.connection.textContent = `Conexão: ${state}${state === 'failed' ? ' — tente reconectar à transmissão; esta rede pode exigir TURN.' : ''}`;
    const watcherIds = new Set(entries.filter(entry => entry.direction === 'send').map(entry => entry.peerId));
    for (const peerId of watcherIds) if (!this.knownWatcherIds.has(peerId)) playSound('viewer-join');
    for (const peerId of this.knownWatcherIds) if (!watcherIds.has(peerId)) playSound('viewer-leave');
    this.knownWatcherIds = watcherIds;
    this.renderWatchers([...watcherIds]);
    this.debug.refresh();
  }

  // Discord-style facepile of who's currently watching my stream.
  private renderWatchers(watcherIds: string[]) {
    this.watchersRow.replaceChildren();
    const label = document.createElement('span');
    label.className = 'watchers-label';
    label.textContent =
      watcherIds.length === 0 ? 'Ninguém assistindo ainda' : `Assistindo à sua tela (${watcherIds.length})`;
    const stack = document.createElement('div');
    stack.className = 'watchers-stack';
    for (const peerId of watcherIds) {
      const watcherName = this.nameOf(peerId);
      const avatar = document.createElement('div');
      avatar.className = 'watcher-avatar';
      avatar.title = watcherName;
      avatar.style.background = avatarColor(watcherName);
      avatar.textContent = initialsOf(watcherName);
      stack.append(avatar);
    }
    this.watchersRow.append(stack, label);
  }

  private showEnded(reason: 'me' | 'remote' | null, who?: string) {
    this.endedReason = reason;
    const watchingSomeone = Boolean(this.selectedId);
    this.endedState.hidden = !reason || watchingSomeone;
    this.emptyState.hidden = watchingSomeone || Boolean(reason);
    if (!reason) return;
    this.endedTitle.textContent = reason === 'remote' ? 'Transmissão encerrada' : 'Você encerrou o compartilhamento';
    this.endedBody.textContent =
      reason === 'remote'
        ? `${who ? this.nameOf(who) : 'Participante'} parou de compartilhar a tela. Escolha outra transmissão na lista de participantes.`
        : 'Sua tela não está mais sendo transmitida para a sala. Os outros participantes continuam conectados.';
    if (reason === 'remote') {
      this.endedPrimary.textContent = 'Voltar para a lista';
      this.endedSecondary.textContent = 'Compartilhar minha tela';
    } else {
      this.endedPrimary.textContent = 'Compartilhar novamente';
      this.endedSecondary.textContent = 'Voltar para a lista';
    }
  }

  // Tear down the outgoing publication for this session without touching the captured
  // stream, so a reconnect can re-publish the same screen without a new prompt.
  private detachPublishing(session: Session) {
    session.capture++;
    session.peers.closeDirection('send');
    session.stream = null;
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.settingsTimer = undefined;
  }

  private stopCapture() {
    this.localStream?.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    this.localStream = null;
    this.localViewer.setStream(null);
    this.sharingInfo.hidden = true;
  }

  private stopSharing(session: Session, notify: boolean) {
    const wasActive = Boolean(session.stream) || this.capturing;
    this.detachPublishing(session);
    this.stopCapture();
    if (this.session === session) {
      this.capturing = false;
      this.renderControls();
      if (notify && wasActive) this.showEnded('me');
    }
    if (notify && session.joined) {
      try {
        session.channel?.send({ type: 'sharing-stopped' });
      } catch {
        /* A desconexão do signaling também encerra a publicação. */
      }
    }
  }

  // Wire a freshly captured (or reconnected) stream into the session and announce it.
  private beginPublishing(session: Session, captured: MediaStream) {
    const screenTrack = captured.getVideoTracks()[0];
    if (!screenTrack) throw new Error('A captura não retornou uma track de vídeo.');
    // Favour a steady framerate and bitrate over sharpening a frozen frame.
    screenTrack.contentHint = 'motion';
    this.localStream = captured;
    session.stream = captured;
    screenTrack.onended = () => {
      if (this.session) this.stopSharing(this.session, true);
      else this.stopCapture();
    };
    this.localViewer.setStream(captured);
    this.sharingInfo.hidden = false;
    const updateSettings = () => {
      const settings = screenTrack.getSettings();
      this.captureInfo.textContent = `Captura real: ${settings.width ?? '?'} × ${settings.height ?? '?'} · ${settings.frameRate ?? 'indisponível'} FPS · ${captured.getAudioTracks().length ? 'Áudio incluído' : 'Sem áudio disponível nesta captura'}`;
    };
    updateSettings();
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    this.settingsTimer = setInterval(updateSettings, 2000);
    try {
      session.channel?.send({ type: 'sharing-started' });
    } catch {
      /* O reingresso reenviará sharing-started. */
    }
    this.renderControls();
  }

  private disposeSession(session: Session) {
    if (session.disposed) return;
    session.disposed = true;
    this.detachPublishing(session);
    session.peers.closeAllPeers();
    session.channel?.close();
    session.channel = null;
  }

  // Reconnect right now if the socket is down — triggered when a throttled background
  // tab becomes visible again, when the network comes back, or on bfcache restore.
  private readonly wakeReconnect = () => {
    if (this.disposed || navigator.onLine === false) return;
    if (this.socketState === 'connected' || this.socketState === 'connecting') return;
    if (document.visibilityState === 'hidden') return;
    this.reconnectAttempts = 0;
    this.startSession();
  };

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.startSession();
    }, delay);
  }

  private startSession() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.knownWatcherIds = new Set();
    if (this.session) this.disposeSession(this.session);
    this.socketState = 'connecting';
    this.selfId = '';
    this.selectedId = null;
    this.capturing = false;
    this.remoteViewer.setStream(null);
    if (!this.localStream) this.localViewer.setStream(null);
    this.setError(this.reconnectAttempts > 0 ? 'Reconectando à sala…' : '');
    this.showEnded(null);
    this.hideJoinError();
    this.copyButton.innerHTML = `${PLUS_ICON_SMALL} Copiar convite`;
    let queue = Promise.resolve();
    const holder: { session?: Session } = {};
    const reportError = (error: unknown) => {
      if (holder.session && this.isCurrent(holder.session))
        this.setError(error instanceof Error ? error.message : 'Falha na conexão WebRTC.');
    };
    const peers = new Peers(
      message => holder.session!.channel!.send(message),
      stream => {
        if (holder.session && this.isCurrent(holder.session)) this.remoteViewer.setStream(stream);
      },
      () => {
        if (holder.session && this.isCurrent(holder.session)) this.renderPeerState(peers);
      },
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
      membersSeeded: false,
    };
    holder.session = session;
    this.session = session;
    this.renderMembers();
    this.renderPeerState(peers);
    this.renderControls();
    try {
      session.channel = connectSignaling(
        this.roomId,
        this.clientId,
        message => {
          queue = queue.then(() => this.receive(session, message)).catch(reportError);
        },
        state => this.onSocketState(session, state),
      );
    } catch (error) {
      reportError(error);
      this.socketState = 'error';
      this.renderControls();
      if (!this.disposed) this.scheduleReconnect();
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
    if (this.watchId) this.resumeWatch = true;
    this.detachPublishing(session);
    session.peers.closeAllPeers();
    session.selection = null;
    this.selectedId = null;
    session.members = [];
    session.disposed = true;
    session.channel?.close();
    this.remoteViewer.setStream(null);
    this.renderMembers();
    this.renderControls();
    this.debug.refresh();
    if (this.disposed) return;
    this.setError(
      state === 'restarting' ? 'Nova versão publicada. Reconectando à sala…' : 'Conexão perdida. Reconectando à sala…',
    );
    this.scheduleReconnect();
  }

  private updateMembers(session: Session, next: Participant[]) {
    const previous = session.members;
    for (const member of previous) {
      if (!next.some(peer => peer.peerId === member.peerId)) session.peers.removePeer(member.peerId);
    }
    if (session.membersSeeded) {
      for (const member of next) {
        if (!previous.some(peer => peer.peerId === member.peerId)) {
          if (member.peerId !== this.selfId) playSound('connect');
        } else {
          const before = previous.find(peer => peer.peerId === member.peerId);
          if (before && !before.sharing && member.sharing) playSound('share-start');
          if (before && before.sharing && !member.sharing) playSound('share-stop');
        }
      }
      for (const member of previous) {
        if (member.peerId !== this.selfId && !next.some(peer => peer.peerId === member.peerId)) playSound('disconnect');
      }
    }
    session.membersSeeded = true;
    session.members = next;
    this.renderMembers();
  }

  private async receive(session: Session, message: ServerMessage) {
    if (!this.isCurrent(session) || !session.channel) return;
    switch (message.type) {
      case 'joined':
        session.joined = true;
        this.selfId = message.peerId;
        this.reconnectAttempts = 0;
        this.setError('');
        this.updateMembers(session, message.peers);
        this.renderControls();
        if (this.alias) {
          try {
            session.channel.send({ type: 'set-alias', alias: this.alias });
          } catch {
            /* A reconexão reenviará o nome salvo. */
          }
        }
        this.resumeAfterReconnect(session, message.peers);
        break;
      case 'room-state':
        this.updateMembers(session, message.peers);
        this.maybeResumeWatch(message.peers);
        break;
      case 'watching':
        if (message.sessionId !== session.watchRequest) break;
        if (message.peerId) {
          this.resumeWatch = false;
        } else {
          session.peers.closeDirection('receive');
          session.selection = null;
          this.selectedId = null;
          this.renderMembers();
          this.renderControls();
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
          this.watchId = null;
          this.watchName = null;
          this.resumeWatch = false;
          this.renderMembers();
          this.renderControls();
          this.showEnded('remote', message.peerId);
        }
        break;
      case 'error':
        if (!session.joined) this.showJoinError(message.message);
        else this.setError(message.message);
        break;
      case 'pong':
        break;
      default:
        if (session.joined) await session.peers.receive(message);
    }
  }

  // After a reconnect, keep publishing the same captured screen without a new prompt.
  private resumeAfterReconnect(session: Session, peers: Participant[]) {
    const track = this.localStream?.getVideoTracks()[0];
    if (this.localStream && track?.readyState === 'live' && !session.stream) {
      try {
        this.beginPublishing(session, this.localStream);
      } catch {
        this.stopCapture();
        this.renderControls();
      }
    } else if (this.localStream && track?.readyState !== 'live') {
      this.stopCapture();
      this.renderControls();
    }
    this.maybeResumeWatch(peers);
  }

  // Re-select the participant this client was watching before it reconnected, once
  // they are back and sharing. Runs on every room update so it survives the publisher
  // reconnecting after us; only armed by a disconnect, never by a live stream ending.
  private maybeResumeWatch(peers: Participant[]) {
    if (!this.resumeWatch || this.selectedId || (!this.watchId && !this.watchName)) return;
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    const available = peers.filter(peer => peer.sharing && peer.peerId !== this.selfId);
    const byName = this.watchName ? available.filter(peer => displayName(peer) === this.watchName) : [];
    const target =
      available.find(peer => peer.peerId === this.watchId) ?? (byName.length === 1 ? byName[0] : undefined);
    if (target) this.watch(target.peerId, true);
  }

  private watch(peerId: string | null, resuming = false) {
    const session = this.session;
    if (!session?.joined || session.disposed) return;
    if (!resuming) this.resumeWatch = false;
    this.watchId = peerId;
    this.watchName = peerId ? this.nameOf(peerId) : null;
    const sessionId = crypto.randomUUID();
    session.watchRequest = sessionId;
    session.selection = peerId ? { peerId, sessionId } : null;
    this.selectedId = peerId;
    this.setError('');
    this.showEnded(null);
    this.renderMembers();
    this.renderControls();
    try {
      session.peers.select(peerId, sessionId);
      session.channel!.send({ type: 'watch', targetPeerId: peerId, sessionId });
    } catch (error) {
      session.peers.closeDirection('receive');
      session.selection = null;
      this.selectedId = null;
      this.watchId = null;
      this.watchName = null;
      this.renderMembers();
      this.renderControls();
      this.setError(error instanceof Error ? error.message : 'Não foi possível assistir.');
    }
  }

  private async share() {
    const session = this.session;
    if (!session?.joined || session.disposed || session.stream || this.capturing) return;
    this.setError('');
    this.showEnded(null);
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
      this.beginPublishing(session, captured);
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
      this.copyButton.textContent = 'Convite copiado';
    } catch {
      this.setError('Não foi possível copiar. Copie a URL da barra do navegador.');
    }
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.wakeReconnect);
    window.removeEventListener('online', this.wakeReconnect);
    window.removeEventListener('pageshow', this.wakeReconnect);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.settingsTimer) clearInterval(this.settingsTimer);
    if (this.session) this.disposeSession(this.session);
    this.stopCapture();
    this.localViewer.dispose();
    this.remoteViewer.dispose();
    this.debug.dispose();
    this.root.replaceChildren();
  }
}
