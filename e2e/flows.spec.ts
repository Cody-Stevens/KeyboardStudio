/**
 * Every flow of the app, driven like a person would, against the mock
 * keyboard. Assertions read the mock keyboard's own memory (keymap, lighting
 * RAM and EEPROM, macro buffer), not just the screen.
 */
import {expect, test, type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

const SHOTS = process.env['KS_SHOTS'];
let shotIndex = 0;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) {
    return;
  }
  mkdirSync(SHOTS, {recursive: true});
  shotIndex += 1;
  await page.screenshot({path: join(SHOTS, `${String(shotIndex).padStart(2, '0')}-${name}.png`)});
};

const COLS = 16;
const KC = {ESC: 0x29, CAPS: 0x39, MUTE: 0xa8, APP: 0x65, RCTL: 0xe4, MACRO0: 0x7700} as const;

/** Reads from the mock keyboard through the test hooks the app installs with ?mock=1. */
const mockKeymap = (page: Page) =>
  page.evaluate(() => (window as unknown as {__keyboardStudio: {keymap: () => number[][][]}}).__keyboardStudio.keymap());
const mockValue = (page: Page, channel: number, valueId: number, length: number, saved = false) =>
  page.evaluate(
    ([c, v, l, s]) => {
      const hooks = (window as unknown as {__keyboardStudio: {customValue: (...a: number[]) => number[]; savedCustomValue: (...a: number[]) => number[]}}).__keyboardStudio;
      return s ? hooks.savedCustomValue(c, v, l) : hooks.customValue(c, v, l);
    },
    [channel, valueId, length, saved ? 1 : 0] as const,
  );
const mockMacroBuffer = (page: Page) =>
  page.evaluate(() => (window as unknown as {__keyboardStudio: {macroBuffer: () => number[]}}).__keyboardStudio.macroBuffer());
const idle = (page: Page) => page.evaluate(() => (window as unknown as {__keyboardStudio: {idle: () => Promise<void>}}).__keyboardStudio.idle());

/** Clicks a key on whichever board is showing: the flat board's button, or the 3D key at its projected position. */
const clickKey = async (page: Page, row: number, col: number) => {
  if (await page.getByTestId('flat-board').isVisible()) {
    await page.getByTestId('flat-board').getByTestId(`key-${row}-${col}`).click();
    return;
  }
  const position = await page.evaluate(
    (matrix) => (window as unknown as {__keyboardScene: {keyScreenPosition: (m: number) => {x: number; y: number} | null}}).__keyboardScene.keyScreenPosition(matrix),
    row * COLS + col,
  );
  const box = await page.getByTestId('board-3d').boundingBox();
  if (!position || !box) {
    throw new Error(`Key ${row},${col} is not on screen`);
  }
  await page.mouse.click(box.x + position.x, box.y + position.y);
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

test('landing, unsupported browser and the unknown-board drop zone', async ({page, browser}) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Connect keyboard'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Try the demo keyboard'})).toHaveAttribute('href', '?mock=1');
  await shot(page, 'landing');

  const noHid = await browser.newPage();
  await noHid.addInitScript(() => {
    delete (Navigator.prototype as unknown as {hid?: unknown}).hid;
  });
  await noHid.goto('/');
  await expect(noHid.getByText('This browser cannot talk to keyboards.')).toBeVisible();
  await shot(noHid, 'unsupported-browser');
  await noHid.close();

  await page.goto('/?mock=1&board=unknown');
  const drop = page.getByTestId('definition-drop');
  await expect(drop).toBeVisible();
  await shot(page, 'unknown-board-drop-zone');
  await drop.locator('input[type=file]').setInputFiles('src/core/definitions/bundled/linky87.json');
  await expect(page.getByTestId('lamp')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('tab-keys')).toBeVisible();
  expect(problems).toEqual([]);
});

