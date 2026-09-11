import { defineRailway, project, service } from 'railway/iac';

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

  // No GitHub source: deployments are explicit via `railway up --service ...`.
  // Railway-generated domains are created separately with `railway domain`.
  // Keep platform defaults ON_FAILURE and Serverless off. CLI 5.44 serializes
  // those defaults as null, so spelling them out causes a perpetual false diff.
  const web = service('web', {
    build: { builder: 'RAILPACK', buildCommand: 'bun run build' },
    start: 'bun run start',
    healthcheck: '/health',
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      restartPolicyMaxRetries: 3,
    },
    env: {
      PORT: '3000',
      NODE_ENV: 'production',
      MAX_VIDEO_BITRATE: '15000000',
      // Camada de mídia. Comece em 'webrtc'; troque para 'cloudflare' quando o
      // app Cloudflare Realtime estiver validado. Rollback = voltar e reiniciar.
      MEDIA_PROVIDER: 'webrtc',
    },
    // CLOUDFLARE_REALTIME_APP_ID e CLOUDFLARE_REALTIME_APP_SECRET são segredos
    // definidos fora da IaC: `railway variables set CLOUDFLARE_REALTIME_APP_SECRET=... --service ReShare`.
  });

  return project('screensharing', { resources: [web] });
});
