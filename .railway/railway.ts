import { defineRailway, github, preserve, project, service } from 'railway/iac';

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

  // The name must match the live service: a different one makes `railway config apply` delete
  // ReShare and create an empty service. Deploys come from the GitHub repo; the custom domain
  // (reshare.arthur-resende.com.br, behind Cloudflare) is managed separately with `railway domain`.
  // Keep the platform default ON_FAILURE unset. CLI 5.44 serializes it as null, so spelling it out
  // causes a perpetual false diff.
  const reshare = service('ReShare', {
    source: github('ArthurResendeC/screensharing'),
    build: { builder: 'RAILPACK', buildCommand: 'bun run build' },
    start: 'bun run start',
    healthcheck: '/health',
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      restartPolicyMaxRetries: 3,
      // Serverless: sleeps when idle and wakes on the next request.
      sleepApplication: true,
    },
    env: {
      PORT: '3000',
      NODE_ENV: 'production',
      MAX_VIDEO_BITRATE: '15000000',
      // Camada de mídia. Comece em 'webrtc'; troque para 'cloudflare' quando o
      // app Cloudflare Realtime estiver validado. Rollback = voltar e reiniciar.
      MEDIA_PROVIDER: 'webrtc',
      // Segredos definidos fora da IaC (`railway variables set ... --service ReShare`);
      // `preserve()` impede que o apply os apague. CLOUDFLARE_REALTIME_APP_ID e
      // CLOUDFLARE_REALTIME_APP_SECRET seguem o mesmo caminho quando MEDIA_PROVIDER=cloudflare.
      ROOM_TOKEN_SECRET: preserve(),
      ORIGIN_AUTH_SECRET: preserve(),
    },
  });

  return project('screensharing', { resources: [reshare] });
});
