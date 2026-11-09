// The new boards' special roles driven through the real UI on phone profiles:
// 狼美骑士 (狼美人 + 骑士), 假面舞会 (舞者 + 假面), 诡术之境 (魔术师 + 定序王子), 魔幻对决 (狼术师), 狼女孩.
// Bots are named by seat (see `fillWithBots`): 1 甲, 2 乙, 3 丙, … 12 丑.
import { expect, test, type Page } from '@playwright/test';
import { ROLES, type RoleId } from '../../shared/roles.ts';
import type { RoomView } from '../../shared/types.ts';
import type { Bot, Strategy } from './bots.ts';
import { autoSpeech, botTakeover, createRoom, fillWithBots, newPlayer, pick, shot, watchErrors, closePlayers } from './helpers.ts';

test.afterEach(closePlayers);
// each test plays its game to the end
test.describe.configure({ timeout: 420_000 });

const acceptDialogs = (p: Page) => p.on('dialog', (d) => void d.accept());
const BOT = ['', '甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '子', '丑'];
const seatOf = (p: Page, seat: number) => p.locator('.seat', { hasText: `机器人${BOT[seat]}` });
const deal = (admin: Bot, seats: RoleId[]) => admin.send({ t: 'owner', cmd: { type: 'debugDeal', seats } });
/** once the scripted part is over, the bots vote out good players so the game reaches 屠边 quickly */
const endgame = (strategy: Strategy, seats: RoleId[]) => {
  strategy.vote = (me, c) => c.find((x) => x !== me && ROLES[seats[x - 1]].faction !== 'wolf') ?? null;
};

test('狼美骑士: 狼美人 charms, the knight duels a wolf from the hidden skill menu', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  acceptDialogs(page);
  const { url, roomId } = await createRoom(page, '狼美骑士');
  const beauty = await newPlayer(browser, ti, url, '狼美玩家', 5);
  watchErrors(beauty, errors);
  const strategy: Strategy = { wolfTarget: (o: number[]) => (o.includes(9) ? 9 : (o.find((x) => x > 8) ?? null)), vote: () => null };
  const { bots, admin } = await fillWithBots(page, roomId, [2, 3, 4, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  const seats: RoleId[] = ['knight', 'seer', 'witch', 'guard', 'wolfbeauty', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];
  deal(admin, seats);
  await page.getByRole('button', { name: /开始游戏/ }).click();

  // the beauty joins the pack's kill (she cannot be knifed herself), then charms alone
  await expect(beauty.getByText('狼人请互相确认身份，并选择今晚要击杀的玩家')).toBeVisible({ timeout: 60000 });
  await expect(pick(beauty, 5)).toHaveCount(0);
  await pick(beauty, 9).click();
  await beauty.getByRole('button', { name: '确认击杀9号' }).click();
  await expect(beauty.getByText('请选择魅惑目标')).toBeVisible({ timeout: 60000 });
  await pick(beauty, 10).click();
  await shot(beauty, 'n1-beauty-charm', ti);
  await beauty.getByRole('button', { name: '魅惑 10号' }).click();
  await expect(beauty.getByText('已确认：10号')).toBeVisible();
  // at night the knight's hidden skill menu explains why the duel is unavailable
  await page.getByRole('button', { name: '技能' }).click();
  await expect(page.locator('.modal').getByText('只能在放逐发言环节决斗')).toBeVisible();
  await page.locator('.modal-close').click();

  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await beauty.getByRole('button', { name: '不上警', exact: true }).click();
  const stopB = autoSpeech(beauty);
  // the knight duels during the discussion
  await expect(page.locator('.speaker', { hasText: /^发言：/ })).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: '技能' }).click();
  await expect(page.getByText('翻牌与一名玩家决斗', { exact: false })).toBeVisible();
  await page.locator('.modal').locator('.pick:has(b:text-is("6"))').click();
  await shot(page, 'n2-knight-duel', ti);
  await page.locator('.modal').getByRole('button', { name: '决斗6号' }).click();
  await expect(seatOf(page, 6).locator('.seat-dead')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.seat', { hasText: '房主' }).locator('.seat-role')).toContainText('骑士');
  // the duelled wolf has no last words: night falls at once
  await expect(page.locator('body[data-time="night"]')).toBeAttached({ timeout: 30000 });
  await shot(page, 'n3-after-duel', ti);

  stopB();
  endgame(strategy, seats);
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(beauty, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 240000 });
  for (const b of [...bots, ...take, admin]) b.close();
  expect(errors).toEqual([]);
});

