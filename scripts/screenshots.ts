// Regenerates the README screenshots (docs/screenshots/*.jpg).
// Starts a local server with test hooks, then plays a scripted 预女猎白 game: two phone browsers
// (小鹿 = 预言家, 大熊 = 狼人) and ten bots with ordinary nicknames. It captures the main screens on the way,
// plus one screen each from short 狼女孩, 狼美骑士 and 盗宝大师 games.
//   npm run build && node scripts/screenshots.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devices, webkit, type Browser, type Page } from '@playwright/test';
import { presetConfig } from '../shared/config.ts';
import type { RoleId } from '../shared/roles.ts';
import type { RoomView } from '../shared/types.ts';
import { Bot, type Strategy } from '../tests/e2e/bots.ts';

const PORT = 3488;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('docs/screenshots');
const NAMES = ['', '阿哲', 'Momo', '小鹿', '老周', '柚子', '南风', '可乐', '大熊', '七七', '阿木', '小满', '十一'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clientId = (tag: string) => `shots-${tag}-${Math.random().toString(36).slice(2, 12)}`;

if (!fs.existsSync('dist/client/index.html')) throw new Error('build the client first: npm run build');
fs.mkdirSync(OUT, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwd-shots-'));
const server = spawn(process.execPath, ['server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', TIME_SCALE: '0.4', TEST_HOOKS: '1', DATA_DIR: dataDir },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => server.kill());
const bots: Bot[] = [];
let browser: Browser | null = null;

const phone = async () => (await browser!.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 })).newPage();
const pick = (p: Page, seat: number) => p.locator(`.seat-picker .pick:has(b:text-is("${seat}"))`);
const until = (p: Page, text: string, timeout = 90_000) => p.getByText(text).first().waitFor({ timeout });

async function shot(p: Page, name: string, top = false): Promise<void> {
  if (top) await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 86, animations: 'disabled' });
  console.log(`  ✓ ${name}.jpg`);
}

/** a room for `board` owned by a bot in seat 1; returns a joiner for the phone seats and a bot filler */
async function newRoom(board: string, strategy: Strategy) {
  const ownerId = clientId('owner');
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ clientId: ownerId, config: presetConfig(board), name: NAMES[1] }),
  });
  const { roomId, ownerKey } = (await res.json()) as { roomId: string; ownerKey: string };
  const owner = new Bot(ownerId, strategy);
  await owner.connect(PORT, roomId, NAMES[1], ownerKey);
  owner.send({ t: 'sit', seat: 1 });
  bots.push(owner);
  const addBots = async (seats: number[]) => {
    for (const seat of seats) {
      const b = new Bot(clientId(`s${seat}`), strategy);
      await b.connect(PORT, roomId, NAMES[seat]);
      b.send({ t: 'sit', seat });
      bots.push(b);
    }
  };
  const join = async (p: Page, seat: number) => {
    await p.goto(`${BASE}/r/${roomId}`);
    await until(p, '请输入你的昵称');
    await p.locator('.modal input').fill(NAMES[seat]);
    await p.getByRole('button', { name: '确定' }).click();
    await p.getByRole('button', { name: `${seat}号 空位`, exact: true }).click();
    await until(p, '你坐在');
  };
  /** hand a phone's seat to a bot (same client id, same name) so the game can go on without it */
  const takeOver = async (p: Page, seat: number) => {
    const id = await p.evaluate(() => localStorage.getItem('wwd.client'));
    const b = new Bot(id!, strategy);
    await b.connect(PORT, roomId, NAMES[seat]);
    bots.push(b);
  };
  const deal = (seats: RoleId[], buried?: RoleId[]) => owner.send({ t: 'owner', cmd: { type: 'debugDeal', seats, buried } });
  const start = () => owner.send({ t: 'owner', cmd: { type: 'start' } });
  return { roomId, addBots, join, takeOver, deal, start };
}

