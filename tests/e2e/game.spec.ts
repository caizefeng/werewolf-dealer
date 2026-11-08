import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { Bot } from './bots.ts';

const PORT = 3317;
const SEATS = ['seer', 'witch', 'hunter', 'guard', 'wolf', 'wolf', 'wolf', 'whitewolfking', 'villager', 'villager', 'villager', 'villager'];
const BOT_NAMES = ['', '', '猎户', '卫兵', '', '灰狼', '黑狼', '白狼', '张三', '李四', '王五', '赵六'];

async function shot(page: Page, name: string, ti: TestInfo): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow on ${name}`).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/shots/${ti.project.name}/${name}.png`, animations: 'disabled' });
}

async function newPlayer(browser: Browser, ti: TestInfo, url: string, name: string, seat: number): Promise<Page> {
  const u = ti.project.use;
  const ctx = await browser.newContext({
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    baseURL: u.baseURL,
  });
  const p = await ctx.newPage();
  await p.goto(url);
  await expect(p.getByText('请输入你的昵称')).toBeVisible();
  await p.locator('.modal input').fill(name);
  await p.getByRole('button', { name: '确定' }).click();
  await p.getByRole('button', { name: `${seat}号 空位`, exact: true }).click();
  await expect(p.getByText('你坐在')).toBeVisible();
  return p;
}

/** keeps clicking "end my speech" style buttons on a page */
function autoSpeech(p: Page): () => void {
  let on = true;
  const loop = async () => {
    while (on) {
      for (const name of ['结束发言', '遗言结束']) {
        const b = p.getByRole('button', { name, exact: true });
        try {
          if (await b.isVisible()) await b.click({ timeout: 1000 });
        } catch {
          /* raced with a state change */
        }
      }
      await p.waitForTimeout(250);
    }
  };
  void loop();
  return () => {
    on = false;
  };
}

const pick = (p: Page, seat: number) => p.locator(`.seat-picker .pick:has(b:text-is("${seat}"))`);

