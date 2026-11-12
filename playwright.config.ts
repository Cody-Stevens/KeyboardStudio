import {defineConfig} from '@playwright/test';

/**
 * End-to-end flows against the built site and the in-memory mock keyboard
 * (`?mock=1`). Nothing here talks to a real keyboard.
 *
 * Set KS_SHOTS to a folder to also save a screenshot of each state.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4321',
    viewport: {width: 1600, height: 1000},
    launchOptions: {
      // Use the real GPU where there is one; without it Chromium falls back to SwiftShader.
      args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'pnpm preview',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