test('假面舞会: 舞者 dances with two others, 假面 verifies the floor and masks a wolf', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const { url, roomId } = await createRoom(page, '假面舞会');
  const masque = await newPlayer(browser, ti, url, '假面玩家', 2);
  watchErrors(masque, errors);
  // night 1 the wolves knife 12; night 2 they knife 9, who is on the (knife-immune) floor
  const strategy: Strategy = { wolfTarget: (o: number[]) => [12, 9].find((x) => o.includes(x)) ?? null, vote: () => null };
  const { bots, admin } = await fillWithBots(page, roomId, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  const seats: RoleId[] = ['dancer', 'masque', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'whitegod', 'villager', 'villager', 'villager', 'villager'];
  deal(admin, seats);
  await page.getByRole('button', { name: /开始游戏/ }).click();
  // night 1: the 假面 only confirms its identity
  await expect(masque.getByText('你是假面：第二晚起可以验证舞池并赐予面具；狼队全部出局后由你开刀。')).toBeVisible({ timeout: 60000 });
  await masque.getByRole('button', { name: '知道了' }).click();
  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await masque.getByRole('button', { name: '不上警', exact: true }).click();
  await expect(seatOf(page, 12).locator('.seat-dead')).toBeVisible({ timeout: 60000 });
  const stops = [autoSpeech(page), autoSpeech(masque)];

  // night 2: the dancer joins the floor with 9 and the wolf 3
  await expect(page.getByText('请选择三名共舞的玩家')).toBeVisible({ timeout: 120000 });
  for (const s of [1, 9, 3]) await pick(page, s).click();
  await expect(page.getByText('已选 3/3')).toBeVisible();
  await shot(page, 'n4-dancer-pick', ti);
  await page.getByRole('button', { name: /^确认共舞/ }).click();
  await expect(page.getByText('已确认：1号、9号、3号')).toBeVisible();
  await expect(masque.getByText('① 选择验证目标（是否在舞池中）：')).toBeVisible({ timeout: 60000 });
  await pick(masque, 3).click();
  await masque.getByRole('button', { name: '验证 3号' }).click();
  await expect(masque.getByText('3号玩家今晚在舞池中。')).toBeVisible();
  await expect(masque.getByText('② 选择赐予面具的目标（可以不给）：')).toBeVisible();
  await pick(masque, 3).click();
  await shot(masque, 'n5-masque', ti);
  await masque.getByRole('button', { name: '确认' }).click();
  await expect(masque.getByText('面具：3号')).toBeVisible();
  // the masked wolf dances as good (nobody dies on the floor) and the floor is immune to the knife on 9
  await expect(page.getByText('昨天晚上是平安夜。').first()).toBeVisible({ timeout: 90000 });
  await expect(seatOf(page, 9).locator('.seat-dead')).toHaveCount(0);
  await expect(seatOf(page, 3).locator('.seat-dead')).toHaveCount(0);

  for (const s of stops) s();
  endgame(strategy, seats);
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(masque, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 300000 });
  for (const b of [...bots, ...take, admin]) b.close();
  expect(errors).toEqual([]);
});