/** a phone alone among bots: joins `seat`, the roles are dealt and the night starts */
async function soloGame(board: string, seats: RoleId[], seat: number, strategy: Strategy, buried?: RoleId[]): Promise<Page> {
  const r = await newRoom(board, strategy);
  await r.addBots(seats.map((_, i) => i + 1).filter((s) => s !== 1 && s !== seat));
  const p = await phone();
  await r.join(p, seat);
  await until(p, '玩家已到齐');
  r.deal(seats, buried);
  await p.getByRole('button', { name: '查看我的身份' }).waitFor();
  r.start();
  return p;
}

async function mainGame(): Promise<void> {
  // 1民 2女巫 3预言家(小鹿) 4狼 5猎人 6民 7狼 8狼(大熊) 9白神 10民 11狼 12民
  const SEATS: RoleId[] = ['villager', 'witch', 'seer', 'wolf', 'hunter', 'villager', 'wolf', 'wolf', 'whitegod', 'villager', 'wolf', 'villager'];
  const WOLVES = [8, 4, 7, 11];
  const SEER = 3;
  const WOLF = 8;
  const strategy: Strategy = {
    signup: (seat) => seat === 2 || seat === 5,
    // a villager on night 1, then gods: the village keeps its 民 and wins by exiling a wolf a day
    wolfTarget: (o) => [6, 5, 9, 2].find((x) => o.includes(x)) ?? null,
    vote: (me, c, v: RoomView) => {
      const ph = v.game?.phase;
      if (ph?.kind === 'vote' && (ph.context === 'sheriff' || ph.context === 'sheriffPk')) return c.includes(SEER) ? SEER : null;
      return WOLVES.find((w) => w !== me && c.includes(w)) ?? null;
    },
  };

  // ── home page ──
  const seer = await phone();
  await seer.goto(`${BASE}/`);
  await until(seer, '创建房间');
  await shot(seer, 'home');

  // ── lobby: players take seats ──
  const r = await newRoom('ynlb', strategy);
  await r.addBots([2, 4, 5, 6, 7]);
  await r.join(seer, SEER);
  await shot(seer, 'lobby', true);
  await r.addBots([9, 10, 11, 12]);
  const wolf = await phone();
  await r.join(wolf, WOLF);
  await until(seer, '玩家已到齐');

  // ── deal: the role card ──
  r.deal(SEATS);
  await seer.getByRole('button', { name: '查看我的身份' }).click();
  await seer.locator('.role-card.back').click();
  await seer.locator('.role-card.front').waitFor();
  await shot(seer, 'role');
  await seer.locator('.modal-close').click();

  // ── night 1: the pack, then the seer ──
  r.start();
  await until(wolf, '狼人请互相确认身份，并选择今晚要击杀的玩家');
  await wolf.waitForTimeout(1500); // the bot wolves agree on 6 first
  await pick(wolf, 6).click();
  await shot(wolf, 'wolves');
  await wolf.getByRole('button', { name: '确认击杀6号' }).click();
  await until(seer, '请选择你要查验的玩家');
  await pick(seer, WOLF).click();
  await seer.getByRole('button', { name: `查验 ${WOLF}号` }).click();
  await until(seer, `${WOLF}号玩家的身份是：狼人`);
  await shot(seer, 'seer');

  // ── day 1: sheriff election, death announcement, exile vote ──
  await until(seer, '你要参加警长竞选（上警）吗？');
  await seer.getByRole('button', { name: '上警', exact: true }).click();
  await wolf.getByRole('button', { name: '不上警', exact: true }).click();
  await seer.locator('.speaker', { hasText: `警上发言：${SEER}号` }).waitFor({ timeout: 90_000 });
  await shot(seer, 'election');
  await seer.getByRole('button', { name: '结束发言', exact: true }).click();
  await until(wolf, '投票选出警长');
  await pick(wolf, SEER).click();
  await wolf.getByRole('button', { name: `投给${SEER}号` }).click();
  await until(seer, '请选择发言顺序');
  await seer.locator('.btn-col button').first().click();
  // everyone speaks; the two phones end their own speeches
  let speaking = true;
  const autoSpeech = async (p: Page) => {
    while (speaking && !p.isClosed()) {
      for (const name of ['结束发言', '遗言结束']) {
        const b = p.getByRole('button', { name, exact: true });
        try {
          if (await b.isVisible()) await b.click({ timeout: 1000 });
        } catch {
          /* raced with a state change */
        }
      }
      await sleep(250);
    }
  };
  void autoSpeech(seer);
  void autoSpeech(wolf);
  await seer.locator('.panel h3', { hasText: '放逐投票' }).waitFor({ timeout: 120_000 });
  await pick(seer, WOLF).click();
  await shot(seer, 'vote');
  await seer.getByRole('button', { name: `投给${WOLF}号` }).click();
  await pick(wolf, SEER).click();
  await wolf.getByRole('button', { name: `投给${SEER}号` }).click();
  await seer.locator('.seat', { hasText: NAMES[WOLF] }).locator('.seat-dead').waitFor({ timeout: 60_000 });
  await seer.waitForTimeout(1500);
  await seer.getByRole('button', { name: '记录' }).click();
  await until(seer, '第1天');
  await shot(seer, 'history');
  await seer.locator('.modal-close').click();
  speaking = false;

  // ── bots finish the game; the seer's phone shows the result ──
  await r.takeOver(seer, SEER);
  await r.takeOver(wolf, WOLF);
  await seer.locator('.result-panel').waitFor({ timeout: 600_000 });
  await shot(seer, 'result', true);
}

