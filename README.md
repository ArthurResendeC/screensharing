# WebRTC Screen Share

Sala privada para até **cinco participantes**. Todos podem transmitir a própria tela e assistir a **uma transmissão remota por vez**, inclusive enquanto transmitem. Next.js 16.3.4 (App Router), React 19.2.8, TypeScript, pnpm. O diretório original estava vazio: não havia backend, componentes, lint, formatter ou aliases a preservar. Foram adotados ESLint/Next e alias `@/*` para `src/*`; não há formatter obrigatório.

## Iniciar localmente

Use Node.js 22.16+ e pnpm 11.6.0.

```bash
pnpm install
cp .env.example .env.local
```

Em dois terminais:

```bash
pnpm signaling
```

```bash
pnpm dev
```

Abra http://localhost:3000. O frontend usa a porta 3000; signaling usa 3001. Se Next escolher outra porta por estar ocupada, ajuste `ALLOWED_ORIGINS` e reinicie o signaling. Para o frontend em produção: `pnpm build && pnpm start`; o signaling continua sendo um processo separado, iniciado por `pnpm signaling` (tsx é dependência de desenvolvimento; mantenha-a instalada nesse servidor).

## Testar com duas abas

1. Na primeira aba, clique **Criar sala** e copie o convite. Abra esse link em outra aba.
2. Qualquer pessoa pode clicar **Compartilhar tela** e selecionar tela, janela ou aba. Marque a opção de áudio se ela estiver disponível. Para evitar espelho, capture outra janela/aba.
3. Em **Transmissões da sala**, clique **Assistir a Participante …**. Cada pessoa tem seu identificador exibido em **Você**. Nenhuma transmissão remota é recebida automaticamente.
4. Inicie também uma captura na segunda aba. As duas podem assistir uma à outra; a captura local tem preview opcional sem som, separado do único vídeo remoto.
5. Abra outras abas, até cinco participantes. Escolha outra transmissão: a anterior deixa de ser recebida. **Parar de assistir** libera a conexão de recebimento sem parar sua própria captura.
6. **Parar compartilhamento** e o botão nativo do navegador encerram somente sua transmissão. Quem estava assistindo deve selecionar novamente após você reiniciar. Você continua assistindo à tela selecionada de outra pessoa.
7. Sair ou recarregar uma aba não encerra a sala dos demais. A sala desaparece quando a última pessoa sai. Reentrar cria uma identidade nova, sem retomar captura ou seleção automaticamente.
8. Se autoplay com som for bloqueado, clique **Reproduzir vídeo e áudio**. Abra **Debug WebRTC** para estados, direção, codec, pacotes e bitrate, atualizados a cada dois segundos enquanto aberto.

`/room/abc` é apenas um exemplo conceitual: a aplicação aceita UUIDs gerados por **Criar sala**. Não há papel de host, transferência de controle ou identidade persistente.

## Testar com duas máquinas

HTTP por IP de rede, como `http://192.168.1.10:3000`, **não habilita captura de tela**. Use HTTPS com certificado confiável nas duas máquinas e WSS para signaling.

Opção direta em rede local, com certificado emitido por uma CA local confiável (por exemplo, mkcert instalado separadamente):

```bash
mkdir -p certificates
mkcert -install
mkcert -cert-file certificates/lan.pem -key-file certificates/lan-key.pem localhost 127.0.0.1 192.168.1.10
```

Substitua o IP pelo IP real do PC A. Instale **apenas o certificado público da CA** como confiável no PC B; nunca compartilhe a chave privada da CA. Configure `.env.local`:

```dotenv
ALLOWED_ORIGINS=https://192.168.1.10:3000,https://localhost:3000
SIGNALING_TLS_CERT=certificates/lan.pem
SIGNALING_TLS_KEY=certificates/lan-key.pem
```

Inicie:

```bash
pnpm signaling
pnpm dev:https --experimental-https-cert certificates/lan.pem --experimental-https-key certificates/lan-key.pem
```

São dois processos/terminais. Abra `https://192.168.1.10:3000` **em ambos os PCs**, crie a sala no PC A e abra o convite no PC B. Permita TCP 3000/3001 no firewall para a rede de teste e tráfego WebRTC entre os pares. Usar a URL de rede também no PC A evita enviar um convite com `localhost`, que apontaria para o PC B.

Alternativa para acesso pela internet: um reverse proxy com certificado TLS válido expõe o frontend e encaminha `/signaling` via WebSocket para 3001 (incluindo upgrade). Configure `NEXT_PUBLIC_SIGNALING_URL=wss://share.example.com/signaling` e `ALLOWED_ORIGINS=https://share.example.com`. O signaling pode permanecer HTTP/WS atrás desse proxy. Variáveis `NEXT_PUBLIC_*` são incorporadas no build: reinicie desenvolvimento ou refaça o build após modificá-las.

## Fluxo e decisões