test('诡术之境: 魔术师 swaps the knife onto another player, 定序王子 voids an exile', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const { url, roomId } = await createRoom(page, '诡术之境');
  const prince = await newPlayer(browser, ti, url, '王子玩家', 2);
  watchErrors(prince, errors);
  acceptDialogs(prince);
  const strategy: Strategy = {
    wolfTarget: (o: number[]) => (o.includes(9) ? 9 : (o.find((x) => x > 8) ?? null)),
    // first the bots exile 11; once the prince has flipped they vote the wolf 4 instead
    vote: (_s: number, c: number[], v: RoomView) => {
      const want = v.seats[1].revealed === 'prince' ? 4 : 11;
      return c.includes(want) ? want : null;
    },
  };
  const { bots, admin } = await fillWithBots(page, roomId, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  const seats: RoleId[] = ['magician', 'prince', 'trickster', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'villager', 'villager', 'villager', 'villager'];
  deal(admin, seats);
  await page.getByRole('button', { name: /开始游戏/ }).click();
  await expect(page.getByText('请选择交换号码的两名玩家')).toBeVisible({ timeout: 60000 });
  await pick(page, 9).click();
  await pick(page, 10).click();
  await shot(page, 'n6-magician-swap', ti);
  await page.getByRole('button', { name: /^交换/ }).click();
  await expect(page.getByText('你交换了9号和10号。')).toBeVisible();

  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await prince.getByRole('button', { name: '不上警', exact: true }).click();
  // the wolves knifed 9, but the swap sent the knife to 10
  await expect(seatOf(page, 10).locator('.seat-dead')).toBeVisible({ timeout: 60000 });
  await expect(seatOf(page, 9).locator('.seat-dead')).toHaveCount(0);
  const stops = [autoSpeech(page)];
  const stopP = autoSpeech(prince);
  await expect(prince.locator('.panel h3', { hasText: '放逐投票' })).toBeVisible({ timeout: 90000 });
  stopP();
  await pick(prince, 11).click();
  await prince.getByRole('button', { name: '投给11号' }).click();
  // the result waits for the prince's decision (a fixed window, so it reveals nothing)
  await expect(prince.getByText('你是定序王子：可以翻牌发动技能', { exact: false })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('等待定序王子确认是否发动技能…')).toBeVisible();
  await prince.getByRole('button', { name: '发动技能' }).click();
  await expect(prince.locator('.speaker', { hasText: '定序王子发言' })).toBeVisible({ timeout: 15000 });
  await shot(prince, 'n7-prince-speech', ti);
  await expect(prince.locator('.seat.me .seat-role')).toContainText('定序王子');
  await prince.getByRole('button', { name: '结束发言', exact: true }).click();
  // the re-vote exiles the wolf 4 instead of 11; no second window (the skill is spent)
  await expect(seatOf(page, 4).locator('.seat-dead')).toBeVisible({ timeout: 60000 });
  await expect(seatOf(page, 11).locator('.seat-dead')).toHaveCount(0);

  for (const s of stops) s();
  endgame(strategy, seats);
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(prince, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 300000 });
  for (const b of [...bots, ...take, admin]) b.close();
  expect(errors).toEqual([]);
});

test('魔幻对决: 狼术师 swaps two seats on night 2 and the knife lands on the other one', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const { url, roomId } = await createRoom(page, '魔幻对决');
  const wizard = await newPlayer(browser, ti, url, '狼术玩家', 5);
  watchErrors(wizard, errors);
  const strategy: Strategy = { wolfTarget: (o: number[]) => [10, 9].find((x) => o.includes(x)) ?? null, vote: () => null };
  const { bots, admin } = await fillWithBots(page, roomId, [2, 3, 4, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  const seats: RoleId[] = ['magician', 'psychic', 'witch', 'hunter', 'wolfwizard', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'villager'];
  deal(admin, seats);
  await page.getByRole('button', { name: /开始游戏/ }).click();
  // this board's magician starts on night 2: night 1 only confirms the card
  await expect(page.getByText('你是魔术师：第二晚起每晚可以交换两名玩家的号码。')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '知道了' }).click();
  await expect(wizard.getByText('狼人请互相确认身份，并选择今晚要击杀的玩家')).toBeVisible({ timeout: 60000 });
  await pick(wizard, 10).click();
  await wizard.getByRole('button', { name: '确认击杀10号' }).click();

  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await wizard.getByRole('button', { name: '不上警', exact: true }).click();
  await expect(seatOf(page, 10).locator('.seat-dead')).toBeVisible({ timeout: 60000 });
  const stops = [autoSpeech(page), autoSpeech(wizard)];

  // night 2: the magician passes, the 狼术师 swaps 9 and 12, then the pack knifes 9
  await expect(page.getByText('请选择交换号码的两名玩家')).toBeVisible({ timeout: 120000 });
  await page.getByRole('button', { name: '不交换' }).click();
  await expect(wizard.getByText('请选择再次更换座位的两名玩家')).toBeVisible({ timeout: 60000 });
  await pick(wizard, 9).click();
  await pick(wizard, 12).click();
  await shot(wizard, 'n8-wolfwizard-swap', ti);
  await wizard.getByRole('button', { name: /^更换/ }).click();
  await expect(wizard.getByText('请选择今晚要击杀的玩家', { exact: true })).toBeVisible({ timeout: 60000 });
  await pick(wizard, 9).click();
  await wizard.getByRole('button', { name: '确认击杀9号' }).click();
  await expect(seatOf(page, 12).locator('.seat-dead')).toBeVisible({ timeout: 90000 });
  await expect(seatOf(page, 9).locator('.seat-dead')).toHaveCount(0);

  for (const s of stops) s();
  endgame(strategy, seats);
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(wizard, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 300000 });
  for (const b of [...bots, ...take, admin]) b.close();
  expect(errors).toEqual([]);
});

