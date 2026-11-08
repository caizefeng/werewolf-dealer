// Smoke test for a running instance: 12 bots create a room for a board and play
// night 1 and day 1 over (w)ss with real timers, then the owner ends the game.
//   node scripts/smoke.ts <board-id> <base-url>
//   node scripts/smoke.ts dbds https://werewolf.example.com
//   node scripts/smoke.ts ynlbh http://localhost:3000
import { BOARDS, playerCountOf, presetConfig } from '../shared/config.ts';
import type { RoomView } from '../shared/types.ts';
import { Bot } from '../tests/e2e/bots.ts';

const boardId = process.argv[2] ?? 'ynlbh';
const base = process.argv[3] ?? process.env.WWD_URL;
if (!base) throw new Error('usage: node scripts/smoke.ts <board-id> <base-url>  (or set WWD_URL)');
const board = BOARDS.find((b) => b.id === boardId);
if (!board) throw new Error(`unknown board ${boardId}; one of ${BOARDS.map((b) => b.id).join(', ')}`);
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const stamp = Date.now().toString(36);
const n = playerCountOf(board.roles);

const ownerId = `smoke-${stamp}-owner-xxxxxxxx`;
const res = await fetch(`${base}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ clientId: ownerId, name: '冒烟1', config: presetConfig(boardId) }),
});
const { roomId } = (await res.json()) as { roomId: string };
log(`room ${roomId} (${board.name}, ${n} players)`);

const bots: Bot[] = [];
for (let seat = 1; seat <= n; seat++) {
  const b = new Bot(seat === 1 ? ownerId : `smoke-${stamp}-${seat}-xxxxxxxx`, {
    signup: (s) => s === 1 || s === 2,
    vote: (_s, c) => c[0] ?? null,
  });
  await b.connect(base, roomId, `烟${seat}`);
  b.send({ t: 'sit', seat });
  bots.push(b);
}
const owner = bots[0];
await owner.waitFor((v) => v.seats.every((s) => s.occupied));
owner.send({ t: 'owner', cmd: { type: 'deal' } });
const dealt = await Promise.all(bots.map((b) => b.waitFor((v) => v.game?.time === 'dealt')));
log('roles', dealt.map((v) => v.game?.you?.role).join(','));
let lastAnn = 0;
const onView = (v: RoomView) => {
  for (const a of v.game?.announcements ?? []) {
    if (a.id > lastAnn) {
      lastAnn = a.id;
      log('📢', a.text);
    }
  }
  return false;
};
owner.send({ t: 'owner', cmd: { type: 'start' } });
const ok = await owner
  .waitFor((v) => {
    onView(v);
    const g = v.game;
    return !!g && ((g.day >= 2 && g.time === 'night') || g.time === 'ended');
  }, 600_000)
  .then(() => true)
  .catch((e) => {
    log('FAILED', String(e));
    return false;
  });
const g = owner.view!.game!;
log(ok ? `reached ${g.time === 'ended' ? 'the end' : `night ${g.night}`}` : 'did not finish', '| errors:', bots.flatMap((b) => b.errors).length);
owner.send({ t: 'owner', cmd: { type: 'abort' } });
await new Promise((r) => setTimeout(r, 800));
for (const b of bots) b.close();
process.exit(ok ? 0 : 1);
