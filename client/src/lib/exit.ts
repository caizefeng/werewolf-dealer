// Leaving a room (lobby bottom bar 退出, menu 退出房间). In the lobby a seated player stands up first so the seat
// is free for someone else; during a game the seat and role stay, and the room link brings the player back.
// The owner keeps ownership (the owner key stays on this device), and the room itself stays.
import type { RoomView } from '../../../shared/types.ts';
import { navigate } from '../Home.tsx';
import { send } from './ws.ts';

export function exitRoom(v: RoomView): void {
  const inGame = !!v.game && v.game.time !== 'ended';
  const msg = inGame
    ? '游戏进行中。退出后你的座位和身份会保留，之后用房间链接可以回来。确定退出吗？'
    : v.you.seat
      ? `退出房间并离开${v.you.seat}号座位吗？${v.you.owner ? '房间会保留，之后用房间链接可以回来。' : ''}`
      : v.you.owner
        ? '退出房间吗？房间会保留，之后用房间链接可以回来。'
        : null;
  if (msg && !confirm(msg)) return;
  if (!v.game && v.you.seat) send({ t: 'stand' });
  // leaving the room page closes the connection (Room's cleanup)
  navigate('/');
}
