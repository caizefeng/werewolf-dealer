// Sound on the owner's phone. iOS mutes Web Audio while the ring/silent switch is on, so on iPhones a
// looping silent <audio> element keeps the page on the media channel (client/src/audio/engine.ts).
import { expect, test } from '@playwright/test';
import { createRoom, watchErrors } from './helpers.ts';

test('iPhone: the silent media channel opens on a tap, closes in the background, reopens on the next tap', async ({ page }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const ios = /iphone|ipad/i.test(ti.project.use.userAgent ?? '');
  const silence: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/silence.mp3') silence.push(r.url());
  });
  await createRoom(page, '预女猎白');
  await page.getByRole('button', { name: '菜单' }).click();
  await page.getByRole('button', { name: '测试声音' }).click();
  const html = page.locator('html');
  if (!ios) {
    // other phones are not muted by a silent switch: nothing extra is loaded
    await page.waitForTimeout(1500);
    expect(silence).toEqual([]);
    await expect(html).not.toHaveAttribute('data-media-channel', /.+/);
    expect(errors).toEqual([]);
    return;
  }
  await expect(html).toHaveAttribute('data-media-channel', 'on');
  expect(silence.length).toBeGreaterThan(0);
  // the page goes to the background: the channel closes (no media controls left on the lock screen)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(html).not.toHaveAttribute('data-media-channel', /.+/);
  // back in the foreground, the next tap opens it again
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: '测试声音' }).click();
  await expect(html).toHaveAttribute('data-media-channel', 'on');
  // turning the phone's sound off closes it too
  await page.locator('.field', { hasText: '本机播放声音' }).getByRole('switch').click();
  await expect(html).not.toHaveAttribute('data-media-channel', /.+/);
  expect(errors).toEqual([]);
});

test('测试声音 says why it stays quiet when the sound or the judge voice is switched off', async ({ page }) => {
  await createRoom(page, '预女猎白');
  await page.getByRole('button', { name: '菜单' }).click();
  await page.locator('.field', { hasText: '法官语音' }).getByRole('switch').click();
  await page.getByRole('button', { name: '测试声音' }).click();
  await expect(page.getByText('法官语音已关闭：请先打开「法官语音」')).toBeVisible();
  await page.locator('.field', { hasText: '本机播放声音' }).getByRole('switch').click();
  await page.getByRole('button', { name: '测试声音' }).click();
  await expect(page.getByText('本机声音已关闭：请先打开「本机播放声音」')).toBeVisible();
});

test('声音诊断 shows what the sound on this phone is doing', async ({ page }) => {
  await createRoom(page, '预女猎白');
  await page.getByRole('button', { name: '菜单' }).click();
  await page.locator('.diag summary').click();
  await page.getByRole('button', { name: '测试声音' }).click();
  const diag = page.locator('.diag');
  await expect(diag).toContainText('声音引擎：运行中');
  await expect(diag).toContainText('已播放 1 句', { timeout: 10_000 });
  await expect(diag).toContainText('设置：语音100% · 音乐70%');
});

/** keeps a handle on every AudioContext the page creates (window.__contexts) */
async function watchContexts(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    w.__contexts = [];
    const C = w.AudioContext ?? w.webkitAudioContext;
    w.AudioContext = class extends C {
      constructor(...a: unknown[]) {
        super(...a);
        w.__contexts.push(this);
      }
    };
  });
}

async function startNight(page: import('@playwright/test').Page): Promise<void> {
  await createRoom(page, '预女猎白');
  await page.locator('.bot-box').getByRole('button', { name: /补满空位/ }).click();
  await page.getByRole('button', { name: '发牌', exact: true }).click();
  await page.getByRole('button', { name: /开始游戏/ }).click();
  await expect(page.locator('body[data-time="night"]')).toBeAttached({ timeout: 30_000 });
}

const states = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as Record<string, AudioContext[]>).__contexts ?? []).map((c) => c.state));

test('sound cut off by the system mid-game comes back with one tap (a fresh engine, as a reload would)', async ({ page }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await watchContexts(page);
  await startNight(page);
  const banner = page.locator('.audio-banner');
  await expect(banner).toHaveCount(0);
  expect(await states(page)).toEqual(['running']);
  // iOS pauses the page's audio engine (a call, Siri, a notification sound …)
  await page.evaluate(() => (window as unknown as Record<string, AudioContext[]>).__contexts[0].suspend());
  await expect(banner).toHaveText('🔈 声音被系统打断了，点此恢复');
  await banner.click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => states(page)).toEqual(['closed', 'running']);
  // the night music plays again on the new engine
  await expect(page.locator('html')).toHaveAttribute('data-night-music', /^(track|synth)$/);
  await page.getByRole('button', { name: '菜单' }).click();
  await page.locator('.diag summary').click();
  await expect(page.locator('.diag')).toContainText('已重建 1 次');
  expect(errors).toEqual([]);
});

test('iPhone: back from the background, the next tap rebuilds the sound', async ({ page }, ti) => {
  test.skip(!/iphone|ipad/i.test(ti.project.use.userAgent ?? ''), 'iOS only');
  const errors: string[] = [];
  watchErrors(page, errors);
  await watchContexts(page);
  await startNight(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const banner = page.locator('.audio-banner');
  await expect(banner).toHaveText('🔈 声音被系统打断了，点此恢复');
  await banner.click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => states(page)).toEqual(['closed', 'running']);
  expect(errors).toEqual([]);
});
