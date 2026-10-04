import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'android',
      testMatch: '**/reliability.spec.ts',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      testMatch: '**/reliability.spec.ts',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npm run test:e2e:server',
    url: 'http://localhost:8787',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