test('a full game on phones: owner, witch and wolf in browsers, bots elsewhere', async ({ page, browser }, ti) => {
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text());
    });
  };
  watch(page);

  // ── home & create ──
  await page.goto('/');
  await expect(page.getByRole('button', { name: '创建房间' })).toBeVisible();
  await shot(page, '01-home', ti);
  await page.getByPlaceholder('其他玩家看到的名字').fill('房主');
  await page.getByRole('button', { name: '创建房间' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const url = page.url();
  const roomId = url.split('/r/')[1];
  await expect(page.getByText('等待玩家入座')).toBeVisible();
  await page.getByRole('button', { name: '1号 空位', exact: true }).click();
  await expect(page.getByText('你坐在')).toBeVisible();
  await shot(page, '02-lobby', ti);

  const witch = await newPlayer(browser, ti, url, '女巫玩家', 2);
  const wolf = await newPlayer(browser, ti, url, '狼人玩家', 5);
  watch(witch);
  watch(wolf);

  // ── bots ──
  const ownerKey = await page.evaluate((id) => localStorage.getItem(`wwd.owner.${id}`), roomId);
  expect(ownerKey).toBeTruthy();
  const admin = new Bot('admin-device-xxxxxxxxxxxx');
  admin.auto = false;
  await admin.connect(PORT, roomId, '管理', ownerKey!);
  const strategy = {
    signup: (seat: number) => seat === 3,
    // the bot wolves agree with the browser wolf (who picks 9 on night 1)
    wolfTarget: (options: number[], mates: number[]) => (options.includes(9) ? 9 : (options.find((x) => !mates.includes(x)) ?? null)),
    vote: (_seat: number, candidates: number[], v: import('../../shared/types.ts').RoomView) => {
      const ph = v.game!.phase;
      if (ph.kind === 'vote' && (ph.context === 'exile' || ph.context === 'exilePk') && candidates.includes(5)) return 5;
      return candidates[0] ?? null;
    },
  };
  const bots: Bot[] = [];
  for (let seat = 3; seat <= 12; seat++) {
    if (seat === 5) continue;
    const b = new Bot(`bot-seat-${seat}-xxxxxxxxxxxx`, strategy);
    await b.connect(PORT, roomId, BOT_NAMES[seat - 1]);
    b.send({ t: 'sit', seat });
    bots.push(b);
  }
  await expect(page.getByText('玩家已到齐')).toBeVisible();
  await shot(page, '03-lobby-full', ti);

  // invite sheet
  await page.getByRole('button', { name: '邀请', exact: true }).first().click();
  await expect(page.locator('.link-box')).toContainText(`/r/${roomId}`);
  await shot(page, '03b-invite', ti);
  await page.locator('.modal-close').click();

  // ── deal (fixed roles through the test hook) ──
  admin.send({ t: 'owner', cmd: { type: 'debugDeal', seats: SEATS } });
  await expect(page.getByRole('button', { name: '查看我的身份' })).toBeVisible();
  await shot(page, '04-dealt', ti);
  await page.getByRole('button', { name: '查看我的身份' }).click();
  await expect(page.getByText('点击翻开身份牌')).toBeVisible();
  await shot(page, '05-card-back', ti);
  await page.getByText('点击翻开身份牌').click();
  await expect(page.locator('.rc-name')).toHaveText('预言家');
  await shot(page, '06-card-front', ti);
  await page.locator('.modal').getByRole('button', { name: '关闭', exact: true }).last().click();
  // the wolf sees teammates on the card
  await wolf.getByRole('button', { name: '查看我的身份' }).click();
  await wolf.getByText('点击翻开身份牌').click();
  await expect(wolf.locator('.rc-info')).toContainText('8号（白狼王）');
  await shot(wolf, '06b-wolf-card', ti);
  await wolf.locator('.modal').getByRole('button', { name: '关闭', exact: true }).last().click();

  // ── night 1 ──
  await page.getByRole('button', { name: /开始游戏/ }).click();
  await expect(page.locator('body[data-time="night"]')).toBeAttached();
  await shot(page, '07-night-idle', ti);

  await expect(wolf.getByText('狼人请互相确认身份，并选择今晚要击杀的玩家')).toBeVisible({ timeout: 60000 });
  await pick(wolf, 9).click();
  await expect(wolf.getByRole('button', { name: '确认击杀9号' })).toBeVisible();
  await shot(wolf, '08-wolves', ti);
  await wolf.getByRole('button', { name: '确认击杀9号' }).click();

  await expect(witch.getByText('今晚被击杀的是：9号')).toBeVisible({ timeout: 60000 });
  await shot(witch, '09-witch', ti);
  await witch.getByRole('button', { name: '今晚不用药' }).click();
  await expect(witch.getByText('你今晚没有用药')).toBeVisible();

  await expect(page.getByText('请选择你要查验的玩家')).toBeVisible({ timeout: 60000 });
  await pick(page, 5).click();
  await shot(page, '10-seer-pick', ti);
  await page.getByRole('button', { name: '查验 5号' }).click();
  await expect(page.getByText('5号玩家的身份是：狼人')).toBeVisible();
  await shot(page, '11-seer-result', ti);

  // ── day 1: sheriff election ──
  await expect(page.getByText('你要参加警长竞选（上警）吗？')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '上警', exact: true }).click();
  await expect(page.getByRole('button', { name: '✓ 上警' })).toBeVisible();
  await shot(page, '12-signup', ti);
  await witch.getByRole('button', { name: '不上警', exact: true }).click();
  await wolf.getByRole('button', { name: '不上警', exact: true }).click();

  await expect(page.locator('.speaker')).toBeVisible({ timeout: 60000 });
  await shot(page, '13-sheriff-speech', ti);
  const stops = [autoSpeech(page), autoSpeech(witch), autoSpeech(wolf)];

  await expect(witch.getByText('投票选出警长')).toBeVisible({ timeout: 60000 });
  await pick(witch, 1).click();
  await shot(witch, '14-sheriff-vote', ti);
  await witch.getByRole('button', { name: '投给1号' }).click();
  await pick(wolf, 1).click();
  await wolf.getByRole('button', { name: '投给1号' }).click();
  await expect(page.locator('.seat.me .seat-badge.sheriff')).toBeVisible({ timeout: 30000 });

  // night death of 9 is announced after the election
  await expect(page.locator('.seat', { hasText: '张三' }).locator('.seat-dead')).toBeVisible({ timeout: 60000 });

  await expect(page.getByText('请选择发言顺序')).toBeVisible({ timeout: 60000 });
  await shot(page, '15-order-choice', ti);
  await page.getByRole('button', { name: /（顺序）/ }).click();

  // the wolf can self-destruct during the discussion (hidden skill menu)
  await expect(wolf.locator('.speaker')).toBeVisible({ timeout: 30000 });
  await wolf.getByRole('button', { name: '技能' }).click();
  await expect(wolf.getByRole('button', { name: '自爆', exact: true })).toBeVisible();
  await shot(wolf, '16-wolf-skill', ti);
  await wolf.locator('.modal-close').click();
  // a villager-side skill menu shows nothing to do
  await witch.getByRole('button', { name: '技能' }).click();
  await expect(witch.getByText('解药：可用')).toBeVisible();
  await witch.locator('.modal-close').click();

  // ── exile vote ──
  await expect(page.getByText('放逐投票').first()).toBeVisible({ timeout: 90000 });
  await pick(page, 5).click();
  await shot(page, '17-exile-vote', ti);
  await page.getByRole('button', { name: '投给5号' }).click();
  await pick(witch, 5).click();
  await witch.getByRole('button', { name: '投给5号' }).click();

  await expect(wolf.getByText('你已出局')).toBeVisible({ timeout: 30000 });
  await shot(wolf, '18-death-skill', ti);
  await wolf.getByRole('button', { name: '不发动' }).click();

  // history shows the vote breakdown with the sheriff's 1.5 votes
  await expect(page.locator('body[data-time="night"]')).toBeAttached({ timeout: 60000 });
  await page.getByRole('button', { name: '记录' }).click();
  await expect(page.locator('.history')).toContainText('放逐投票');
  await expect(page.locator('.history')).toContainText('1号当选警长');
  await shot(page, '19-history', ti);
  await page.locator('.modal-close').click();
  await page.getByRole('button', { name: '规则' }).click();
  await expect(page.locator('.rules')).toContainText('双爆吞警徽');
  await shot(page, '20-rules', ti);
  await page.locator('.modal-close').click();
  await page.getByRole('button', { name: '菜单' }).click();
  await expect(page.getByText('房主菜单')).toBeVisible();
  await shot(page, '21-owner-menu', ti);
  await page.locator('.modal-close').click();

  // ── hand the three browser seats to bots and let the game finish ──
  for (const s of stops) s();
  for (const [p, seat] of [
    [page, 1],
    [witch, 2],
    [wolf, 5],
  ] as const) {
    const cid = await p.evaluate(() => localStorage.getItem('wwd.client'));
    const b = new Bot(cid!, strategy);
    await b.connect(PORT, roomId, `seat${seat}`);
    bots.push(b);
  }
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 180000 });
  await shot(page, '22-result', ti);
  await expect(page.locator('.rrow')).toHaveCount(12);
  await page.locator('.nightlog summary').click();
  await expect(page.locator('.nightlog')).toContainText('第1夜');
  await shot(page, '23-result-log', ti);

  // ── restart ──
  await page.getByRole('button', { name: /再来一局/ }).click();
  await expect(page.getByRole('button', { name: '查看我的身份' })).toBeVisible();

  for (const b of [...bots, admin]) b.close();
  expect(errors).toEqual([]);
});

test('home page validates and the room 404 page works', async ({ page }) => {
  await page.goto('/r/doesnotexist');
  await expect(page.getByText('房间不存在或已过期')).toBeVisible();
  await page.getByRole('button', { name: '创建新房间' }).click();
  await expect(page.getByRole('button', { name: '创建房间' })).toBeVisible();
  // a config without wolves cannot be created
  await page.getByRole('button', { name: '减少狼人' }).click();
  await page.getByRole('button', { name: '减少狼人' }).click();
  await page.getByRole('button', { name: '减少狼人' }).click();
  await page.getByRole('button', { name: '减少狼人' }).click();
  await expect(page.locator('.form-error')).toContainText('狼');
  await expect(page.getByRole('button', { name: '创建房间' })).toBeDisabled();
});