test('狼女孩: 首夜禁刀, the confession reaches only its target, 自爆 takes the confessed player along', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const { url, roomId } = await createRoom(page, '狼女孩');
  const girl = await newPlayer(browser, ti, url, '狼女孩玩家', 5);
  watchErrors(girl, errors);
  acceptDialogs(girl);
  const strategy: Strategy = { wolfTarget: (o: number[]) => (o.includes(9) ? 9 : (o.find((x) => x > 8) ?? null)), vote: () => null };
  const { bots, admin } = await fillWithBots(page, roomId, [2, 3, 4, 6, 7, 8, 9, 10, 11, 12], strategy);
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  // 1平民(房主) 2预言家 3毒师 4猎人 5狼女孩 6守卫 7-9狼 10-12平民
  const seats: RoleId[] = ['villager', 'seer', 'poisoner', 'hunter', 'wolfgirl', 'guard', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager'];
  deal(admin, seats);
  await page.getByRole('button', { name: /开始游戏/ }).click();

  // night 1: the pack only meets (首夜禁刀)
  await expect(girl.getByText('狼人请互相确认身份（首夜禁刀）')).toBeVisible({ timeout: 60000 });
  await expect(girl.locator('.seat-picker')).toHaveCount(0);
  await shot(girl, 'n9-wolves-no-knife', ti);
  await girl.getByRole('button', { name: '确认', exact: true }).click();
  // then she confesses, never to her own pack
  await expect(girl.getByText('请选择你要表白的玩家')).toBeVisible({ timeout: 60000 });
  await expect(pick(girl, 7)).toHaveCount(0);
  await pick(girl, 1).click();
  await shot(girl, 'n10-wolfgirl-confess', ti);
  await girl.getByRole('button', { name: '表白 1号' }).click();
  await expect(girl.getByText('你向1号表白了。你不会知道对方是否接受。')).toBeVisible();
  // the confessed villager (the owner) learns it on their own phone
  await expect(page.getByText('狼女孩向你表白了：你是平民，现在成为狼混，与狼人阵营共同胜利。')).toBeVisible({ timeout: 60000 });
  await shot(page, 'n11-confessed', ti);
  await page.getByRole('button', { name: '知道了' }).click();

  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '不上警', exact: true }).click();
  await girl.getByRole('button', { name: '不上警', exact: true }).click();
  await expect(page.getByText('昨天晚上是平安夜。').first()).toBeVisible({ timeout: 60000 });
  const stop = autoSpeech(page);
  // she self-destructs during the discussion and the owner goes out with her
  await expect(girl.locator('.speaker', { hasText: /^发言：/ })).toBeVisible({ timeout: 60000 });
  await girl.getByRole('button', { name: '技能' }).click();
  await expect(girl.locator('.modal').getByText('你的表白对象1号会随你一起出局（没有遗言）。')).toBeVisible();
  await shot(girl, 'n12-wolfgirl-selfdestruct', ti);
  await girl.locator('.modal').getByRole('button', { name: '自爆', exact: true }).click();
  await expect(page.getByText('5号玩家自爆，翻牌为狼女孩，表白对象1号玩家随之出局。').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.seat', { hasText: '房主' }).locator('.seat-dead')).toBeVisible();
  await expect(page.locator('.seat', { hasText: '狼女孩玩家' }).locator('.seat-role')).toContainText('狼女孩');
  await expect(page.locator('body[data-time="night"]')).toBeAttached({ timeout: 30000 });

  stop();
  endgame(strategy, seats);
  const take = [await botTakeover(page, roomId, strategy), await botTakeover(girl, roomId, strategy)];
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 300000 });
  await expect(page.locator('.result-panel .rnote', { hasText: '狼混' })).toHaveCount(1);
  for (const b of [...bots, ...take, admin]) b.close();
  expect(errors).toEqual([]);
});
