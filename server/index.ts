// HTTP + WebSocket server. Serves the built client, the room API and /ws.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { estimateDuration } from '../shared/audio.ts';
import { sanitizeConfig } from '../shared/config.ts';
import type { ClientMsg, ServerMsg } from '../shared/types.ts';
import { RoomManager, type Conn } from './rooms.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface ServerOptions {
  port: number;
  host?: string;
  dataDir: string | null;
  staticDir: string | null;
  /** trust X-Forwarded-For (set when running behind a reverse proxy) */
  trustProxy?: boolean;
  quiet?: boolean;
  /** speeds up every game timer (tests/e2e only) */
  timeScale?: number;
  /** enables the debugDeal owner command (tests/e2e only) */
  testHooks?: boolean;
  /** new rooms per hour per IP (default 30; the e2e suite creates more than that from one IP) */
  createLimit?: number;
}

function loadDurations(): (id: string) => number {
  const file = path.join(ROOT, 'shared', 'audio-durations.json');
  try {
    const map = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, number>;
    return (id) => map[id] ?? estimateDuration(id);
  } catch {
    return estimateDuration;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  // a private game server: nothing here belongs in a search engine, an archive or an AI training set
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "media-src 'self' blob: data:; font-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; " +
    "frame-ancestors 'none'; form-action 'self'; object-src 'none'",
};

/** robots.txt: every well-behaved crawler (search engines, AI crawlers, SEO tools, archives) stays out */
const ROBOTS_TXT = '# Private game server: please do not crawl, index or archive anything here.\nUser-agent: *\nDisallow: /\n';

/** crawlers that say who they are: search engines, SEO tools, AI crawlers, archivers, scanners */
const CRAWLER_UA =
  /bot\/|crawl|spider|slurp|scrapy|scraper|httrack|heritrix|archive\.org_bot|ia_archiver|petalbot|coccocbot|imagesiftbot|img2dataset|barkrowler|bingpreview|googleother|google-inspectiontool|adsbot-google|mediapartners-google|storebot-google|chatgpt-user|perplexity|claude-user|anthropic-ai|cohere-ai|meta-external|omgili|censys|netcraft|zgrab|masscan/i;
/** chat apps fetching a link preview stay welcome, so a shared room link still gets its card */
const PREVIEW_UA = /facebookexternalhit|twitterbot|telegrambot|slackbot|discordbot|whatsapp|linkedinbot|skypeuripreview|iframely|embedly/i;

/** a self-identified crawler (never a phone: browser user agents carry none of these words) */
export function isCrawler(ua: string | undefined): boolean {
  return !!ua && CRAWLER_UA.test(ua) && !PREVIEW_UA.test(ua);
}

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ROOM_ID_RE = /^[a-z0-9]{4,16}$/;

class RateLimiter {
  private hits = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  allow(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
}

export function startServer(opts: ServerOptions) {
  const mgr = new RoomManager({ dataDir: opts.dataDir, dur: loadDurations(), scale: opts.timeScale ?? 1, testHooks: !!opts.testHooks });
  const loaded = mgr.loadAll();
  const log = (...a: unknown[]) => {
    if (!opts.quiet) console.log(new Date().toISOString(), ...a);
  };
  if (loaded) log(`restored ${loaded} room(s)`);
  const createLimiter = new RateLimiter(opts.createLimit ?? 30, 3600_000);

  const clientIp = (req: http.IncomingMessage): string => {
    const remote = req.socket.remoteAddress ?? '';
    if (opts.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
    }
    return remote;
  };

  const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: http.IncomingMessage, max = 32 * 1024): Promise<string> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > max) {
          reject(new Error('too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => {
    if (!opts.staticDir) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('not found');
      return;
    }
    const root = opts.staticDir;
    let rel = decodeURIComponent(pathname);
    if (rel.includes('\0')) {
      res.writeHead(400, SECURITY_HEADERS);
      res.end();
      return;
    }
    let file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403, SECURITY_HEADERS);
      res.end();
      return;
    }
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(file);
      if (stat.isDirectory()) {
        file = path.join(file, 'index.html');
        stat = fs.statSync(file);
      }
    } catch {
      stat = null;
    }
    if (!stat) {
      // SPA fallback for client routes (/r/<id>), real 404 for missing assets
      if (path.extname(rel)) {
        res.writeHead(404, SECURITY_HEADERS);
        res.end('not found');
        return;
      }
      file = path.join(root, 'index.html');
      rel = '/index.html';
      try {
        stat = fs.statSync(file);
      } catch {
        res.writeHead(404, SECURITY_HEADERS);
        res.end('not found');
        return;
      }
    }
    const ext = path.extname(file);
    const headers: Record<string, string> = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': String(stat.size),
    };
    if (rel.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    else if (ext === '.html') headers['Cache-Control'] = 'no-cache';
    else headers['Cache-Control'] = 'public, max-age=86400';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = url.pathname;
      // crawlers may read robots.txt (an unreadable one counts as "crawl everything") and nothing else
      if (p === '/robots.txt') {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end(ROBOTS_TXT);
        return;
      }
      if (p === '/api/health') return sendJson(res, 200, { ok: true, rooms: mgr.rooms.size });
      if (isCrawler(req.headers['user-agent'])) {
        res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('This is a private game server. Crawling is not allowed.');
        return;
      }
      if (p === '/api/rooms' && req.method === 'POST') {
        if (!createLimiter.allow(clientIp(req))) return sendJson(res, 429, { error: '创建房间过于频繁，请稍后再试' });
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return sendJson(res, 400, { error: '请求无效' });
        }
        const clientId = body.clientId;
        if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId)) return sendJson(res, 400, { error: '客户端标识无效' });
        const config = sanitizeConfig(body.config);
        if (!config) return sendJson(res, 400, { error: '配置无效' });
        const room = mgr.create(config, clientId, typeof body.name === 'string' ? body.name : '');
        if (typeof room === 'string') return sendJson(res, 400, { error: room });
        log(`room ${room.id} created (${config.boardName}, ${room.data.seats.length} players)`);
        return sendJson(res, 200, { roomId: room.id, ownerKey: room.data.ownerKey });
      }
      const m = /^\/api\/rooms\/([a-z0-9]+)$/.exec(p);
      if (m && req.method === 'GET') {
        const room = mgr.get(m[1]);
        if (!room) return sendJson(res, 404, { error: '房间不存在或已过期' });
        return sendJson(res, 200, { roomId: room.id, boardName: room.data.config.boardName, players: room.data.seats.length });
      }
      if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, SECURITY_HEADERS);
        res.end();
        return;
      }
      serveStatic(req, res, p);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器错误' });
      else res.end();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws' || isCrawler(req.headers['user-agent'])) {
      socket.destroy();
      return;
    }
    // only accept same-origin browsers (the Vite dev proxy rewrites nothing, so allow its port)
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (origin) {
      try {
        const o = new URL(origin);
        const okHost = o.host === host || o.hostname === 'localhost' || o.hostname === '127.0.0.1';
        if (!okHost) {
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = {
      clientId: null,
      roomId: null,
      lastSent: null,
      send: (data: string) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
    };
    let tokens = 30;
    let last = Date.now();
    const reply = (msg: ServerMsg) => conn.send(JSON.stringify(msg));
    let alive = true;
    ws.on('pong', () => (alive = true));
    const hb = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* closed */
      }
    }, 25_000);

    ws.on('message', (raw) => {
      const now = Date.now();
      tokens = Math.min(30, tokens + ((now - last) / 1000) * 15);
      last = now;
      if (tokens < 1) return;
      tokens -= 1;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') return reply({ t: 'pong', now });
      if (msg.t === 'hello') {
        if (typeof msg.client !== 'string' || !CLIENT_ID_RE.test(msg.client)) return reply({ t: 'error', message: '客户端标识无效' });
        if (typeof msg.room !== 'string' || !ROOM_ID_RE.test(msg.room)) return reply({ t: 'error', message: '房间不存在' });
        const room = mgr.get(msg.room);
        if (!room) return reply({ t: 'error', message: '房间不存在或已过期' });
        // re-hello moves the connection
        if (conn.roomId && conn.roomId !== room.id) mgr.get(conn.roomId)?.conns.delete(conn);
        conn.clientId = msg.client;
        conn.roomId = room.id;
        conn.lastSent = null;
        room.conns.add(conn);
        room.hello(msg.client, msg.name, typeof msg.ownerKey === 'string' ? msg.ownerKey : undefined);
        room.changed();
        room.push(conn, true);
        return;
      }
      if (!conn.clientId || !conn.roomId) return reply({ t: 'error', message: '请先加入房间' });
      const room = mgr.get(conn.roomId);
      if (!room) return reply({ t: 'error', message: '房间不存在或已过期' });
      let err: string | null = null;
      try {
        switch (msg.t) {
          case 'sit':
            err = room.sit(conn.clientId, Number(msg.seat));
            break;
          case 'stand':
            err = room.stand(conn.clientId);
            break;
          case 'rename':
            err = room.rename(conn.clientId, String(msg.name ?? ''));
            break;
          case 'act':
            if (!msg.action || typeof msg.action !== 'object') return;
            room.tick(now);
            err = room.act(conn.clientId, msg.action, now);
            break;
          case 'owner':
            if (!msg.cmd || typeof msg.cmd !== 'object') return;
            if (msg.cmd.type === 'reconfigure') {
              const cfg = sanitizeConfig(msg.cmd.config);
              if (!cfg) {
                err = '配置无效';
                break;
              }
              msg.cmd.config = cfg;
            }
            room.tick(now);
            err = room.owner(conn.clientId, msg.cmd, now);
            break;
          default:
            return;
        }
      } catch (e) {
        console.error('handler error', e);
        err = '服务器错误';
      }
      if (err) reply({ t: 'error', message: err });
      room.changed();
    });

    ws.on('close', () => {
      clearInterval(hb);
      if (conn.roomId) {
        const room = mgr.get(conn.roomId);
        if (room) {
          room.conns.delete(conn);
          room.broadcast();
        }
      }
    });
  });

  const expiry = setInterval(() => mgr.expire(Date.now()), 3600_000);
  expiry.unref();

  return new Promise<{ server: http.Server; mgr: RoomManager; port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      log(`werewolf-dealer listening on ${opts.host ?? '0.0.0.0'}:${port}`);
      resolve({
        server,
        mgr,
        port,
        close: () =>
          new Promise<void>((r) => {
            clearInterval(expiry);
            mgr.flushAll();
            for (const room of mgr.rooms.values()) if (room.timer) clearTimeout(room.timer);
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => r());
          }),
      });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
  const staticDir = process.env.STATIC_DIR || path.join(ROOT, 'dist', 'client');
  startServer({
    port,
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    staticDir: fs.existsSync(staticDir) ? staticDir : null,
    trustProxy: process.env.TRUST_PROXY === '1',
    timeScale: Number(process.env.TIME_SCALE) > 0 ? Number(process.env.TIME_SCALE) : 1,
    testHooks: process.env.TEST_HOOKS === '1',
    createLimit: Number(process.env.CREATE_LIMIT) > 0 ? Number(process.env.CREATE_LIMIT) : undefined,
  }).then(({ close }) => {
    const shutdown = (sig: string) => {
      console.log(`${sig}: saving rooms and shutting down`);
      close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
}
