import React, { useEffect, useState, type ReactNode } from 'react';
import {
  ALIAS_MAX_LENGTH,
  ROOM_PASSWORD_MAX_LENGTH,
} from '../../lib/signaling/messages';
import type { HostSecrets, MediaProvider } from '../media/types';
import type { ScreenShareState } from '../screenShare';
import { CloseIcon, EndedIcon, EyeIcon, ScreenIcon } from './icons';

// Entregue uma única vez, na criação da sala ou na reivindicação do controle. Depois
// disso não há insistência: mesmo tratamento que o link de convite e a senha já
// recebem — mostrados uma vez, e daí em diante é responsabilidade de quem criou.
export function HostSecretsModal({
  secrets,
  onDismiss,
}: {
  secrets: HostSecrets | null;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!secrets) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secrets.recoveryCode);
      setCopied(true);
    } catch {
      // Sem área de transferência a pessoa ainda pode selecionar o código à mão.
    }
  };
  return (
    <div className="modal-overlay">
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recovery-code-title"
      >
        <div className="icon">
          <ScreenIcon />
        </div>
        <h2 id="recovery-code-title">Guarde seu código de recuperação</h2>
        <p>
          Este é o único jeito de reaver o controle da sala se você limpar os
          dados deste navegador ou trocar de dispositivo. Ele não será mostrado
          de novo.
        </p>
        <code className="recovery-code mono" data-recovery-code>
          {secrets.recoveryCode}
        </code>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void copy()}
          >
            {copied ? 'Código copiado' : 'Copiar código'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onDismiss}>
            Já guardei
          </button>
        </div>
      </div>
    </div>
  );
}

export function KickedModal({ by }: { by: ScreenShareState['kickedBy'] }) {
  if (!by) return null;
  return (
    <div className="modal-overlay">
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kicked-title"
        data-kicked
      >
        <div className="icon">
          <EndedIcon />
        </div>
        <h2 id="kicked-title">Você foi removido da sala</h2>
        <p>
          {by === 'host'
            ? 'O dono da sala removeu você. '
            : 'Um moderador removeu você. '}
          Peça um novo convite se acha que foi engano.
        </p>
        <div className="modal-actions">
          <a className="btn btn-primary" href="/">
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}

// Controlado pela sala: o diálogo do código de recuperação precisa saber, no mesmo
// commit, que este portão saiu da frente — senão os dois se sobrepõem por um quadro.
export function NameGate({
  open,
  state,
  controller,
  onSubmit,
}: {
  open: boolean;
  state: ScreenShareState;
  controller: MediaProvider;
  onSubmit: () => void;
}) {
  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('alias');
    controller.setAlias(typeof value === 'string' ? value : '');
    onSubmit();
  };
  return (
    <div className="name-gate" data-name-gate hidden={!open}>
      <form className="name-gate-card" onSubmit={submit}>
        <div className="name-gate-icon">
          <ScreenIcon />
        </div>
        <h2>Como você quer aparecer?</h2>
        <p>Escolha o nome que os outros participantes vão ver nesta sala.</p>
        <input
          autoFocus={open}
          name="alias"
          aria-label="Seu nome na sala"
          defaultValue={state.alias}
          maxLength={ALIAS_MAX_LENGTH}
          autoComplete="nickname"
          placeholder={
            state.selfId ? controller.nameOf(state.selfId) : 'Seu nome'
          }
        />
        <button type="submit" className="btn btn-primary">
          Entrar na sala
        </button>
      </form>
    </div>
  );
}

export function RoomPasswordGate({
  error = '',
  onSubmit,
}: {
  error?: ScreenShareState['accessError'];
  onSubmit: (password: string) => void;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('room-password');
    if (typeof password === 'string') onSubmit(password);
  };
  const terminal = error === 'invalid-invite' || error === 'too-many-attempts';
  const message =
    error === 'wrong-password'
      ? 'Senha incorreta. Tente novamente.'
      : error === 'password-required'
        ? 'Seu acesso salvo expirou ou não é mais válido. Digite a senha novamente.'
        : error === 'invalid-invite'
          ? 'Este convite está ausente, inválido ou foi alterado.'
          : error === 'too-many-attempts'
            ? 'Muitas tentativas incorretas. Abra o convite novamente para tentar mais tarde.'
            : '';
  return (
    <div className="name-gate" data-password-gate>
      <form className="name-gate-card" onSubmit={submit}>
        <div className="name-gate-icon">
          <ScreenIcon />
        </div>
        <h2>{terminal ? 'Não foi possível entrar' : 'Sala protegida'}</h2>
        <p>
          {terminal
            ? message
            : error === 'password-required'
              ? message
              : 'Digite a senha compartilhada pelo criador. Ela não será salva neste navegador.'}
        </p>
        {!terminal && (
          <div className="password-input">
            <input
              autoFocus
              name="room-password"
              type={passwordVisible ? 'text' : 'password'}
              aria-label="Senha da sala"
              maxLength={ROOM_PASSWORD_MAX_LENGTH}
              autoComplete="off"
              required
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
        )}
        {error === 'wrong-password' && <p className="error">{message}</p>}
        {terminal ? (
          <a className="btn btn-primary" href="/">
            Voltar ao início
          </a>
        ) : (
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">
              Entrar
            </button>
            <a className="btn btn-outline" href="/">
              Voltar ao início
            </a>
          </div>
        )}
      </form>
    </div>
  );
}

export function JoinErrorModal({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  if (!message) return null;
  const isFull = /cheia/i.test(message);
  return (
    <div className="modal-overlay">
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="join-error-title"
      >
        <div className="icon">
          <EndedIcon />
        </div>
        <h2 id="join-error-title">
          {isFull ? 'Sala cheia' : 'Não foi possível entrar'}
        </h2>
        <p>
          {isFull
            ? `${message} Aguarde alguém sair ou peça um novo convite.`
            : message}
        </p>
        <div className="modal-actions">
          <a className="btn btn-primary" href="/">
            Voltar ao início
          </a>
          <button type="button" className="btn btn-outline" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      </div>
    </div>
  );
}

export function DebugModal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="modal-overlay"
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="debug-modal-title"
      >
        <div className="modal-card-header">
          <h2 id="debug-modal-title">Debug WebRTC</h2>
          <button
            type="button"
            className="btn-icon"
            title="Fechar"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