- O primeiro `join-room` cria a sala em memória; o servidor atribui IDs aleatórios e entrega um snapshot de participantes e transmissões. `room-state` atualiza esse snapshot para todos. Não há banco de dados ou host privilegiado.
- Cada pessoa chama `getDisplayMedia` pelo clique, com 2560 × 1440 e 60 FPS ideais e `audio: true`. `getSettings()` mostra a captura real. Sem track de áudio, o vídeo continua normalmente; não há microfone.
- `sharing-started` / `sharing-stopped` anunciam a disponibilidade. Capturar sem espectadores consome recursos de captura local, mas não cria conexões RTP nem envia mídia pela rede.
- `watch { targetPeerId, sessionId }` seleciona um transmissor; `targetPeerId: null` para de assistir. O servidor encerra a assinatura anterior antes de aceitar outra e só permite selecionar outro participante transmitindo na mesma sala. Em seleção inválida, encerra a anterior e confirma nenhuma seleção.
- `watching` confirma a seleção ao espectador; `subscriber-joined` solicita a conexão ao transmissor. `subscription-ended` encerra uma assinatura exata em ambos os lados. IDs de assinatura ativos são únicos na sala.
- **P2P sob demanda:** `Peers.peers` é um `Map` por `sessionId`, com participante, direção, conexão e fila ICE. Cada cliente tem no máximo quatro conexões de envio e uma de recebimento. Não há SFU ou MCU.
- Usamos uma conexão **unidirecional por assinatura**. Se A assiste B e B assiste A, existem duas conexões independentes entre eles. Isso simplifica parar ou trocar uma direção sem renegociar a outra. Tem mais conexões que o reaproveitamento bidirecional, mas é limitado neste grupo pequeno e evita colisões de offers.
- Somente o transmissor daquela assinatura gera offer. Adiciona tracks com `addTrack(track, stream)`, configura direção `sendonly`, cria e aplica a descrição local. O espectador aplica SDP remoto, cria/aplica answer e a envia. O transmissor aplica a answer. Não precisamos de perfect negotiation enquanto esse contrato unidirecional for mantido.
- O espectador prepara a conexão ao selecionar, antes de enviar `watch`, e enfileira candidatos recebidos antes do SDP remoto. Handlers assíncronos são serializados; IDs e verificações após `await` descartam negociação antiga durante trocas rápidas. Mensagens não recriam conexões não solicitadas.
- `ontrack` agrupa tracks num `MediaStream` e associa a `video.srcObject` por ref. A seleção anterior é fechada com `RTCPeerConnection.close()` e removida; não fica recebendo em um vídeo oculto. Parar uma conexão de envio não para a track local compartilhada com outros espectadores.
- WebSocket nativo no navegador, `ws` no Node e Zod para tipos/validação. O signaling autoriza SDP e ICE apenas na assinatura ativa, com direção correta, destino na mesma sala e `sessionId` correspondente. Mensagens antigas são descartadas; JSON inválido produz erro sem derrubar o processo. Limites de origem, payload, taxa e lotação permanecem.
- `screenTrack.onended` e parar pela UI encerram somente envios locais. Sair do componente, `pagehide` ou queda do signaling param tracks e todas as conexões. Ping/pong detecta quedas silenciosas em aproximadamente 15–30 segundos. A sala persiste até ficar vazia ou o servidor reiniciar.
- O convite permite acesso sem autenticação. Origin não substitui autenticação, pois clientes fora do navegador podem forjá-lo. Não publique o link; use com pessoas confiáveis.

### Compatibilidade e próxima implantação

O protocolo mudou em relação à versão de host único. Reinicie o signaling e recarregue todas as abas juntas; clientes antigos não são compatíveis. Não há migração de banco. Os comandos e variáveis de ambiente permanecem iguais, sem novas dependências. O deploy será feito em uma etapa posterior, com HTTPS/WSS e decisão de TURN conforme as redes utilizadas.

## Bitrate, codecs e capacidade

`src/lib/webrtc/rtcConfiguration.ts` centraliza ICE e o limite opcional `MAX_VIDEO_BITRATE` (15.000.000 bits/s **por espectador**, configurável por `NEXT_PUBLIC_MAX_VIDEO_BITRATE`; `0` desativa).

Depois da answer, o transmissor lê parâmetros atuais com `sender.getParameters()`, modifica somente `encodings[].maxBitrate` e usa `setParameters()`. Não inventa encodings nem altera codecs. Falha nessa otimização é exibida, mas não interrompe a transmissão. Esse valor é um teto solicitado, não uma garantia de bitrate, resolução, FPS ou qualidade: navegador, CPU, captura e rede determinam o resultado; overhead de transporte e áudio são adicionais.

A negociação padrão escolhe o codec. O debug distingue capacidades locais (`RTCRtpSender.getCapabilities('video')`) do codec observado nos relatórios RTP de `getStats()`. Bitrate é calculado pelo delta de bytes entre amostras; mede vídeo enviado/recebido por peer, não upload total nem latência ponta a ponta.

