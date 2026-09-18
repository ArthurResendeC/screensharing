import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { findHostToken } from '../roomStorage';

// Painel de moderadores permanentes (só para o dono). Vai pelo HTTP e não pelo
// WebSocket de propósito: os moderadores listados aqui costumam estar offline, e
// revogar alguém não deveria exigir que a pessoa esteja conectada.
const moderatorsSchema = z.object({
  moderators: z.array(
    z.object({ id: z.string(), grantedAt: z.number() }).strict(),
  ),
});

type Grant = { id: string; grantedAt: number };

export function ModeratorsPanel({ roomId }: { roomId: string }) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const hostToken = findHostToken(roomId);
    if (!hostToken) {
      setError('Credencial de dono indisponível neste navegador.');
      return;
    }
    try {
      const response = await fetch(
        `/rooms/${encodeURIComponent(roomId)}/moderators`,
        { headers: { authorization: `Bearer ${hostToken}` } },
      );
      if (!response.ok) throw new Error(String(response.status));
      setGrants(moderatorsSchema.parse(await response.json()).moderators);
      setError('');
    } catch {
      setError('Não foi possível carregar os moderadores permanentes.');
    }
  }, [roomId]);

  useEffect(() => void load(), [load]);

  const revoke = async (id: string) => {
    const hostToken = findHostToken(roomId);
    if (!hostToken) return;
    try {
      const response = await fetch(
        `/rooms/${encodeURIComponent(roomId)}/moderators/${encodeURIComponent(id)}/revoke`,
        { method: 'POST', headers: { authorization: `Bearer ${hostToken}` } },
      );
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      setError('Não foi possível revogar este moderador.');
    }
  };

  return (
    <div className="moderators-panel">
      {error && <p className="error">{error}</p>}
      {grants && grants.length === 0 && !error && (
        <span className="settings-hint">
          Nenhum moderador permanente. Promova alguém pela lista de
          participantes.
        </span>
      )}
      {grants?.map((grant, index) => (
        <div className="moderator-row" key={grant.id}>
          <div className="info">
            {/* Só o handle opaco do grant é exposto: o memberId nunca sai do
                navegador de quem foi promovido. */}
            <span className="name">Moderador {index + 1}</span>
            <span className="status mono">
              desde {new Date(grant.grantedAt).toLocaleDateString('pt-BR')}
            </span>
          </div>
          <button
            type="button"
            className="theme-btn"
            onClick={() => void revoke(grant.id)}
          >
            Revogar
          </button>
        </div>
      ))}
    </div>
  );
}
