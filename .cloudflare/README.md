# Cloudflare na frente da Railway

A configuração da zona `arthur-resende.com.br` para `reshare.arthur-resende.com.br` está em [`rules.ts`](./rules.ts), como dados; [`cloudflare.ts`](./cloudflare.ts) aplica pela API e [`rules.test.ts`](./rules.test.ts) testa as regras contra as rotas de `server/index.ts` e o build de produção.

```bash
export CLOUDFLARE_API_TOKEN=<token>
export ORIGIN_AUTH_SECRET=<o mesmo valor da variável do serviço ReShare na Railway>
bun run cf:plan    # mostra o que mudaria; não altera nada
bun run cf:apply   # aplica
```

O token precisa de, na zona: Zone → Read, Bot Management → Read, e Edit em Zone Settings, Config Rules, Transform Rules e Zone WAF.

## O que é aplicado

| Fase                           | Regra                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `http_config_settings`         | SSL Full (a Railway não aceita Full Strict) e Browser Integrity Check                                 |
| `http_request_firewall_custom` | Bloqueia qualquer caminho fora da allowlist: rotas do servidor, `/room/<id>` e assets com hash do Bun |
| `http_request_firewall_custom` | Bloqueia métodos diferentes de GET/HEAD, exceto os POST/PUT que o servidor atende                     |
| `http_request_firewall_custom` | Bloqueia user agents que se dizem crawler sem serem verificados pela Cloudflare                       |
| `http_ratelimit`               | 30 requisições por IP a cada 10 s em `/config.json`, `/client-errors`, `/signaling` e `/realtime/*`   |
| `http_request_late_transform`  | Define o cabeçalho `x-reshare-origin-auth` com `ORIGIN_AUTH_SECRET` (ver "Acesso direto à Railway")   |
| Configuração da zona           | WebSockets ligado (`/signaling`)                                                                      |
| Painel (só verificado)         | Bot Fight Mode ligado: Security → Settings → Bot fight mode; a API não liga no plano Free             |

Todas as regras, exceto o rate limit, são limitadas a `http.host eq "reshare.arthur-resende.com.br"` e têm a descrição começando por `[reshare] `. O `apply` só substitui essas; regras de outros subdomínios na mesma fase são reenviadas sem mudança. Bot Fight Mode e WebSockets valem para a zona inteira, assim como o rate limit: no plano Free a expressão dele só aceita o caminho (sem host nem funções), então ele conta os caminhos do ReShare em qualquer subdomínio.

## Ao mudar o servidor

Rota nova em `server/index.ts`: adicione em `SERVED_PATHS` (e em `WRITE_PATHS`, se aceitar POST/PUT) e rode `bun run cf:apply`. Os testes falham enquanto a rota não estiver na allowlist, assim ela não é bloqueada em produção por engano.

## Acesso direto à Railway

O edge da Railway atende `reshare.arthur-resende.com.br` a quem se conecta direto no IP dela (`curl --resolve reshare.arthur-resende.com.br:443:<ip da railway> …`), sem passar por nenhuma regra acima. Scanners acham o nome nos logs de Certificate Transparency e fazem isso: era a origem dos 404 em `railway logs --http` (por exemplo o LeakIX, com UA `+https://leakix.net` e caminhos como `/.env`, que a Cloudflare bloquearia três vezes).

Para fechar isso, a Cloudflare põe o segredo `ORIGIN_AUTH_SECRET` no cabeçalho `x-reshare-origin-auth` de toda requisição ao host, sobrescrevendo o que o cliente mandar, e o servidor (`server/originAuth.ts`) responde `403 Direct origin access not allowed` sem ele em `/config.json`, `/signaling`, `/client-errors`, `/realtime/*` e em qualquer caminho desconhecido. O app não funciona sem `/config.json` e `/signaling`, então quem vem direto não consegue usar nem gastar o que o rate limit protege.

Continua igual:

- HTML, bundle, ícones, manifest e service worker são servidos pelo Bun antes de qualquer código nosso, e por isso continuam acessíveis direto na Railway. Eles já são públicos.
- `/health` fica aberto para o healthcheck da Railway, que chama o container direto.
- As requisições diretas ainda aparecem em `railway logs --http`, porque a Railway não filtra a entrada. Agora aparecem como 403, o que indica acesso sem a Cloudflare: `railway logs --http --status 403 --service ReShare`.

### Criar ou trocar o segredo

A ordem importa: se o servidor exigir o segredo antes de a Cloudflare enviá-lo, o site cai.

```bash
export ORIGIN_AUTH_SECRET="$(openssl rand -hex 32)"   # 64 caracteres hex; guarde num gerenciador de senhas
bun run cf:apply                                        # 1. a Cloudflare passa a enviar o cabeçalho
railway variables set ORIGIN_AUTH_SECRET="$ORIGIN_AUTH_SECRET" --service ReShare --environment production
                                                        # 2. reimplanta e o servidor passa a exigir
```

Para trocar, faça os dois passos de novo com o valor novo. Entre o primeiro e o segundo, as rotas protegidas respondem 403. O intervalo dura o redeploy e as salas abertas caem, então troque num momento sem uso.
