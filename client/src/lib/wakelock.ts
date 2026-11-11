// Keep the screen on during a game: Screen Wake Lock API, falling back to a
// muted looping inline video (older iOS / WeChat WebViews).
type Sentinel = { release(): Promise<void>; addEventListener?(type: 'release', f: () => void): void };
let sentinel: Sentinel | null = null;
let video: HTMLVideoElement | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } };
  if (nav.wakeLock) {
    try {
      const s = await nav.wakeLock.request('screen');
      sentinel = s;
      // the system may drop the lock mid-game (the screen would then sleep and the sound stop): take it again
      s.addEventListener?.('release', () => {
        if (sentinel !== s) return;
        sentinel = null;
        if (wanted && document.visibilityState === 'visible') void acquire();
      });
      return;
    } catch {
      /* fall through */
    }
  }
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.loop = true;
    video.src = '/nosleep.mp4';
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;bottom:0;left:0';
    document.body.appendChild(video);
  }
  try {
    await video.play();
  } catch {
    /* needs a user gesture; retried on the next tap */
  }
}

export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else {
    void sentinel?.release().catch(() => {});
    sentinel = null;
    video?.pause();
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') void acquire();
});
// some browsers only allow the fallback after a gesture
document.addEventListener(
  'pointerdown',
  () => {
    if (wanted && !sentinel) void acquire();
  },
  { passive: true },
);
