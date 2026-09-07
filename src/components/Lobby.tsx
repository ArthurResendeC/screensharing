'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { roomIdSchema } from '@/lib/signaling/messages';
export function Lobby() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  return <main><h1>WebRTC Screen Share</h1><p>Compartilhe sua tela com até quatro amigos. Todos podem transmitir e escolher uma tela para assistir.</p>
    <button onClick={() => { if (!crypto.randomUUID) { setError('Abra em HTTPS ou localhost para criar a sala.'); return; } router.push(`/room/${crypto.randomUUID()}`); }}>Criar sala</button>
    <form onSubmit={event => { event.preventDefault(); let id = input.trim(); try { id = new URL(id).pathname.split('/').filter(Boolean).at(-1) ?? ''; } catch { /* Plain room ID. */ } if (!roomIdSchema.safeParse(id).success) { setError('Informe um ID de sala válido ou o link de convite.'); return; } router.push(`/room/${id}`); }}>
      <label htmlFor="room">ID ou URL da sala</label><input id="room" value={input} onChange={event => setInput(event.target.value)} required />
      <button>Entrar</button>
    </form><p>O convite permite acesso à sala. Envie somente aos seus amigos.</p>{error && <p role="alert">{error}</p>}
  </main>;
}