/** 狼女孩: the pack only meets on night 1 (首夜禁刀), then she picks whom to confess to */
async function wolfgirlShot(): Promise<void> {
  const seats: RoleId[] = ['villager', 'seer', 'poisoner', 'hunter', 'wolfgirl', 'guard', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager'];
  const p = await soloGame('lnh', seats, 5, {});
  await until(p, '狼人请互相确认身份（首夜禁刀）');
  await p.getByRole('button', { name: '确认', exact: true }).click();
  await until(p, '请选择你要表白的玩家');
  await pick(p, 10).click();
  await shot(p, 'wolfgirl');
}

/** 骑士: duels from the hidden 技能 menu during the day's speeches */
async function knightShot(): Promise<void> {
  const seats: RoleId[] = ['villager', 'seer', 'knight', 'witch', 'guard', 'wolfbeauty', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager'];
  const p = await soloGame('lmqs', seats, 3, { wolfTarget: (o) => (o.includes(10) ? 10 : null) });
  await until(p, '你要参加警长竞选（上警）吗？');
  await p.getByRole('button', { name: '不上警', exact: true }).click();
  await p.locator('.speaker', { hasText: /^发言：/ }).waitFor({ timeout: 90_000 });
  await p.getByRole('button', { name: '技能' }).click();
  await p.locator('.modal').locator('.pick:has(b:text-is("8"))').click();
  await shot(p, 'knight');
}

/** 盗宝大师: picks tonight's card from the three buried ones */
async function treasureShot(): Promise<void> {
  const seats: RoleId[] = ['villager', 'psychic', 'poisoner', 'treasure', 'hunter', 'dreamer', 'wolfking', 'wolf', 'wolf', 'villager', 'villager', 'villager'];
  const p = await soloGame('dbds', seats, 4, {}, ['masked', 'wolf', 'villager']);
  await p.locator('.tcards .tcard').first().waitFor({ timeout: 60_000 });
  await p.locator('.tcards .tcard').first().click();
  await shot(p, 'treasure');
}

async function main(): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 80) throw new Error('server did not start');
    await sleep(250);
  }
  browser = await webkit.launch();
  await mainGame();
  await wolfgirlShot();
  await knightShot();
  await treasureShot();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    server.kill();
    for (const b of bots) b.close();
    await browser?.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
