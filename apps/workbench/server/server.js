// Local HTTP API for the workbench UI. Binds to 127.0.0.1 only; the AIsa key never leaves this process.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createAisa, AisaError } from './aisa.js';
import { createOps, GateError } from './ops.js';

const PORT = Number(process.env.PORT || 4318);
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

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
  ['POST', /^\/api\/contents\/(\d+)\/submit$/, (_, [id]) => ops.submitForReview(Number(id))],
  ['POST', /^\/api\/contents\/(\d+)\/review$/, (body, [id]) => ops.review(Number(id), body)],
  ['POST', /^\/api\/contents\/(\d+)\/publish\/youtube$/, (body, [id]) => ops.publishYoutube(Number(id), body)],
  ['GET', /^\/api\/posts$/, () => ops.listPosts()],
  ['POST', /^\/api\/posts\/(\d+)\/refresh$/, (_, [id]) => ops.refreshPost(Number(id))],
  ['GET', /^\/api\/spend$/, () => ops.spend()],
];

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
