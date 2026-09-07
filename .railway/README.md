# Deploy na Railway pela CLI

Infraestrutura definida em [`railway.ts`](./railway.ts), usando o [SDK oficial IaC](https://docs.railway.com/infrastructure-as-code). O projeto foi criado no workspace pessoal de Arthur; não foi associado a projetos existentes.

- [GitHub privado](https://github.com/ArthurResendeC/screensharing)
- [Projeto Railway](https://railway.com/project/a2f56a74-1b60-4657-aa06-6b49373fee84)
- Ambiente: `production`
- Frontend reservado: https://web-production-af1c0.up.railway.app
- Signaling reservado: wss://signaling-production-7704.up.railway.app

**Estado da preparação:** serviços, variáveis, comandos, healthchecks e domínios já foram criados. O upload/build remoto da aplicação será iniciado pelos comandos abaixo; os domínios só servirão a aplicação depois do primeiro deploy bem-sucedido.

## Fazer o primeiro deploy

Nesta máquina o diretório já está vinculado ao projeto. Em outra máquina/clone:

```bash
pnpm install --frozen-lockfile
railway login
railway link --project a2f56a74-1b60-4657-aa06-6b49373fee84 --environment production
```

Na raiz do repositório, envie os dois serviços:

```bash
railway up --service signaling --environment production --detach
railway up --service web --environment production --detach
```

`--detach` retorna após iniciar o deploy; não significa que o serviço já está saudável. Acompanhe:

```bash
railway service status --service signaling
railway service status --service web
railway logs --service signaling --latest --lines 100
railway logs --service web --latest --lines 100
```

Quando ambos estiverem prontos, abra o domínio do frontend. O signaling deve responder `Signaling OK` em https://signaling-production-7704.up.railway.app/health. Crie uma sala, abra o convite em outro navegador/máquina, compartilhe uma tela e selecione essa transmissão no outro participante.

## O que está configurado

| Serviço | Build | Start | Porta interna | Healthcheck |
| --- | --- | --- | --- | --- |
| `web` | `pnpm build` | `pnpm start` | 3000 | `/` |
| `signaling` | `pnpm build:signaling` | `pnpm start:signaling` | 3001 | `/health` |

Railpack usa Node 22, pnpm e o lockfile. O signaling é compilado pelo TypeScript em `dist/` e executado pelo Node, sem `tsx` em runtime. A Railway termina TLS: internamente os serviços recebem HTTP/WS; no navegador usam HTTPS/WSS. Não configure certificado local, `SIGNALING_TLS_CERT` ou `SIGNALING_TLS_KEY` nesses serviços.

`NEXT_PUBLIC_SIGNALING_URL` referencia o domínio público de `signaling`; `ALLOWED_ORIGINS` referencia o domínio HTTPS de `web`. Esses valores foram conferidos depois da criação dos domínios. Não use `railway.internal` para o WebSocket do navegador, pois essa rede só existe entre os containers.

Há uma réplica por serviço. O signaling não pode ganhar réplicas sem compartilhar o estado das salas. Serverless está desativado e a política de reinício é On Failure, com três tentativas. A CLI 5.44 representa esses dois valores padrão como `null` ao fazer planos; por isso a definição omite os padrões, cujos valores efetivos foram confirmados pela API.

Não há banco, volume, SFU ou TURN provisionados. O tráfego de mídia continua P2P. Se as redes dos participantes exigirem relay, configure um serviço TURN separadamente conforme o README principal.

## Atualizações

`railway up` envia o diretório local, respeitando `.gitignore`. Ele não baixa o último commit do GitHub. Faça o push e o upload a partir do mesmo estado revisado do código. Arquivos locais não commitados também podem ser enviados se não estiverem ignorados.

Os serviços não têm source GitHub associado: o deploy é deliberadamente manual pela CLI. O repositório privado mantém o código e a infraestrutura versionados. Um `git push` sozinho não dispara deploy.

Para mudar a infraestrutura, edite `railway.ts` e execute:

```bash
railway config plan
railway config apply
```

Este arquivo gerencia o ambiente inteiro. Confira o projeto e o plano antes de aplicar; não o vincule a um projeto com serviços de outros aplicativos. A remoção de recursos da definição pode removê-los da Railway. Não adicione `railway.json`/`railway.toml`: o fluxo atual usa IaC.

Os domínios gerados pela Railway são administrados pela CLI e não fazem parte da definição IaC. Se precisar recriá-los:

```bash
railway domain --service web --port 3000
railway domain --service signaling --port 3001
```

Depois de mudar um domínio, atualize as origens pertinentes e refaça o deploy do frontend, pois `NEXT_PUBLIC_*` é incorporado no build. Para domínio próprio, altere as referências de URL/origem para esse domínio e configure DNS/TLS antes do deploy.

Para adicionar credenciais TURN depois, mantenha os valores fora do Git e declare as variáveis extras na IaC com `preserve()` quando já estiverem configuradas na plataforma. Assim, futuras aplicações da infraestrutura não tentarão apagá-las. `NEXT_PUBLIC_*` é visível no navegador; prefira credenciais temporárias para TURN.

Reimplantar/reiniciar o signaling encerra as salas em memória. Faça isso quando ninguém estiver compartilhando. A configuração não mantém os dois processos de signaling atendendo durante o período de encerramento; ainda assim, esta versão não oferece migração de salas nem atualização sem interrupção.
