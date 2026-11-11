// Board-specific special roles driven through the real UI on phone profiles:
// 预女猎白混 (混血儿 + 白神), 机械狼通灵师 (机械狼 + 通灵师), 盗宝大师 (盗宝大师 + 蒙面人).
import { expect, test } from '@playwright/test';
import type { RoomView } from '../../shared/types.ts';
import type { Bot } from './bots.ts';
import { PORT, autoSpeech, botTakeover, createRoom, fillWithBots, newPlayer, pick, shot, watchErrors, closePlayers } from './helpers.ts';

test.afterEach(closePlayers);

void PORT;

const voteFor = (target: number) => (_seat: number, candidates: number[], v: RoomView) => {
  const ph = v.game!.phase;
  if (ph.kind === 'vote' && (ph.context === 'exile' || ph.context === 'exilePk') && candidates.includes(target)) return target;
  return null;
};

test('预女猎白混: 混血儿 picks a 榜样, 白神 flips when exiled', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const { url, roomId } = await createRoom(page, '预女猎白混');
  const wg = await newPlayer(browser, ti, url, '白神玩家', 4);
  watchErrors(wg, errors);
  const strategy = { wolfTarget: (o: number[]) => (o.includes(9) ? 9 : (o.find((x) => x > 8) ?? null)), vote: voteFor(4) };
  const { bots, admin } = await fillWithBots(page, roomId, [2, 3, 5, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  admin.send({
    t: 'owner',
    cmd: { type: 'debugDeal', seats: ['mixed', 'witch', 'hunter', 'whitegod', 'wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'seer'] },
  });
  await page.getByRole('button', { name: /开始游戏/ }).click();

  await expect(page.getByText('请选择你的榜样')).toBeVisible({ timeout: 60000 });
  await pick(page, 5).click();
  await shot(page, 'b1-mixed-pick', ti);
  await page.getByRole('button', { name: '确认榜样 5号' }).click();
  await expect(page.getByText('你选择了5号作为榜样。')).toBeVisible();

  await expect(wg.getByText('白神请确认身份')).toBeVisible({ timeout: 60000 });
  await shot(wg, 'b2-whitegod-confirm', ti);
  await wg.getByRole('button', { name: '知道了' }).click();

  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await wg.getByRole('button', { name: '不上警', exact: true }).click();
  const stops = [autoSpeech(page), autoSpeech(wg)];

  await expect(page.getByText('放逐投票').first()).toBeVisible({ timeout: 90000 });
  await pick(page, 4).click();
  await page.getByRole('button', { name: '投给4号' }).click();
  await expect(wg.getByText('你已出局')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.seat', { hasText: '白神玩家' }).locator('.seat-role')).toContainText('白神');
  await shot(page, 'b3-whitegod-flipped', ti);
  await wg.getByRole('button', { name: '不发动' }).click();

  for (const s of stops) s();
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(wg, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 180000 });
  await expect(page.locator('.rrow').first()).toContainText('榜样：5号');
  await shot(page, 'b4-mixed-result', ti);
  for (const b of [...bots, ...take, admin] as Bot[]) b.close();
  expect(errors).toEqual([]);
});

test('机械狼通灵师: 机械狼 learns and poisons, 通灵师 sees the learned identity', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const { url, roomId } = await createRoom(page, '机械狼通灵师');
  const ps = await newPlayer(browser, ti, url, '通灵师玩家', 2);
  watchErrors(ps, errors);
  const strategy = { wolfTarget: (o: number[]) => (o.includes(12) ? 12 : (o.find((x) => x > 8) ?? null)), vote: voteFor(6) };
  const { bots, admin } = await fillWithBots(page, roomId, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  admin.send({
    t: 'owner',
    cmd: { type: 'debugDeal', seats: ['mechwolf', 'psychic', 'witch', 'hunter', 'guard', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'] },
  });
  await page.getByRole('button', { name: /开始游戏/ }).click();

  await expect(page.getByText('请选择你要学习的玩家')).toBeVisible({ timeout: 60000 });
  await pick(page, 3).click();
  await page.getByRole('button', { name: '学习 3号' }).click();
  await expect(page.getByText('3号玩家的身份是：女巫')).toBeVisible();
  await expect(page.getByText(/你获得的机械技能：拥有一瓶毒药/)).toBeVisible();
  await shot(page, 'm1-mech-learn', ti);

  await expect(ps.getByText('结果为具体身份。')).toBeVisible({ timeout: 60000 });
  await pick(ps, 1).click();
  await ps.getByRole('button', { name: '查验 1号' }).click();
  await expect(ps.getByText('1号玩家的身份是：女巫')).toBeVisible();
  await shot(ps, 'm2-psychic-sees-learned', ti);

  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await ps.getByRole('button', { name: '不上警', exact: true }).click();
  const stops = [autoSpeech(page), autoSpeech(ps)];
  await expect(page.getByText('放逐投票').first()).toBeVisible({ timeout: 90000 });
  await pick(page, 6).click();
  await page.getByRole('button', { name: '投给6号' }).click();
  await pick(ps, 6).click();
  await ps.getByRole('button', { name: '投给6号' }).click();

  // night 2: no knife while the pack lives, then the mechanical poison
  await expect(page.getByText('你的带刀状态：不能带刀（狼队还有存活的狼人）')).toBeVisible({ timeout: 90000 });
  await shot(page, 'm3-mech-knife-status', ti);
  await page.getByRole('button', { name: '知道了' }).click();
  await expect(page.getByText('机械技能：拥有一瓶毒药')).toBeVisible({ timeout: 60000 });
  await pick(page, 10).click();
  await page.getByRole('button', { name: '毒杀 10号' }).click();
  await expect(page.locator('.seat', { hasText: '机器人癸' }).locator('.seat-dead')).toBeVisible({ timeout: 60000 });

  for (const s of stops) s();
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(ps, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 180000 });
  await expect(page.locator('.rrow').first()).toContainText('学习：女巫');
  await shot(page, 'm4-result', ti);
  for (const b of [...bots, ...take, admin] as Bot[]) b.close();
  expect(errors).toEqual([]);
});

test('盗宝大师: 首夜禁刀, card choice with a skill target, the poisoned 蒙面人 goes out after speaking', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const { url, roomId } = await createRoom(page, '盗宝大师');
  const mk = await newPlayer(browser, ti, url, '蒙面玩家', 3);
  watchErrors(mk, errors);
  const strategy = { wolfTarget: (o: number[]) => (o.includes(9) ? 9 : (o.find((x) => x > 8) ?? null)), vote: () => null };
  const { bots, admin } = await fillWithBots(page, roomId, [2, 4, 5, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  admin.send({
    t: 'owner',
    cmd: {
      type: 'debugDeal',
      seats: ['treasure', 'psychic', 'masked', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'],
      buried: ['poisoner', 'villager', 'wolf'],
    },
  });
  // the role card shows the buried cards
  await page.getByRole('button', { name: '查看我的身份' }).click();
  await page.getByText('点击翻开身份牌').click();
  await expect(page.locator('.rc-info')).toContainText('毒师');
  await shot(page, 't1-treasure-card', ti);
  await page.locator('.modal').getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: /开始游戏/ }).click();

  await expect(page.getByText('盗宝大师请选择今晚使用的身份牌')).toBeVisible({ timeout: 60000 });
  await page.locator('.tcard', { hasText: '毒师' }).click();
  await expect(page.getByText('使用毒药（可以不用）')).toBeVisible();
  await pick(page, 3).click();
  await shot(page, 't2-treasure-pick', ti);
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('今晚使用的身份牌：毒师')).toBeVisible();

  await expect(mk.getByText('蒙面人请确认身份')).toBeVisible({ timeout: 60000 });
  await mk.getByRole('button', { name: '知道了' }).click();

  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await mk.getByRole('button', { name: '不上警', exact: true }).click();
  const stopOwner = autoSpeech(page);
  // 首夜禁刀: nobody was knifed, and the poisoned 蒙面人 is not announced, so the night is peaceful;
  // the 蒙面人 is still alive and knows it is wounded
  await expect(mk.locator('.speaker', { hasText: /^发言：/ })).toBeVisible({ timeout: 90000 });
  await expect(page.locator('.seat', { hasText: '机器人壬' }).locator('.seat-dead')).toHaveCount(0);
  await mk.getByRole('button', { name: '技能' }).click();
  await expect(mk.getByText('负伤：今天你发言结束后出局。')).toBeVisible();
  await shot(mk, 't3-masked-wounded', ti);
  await mk.locator('.modal-close').click();
  // the 蒙面人 speaks, then goes out
  const end = mk.getByRole('button', { name: '结束发言', exact: true });
  await expect(end).toBeVisible({ timeout: 90000 });
  await end.click();
  await expect(page.locator('.seat', { hasText: '蒙面玩家' }).locator('.seat-dead')).toBeVisible({ timeout: 30000 });
  await shot(page, 't4-masked-out', ti);
  // the public record explains the delayed death
  await page.getByRole('button', { name: '记录' }).click();
  await expect(page.locator('.history')).toContainText('3号出局（第1夜负伤，发言后出局）');
  await expect(page.locator('.history')).toContainText('第1夜：平安夜');
  await page.locator('.modal-close').click();

  stopOwner();
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(mk, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 240000 });
  await expect(page.locator('.result-panel')).toContainText('底牌：毒师、普通村民、狼人');
  await shot(page, 't5-result', ti);
  for (const b of [...bots, ...take, admin] as Bot[]) b.close();
  expect(errors).toEqual([]);
});
