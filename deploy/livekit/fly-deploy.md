# Deploy do LiveKit no Fly.io

O Fly hospeda **apenas o SFU LiveKit**. A API Bun continua no Railway e só ganha as
variáveis `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## 1. Gerar as chaves da API

```bash
docker run --rm livekit/livekit-server generate-keys
# APIKey:  APIxxxxxxxxxxxx
# Secret:  xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 2. Criar o app

```bash
cd deploy/livekit
fly launch --no-deploy --copy-config --name reshare-livekit --region gru
```

Ajuste `domain:` em `livekit.yaml` para `reshare-livekit.fly.dev` (ou seu domínio).

## 3. Segredos e IP dedicado

```bash
fly secrets set LIVEKIT_KEYS="APIxxxxxxxxxxxx: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# UDP exige um IPv4 dedicado (o compartilhado só roteia TCP):
fly ips allocate-v4
fly ips allocate-v6
```

## 4. Deploy e verificação

```bash
fly deploy
fly logs

# Fumaça: conecta um cliente de teste ao SFU.
npx --yes livekit-cli join-room \
  --url wss://reshare-livekit.fly.dev \
  --api-key APIxxxxxxxxxxxx --api-secret xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --room fumaca --identity probe
```

Confira também que `wss://reshare-livekit.fly.dev` responde (TLS válido) e que as
portas UDP `7882`, TCP `7881` e TURN/TLS `5349` estão acessíveis (`fly ips list`).

## 5. Ligar na API do Railway

```bash
railway variables set \
  MEDIA_PROVIDER=livekit \
  LIVEKIT_URL=wss://reshare-livekit.fly.dev \
  LIVEKIT_API_KEY=APIxxxxxxxxxxxx \
  LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --service web
```

Faça o rollout com `MEDIA_PROVIDER=webrtc` primeiro, valide numa preview e só então
mude para `livekit`. **Rollback = voltar `MEDIA_PROVIDER=webrtc` e reiniciar** (sem
novo deploy de código).

## Outros hosts

Qualquer host Docker roda a mesma imagem + `livekit.yaml`. Requisitos genéricos:

- Porta UDP pública (faixa ou porta única de mux) além de `7881/tcp`.
- `rtc.use_external_ip: true` (ou `rtc.node_ip` fixo).
- Proxy que termina TLS para `wss://` (Caddy, nginx, o LB do provedor).
- Redis só ao escalar para múltiplos nós de LiveKit.
