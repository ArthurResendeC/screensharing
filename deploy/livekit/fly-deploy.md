# Deploy do LiveKit no Fly.io

O Fly hospeda **apenas o SFU LiveKit**. A API Bun continua no Railway e só ganha as
variáveis `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## 0. CLIs (via Homebrew / Linuxbrew)

```bash
brew install flyctl
brew install railway
brew install livekit-cli   # opcional, só para o teste de fumaça; binário chamado `lk`
```

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

`fly launch` cria **2 máquinas** por padrão. Sem Redis, um nó LiveKit não fala com o
outro e participantes em máquinas diferentes não se enxergam — fixe em 1:

```bash
fly scale count 1
```

## 3. Segredos e IPs

```bash
fly secrets set LIVEKIT_KEYS="APIxxxxxxxxxxxx: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Sem IP alocado o hostname não resolve. Os dois abaixo são gratuitos:
fly ips allocate-v4 --shared   # IPv4 compartilhado (grátis, só TCP)
fly ips allocate-v6            # IPv6 dedicado (grátis)
fly ips list                   # confirma que aparecem
```

**Mídia por TCP (sem custo extra).** O IPv4 compartilhado só roteia TCP, então a
mídia usa ICE/TCP (7881) e TURN/TLS (5349) — funciona bem para compartilhamento de
tela, com latência um pouco maior. Para habilitar UDP (menor latência, melhor sob
perda de pacote): `fly ips allocate-v4` **sem** `--shared` (IPv4 dedicado, ~US$2/mês),
depois descomente `udp_port` no `livekit.yaml` e o serviço `udp` no `fly.toml` e
refaça o deploy.

## 4. Deploy e verificação

```bash
fly deploy
fly logs

# O LiveKit responde 200 em "/". Confirma TLS + app de pé:
curl -sI https://reshare-livekit.fly.dev/
```

Teste de fumaça com um cliente real (`lk`, do passo 0):

```bash
lk room join \
  --url wss://reshare-livekit.fly.dev \
  --api-key APIxxxxxxxxxxxx --api-secret xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --identity probe fumaca
```

O jeito mais completo de validar é rodar o app com `MEDIA_PROVIDER=livekit` apontando
para o Fly e abrir a sala em duas abas.

Confira que as portas TCP `7881` e TURN/TLS `5349` aparecem no app (`fly ips list` /
`fly services list`).

## 5. Ligar na API do Railway

```bash
railway variables set \
  MEDIA_PROVIDER=livekit \
  LIVEKIT_URL=wss://reshare-livekit.fly.dev \
  LIVEKIT_API_KEY=APIxxxxxxxxxxxx \
  LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --service ReShare
```

Faça o rollout com `MEDIA_PROVIDER=webrtc` primeiro, valide e só então mude para
`livekit`. **Rollback = voltar `MEDIA_PROVIDER=webrtc` e reiniciar** (sem novo deploy
de código).

## Outros hosts

Qualquer host Docker roda a mesma imagem + `livekit.yaml`. Requisitos genéricos:

- Porta UDP pública (faixa ou porta única de mux) além de `7881/tcp`.
- `rtc.use_external_ip: true` (ou `rtc.node_ip` fixo).
- Proxy que termina TLS para `wss://` (Caddy, nginx, o LB do provedor).
- Um único nó, ou Redis para roteamento entre nós.
