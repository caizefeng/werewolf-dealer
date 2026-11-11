// Night music on the owner's phone: the recorded track (client/public/music/night.mp3, git-ignored and
// therefore optional) plays when the instance has one; without it the synthesized ambience plays.
import { expect, test, type Page } from '@playwright/test';
import { createRoom, watchErrors } from './helpers.ts';

async function nightMusic(page: Page): Promise<string | undefined> {
  const box = page.locator('.bot-box');
  await box.getByRole('button', { name: /补满空位/ }).click();
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  await page.getByRole('button', { name: '发牌', exact: true }).click();
  await page.getByRole('button', { name: /开始游戏/ }).click();
  await expect(page.locator('body[data-time="night"]')).toBeAttached({ timeout: 30_000 });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-night-music', /^(track|synth)$/, { timeout: 15_000 });
  return (await html.getAttribute('data-night-music')) ?? undefined;
}

test('night music: the recorded track when the instance has one', async ({ page }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await createRoom(page, '预女猎白');
  const hasTrack = (await page.request.get('/music/night.mp3')).ok();
  expect(await nightMusic(page)).toBe(hasTrack ? 'track' : 'synth');
  // the owner turns the music off and on again from the menu: it stops and comes back
  await page.getByRole('button', { name: '菜单' }).click();
  const music = page.locator('.field', { hasText: '夜间背景音乐' }).getByRole('switch');
  await music.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-night-music', /.+/);
  await music.click();
  await expect(page.locator('html')).toHaveAttribute('data-night-music', hasTrack ? 'track' : 'synth');
  expect(errors).toEqual([]);
});

test('night music: a slow download starts with the synth and crossfades to the track', async ({ page }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  test.skip(!(await page.request.get('/music/night.mp3')).ok(), 'this instance has no recorded track');
  // the track arrives 8 s after it was asked for, so the night begins before it is ready
  await page.route('**/music/night.mp3', async (r) => {
    const res = await r.fetch();
    await new Promise((x) => setTimeout(x, 8000));
    await r.fulfill({ response: res });
  });
  await createRoom(page, '预女猎白');
  expect(await nightMusic(page)).toBe('synth');
  await expect(page.locator('html')).toHaveAttribute('data-night-music', 'track', { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('night music: the synthesized ambience when there is no track', async ({ page }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.route('**/music/night.mp3', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await createRoom(page, '预女猎白');
  expect(await nightMusic(page)).toBe('synth');
  expect(errors).toEqual([]);
});
