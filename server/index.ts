import homepage from '../src/client/index.html';
import icon192 from '../src/client/assets/icon-192.png' with { type: 'file' };
import icon512 from '../src/client/assets/icon-512.png' with { type: 'file' };
import maskableIcon512 from '../src/client/assets/icon-maskable-512.png' with { type: 'file' };
import manifest from '../src/client/manifest.webmanifest' with { type: 'text' };
import serviceWorker from '../src/client/service-worker.js' with { type: 'text' };
import { createRealtimeProxy } from './realtime/proxy';
import { SignalingHub, type Client, type SignalingSocket } from './signaling';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');

const mediaProvider = process.env.MEDIA_PROVIDER === 'cloudflare' ? 'cloudflare' : 'webrtc';
const cfAppId = process.env.CLOUDFLARE_REALTIME_APP_ID ?? '';
const cfAppSecret = process.env.CLOUDFLARE_REALTIME_APP_SECRET ?? '';
if (mediaProvider === 'cloudflare' && (!cfAppId || !cfAppSecret))
  throw new Error('MEDIA_PROVIDER=cloudflare exige CLOUDFLARE_REALTIME_APP_ID e CLOUDFLARE_REALTIME_APP_SECRET.');

const turnConfig = process.env.TURN_URL
  ? { urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }
  : null;

// Limite opcional de tamanho de sala, aplicado no join-room (usado nos dois modos:
// tanto o mesh quanto o cloudflare passam por join-room). Ausente = sem limite.
const maxRoomParticipants = Number(process.env.MAX_ROOM_PARTICIPANTS) || undefined;

const configuredOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);
const configuredRoomTokenSecret = process.env.ROOM_TOKEN_SECRET ?? '';
if (process.env.NODE_ENV === 'production' && configuredRoomTokenSecret.length < 32)
  throw new Error('ROOM_TOKEN_SECRET deve ter pelo menos 32 caracteres.');
const roomTokenSecret = configuredRoomTokenSecret || 'development-only-room-token-secret-change-me';
const hub = new SignalingHub(roomTokenSecret, maxRoomParticipants);
const iconHeaders = { 'cache-control': 'public, max-age=604800' };

// Proxy sem estado para o SFU Cloudflare Realtime (valida a sala, esconde o App
// Secret). Só existe quando configurado, para deploys WebRTC não mudarem.
const realtimeProxy =
  mediaProvider === 'cloudflare'
    ? createRealtimeProxy({
        roomTokenSecret,
        appId: cfAppId,
        appSecret: cfAppSecret,
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          ...(turnConfig?.urls ? [turnConfig as RTCIceServer] : []),
        ],
      })
    : null;

function originAllowed(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (configuredOrigins.has(origin)) return true;
  try {
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    return new URL(origin).host === (forwardedHost || request.headers.get('host'));
  } catch {
    return false;
  }
}

// GET same-origin no navegador normalmente não envia Origin; quando envia (cross-site),
// exigimos que a origem seja permitida. Sem cookies/sessão, não há risco de CSRF: a
// credencial assinada é a barreira real, isto só evita uso da cota por outros sites.
function tokenRequestAllowed(request: Request) {
  return request.headers.get('origin') ? originAllowed(request) : true;
}

const forbidden = () => new Response('Origin not allowed\n', { status: 403 });

const server = Bun.serve<Client>({
  hostname: '0.0.0.0',
  port,
  development: process.env.NODE_ENV !== 'production',
  routes: {
    '/': homepage,
    '/room/:roomId': homepage,
    '/manifest.webmanifest': new Response(manifest, {
      headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' },
    }),
    '/service-worker.js': new Response(serviceWorker, {
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' },
    }),
    '/icons/icon-192.png': new Response(Bun.file(icon192), { headers: iconHeaders }),
    '/icons/icon-512.png': new Response(Bun.file(icon512), { headers: iconHeaders }),
    '/icons/icon-maskable-512.png': new Response(Bun.file(maskableIcon512), { headers: iconHeaders }),
    '/health': new Response('OK\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    }),
    '/config.json': () =>
      Response.json(
        {
          mediaProvider,
          maxVideoBitrate: Number(process.env.MAX_VIDEO_BITRATE ?? 15_000_000),
          minVideoBitrate: Number(process.env.MIN_VIDEO_BITRATE ?? 2_500_000),
          startVideoBitrate: Number(process.env.START_VIDEO_BITRATE ?? 8_000_000),
          // TURN opcional; entregue ao cliente em ambos os modos (o Cloudflare
          // adiciona seu próprio STUN por baixo).
          turn: turnConfig,
        },
        { headers: { 'cache-control': 'no-store' } },
      ),
    ...(realtimeProxy
      ? {
          '/realtime/session': (request: Request) =>
            tokenRequestAllowed(request) ? realtimeProxy(request) : forbidden(),
          '/realtime/tracks/new': (request: Request) =>
            tokenRequestAllowed(request) ? realtimeProxy(request) : forbidden(),
          '/realtime/renegotiate': (request: Request) =>
            tokenRequestAllowed(request) ? realtimeProxy(request) : forbidden(),
          '/realtime/tracks/close': (request: Request) =>
            tokenRequestAllowed(request) ? realtimeProxy(request) : forbidden(),
        }
      : {}),
  },
  fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname !== '/signaling') return new Response('Not found\n', { status: 404 });
    if (!originAllowed(request)) return new Response('Origin not allowed\n', { status: 403 });
    const upgraded = bunServer.upgrade(request, { data: hub.createClient() });
    return upgraded ? undefined : new Response('WebSocket upgrade required\n', { status: 426 });
  },
  websocket: {
    data: {} as Client,
    maxPayloadLength: 65_536,
    perMessageDeflate: false,
    open(ws) {
      hub.open(ws.data, ws as unknown as SignalingSocket);
    },
    message(ws, message) {
      hub.message(ws.data, message);
    },
    close(ws) {
      hub.leave(ws.data);
    },
    pong(ws) {
      hub.pong(ws.data);
    },
  },
});

const heartbeat = setInterval(() => hub.heartbeat(), 15_000);
console.log(`ReShare listening on ${server.url}`);

function shutdown() {
  clearInterval(heartbeat);
  hub.close();
  // Give the 1012 close frames a moment to flush before forcing the socket shut.
  setTimeout(() => void server.stop(true), 300);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
