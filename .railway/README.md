# Deploy na Railway pela CLI

A infraestrutura está em [`railway.ts`](./railway.ts), usando o [SDK oficial de IaC](https://docs.railway.com/infrastructure-as-code).

- [GitHub privado](https://github.com/ArthurResendeC/screensharing)
- [Projeto Railway](https://railway.com/project/a2f56a74-1b60-4657-aa06-6b49373fee84)
- Ambiente: `production`
- Aplicação: https://web-production-af1c0.up.railway.app

## Atualizações

A migração dos serviços separados foi concluída em 7 de setembro de 2026: o novo `web` foi publicado e validado antes da remoção do `signaling` legado. Para atualizações futuras, use:

```bash
bun install --frozen-lockfile
railway login
railway link --project a2f56a74-1b60-4657-aa06-6b49373fee84 --environment production
railway config plan
railway config apply
railway variable set ROOM_TOKEN_SECRET=<segredo-aleatorio-com-pelo-menos-32-caracteres> --service web
railway up --service web --environment production --detach
```

Acompanhe o deploy:

```bash
railway service status --service web
railway logs --service web --latest --lines 100
curl -fsS https://web-production-af1c0.up.railway.app/health
```

Depois, crie uma sala no domínio público e teste em dois navegadores ou máquinas. O WebSocket deve usar `wss://web-production-af1c0.up.railway.app/signaling` automaticamente.

## Configuração final

| Serviço | Build           | Start           | Porta                 | Health check |
| ------- | --------------- | --------------- | --------------------- | ------------ |
| `web`   | `bun run build` | `bun run start` | `$PORT` (3000 na IaC) | `/health`    |

Railpack detecta `bun.lock` e o `packageManager` fixado no `package.json`. A Railway termina TLS; Bun recebe HTTP/WS internamente e o navegador usa HTTPS/WSS na mesma origem. Não é necessário configurar URL pública de signaling.

Há uma réplica porque os participantes conectados ficam em memória **e** porque um arquivo SQLite tem um único escritor. Antes de subir réplicas é preciso sair do SQLite (por exemplo, para Postgres) ou adicionar uma camada de coordenação. Não há SFU nem TURN provisionado e a mídia continua P2P.

Reiniciar ou reimplantar continua encerrando as sessões ativas, e os convites permanecem válidos. O que mudou: **o dono da sala, os moderadores permanentes e o transporte escolhido por sala sobrevivem ao redeploy**, porque ficam num SQLite no volume `rooms-data` (montado em `/data`, `SQLITE_PATH=/data/rooms.sqlite`). Sem esse volume o arquivo é recriado vazio a cada deploy e todos os `hostToken` e grants se perdem em silêncio — o volume não é opcional.

A IaC já declara o volume e a variável; `railway config apply` provisiona os dois. Confirme depois do apply:

```bash
railway volume list
railway variables --service web | grep SQLITE_PATH
```

Salas não somem mais quando ficam vazias: uma varredura horária apaga as que passaram `ROOM_RETENTION_DAYS` (padrão 30) sem nenhum join nem ação de dono/moderador, e os grants de moderador vão junto por cascade.

`ROOM_TOKEN_SECRET` é obrigatório em produção, não deve ser colocado na IaC ou no Git e precisa permanecer estável entre deploys. Trocá-lo invalida todos os convites de sala existentes — e agora também todos os `hostToken`, códigos de recuperação e grants de moderador, porque é a mesma chave que gera os HMACs guardados no SQLite.

`railway up` envia o diretório local e não depende do último commit no GitHub. Revise o estado local antes do upload. Os domínios gerados pela Railway são administrados separadamente; para recriar o domínio da aplicação:

```bash
railway domain --service web --port 3000
```

Para TURN, configure `TURN_URL`, `TURN_USERNAME` e `TURN_CREDENTIAL` como variáveis privadas do serviço. Elas são expostas ao navegador por necessidade do ICE; use credenciais temporárias. `MAX_VIDEO_BITRATE` define o teto solicitado por envio, em bits por segundo.
