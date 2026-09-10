# Deploy e migração para o LiveKit

## Topologia

```
React ──► API Bun (Railway)  ──►  Servidor LiveKit (Fly.io)
          · autentica o convite       · transporte, ICE, SDP
          · assina o JWT do LiveKit    · TURN/TURN-TLS embutido (3478/5349)
          · GET /livekit/token         · simulcast + dynacast + adaptive stream
          · WebSocket só p/ create-room · reconexão automática
```

O provedor de mídia é escolhido em tempo de execução a partir de `/config.json`
(`MEDIA_PROVIDER`). Nenhum build novo do frontend é necessário para trocar.

## Build da API

O Railway continua usando **Railpack** (`bun run build` + `bun run start`), sem
mudança. O `deploy/Dockerfile` existe para outros hosts Docker / Fly / o
`docker-compose` local e **não** fica na raiz: um `Dockerfile` na raiz faria o
Railway trocar o Railpack por ele. Para construir a imagem manualmente:

```bash
docker build -f deploy/Dockerfile -t reshare-api .
docker run -p 3000:3000 -e ROOM_TOKEN_SECRET=... reshare-api
```

## Variáveis de ambiente (API Bun)

| Variável                                 | Obrigatória  | Descrição                                                               |
| ---------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| `MEDIA_PROVIDER`                         | não          | `webrtc` (padrão) ou `livekit` — a chave de rollout/rollback            |
| `LIVEKIT_URL`                            | se `livekit` | `wss://reshare-livekit.fly.dev` — devolvida em `/config.json`           |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | se `livekit` | assinam o JWT (só no servidor, nunca em `/config.json`)                 |
| `LIVEKIT_TOKEN_TTL`                      | não          | validade do JWT, padrão `10m`                                           |
| `MAX_ROOM_PARTICIPANTS`                  | não          | ausente = sem limite; só afeta o caminho legado de signaling WebRTC     |
| `ROOM_TOKEN_SECRET`                      | em produção  | inalterada — assina os convites, ≥ 32 caracteres, estável entre deploys |

Servidor LiveKit: `LIVEKIT_KEYS` (`"chave: segredo"`), config em `livekit/livekit.yaml`.
`REDIS_*` só ao escalar para múltiplos nós.

## Estratégia de migração

1. Publique o código com `MEDIA_PROVIDER` ausente/`webrtc` — produção não muda.
2. Suba o LiveKit no Fly (`livekit/fly-deploy.md`); defina `LIVEKIT_*` no Railway;
   mantenha `MEDIA_PROVIDER=webrtc`.
3. Numa preview do Railway, mude para `MEDIA_PROVIDER=livekit` e rode
   `bun run test:e2e:livekit`; teste manualmente em Chrome/Edge/Firefox e por uma VPN.
4. Mude produção para `livekit`.
5. **Rollback:** `MEDIA_PROVIDER=webrtc` + reiniciar. Sem deploy de código.
6. Depois de estabilizar, um PR posterior pode remover `src/lib/webrtc/**` e o relay
   WebRTC do `server/signaling.ts` (mantendo `create-room`). Não faz parte deste PR.

## Boas práticas de produção

- Mantenha `MEDIA_PROVIDER=webrtc` até `test:e2e:livekit` + testes manuais passarem.
- `LIVEKIT_API_SECRET` só no host da API; nunca em `/config.json` nem no bundle.
- JWT curto (`10m`): o cliente busca um token novo a cada (re)conexão.
- Fixe as versões: imagem `livekit/livekit-server`, `livekit-client`, `livekit-server-sdk`.
- LiveKit atrás de TLS (`wss`) com TURN/TLS em 5349 para redes que bloqueiam UDP.
- `rtc.use_external_ip: true` + regras de firewall para a faixa UDP e `7881/tcp`.
- `room.empty_timeout` libera salas abandonadas (não há banco para reconciliar).
- Acompanhe as métricas Prometheus do `livekit-server`; alerte na fração de tráfego
  via TURN (relay).
- CSP/`connect-src`: inclua a origem `wss://` do LiveKit.

## Local

```bash
docker compose up -d livekit
MEDIA_PROVIDER=livekit LIVEKIT_URL=ws://localhost:7880 \
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret bun run dev
# ou a pilha inteira:
docker compose up --build
```
