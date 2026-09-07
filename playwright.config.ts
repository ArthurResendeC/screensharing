import { defineConfig } from '@playwright/test';
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
  webServer: [
    { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
    { command: 'pnpm signaling', url: 'http://localhost:3001', reuseExistingServer: !process.env.CI },
  ],
});
