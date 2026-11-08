// Dev helper: list elements wider than the viewport on a phone-sized page.
// usage: node scripts/find-overflow.mjs http://localhost:3311/ [width]
import { webkit } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:3000/';
const width = Number(process.argv[3] ?? 390);
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(url);
await page.waitForTimeout(500);
const res = await page.evaluate(() => {
  const W = window.innerWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 0.5 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${r.right.toFixed(1)} w=${r.width.toFixed(1)} text=${(el.textContent || '').slice(0, 30)}`);
  }
  return { W, sw: document.documentElement.scrollWidth, out: out.slice(0, 30) };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
