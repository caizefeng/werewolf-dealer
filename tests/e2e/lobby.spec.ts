// Leaving a room: 退出 in the lobby's bottom bar (and 退出房间 in the menu), for players and the owner.
import { expect, test } from '@playwright/test';
import { closePlayers, createRoom, newPlayer, watchErrors } from './helpers.ts';

test.afterEach(closePlayers);

test('退出: a player leaves the lobby and frees the seat; the owner leaves and comes back as owner', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  page.on('dialog', (d) => void d.accept());
  const { url, roomId } = await createRoom(page, '预女猎白');
  const p2 = await newPlayer(browser, ti, url, '小明', 2);
  watchErrors(p2, errors);
  p2.on('dialog', (d) => void d.accept());
  await expect(page.getByRole('button', { name: '2号 小明', exact: true })).toBeVisible();

  // the player leaves from the bottom bar: back on the home page, seat 2 is free again
  await p2.getByRole('button', { name: '退出', exact: true }).click();
  await expect(p2.getByRole('button', { name: '创建房间' })).toBeVisible();
  expect(new URL(p2.url()).pathname).toBe('/');
  await expect(page.getByRole('button', { name: '2号 空位', exact: true })).toBeVisible();

  // the owner leaves from the menu; the room stays and the owner comes back with the owner controls
  await page.getByRole('button', { name: '菜单' }).click();
  await page.getByRole('button', { name: '退出房间（返回首页）' }).click();
  await expect(page.getByRole('button', { name: '创建房间' })).toBeVisible();
  expect((await page.request.get(`/api/rooms/${roomId}`)).ok()).toBe(true);
  await page.goto(url);
  await expect(page.getByRole('button', { name: '1号 空位', exact: true })).toBeVisible();
  await expect(page.locator('.bot-box')).toBeVisible();
  expect(errors).toEqual([]);
});
