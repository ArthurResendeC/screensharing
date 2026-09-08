import { defineConfig } from '@playwright/test';

const isCI = process.env.CI !== undefined;

export default defineConfig({
  testDir: './tests/e2e',
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
  },
});
