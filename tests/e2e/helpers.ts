import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { Bot, type Strategy } from './bots.ts';

export const PORT = 3317;

export async function shot(page: Page, name: string, ti: TestInfo): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow on ${name}`).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/shots/${ti.project.name}/${name}.png`, animations: 'disabled' });
}

export function watchErrors(p: Page, errors: string[]): void {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text());
  });
}

export async function newPlayer(browser: Browser, ti: TestInfo, url: string, name: string, seat: number): Promise<Page> {
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
export function autoSpeech(p: Page): () => void {
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

export const pick = (p: Page, seat: number) => p.locator(`.seat-picker .pick:has(b:text-is("${seat}"))`);

/** owner creates a room for a preset (button text on the home page) and sits at seat 1 */
export async function createRoom(page: Page, preset: string): Promise<{ url: string; roomId: string }> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${preset}`) }).first().click();
  await page.getByPlaceholder('其他玩家看到的名字').fill('房主');
  await page.getByRole('button', { name: '创建房间' }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  const url = page.url();
  await page.getByRole('button', { name: '1号 空位', exact: true }).click();
  await expect(page.getByText('你坐在')).toBeVisible();
  return { url, roomId: url.split('/r/')[1] };
}

/** fills every seat in `seats` with bots; returns them plus an owner-device bot for test hooks */
export async function fillWithBots(page: Page, roomId: string, seats: number[], strategy: Strategy): Promise<{ bots: Bot[]; admin: Bot }> {
  const ownerKey = await page.evaluate((id) => localStorage.getItem(`wwd.owner.${id}`), roomId);
  const admin = new Bot(`admin-${roomId}-xxxxxxxxxxxx`);
  admin.auto = false;
  await admin.connect(PORT, roomId, '管理', ownerKey!);
  const names = ['', '甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '子', '丑'];
  const bots: Bot[] = [];
  for (const seat of seats) {
    const b = new Bot(`bot-${roomId}-${seat}-xxxxxxxxxx`, strategy);
    await b.connect(PORT, roomId, `机器人${names[seat] ?? seat}`);
    b.send({ t: 'sit', seat });
    bots.push(b);
  }
  return { bots, admin };
}

/** hand a browser seat to a bot (same client id) so the game can finish on its own */
export async function botTakeover(p: Page, roomId: string, strategy: Strategy): Promise<Bot> {
  const cid = await p.evaluate(() => localStorage.getItem('wwd.client'));
  const b = new Bot(cid!, strategy);
  await b.connect(PORT, roomId, '接管');
  return b;
}