Quatro espectadores podem demandar até aproximadamente 60 Mbps de upload de vídeo no transmissor com o limite padrão, além de áudio/overhead, e múltiplos encoders. Reduza o limite se necessário. 1440p60 não é garantido. Áudio de aba, janela ou sistema depende do navegador, sistema operacional e escolha feita no seletor. Dispositivos móveis têm suporte variável. Latência baixa é o objetivo do transporte direto, mas não há garantia nem medição de latência nesta versão.

## STUN e TURN

O STUN público do Google está configurado **para desenvolvimento** em `rtcConfiguration.ts`. Ele ajuda a descobrir endereços públicos, mas não retransmite mídia. NAT restritivo, CGNAT em certas combinações, redes corporativas e bloqueio de UDP podem impedir o caminho direto mesmo com SDP e ICE corretos.

TURN passa a ser necessário quando os dois peers não conseguem estabelecer conexão direta; é recomendável para uso confiável entre redes diferentes. TURN retransmite mídia quando necessário, enquanto o signaling continua sem transportá-la. Não é SFU.

O código já aceita as variáveis de TURN de `.env.example`, equivalentes a:

```ts
{
  urls: 'turn:turn.example.com:3478',
  username: '...',
  credential: '...'
}
```

Não há credenciais reais no repositório. Credenciais entregues ao navegador são visíveis: em implantação real, prefira obtê-las de um endpoint que emita credenciais temporárias; as variáveis públicas são apenas a integração simples inicial. Para redes que bloqueiam UDP, configure também os transportes TCP/TLS suportados pelo seu serviço TURN. Esta versão não inclui servidor TURN nem recuperação automática com ICE restart; em falha, tente sair/entrar novamente ou reiniciar a captura após corrigir a conectividade.

## Verificações

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Os três testes Node verificam seleção única, assinaturas recíprocas, limites, validação, isolamento entre salas, relay autorizado, descarte de mensagens antigas, fila ICE e cancelamento durante SDP pendente. Os dois testes Playwright usam canvas e áudio sintéticos com transporte WebRTC real: cinco participantes, duas capturas simultâneas, quatro espectadores de uma tela, áudio recebido, captura sem áudio, trocas rápidas e fechamento efetivo da conexão anterior, parada independente, saída do criador e reconexão após queda do signaling.

Não substituem testes manuais do seletor nativo, permissões, áudio do sistema, qualidade em máquinas físicas e NAT/TURN. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` permite escolher um Chromium instalado.

## Estrutura de arquivos

A primeira versão foi criada em um diretório vazio. Esta evolução modifica protocolo/servidor de signaling, gerenciamento de peers, componentes, testes e este README; mantém as dependências e a configuração de implantação:

- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/room/[roomId]/page.tsx`: estrutura Next e rotas.
- `src/components/Lobby.tsx`, `ScreenShare.tsx`, `Viewer.tsx`, `ConnectionDebug.tsx`: criação/entrada, captura, reprodução e debug.
- `src/lib/webrtc/peers.ts`, `rtcConfiguration.ts`, `stats.ts`: gerenciamento de peers, ICE/qualidade e estatísticas.
- `src/lib/signaling/messages.ts`, `client.ts`: protocolo validado/tipado e transporte cliente.
- `server/signaling.ts`, `server/index.ts`: salas, relay WebSocket, heartbeat e configuração HTTP/TLS.
- `tests/signaling.test.ts`, `tests/peers.test.ts`, `tests/e2e/share.spec.ts`, `playwright.config.ts`: testes.
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `next-env.d.ts`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `README.md`: configuração e documentação.
- `AGENTS.md` e `CLAUDE.md`: gerados automaticamente por esta versão do Next durante `next dev`.

## Referências oficiais consultadas antes da implementação

- [WebRTC — introdução oficial](https://webrtc.org/?hl=pt-br) e [MDN — WebRTC API](https://developer.mozilla.org/pt-BR/docs/Web/API/WebRTC_API): modelo peer-to-peer e separação entre conexão, tracks e mídia.
- [WebRTC — Peer connections](https://webrtc.org/getting-started/peer-connections): sequência offer/answer, descrições local/remota e trickle ICE. O signaling WebSocket e as regras da sala são decisões desta aplicação.
- [MDN — getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia): contexto seguro, ativação pelo usuário, constraints ideais e áudio opcional.
- [MDN — addIceCandidate](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate): descrição remota obrigatória antes de adicionar candidatos, motivando a fila explícita.
- [MDN — addTrack](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTrack) e [close](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/close): agrupamento de tracks e encerramento real da transmissão anterior.
- [MDN — setParameters](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters): modificar parâmetros obtidos do próprio sender e tratar bitrate como limite sujeito à rede e à implementação.
- [MDN — getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/getCapabilities_static): capacidades locais para debug, sem forçar codecs.
- [WebRTC — TURN](https://webrtc.org/getting-started/turn-server): fallback por relay e configuração centralizada de URL/credenciais.

Os guias foram usados como referência de fluxo; a implementação adiciona lifecycle React, validação, isolamento, limites, filas e cancelamento próprios.
