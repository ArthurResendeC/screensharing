import { defineRailway, project, service, volume } from 'railway/iac';

export default defineRailway(ctx => {
  // Some CLI versions evaluate once without context before loading the linked project.
  // When context is present, refuse to manage an unrelated project.
  if (
    ctx.projectId &&
    ctx.projectId !== 'a2f56a74-1b60-4657-aa06-6b49373fee84'
  ) {
    throw new Error(
      'Vincule o projeto screensharing antes de aplicar esta configuração.',
    );
  }

  // Dono da sala, moderadores permanentes e o transporte escolhido por sala ficam num
  // SQLite. Sem um volume montado, cada redeploy apagaria o arquivo junto com todos os
  // hostTokens e grants — "permanente" deixaria de significar qualquer coisa.
  const data = volume('rooms-data', { sizeMB: 1024 });

  // No GitHub source: deployments are explicit via `railway up --service ...`.
  // Railway-generated domains are created separately with `railway domain`.
  // Keep platform defaults ON_FAILURE and Serverless off. CLI 5.44 serializes
  // those defaults as null, so spelling them out causes a perpetual false diff.
  const web = service('web', {
    build: { builder: 'RAILPACK', buildCommand: 'bun run build' },
    start: 'bun run start',
    healthcheck: '/health',
    healthcheckTimeout: 60,
    // Uma réplica só: os participantes conectados ficam em memória e um arquivo
    // SQLite tem um único escritor. Antes de subir réplicas é preciso sair do SQLite
    // (por exemplo, para Postgres) ou adicionar coordenação.
    replicas: 1,
    deploy: {
      restartPolicyMaxRetries: 3,
    },
    volumeMounts: { 'rooms-data': { mountPath: '/data' } },
    env: {
      PORT: '3000',
      NODE_ENV: 'production',
      MAX_VIDEO_BITRATE: '15000000',
      // Camada de mídia. Comece em 'webrtc'; troque para 'cloudflare' quando o
      // app Cloudflare Realtime estiver validado. Rollback = voltar e reiniciar.
      MEDIA_PROVIDER: 'webrtc',
      // Precisa apontar para dentro do volume montado acima.
      SQLITE_PATH: '/data/rooms.sqlite',
      // Salas não somem mais quando esvaziam; a varredura horária remove as
      // abandonadas há mais dias que isto.
      ROOM_RETENTION_DAYS: '30',
    },
    // CLOUDFLARE_REALTIME_APP_ID e CLOUDFLARE_REALTIME_APP_SECRET são segredos
    // definidos fora da IaC: `railway variables set CLOUDFLARE_REALTIME_APP_SECRET=... --service ReShare`.
  });

  return project('screensharing', { resources: [data, web] });
});
