/**
 * Measures the 3D board's frame rate on the demo keyboard, on the real GPU
 * and on Chromium's software renderer (SwiftShader).
 *
 *   pnpm build && pnpm preview   (in another terminal)
 *   node scripts/measure-frames.mjs [effect value, default 5 = breathing]
 *
 * It only ever opens `?mock=1`; it never talks to a real keyboard.
 */
import {chromium} from '@playwright/test';

const BASE = process.env['KS_BASE'] ?? 'http://127.0.0.1:4321';
const effect = process.argv[2] ?? '5';

const RENDERERS = {
  gpu: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  software: ['--use-angle=swiftshader', '--use-gl=angle', '--disable-gpu'],
};

for (const [name, args] of Object.entries(RENDERERS)) {
  const browser = await chromium.launch({args});
  const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
  await page.goto(`${BASE}/?mock=1`);
  await page.getByTestId('lamp').and(page.locator('[data-state="idle"]')).waitFor();
  await page.waitForTimeout(2600);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  await page.getByTestId('tab-lighting').click();
  await page.getByTestId('control-id_qmk_rgb_matrix_effect').selectOption(effect);
  await page.waitForTimeout(1500);
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const scene = window.__keyboardScene;
        const startFrames = scene.framesDrawn ?? 0;
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start < 3000) {
            requestAnimationFrame(tick);
          } else {
            const seconds = (performance.now() - start) / 1000;
            resolve({
              rafFps: Math.round(frames / seconds),
              drawnFps: scene.framesDrawn === undefined ? null : Math.round((scene.framesDrawn - startFrames) / seconds),
              drawCalls: scene.drawCalls,
              bloom: scene.bloomActive ?? null,
              sceneFps: scene.fps,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  // Idle: solid colour, nothing moving. Frames drawn over two seconds should be zero.
  await page.getByTestId('control-id_qmk_rgb_matrix_effect').selectOption('1');
  await page.mouse.move(5, 995);
  await page.waitForTimeout(800);
  const idle = await page.evaluate(async () => {
    const scene = window.__keyboardScene;
    const before = scene.framesDrawn;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return before === undefined ? null : scene.framesDrawn - before;
  });
  const flat = await page.getByTestId('flat-board').isVisible();
  console.log(JSON.stringify({renderer: name, gpu: renderer, ...result, idleFramesIn2s: idle, fellBackToFlat: flat}));
  await browser.close();
}
