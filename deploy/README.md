# Deploy e migração para o Cloudflare Realtime

## Topologia

```
React ──► API Bun (Railway)  ──►  Cloudflare Realtime SFU (edge global)
          · autentica o convite       · transporte, ICE, NAT, TURN
          · proxy /realtime/* (esconde  · fan-out de tracks
            o App Secret; ticket HMAC)   · reconexão via re-criação de sessão
          · WebSocket /signaling
            (presença + rt-publish)
```

Cada navegador abre **uma** `RTCPeerConnection` contra a Cloudflare. O WebSocket só
carrega presença e "quem publicou o quê" (`sessionId` + nomes das tracks). Não há
servidor de mídia para hospedar.

## Pré-requisito: app Cloudflare Realtime

Em [dash.cloudflare.com → Realtime → SFU](https://dash.cloudflare.com/?to=/:account/realtime/sfu),
crie um app. Você recebe **App ID** e **App Secret**. Conta gratuita basta.

## Variáveis de ambiente (API Bun no Railway)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `MEDIA_PROVIDER` | não | `webrtc` (padrão) ou `cloudflare` — a chave de rollout/rollback |
| `CLOUDFLARE_REALTIME_APP_ID` | se `cloudflare` | da dashboard; vai no path das chamadas ao SFU |
| `CLOUDFLARE_REALTIME_APP_SECRET` | se `cloudflare` | Bearer das chamadas ao SFU — **só no servidor**, nunca em `/config.json` |
| `ROOM_TOKEN_SECRET` | em produção | inalterada — assina convites e o ticket de sessão, ≥ 32 caracteres |
| `MAX_ROOM_PARTICIPANTS` | não | ausente = sem limite; só afeta o caminho legado de signaling WebRTC |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | não | TURN extra opcional; a Cloudflare já expõe IP público + STUN |

```bash
railway variables set \
  CLOUDFLARE_REALTIME_APP_ID=<app id> \
  CLOUDFLARE_REALTIME_APP_SECRET=<app secret> \
  --service ReShare
```

## Estratégia de migração

1. Publique o código com `MEDIA_PROVIDER` ausente/`webrtc` — produção não muda.
2. Crie o app Cloudflare Realtime e defina `CLOUDFLARE_REALTIME_APP_ID` / `_APP_SECRET`
   no Railway; mantenha `MEDIA_PROVIDER=webrtc`.
3. Numa preview do Railway, `MEDIA_PROVIDER=cloudflare` e rode
   `bun run test:e2e:cloudflare`; teste em duas abas.
4. Mude produção para `cloudflare`.
5. **Rollback:** `MEDIA_PROVIDER=webrtc` + reiniciar. Sem deploy de código.
6. Depois de estabilizar, um PR posterior pode remover `src/lib/webrtc/**` e o relay
   offer/answer/ice do `server/signaling.ts` (mantendo `create-room` e a presença).

## Boas práticas

- Mantenha `MEDIA_PROVIDER=webrtc` até `test:e2e:cloudflare` + testes manuais passarem.
- `CLOUDFLARE_REALTIME_APP_SECRET` só no host da API; nunca em `/config.json` nem no bundle.
- Ticket de sessão curto (15 min); o cliente pega um novo a cada (re)conexão.
- Egress: 1.000 GB/mês grátis, depois US$0,05/GB. Só tráfego Cloudflare→cliente conta.
- CSP/`connect-src`: a mídia vai direto ao SFU da Cloudflare via WebRTC; as chamadas
  HTTP são todas para a própria origem (`/realtime/*`).

## Build da API

O Railway usa **Railpack** (`bun run build` + `bun run start`). O `deploy/Dockerfile`
existe para outros hosts Docker e fica fora da raiz de propósito (um `Dockerfile` na
raiz faria o Railway trocar o Railpack por ele):

```bash
docker build -f deploy/Dockerfile -t reshare-api .
docker run -p 3000:3000 -e ROOM_TOKEN_SECRET=... reshare-api
```

## Local

```bash
MEDIA_PROVIDER=cloudflare \
  CLOUDFLARE_REALTIME_APP_ID=... CLOUDFLARE_REALTIME_APP_SECRET=... \
  ROOM_TOKEN_SECRET=dev-secret-at-least-32-characters-long \
  bun run dev
```
