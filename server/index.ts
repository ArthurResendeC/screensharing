import homepage from '../src/client/index.html';
import { SignalingHub, type Client, type SignalingSocket } from './signaling';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');

const configuredOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);
const hub = new SignalingHub();

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

const server = Bun.serve<Client>({
  hostname: '0.0.0.0',
  port,
  development: process.env.NODE_ENV !== 'production',
  routes: {
    '/': homepage,
    '/room/:roomId': homepage,
    '/health': new Response('OK\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    }),
    '/config.json': () =>
      Response.json(
        {
          maxVideoBitrate: Number(process.env.MAX_VIDEO_BITRATE ?? 15_000_000),
          turn: process.env.TURN_URL
            ? {
                urls: process.env.TURN_URL,
                username: process.env.TURN_USERNAME,
                credential: process.env.TURN_CREDENTIAL,
              }
            : null,
        },
        { headers: { 'cache-control': 'no-store' } },
      ),
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
console.log(`WebRTC Screen Share listening on ${server.url}`);

function shutdown() {
  clearInterval(heartbeat);
  hub.close();
  void server.stop(true);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
