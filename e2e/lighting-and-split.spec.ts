/**
 * The board/editor split, the effect explanations and the reactive lighting
 * preview, against the mock keyboard (`?mock=1`). Nothing here talks to a
 * real keyboard.
 *
 * Set KS_SHOTS2 to a folder to also save the round-two screenshots.
 */
import {expect, test, type Locator, type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

const SHOTS = process.env['KS_SHOTS2'];
const shot = async (page: Page, name: string) => {
  if (!SHOTS) {
    return;
  }
  mkdirSync(SHOTS, {recursive: true});
  await page.screenshot({path: join(SHOTS, `${name}.png`)});
};

interface SceneHooks {
  framesDrawn: number;
  bloomActive: boolean;
  keyScreenPosition: (matrix: number) => {x: number; y: number} | null;
}
const scene = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as {__keyboardScene: SceneHooks}).__keyboardScene;
  return {framesDrawn: s.framesDrawn, bloomActive: s.bloomActive};
});
const framesOver = async (page: Page, ms: number) => {
  const before = (await scene(page)).framesDrawn;
  await page.waitForTimeout(ms);
  return (await scene(page)).framesDrawn - before;
};
const mockValue = (page: Page, channel: number, valueId: number, length: number) =>
  page.evaluate(
    ([c, v, l]) => (window as unknown as {__keyboardStudio: {customValue: (...a: number[]) => number[]}}).__keyboardStudio.customValue(c, v, l),
    [channel, valueId, length] as const,
  );

const ready = async (page: Page) => {
  await expect(page.getByTestId('lamp')).toHaveAttribute('data-state', 'idle');
  await page.waitForTimeout(2600);
};

const watchConsole = (page: Page) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
};

const valueNow = async (handle: Locator) => Number(await handle.getAttribute('aria-valuenow'));

/** Checks that every key of the 3D board is inside the canvas. */
const boardFits = async (page: Page) => {
  const box = await page.getByTestId('board-3d').boundingBox();
  const points = await page.evaluate(() => {
    const s = (window as unknown as {__keyboardScene: SceneHooks}).__keyboardScene;
    // Esc, the bottom-left Ctrl, Pause and the right arrow: the four corners of the Linky87.
    return [0, 5 * 16, 15, 5 * 16 + 15].map((matrix) => s.keyScreenPosition(matrix));
  });
  for (const point of points) {
    expect(point).not.toBeNull();
    expect(point!.x).toBeGreaterThan(0);
    expect(point!.y).toBeGreaterThan(0);
    expect(point!.x).toBeLessThan(box!.width);
    expect(point!.y).toBeLessThan(box!.height);
  }
};

test('the split between board and editor: drag, keys, touch, memory and reset', async ({page}) => {
  const problems = watchConsole(page);
  await page.goto('/?mock=1');
  await ready(page);
  const handle = page.getByTestId('split-handle');
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  const initial = await valueNow(handle);
  expect(initial).toBeGreaterThan(50);
  const stage = page.locator('.stage');
  const dock = page.locator('.dock');
  const stageBefore = (await stage.boundingBox())!.height;
  await shot(page, '01-split-default');

  // Drag with the mouse: the board shrinks by what the pointer moved, and both views refit.
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 200, {steps: 10});
  await page.mouse.up();
  const stageAfter = (await stage.boundingBox())!.height;
  expect(Math.abs(stageBefore - 200 - stageAfter)).toBeLessThanOrEqual(2);
  expect(await valueNow(handle)).toBeLessThan(initial);
  await expect(page.getByTestId('board-3d')).toBeVisible();
  await boardFits(page);
  // Rendering on demand: the drag drew frames, an idle board draws none.
  await page.mouse.move(5, 995);
  await page.waitForTimeout(400);
  expect(await framesOver(page, 1000)).toBe(0);
  await shot(page, '02-split-small-board');

  // It cannot be dragged past the minimums.
  const now = (await handle.boundingBox())!;
  await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2);
  await page.mouse.down();
  await page.mouse.move(now.x + now.width / 2, 20, {steps: 8});
  await page.mouse.up();
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(259);
  await expect(handle).toHaveAttribute('aria-valuenow', (await handle.getAttribute('aria-valuemin')) ?? '');

  // Keyboard: arrows, then End and Home.
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await valueNow(handle)).toBeGreaterThan(Number(await handle.getAttribute('aria-valuemin')));
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', (await handle.getAttribute('aria-valuemax')) ?? '');
  expect((await dock.boundingBox())!.height).toBeGreaterThanOrEqual(199);
  await boardFits(page);
  await shot(page, '03-split-large-board');

  // The editor scrolls inside itself when it is short.
  await page.getByTestId('tab-lighting').click();
  const body = page.locator('.dock-body');
  expect(await body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  // Remembered across a reload.
  await page.keyboard.press('Home');
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  const remembered = await valueNow(handle);
  await page.reload();
  await ready(page);
  expect(await valueNow(page.getByTestId('split-handle'))).toBe(remembered);

  // The flat board refits too.
  await page.getByTestId('view-flat').click();
  const flat = (await page.getByTestId('flat-board').boundingBox())!;
  const stageBox = (await stage.boundingBox())!;
  expect(flat.y).toBeGreaterThanOrEqual(stageBox.y);
  expect(flat.y + flat.height).toBeLessThanOrEqual(stageBox.y + stageBox.height);
  await page.getByTestId('view-3d').click();

  // Double-click resets to the default, and the default is remembered as such.
  await page.getByTestId('split-handle').dblclick();
  expect(await valueNow(page.getByTestId('split-handle'))).toBe(initial);
  await page.reload();
  await ready(page);
  expect(await valueNow(page.getByTestId('split-handle'))).toBe(initial);
  expect(problems).toEqual([]);
});

