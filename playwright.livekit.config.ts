import { defineConfig } from '@playwright/test';

const isCI = process.env.CI !== undefined;

// E2E do modo LiveKit. Requer um servidor LiveKit acessível (padrão: dev em
// ws://localhost:7880 com as chaves devkey/secret). Suba com:
//   docker compose up -d livekit
// e rode:  bun run test:e2e:livekit
const livekitUrl = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
const livekitApiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
const livekitApiSecret = process.env.LIVEKIT_API_SECRET ?? 'secret';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /livekit\.spec\.ts/,
  globalSetup: './tests/e2e/livekit.setup.ts',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !isCI,
    env: {
      MEDIA_PROVIDER: 'livekit',
      LIVEKIT_URL: livekitUrl,
      LIVEKIT_API_KEY: livekitApiKey,
      LIVEKIT_API_SECRET: livekitApiSecret,
    },
  },
});
