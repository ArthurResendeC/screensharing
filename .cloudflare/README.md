# Cloudflare na frente da Railway

A configuração da zona `arthur-resende.com.br` para `reshare.arthur-resende.com.br` está em [`rules.ts`](./rules.ts), como dados; [`cloudflare.ts`](./cloudflare.ts) aplica pela API e [`rules.test.ts`](./rules.test.ts) testa as regras contra as rotas de `server/index.ts` e o build de produção.

```bash
export CLOUDFLARE_API_TOKEN=<token>
bun run cf:plan    # mostra o que mudaria; não altera nada
bun run cf:apply   # aplica
```

O token precisa de, na zona: Zone → Read, Bot Management → Read, e Edit em Zone Settings, Config Rules e Zone WAF.

## O que é aplicado

| Fase                           | Regra                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `http_config_settings`         | SSL Full (a Railway não aceita Full Strict) e Browser Integrity Check                                 |
| `http_request_firewall_custom` | Bloqueia qualquer caminho fora da allowlist: rotas do servidor, `/room/<id>` e assets com hash do Bun |
| `http_request_firewall_custom` | Bloqueia métodos diferentes de GET/HEAD, exceto os POST/PUT que o servidor atende                     |
| `http_request_firewall_custom` | Bloqueia user agents que se dizem crawler sem serem verificados pela Cloudflare                       |
| `http_ratelimit`               | 30 requisições por IP a cada 10 s em `/config.json`, `/client-errors`, `/signaling` e `/realtime/*`   |
| Configuração da zona           | WebSockets ligado (`/signaling`)                                                                      |
| Painel (só verificado)         | Bot Fight Mode ligado: Security → Settings → Bot fight mode; a API não liga no plano Free             |

Todas as regras, exceto o rate limit, são limitadas a `http.host eq "reshare.arthur-resende.com.br"` e têm a descrição começando por `[reshare] `. O `apply` só substitui essas; regras de outros subdomínios na mesma fase são reenviadas sem mudança. Bot Fight Mode e WebSockets valem para a zona inteira, assim como o rate limit: no plano Free a expressão dele só aceita o caminho (sem host nem funções), então ele conta os caminhos do ReShare em qualquer subdomínio.

## Ao mudar o servidor

Rota nova em `server/index.ts`: adicione em `SERVED_PATHS` (e em `WRITE_PATHS`, se aceitar POST/PUT) e rode `bun run cf:apply`. Os testes falham enquanto a rota não estiver na allowlist, assim ela não é bloqueada em produção por engano.

## Limitação

O domínio `web-production-af1c0.up.railway.app` continua público e não passa pela Cloudflare, então scanners que o encontrarem chegam direto no servidor.