test('the split works by touch and at 1280 x 720 with the Changes panel open or closed', async ({browser}) => {
  const page = await browser.newPage({viewport: {width: 1280, height: 720}, hasTouch: true});
  const problems = watchConsole(page);
  await page.goto('/?mock=1');
  await ready(page);
  const handle = page.getByTestId('split-handle');
  const stage = page.locator('.stage');
  const before = (await stage.boundingBox())!.height;
  expect(before).toBeGreaterThan(280);

  // A real touch drag through the browser's input pipeline.
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y + step * 10}]});
  }
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  const after = (await stage.boundingBox())!.height;
  expect(after - before).toBeGreaterThan(50);
  await boardFits(page);

  // Changes panel open and closed: the board still fits and the minimums hold.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', {name: /^Changes/}).click();
    await page.waitForTimeout(300);
    await boardFits(page);
    expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(259);
    expect((await page.locator('.dock').boundingBox())!.height).toBeGreaterThanOrEqual(199);
  }
  await page.getByTestId('split-handle').dblclick();
  await page.close();
  expect(problems).toEqual([]);
});

test('effects are grouped and explained, and reactive effects preview on the model', async ({page}) => {
  const problems = watchConsole(page);
  await page.goto('/?mock=1');
  await ready(page);
  await page.getByTestId('tab-lighting').click();
  const effect = page.getByTestId('control-id_qmk_rgb_matrix_effect');
  const about = page.getByTestId('control-id_qmk_rgb_matrix_effect-about');

  // Grouped from the definition's own list: every option is still there, in seven groups.
  await expect(effect.locator('option')).toHaveCount(46);
  await expect(effect.locator('optgroup')).toHaveCount(7);
  await expect(effect.locator('optgroup[label="Dark until you type"] option')).toHaveCount(10);
  await expect(effect.locator('optgroup[label="Stays lit, flashes when you type"] option')).toHaveText(['Solid reactive']);

  // The real board's effect: solid reactive, with its flash colour from the firmware rule.
  await expect(effect).toHaveValue('31');
  await expect(about).toHaveText('Every key stays lit. A pressed key flashes a shifted colour, then slides back. Uses your colour, the speed and key presses.');
  const [hue] = await mockValue(page, 3, 4, 2);
  const flash = page.getByTestId('flash-colour');
  await expect(flash).toContainText('Pressed keys flash this colour');
  await expect(flash).toHaveAttribute('data-flash-hue', String(((hue ?? 0) + 64) & 255));
  await expect(page.getByTestId('zone-backlight')).toContainText('Type, or click keys on the model, to try it.');

  // Typing previews it on the model, then the board goes idle again.
  await page.mouse.move(5, 995);
  await page.waitForTimeout(300);
  expect(await framesOver(page, 600)).toBe(0);
  await page.locator('.stage').click({position: {x: 40, y: 200}});
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(90);
  await shot(page, '10-3d-solid-reactive-keypress-light');
  expect(await framesOver(page, 300)).toBeGreaterThan(5);
  // The flash fades in about 1.2 s at the mock's speed (54).
  await page.waitForTimeout(1500);
  expect(await framesOver(page, 600)).toBe(0);
  // V does not switch views while typing previews the effect.
  await page.keyboard.press('KeyV');
  await expect(page.getByTestId('board-3d')).toBeVisible();

  // Dark-until-pressed effects say so, and the definition's hidden colour is respected and explained.
  await effect.selectOption('32');
  await expect(about).toContainText('A pressed key lights a soft glow around itself that shrinks and fades.');
  await expect(page.getByTestId('control-id_qmk_rgb_matrix_color-hue')).toHaveCount(0);
  await expect(page.getByTestId('colour-hidden-backlight')).toContainText('still uses the colour set last');
  await effect.selectOption('40');
  await expect(about).toContainText('A ring of your colour spreads out from the pressed key.');
  await effect.selectOption('29');
  await expect(page.getByTestId('colour-hidden-backlight')).toHaveText('Pixel flow makes its own colours.');
  await effect.selectOption('42');
  await expect(page.getByTestId('zone-backlight')).toContainText('Watch your keyboard to see the effect.');
  // Vendor effects on the other zones fall back to an honest line.
  await expect(page.getByTestId('control-id_qmk_rgblight_effect-about')).toHaveText('Made by this keyboard’s maker, so the app cannot describe it.');
  expect(problems).toEqual([]);
});

