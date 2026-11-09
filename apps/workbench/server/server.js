// Local HTTP API for the workbench UI. Binds to 127.0.0.1 only; the AIsa key never leaves this process.
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createAisa, AisaError } from './aisa.js';
import { createOps, GateError } from './ops.js';
import * as radar from './radar.js';

const PORT = Number(process.env.PORT || 4318);
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const db = openDb();
const aisa = createAisa({ db });
const ops = createOps({ db, aisa });

const routes = [
  ['GET', /^\/api\/accounts$/, () => aisa.listAccounts().then((r) => r.data)],
  ['GET', /^\/api\/accounts\/health$/, () => aisa.accountsHealth().then((r) => r.data)],
  ['POST', /^\/api\/connect\/([a-z]+)$/, (_, [platform]) => aisa.startConnect(platform).then((r) => r.data)],
  ['GET', /^\/api\/connect\/sessions\/([\w-]+)$/, (_, [id]) => aisa.getConnectSession(id).then((r) => r.data)],
  ['GET', /^\/api\/contents$/, () => ops.listContents()],
  ['POST', /^\/api\/contents$/, (body) => ops.addContent(body)],
  ['PUT', /^\/api\/contents\/(\d+)$/, (body, [id]) => ops.updateContent(Number(id), body)],
  ['POST', /^\/api\/contents\/(\d+)\/publish\/wechat$/, (body, [id]) => ops.publishWechat(Number(id), body)],
  ['GET', /^\/api\/wechat\/status$/, () => wechatStatus()],
  ['GET', /^\/api\/topics$/, () => ops.listTopics()],
  ['POST', /^\/api\/topics$/, (body) => ops.addTopic(body)],
  ['POST', /^\/api\/topics\/(\d+)\/status$/, (body, [id]) => ops.setTopicStatus(Number(id), body.status)],
  ['GET', /^\/api\/radar\/runs$/, () => ops.radarRuns()],
  ['GET', /^\/api\/radar\/runs\/(latest|\d+)$/, (_, [id]) => ops.radarRun(id === 'latest' ? null : Number(id))],
  ['POST', /^\/api\/radar\/quote$/, async (b) => {
    const q = await radar.quote(process.env.AISA_API_KEY, radar.plan(b.keywords, b.platforms));
    return { calls: q.length, totalUsd: +q.reduce((s, x) => s + (x.usd || 0), 0).toFixed(6), quotes: q };
  }],
  ['POST', /^\/api\/radar\/run$/, (b) => {
    if (!(b.budgetUsd > 0 && b.budgetUsd <= 1)) throw new GateError('budgetUsd must be between 0 and 1');
    return radar.runAndStore(db, process.env.AISA_API_KEY, b);
  }],
  ['GET', /^\/api\/youtube\/channel\/(acc_\w+)$/, async (_, [acc]) => {
    const [stats, videos] = await Promise.all([aisa.followerStats(acc), aisa.channelVideos(acc)]);
    const publicStats = Object.fromEntries(db.prepare('SELECT * FROM public_stats').all().map((r) => [r.url, r]));
    return { followers: stats.data, videos: videos.data, publicStats };
  }],
  ['POST', /^\/api\/youtube\/public-stats$/, async (b) => {
    if (!/^https:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{6,}$|^https:\/\/youtu\.be\/[\w-]{6,}$/.test(b.url || '')) throw new GateError('expected a YouTube video URL');
    const r = await aisa.youtubePublicVideo(b.url);
    const m = r.data?.data?.metrics || {};
    return db.prepare(`INSERT INTO public_stats (url, views, likes, comments, fetched_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET views = excluded.views, likes = excluded.likes, comments = excluded.comments, fetched_at = excluded.fetched_at
      RETURNING *`).get(b.url, m.views ?? null, m.likes ?? null, m.comments ?? null, new Date().toISOString());
  }],
  ['POST', /^\/api\/contents\/(\d+)\/submit$/, (_, [id]) => ops.submitForReview(Number(id))],
  ['POST', /^\/api\/contents\/(\d+)\/review$/, (body, [id]) => ops.review(Number(id), body)],
  ['POST', /^\/api\/contents\/(\d+)\/publish\/youtube$/, (body, [id]) => ops.publishYoutube(Number(id), body)],
  ['GET', /^\/api\/posts$/, () => ops.listPosts()],
  ['POST', /^\/api\/posts\/(\d+)\/refresh$/, (_, [id]) => ops.refreshPost(Number(id))],
  ['GET', /^\/api\/spend$/, () => ops.spend()],
];

// Presence checks only: never read or return credential values.
function wechatStatus() {
  const wenyan = spawnSync('wenyan', ['--version'], { encoding: 'utf8' });
  return {
    wenyan: wenyan.status === 0 ? wenyan.stdout.trim() : null,
    credentials: Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET),
  };
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(pathname, res) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!pathname.startsWith('/api/')) return serveStatic(pathname, res);
  const route = routes.find(([m, re]) => m === req.method && re.test(pathname));
  if (!route) return send(res, 404, { error: 'no such route' });
  try {
    // Only same-origin pages may call the API (blocks other local sites from driving it).
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) {
      return send(res, 403, { error: 'cross-origin request refused' });
    }
    const body = req.method === 'GET' ? {} : await readJson(req);
    const result = await route[2](body, pathname.match(route[1]).slice(1));
    send(res, 200, result);
  } catch (e) {
    if (e instanceof GateError) return send(res, 409, { error: e.message });
    if (e instanceof AisaError) return send(res, 502, { error: e.message, code: e.code, retryHint: e.retryHint });
    console.error(e);
    send(res, 500, { error: 'internal error' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`workbench on http://127.0.0.1:${PORT}`));