test('every editing flow on the demo keyboard', async ({page}) => {
  const problems = watchConsole(page);
  await page.goto('/?mock=1');

  // Connect: the demo connects on load and reads the keyboard.
  await expect(page.getByTestId('lamp')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('board-3d')).toBeVisible();
  const initial = await mockKeymap(page);
  expect(initial[0]?.[3]?.[0]).toBe(KC.CAPS);
  await page.waitForTimeout(400);
  await shot(page, 'connect-assembling');
  await page.waitForTimeout(2200);
  await shot(page, 'connected-windows-3d');

  // Remap Caps Lock to Esc by clicking the 3D key and searching.
  await clickKey(page, 3, 0);
  await expect(page.getByTestId('key-sentence')).toContainText('Caps Lock on Windows does Caps Lock');
  await shot(page, 'key-selected-3d');
  await page.getByTestId('picker-search').fill('esc');
  await shot(page, 'key-search');
  await page.getByTestId('picker-search').press('Enter');
  await idle(page);
  await expect(page.getByTestId('key-sentence')).toContainText('Caps Lock on Windows is now Esc.');
  await expect(page.getByTestId('key-sentence')).toContainText('Saved to keyboard.');
  await expect(page.getByTestId('lamp')).toHaveAttribute('data-state', 'saved');
  expect((await mockKeymap(page))[0]?.[3]?.[0]).toBe(KC.ESC);
  await page.waitForTimeout(300);
  await shot(page, 'key-saved-sentence');

  // Undo from the sentence.
  await page.getByTestId('sentence-undo').click();
  await idle(page);
  expect((await mockKeymap(page))[0]?.[3]?.[0]).toBe(KC.CAPS);
  await expect(page.getByTestId('log-entry').first()).toContainText('Undone: Caps Lock on Windows is Caps Lock again.');
  await shot(page, 'undo-in-log');

  // "Press a key" capture, with Escape cancelling cleanly.
  await page.getByTestId('capture').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('capture')).toHaveText('Press a key');
  await expect(page.getByTestId('key-sentence')).toBeVisible();
  await page.getByTestId('capture').click();
  await page.keyboard.press('Control+KeyC');
  await idle(page);
  expect((await mockKeymap(page))[0]?.[3]?.[0]).toBe(0x0106);
  await expect(page.getByTestId('key-sentence')).toContainText('is now Ctrl + C.');

  // Flat view with the V shortcut, and back.
  await page.getByTestId('key-sentence').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.getByTestId('flat-board')).toBeVisible();
  await expect(page.getByTestId('flat-board').getByTestId('key-3-0')).toContainText('Ctrl');
  await shot(page, 'flat-view-windows');

  // Switch layers: Windows Fn shows the factory reset on Fn + End in red, and fades repeats.
  await page.getByTestId('layer-2').click();
  const end = page.getByTestId('flat-board').getByTestId('key-2-15');
  await expect(end).toHaveClass(/danger/);
  await expect(end).toContainText('Reset');
  await expect(page.getByTestId('flat-board').getByTestId('key-2-1')).toHaveClass(/faded/);
  await expect(page.getByText('Faded keys do the same as on Windows.')).toBeVisible();
  await clickKey(page, 2, 15);
  await expect(page.getByText('Factory reset.', {exact: false}).first()).toBeVisible();
  await shot(page, 'windows-fn-factory-reset-marked');
  await page.keyboard.press('Escape');

  // "Also on Mac": one action writes Windows and Mac.
  await page.getByTestId('layer-0').click();
  await clickKey(page, 5, 11);
  await page.getByTestId('also-paired').check();
  await page.getByTestId('picker-search').fill('mute');
  await page.getByTestId('picker-search').press('Enter');
  await idle(page);
  const afterPair = await mockKeymap(page);
  expect(afterPair[0]?.[5]?.[11]).toBe(KC.MUTE);
  expect(afterPair[1]?.[5]?.[11]).toBe(KC.MUTE);
  await expect(page.getByTestId('log-entry').first()).toContainText('Menu on Windows and Mac is now Mute.');
  await shot(page, 'also-on-mac');
  await page.getByTestId('also-paired').uncheck();
  await page.keyboard.press('Escape');

  // Back to 3D for lighting.
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('board-3d')).toBeVisible();

  // Lighting: three zones, each written and saved to EEPROM.
  await page.getByTestId('tab-lighting').click();
  await expect(page.getByTestId('zone-logo')).toBeVisible();
  await expect(page.getByTestId('zone-backlight')).toBeVisible();
  await expect(page.getByTestId('zone-side')).toBeVisible();
  await expect(page.getByTestId('zone-backlight')).toContainText('255, above the usual 0 to 160');
  await page.getByTestId('zone-logo').hover();
  await shot(page, 'lighting-zones-hover-logo');
  await page.getByTestId('control-id_qmk_rgblight_effect').selectOption('4');
  await page.getByTestId('control-id_qmk_rgb_matrix_effect').selectOption('5');
  await page.getByTestId('control-id_qmk_rgb_matrix_brightness').fill('80');
  await page.getByTestId('zone-side').getByRole('button', {name: 'Hue 181 degrees'}).click();
  await idle(page);
  expect(await mockValue(page, 2, 2, 1)).toEqual([4]);
  expect(await mockValue(page, 2, 2, 1, true)).toEqual([4]);
  expect(await mockValue(page, 3, 2, 1, true)).toEqual([5]);
  expect(await mockValue(page, 3, 1, 1, true)).toEqual([80]);
  expect(await mockValue(page, 4, 4, 2, true)).toEqual([128, 255]);
  await expect(page.getByTestId('lamp')).toHaveAttribute('data-state', 'saved');
  await expect(page.getByTestId('zone-backlight')).toContainText('The model shows this effect.');
  await page.waitForTimeout(600);
  await shot(page, 'lighting-breathing-saved');

  // Frame rate while the breathing backlight animates in 3D.
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start < 2000) {
            requestAnimationFrame(tick);
          } else {
            resolve(Math.round((frames * 1000) / (performance.now() - start)));
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  const drawCalls = await page.evaluate(() => (window as unknown as {__keyboardScene: {drawCalls: number; fps: number}}).__keyboardScene.drawCalls);
  console.log(`3D frame rate while animating: ${fps} fps, ${drawCalls} draw calls per frame`);
  expect(fps).toBeGreaterThan(20);

  // Clicking the logo on the model focuses its panel.
  await page.getByTestId('tab-keys').click();
  await page.getByTestId('tab-lighting').click();

  // Macros: name, record, "Save and put on a key", click the key.
  await page.getByTestId('tab-macros').click();
  await page.getByTestId('macro-slot-0').click();
  await page.getByTestId('macro-name').fill('Sig');
  await page.getByTestId('macro-record').click();
  await page.keyboard.type('Hi');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Shift+KeyT');
  await shot(page, 'macro-recording');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('macro-steps')).toContainText('Hi');
  await expect(page.getByTestId('macro-steps')).toContainText('Ctrl + Shift + T');
  await expect(page.getByTestId('macro-budget')).toContainText('of 338 bytes free');
  await page.getByTestId('macro-save-place').click();
  await expect(page.getByText('Click the key that should play')).toBeVisible();
  await shot(page, 'macro-placing');
  await clickKey(page, 5, 12);
  await idle(page);
  const buffer = await mockMacroBuffer(page);
  expect(buffer.slice(0, 5)).toEqual([72, 105, 1, 1, 0x28]);
  expect((await mockKeymap(page))[0]?.[5]?.[12]).toBe(KC.MACRO0);
  await expect(page.getByTestId('log-entry').first()).toContainText('Macro Sig is saved and on Right Ctrl (Windows).');
  await expect(page.getByTestId('log-entry').first()).toHaveAttribute('data-state', 'saved');
  await shot(page, 'macro-on-key');

  // A macro saved without a key is flagged.
  await page.getByTestId('macro-slot-1').click();
  await page.getByTestId('macro-text').fill('ok');
  await page.getByTestId('macro-text').press('Enter');
  await page.getByTestId('macro-save-only').click();
  await idle(page);
  await expect(page.getByTestId('macro-slot-1')).toContainText('Not on a key');
  await shot(page, 'macro-not-on-a-key');

  // Snapshot: save, change a key, review what restore changes, restore.
  await page.getByTestId('tab-snapshots').click();
  await page.getByTestId('snapshot-name').fill('Before the trip');
  await page.getByTestId('snapshot-save').click();
  await expect(page.getByTestId('snapshot-list')).toContainText('Before the trip');
  await page.getByTestId('tab-keys').click();
  await clickKey(page, 3, 0);
  await page.getByTestId('picker-search').fill('esc');
  await page.getByTestId('picker-search').press('Enter');
  await idle(page);
  expect((await mockKeymap(page))[0]?.[3]?.[0]).toBe(KC.ESC);
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-snapshots').click();
  await page.getByTestId('snapshot-restore').first().click();
  await expect(page.getByTestId('restore-diff')).toHaveText('1 key on Windows');
  await shot(page, 'snapshot-restore-review');
  await page.getByTestId('restore-confirm').click();
  await idle(page);
  expect((await mockKeymap(page))[0]?.[3]?.[0]).toBe(0x0106);
  await expect(page.getByTestId('log-entry').first()).toContainText('Restored "Before the trip".');

  // A failed write rolls back, and the screen says so.
  await page.getByTestId('tab-keys').click();
  await clickKey(page, 3, 0);
  await page.evaluate(() => (window as unknown as {__keyboardStudio: {failWrites: (n: number, mode: string, commands: number[]) => void}}).__keyboardStudio.failWrites(1, 'send-error', [0x05]));
  await page.getByTestId('picker-search').fill('tab');
  await page.getByTestId('picker-search').press('Enter');
  await idle(page);
  await expect(page.getByTestId('lamp')).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('log-entry').first()).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('key-sentence')).toContainText('Did not save.');
  expect((await mockKeymap(page))[0]?.[3]?.[0]).toBe(0x0106);
  await shot(page, 'failed-write-rolled-back');

  // Disconnect and reconnect without losing the page.
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as {__keyboardStudio: {unplug: () => void}}).__keyboardStudio.unplug());
  await expect(page.getByRole('alert')).toContainText('The keyboard was disconnected.');
  await expect(page.getByTestId('lamp')).toHaveAttribute('data-state', 'disconnected');
  await shot(page, 'disconnected');
  await page.getByRole('button', {name: 'Reconnect'}).click();
  await expect(page.getByTestId('lamp')).not.toHaveAttribute('data-state', 'disconnected');
  expect((await mockKeymap(page))[0]?.[5]?.[12]).toBe(KC.MACRO0);

  // The view choice is remembered across a reload.
  await page.keyboard.press('v');
  await expect(page.getByTestId('flat-board')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('flat-board')).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.getByTestId('board-3d')).toBeVisible();

  expect(problems).toEqual([]);
});

test('laptop and phone sizes', async ({browser}) => {
  const laptop = await browser.newPage({viewport: {width: 1280, height: 720}});
  const problems = watchConsole(laptop);
  await laptop.goto('/?mock=1');
  await expect(laptop.getByTestId('lamp')).toHaveAttribute('data-state', 'idle');
  await laptop.waitForTimeout(2600);
  await clickKey(laptop, 3, 0);
  await expect(laptop.getByTestId('key-sentence')).toBeVisible();
  // The whole board stays visible above the docked editor.
  const stage = await laptop.locator('.stage').boundingBox();
  expect(stage?.height ?? 0).toBeGreaterThan(280);
  await shot(laptop, 'laptop-1280x720');
  await laptop.close();

  const phone = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  await phone.goto('/?mock=1');
  await expect(phone.getByTestId('flat-board')).toBeVisible();
  await shot(phone, 'phone-390');
  await phone.close();
  expect(problems).toEqual([]);
});