test('reduced motion holds the lighting still, and slow frames turn bloom off before 3D', async ({browser}) => {
  const page = await browser.newPage({viewport: {width: 1600, height: 1000}, reducedMotion: 'reduce'});
  await page.goto('/?mock=1');
  await ready(page);
  await page.getByTestId('tab-lighting').click();
  await page.getByTestId('control-id_qmk_rgb_matrix_effect').selectOption('5');
  await page.mouse.move(5, 995);
  await page.waitForTimeout(500);
  expect(await framesOver(page, 1000)).toBe(0);
  await page.getByTestId('control-id_qmk_rgb_matrix_effect').selectOption('31');
  await page.waitForTimeout(300);
  await page.locator('.stage').click({position: {x: 40, y: 200}});
  await page.keyboard.press('KeyJ');
  expect(await framesOver(page, 500)).toBeLessThanOrEqual(2);

  // A slow GPU: bloom goes first; if it is still slow, the flat board.
  const bloomBefore = (await scene(page)).bloomActive;
  const slow = () =>
    page.evaluate(() =>
      (window as unknown as {__keyboardScene: {checkFrameTimes: (s: number[]) => void}}).__keyboardScene.checkFrameTimes(Array.from({length: 20}, () => 0.1)),
    );
  await slow();
  expect((await scene(page)).bloomActive).toBe(false);
  if (bloomBefore) {
    await expect(page.getByTestId('board-3d')).toBeVisible();
    await slow();
  }
  await expect(page.getByTestId('flat-board')).toBeVisible();
  await page.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`lighting screenshots, ${scheme}`, async ({browser}) => {
    test.skip(!SHOTS, 'Set KS_SHOTS2 to save the screenshots');
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}, colorScheme: scheme});
    await page.goto('/?mock=1');
    await ready(page);
    await page.getByTestId('tab-lighting').click();
    const effect = page.getByTestId('control-id_qmk_rgb_matrix_effect');
    const settle = async () => {
      await page.mouse.move(5, 995);
      await page.waitForTimeout(700);
    };
    await effect.selectOption('1');
    await settle();
    await shot(page, `11-3d-solid-${scheme}`);
    await effect.selectOption('5');
    await settle();
    await shot(page, `12-3d-breathing-${scheme}`);
    await effect.selectOption('4');
    await settle();
    await shot(page, `13-3d-gradient-${scheme}`);
    await effect.selectOption('13');
    await settle();
    await shot(page, `14-3d-rainbow-${scheme}`);
    await effect.selectOption('31');
    await settle();
    await page.locator('.stage').click({position: {x: 40, y: 200}});
    for (const key of ['KeyH', 'KeyJ', 'KeyK']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(70);
    }
    await shot(page, `15-3d-solid-reactive-keypress-${scheme}`);
    await page.waitForTimeout(1600);
    await effect.selectOption('4');
    await page.getByTestId('view-flat').click();
    await settle();
    await shot(page, `16-flat-lit-gradient-${scheme}`);
    await page.getByTestId('view-3d').click();
    // The picker's groups, opened in the page (a native drop-down list is drawn outside the page).
    await effect.evaluate((element) => {
      const select = element as HTMLSelectElement;
      select.size = 24;
      select.style.height = 'auto';
      select.style.position = 'relative';
      select.style.zIndex = '5';
      select.closest('.zone')?.scrollIntoView();
    });
    await page.getByTestId('split-handle').focus();
    await page.keyboard.press('Home');
    await page.mouse.move(5, 995);
    await page.waitForTimeout(400);
    await shot(page, `17-effect-picker-grouped-${scheme}`);
    await page.getByTestId('split-handle').dblclick();
    await page.close();
  });
}
