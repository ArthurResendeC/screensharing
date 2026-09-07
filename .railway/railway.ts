import { defineRailway, project, service } from 'railway/iac';

export default defineRailway(ctx => {
  // Some CLI versions evaluate once without context before loading the linked project.
  // When context is present, refuse to manage an unrelated project.
  if (ctx.projectId && ctx.projectId !== 'a2f56a74-1b60-4657-aa06-6b49373fee84') {
    throw new Error('Vincule o projeto screensharing antes de aplicar esta configuração.');
  }

  // No GitHub source: deployments are explicit via `railway up --service ...`.
  // Railway-generated domains are created separately with `railway domain`.
  // Keep platform defaults ON_FAILURE and Serverless off. CLI 5.44 serializes
  // those defaults as null, so spelling them out causes a perpetual false diff.
  const web = service('web', {
    build: { builder: 'RAILPACK', buildCommand: 'pnpm build' },
    start: 'pnpm start',
    healthcheck: '/',
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      restartPolicyMaxRetries: 3,
    },
    env: {
      NODE_ENV: 'production',
      PORT: '3000',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SIGNALING_URL: 'wss://${{signaling.RAILWAY_PUBLIC_DOMAIN}}',
      NEXT_PUBLIC_MAX_VIDEO_BITRATE: '15000000',
    },
  });

  const signaling = service('signaling', {
    build: { builder: 'RAILPACK', buildCommand: 'pnpm build:signaling' },
    start: 'pnpm start:signaling',
    healthcheck: '/health',
    healthcheckTimeout: 30,
    // Rooms/subscriptions live in memory; replicas cannot share that state.
    replicas: 1,
    deploy: {
      overlapSeconds: 0,
      drainingSeconds: 0,
      restartPolicyMaxRetries: 3,
    },
    env: {
      NODE_ENV: 'production',
      PORT: '3001',
      ALLOWED_ORIGINS: 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}',
    },
  });

  return project('screensharing', { resources: [web, signaling] });
});
