import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createSignalingServer } from './signaling';
const cert = process.env.SIGNALING_TLS_CERT;
const key = process.env.SIGNALING_TLS_KEY;
if (Boolean(cert) !== Boolean(key)) throw new Error('Configure certificado E chave TLS.');
const server = cert && key ? createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }) : createServer();
server.on('request', (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Signaling OK\n'); });
const origins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim());
const wss = createSignalingServer(server, origins);
server.listen(Number(process.env.SIGNALING_PORT ?? 3001), '0.0.0.0', () => console.log(`Signaling ${cert ? 'WSS' : 'WS'} listening; allowed origins: ${origins.join(', ')}`));
function shutdown() { for (const client of wss.clients) client.terminate(); wss.close(); server.close(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
