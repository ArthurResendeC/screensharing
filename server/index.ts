import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createSignalingServer } from './signaling.js';

const cert = process.env.SIGNALING_TLS_CERT;
const key = process.env.SIGNALING_TLS_KEY;
if (Boolean(cert) !== Boolean(key)) throw new Error('Configure certificado E chave TLS.');
const port = Number(process.env.PORT ?? process.env.SIGNALING_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta de signaling inválida.');
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS?.trim()) {
  throw new Error('Configure ALLOWED_ORIGINS para o domínio HTTPS do frontend.');
}
const server = cert && key
  ? createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) })
  : createServer();
server.on('request', (req, res) => {
  const healthy = req.url === '/' || req.url === '/health';
  res.writeHead(healthy ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end(healthy ? 'Signaling OK\n' : 'Not found\n');
});
const origins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(origin => origin.trim()).filter(Boolean);
const wss = createSignalingServer(server, origins);
server.listen(port, '0.0.0.0', () => console.log(`Signaling ${cert ? 'WSS' : 'WS'} listening on ${port}; allowed origins: ${origins.join(', ')}`));
function shutdown() {
  for (const client of wss.clients) client.terminate();
  wss.close();
  server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
