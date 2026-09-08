import React, { useEffect, useState, type ReactNode } from 'react';
import { ALIAS_MAX_LENGTH } from '../../lib/signaling/messages';
import type { ScreenShareController, ScreenShareState } from '../screenShare';
import { CloseIcon, EndedIcon, ScreenIcon } from './icons';

export function NameGate({ state, controller }: { state: ScreenShareState; controller: ScreenShareController }) {
  const [open, setOpen] = useState(!state.alias);
  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('alias');
    controller.setAlias(typeof value === 'string' ? value : '');
    setOpen(false);
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
          placeholder={state.selfId ? controller.nameOf(state.selfId) : 'Seu nome'}
        />
        <button type="submit" className="btn btn-primary">
          Entrar na sala
        </button>
      </form>
    </div>
  );
}

export function JoinErrorModal({ message, onRetry }: { message: string; onRetry: () => void }) {
  if (!message) return null;
  const isFull = /cheia/i.test(message);
  return (
    <div className="modal-overlay">
      <div className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="join-error-title">
        <div className="icon">
          <EndedIcon />
        </div>
        <h2 id="join-error-title">{isFull ? 'Sala cheia' : 'Não foi possível entrar'}</h2>
        <p>{isFull ? `${message} Aguarde alguém sair ou peça um novo convite.` : message}</p>
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

export function DebugModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
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
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="debug-modal-title">
        <div className="modal-card-header">
          <h2 id="debug-modal-title">Debug WebRTC</h2>
          <button type="button" className="btn-icon" title="Fechar" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
