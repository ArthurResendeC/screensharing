# Deploy na Railway

A infraestrutura está em [`railway.ts`](./railway.ts), usando o [SDK oficial de IaC](https://docs.railway.com/infrastructure-as-code).

- [GitHub privado](https://github.com/ArthurResendeC/screensharing)
- [Projeto Railway](https://railway.com/project/a2f56a74-1b60-4657-aa06-6b49373fee84)
- Ambiente: `production`
- Serviço: `ReShare`
- Aplicação: https://reshare.arthur-resende.com.br, atrás da Cloudflare ([`.cloudflare/`](../.cloudflare/README.md))

## Atualizações

O serviço está ligado ao repositório no GitHub: cada push em `main` gera um deploy. Para mudar a configuração do serviço:

```bash
bun install --frozen-lockfile
railway login
railway link --project a2f56a74-1b60-4657-aa06-6b49373fee84 --environment production
railway config plan    # deve dizer "already up to date" antes de qualquer mudança sua
railway config apply
```

O nome em `service('ReShare', …)` precisa ser o do serviço em produção. Com outro nome, o `apply` apaga o `ReShare` e cria um serviço vazio. Confira o `plan` antes de aplicar.

Para publicar o diretório local sem passar pelo GitHub:

```bash
railway up --service ReShare --environment production --detach
```

Acompanhe o deploy:

```bash
railway service status --service ReShare
railway logs --service ReShare --latest --lines 100
railway logs --service ReShare --http --status ">=400" --lines 50
curl -fsS https://reshare.arthur-resende.com.br/health
```

## Configuração

| Serviço   | Build           | Start           | Porta                 | Health check |
| --------- | --------------- | --------------- | --------------------- | ------------ |
| `ReShare` | `bun run build` | `bun run start` | `$PORT` (3000 na IaC) | `/health`    |

Railpack detecta `bun.lock` e o `packageManager` fixado no `package.json`. A Railway termina TLS; Bun recebe HTTP/WS internamente e o navegador usa HTTPS/WSS na mesma origem.

O serviço é serverless (`sleepApplication`): dorme quando fica ocioso e acorda na próxima requisição. Há uma réplica porque os participantes conectados ficam em memória. Não há banco, volume ou TURN provisionado. A mídia continua P2P. Reiniciar ou reimplantar encerra as sessões ativas, mas os convites permanecem válidos.

O domínio `reshare.arthur-resende.com.br` é configurado fora da IaC (`railway domain`). O domínio gerado `*.up.railway.app` foi removido; recriá-lo expõe a aplicação sem a Cloudflare.

## Segredos

Ficam fora da IaC e do Git. `railway.ts` os declara com `preserve()` para o `apply` não apagá-los:

- `ROOM_TOKEN_SECRET`: obrigatório em produção e estável entre deploys. Trocá-lo invalida todos os convites de sala existentes.
- `ORIGIN_AUTH_SECRET`: o mesmo valor que a Cloudflare envia no cabeçalho `x-reshare-origin-auth`. Defina-o só depois do `bun run cf:apply` (ordem em [`.cloudflare/README.md`](../.cloudflare/README.md#criar-ou-trocar-o-segredo)).
- `CLOUDFLARE_REALTIME_APP_ID` e `CLOUDFLARE_REALTIME_APP_SECRET`: só com `MEDIA_PROVIDER=cloudflare`.

```bash
railway variables set ROOM_TOKEN_SECRET=<segredo-aleatorio-com-pelo-menos-32-caracteres> --service ReShare
```

Para TURN, configure `TURN_URL`, `TURN_USERNAME` e `TURN_CREDENTIAL` como variáveis privadas do serviço. Elas são expostas ao navegador por necessidade do ICE; use credenciais temporárias. `MAX_VIDEO_BITRATE` define o teto solicitado por envio, em bits por segundo.
