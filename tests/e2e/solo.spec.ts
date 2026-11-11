// Playing alone: the owner fills the table with the built-in bots (server/bots.ts) from the lobby and
// plays a whole 预女猎白 game as 预言家 on the phone; the bots play every other seat.
import { expect, test, type Page } from '@playwright/test';
import type { RoleId } from '../../shared/roles.ts';
import { Bot } from './bots.ts';
import { autoSpeech, createRoom, PORT, shot, watchErrors } from './helpers.ts';

test.describe.configure({ timeout: 720_000 });

/** clicks `name` if it is on screen right now (the game moves on by itself, so races are fine) */
async function tap(p: Page, name: string | RegExp): Promise<boolean> {
  const b = p.getByRole('button', { name, exact: typeof name === 'string' }).first();
  try {
    if (!(await b.isVisible()) || !(await b.isEnabled())) return false;
    await b.click({ timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

test('solo: the owner fills the table with bots and plays a whole game as 预言家', async ({ page }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  page.on('dialog', (d) => void d.accept());
  const { roomId } = await createRoom(page, '预女猎白');

  // the lobby offers bots to the owner
  const box = page.locator('.bot-box');
  await expect(box.getByRole('button', { name: '补满空位（11）' })).toBeVisible();
  await shot(page, 'solo-1-lobby', ti);
  await box.getByRole('button', { name: '补满空位（11）' }).click();
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  await expect(page.locator('.seat.bot')).toHaveCount(11);
  await expect(box).toContainText('机器人 · 11个');
  await expect(page.getByRole('button', { name: '12号 机器人', exact: true })).toBeVisible();
  // one bot out from the owner menu, then one back on the same seat
  await page.getByRole('button', { name: '菜单' }).click();
  await page.getByRole('button', { name: '12号 机器人 · 移出' }).click();
  await expect(page.locator('.seat.bot')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '12号 空位', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '菜单' }).click();
  await page.getByRole('button', { name: '12号 空位 · 放一个机器人' }).click();
  await expect(page.locator('.seat.bot')).toHaveCount(11);
  await shot(page, 'solo-2-full', ti);

  // deal fixed cards through the test hook so that the phone holds the 预言家
  const ownerKey = await page.evaluate((id) => localStorage.getItem(`wwd.owner.${id}`), roomId);
  const admin = new Bot(`admin-${roomId}-xxxxxxxxxxxx`);
  admin.auto = false;
  await admin.connect(PORT, roomId, '管理', ownerKey!);
  const seats: RoleId[] = ['seer', 'wolf', 'villager', 'witch', 'wolf', 'villager', 'hunter', 'wolf', 'villager', 'whitegod', 'wolf', 'villager'];
  admin.send({ t: 'owner', cmd: { type: 'debugDeal', seats } });
  // every bot looks at its card by itself
  await expect(page.getByText('已查看身份：11/12')).toBeVisible({ timeout: 20_000 });
  admin.close();
  await page.getByRole('button', { name: /开始游戏/ }).click();

  // play the 预言家: check someone every night, stay off the sheriff race, vote, end my speeches
  const stop = autoSpeech(page);
  let checks = 0;
  let votes = 0;
  const deadline = Date.now() + 600_000;
  while (!(await page.locator('.result-panel').isVisible())) {
    expect(Date.now(), 'the game did not end').toBeLessThan(deadline);
    if (await page.getByText('请选择你要查验的玩家').isVisible()) {
      const target = page.locator('.seat-picker .pick').first();
      if (await target.isVisible().catch(() => false)) {
        await target.click({ timeout: 1000 }).catch(() => {});
        if (await tap(page, /^查验 \d+号$/)) {
          await expect(page.getByText(/^\d+号玩家的身份是：(好人|狼人)$/)).toBeVisible();
          if (checks++ === 0) await shot(page, 'solo-3-check', ti);
        }
      }
    }
    await tap(page, '不上警');
    if (await page.locator('.panel.action h3', { hasText: /投票/ }).isVisible().catch(() => false)) {
      if (!(await page.getByText(/^你已(弃票|投给)/).isVisible().catch(() => false))) {
        await page.locator('.seat-picker .pick').first().click({ timeout: 1000 }).catch(() => {});
        if (await tap(page, /^投给\d+号$/) && votes++ === 0) await shot(page, 'solo-4-vote', ti);
      }
    }
    await page.waitForTimeout(400);
  }
  await stop();
  expect(checks).toBeGreaterThan(0);
  // the end screen shows every card; the bots keep their name
  await expect(page.locator('.result-panel')).toContainText(/阵营胜利|平局/);
  await expect(page.locator('.result-panel .rname', { hasText: /^机器人$/ })).toHaveCount(11);
  await expect(page.locator('.result-panel .rname', { hasText: /^房主$/ })).toHaveCount(1);
  await shot(page, 'solo-5-result', ti);
  expect(errors).toEqual([]);
});
