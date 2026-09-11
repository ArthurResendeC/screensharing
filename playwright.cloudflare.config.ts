import { defineConfig } from '@playwright/test';

const isCI = process.env.CI !== undefined;

// E2E do modo Cloudflare Realtime. Requer um app Cloudflare Realtime SFU (crie em
// dash.cloudflare.com → Realtime → SFU) e as variáveis:
//   CLOUDFLARE_REALTIME_APP_ID  CLOUDFLARE_REALTIME_APP_SECRET
// Rode com:  bun run test:e2e:cloudflare
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /cloudflare\.spec\.ts/,
  globalSetup: './tests/e2e/cloudflare.setup.ts',
  timeout: 90000,
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
      MEDIA_PROVIDER: 'cloudflare',
      CLOUDFLARE_REALTIME_APP_ID: process.env.CLOUDFLARE_REALTIME_APP_ID ?? '',
      CLOUDFLARE_REALTIME_APP_SECRET:
        process.env.CLOUDFLARE_REALTIME_APP_SECRET ?? '',
      ROOM_TOKEN_SECRET:
        process.env.ROOM_TOKEN_SECRET ??
        'e2e-room-token-secret-at-least-32-characters',
    },
  },
});
