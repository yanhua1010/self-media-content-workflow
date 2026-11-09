// Topic radar: search public posts on several platforms through AIsa read APIs,
// keep every raw response, and normalize items with link, publish time and engagement.
// Read-only. Quote first, then run under a hard budget.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://api.aisa.one/apis/v1';
const COST_HEADER = 'x-aisa-customer-cost-micros-usd';
const DAY = 86400;

const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);

const REL = /(\d+)\s*(mo|month|y|year|w|week|d|day|h|hour|min|minute|m|s|second)s?\s+ago/i;
const REL_SEC = { s: 1, second: 1, m: 60, min: 60, minute: 60, h: 3600, hour: 3600, d: DAY, day: DAY,
  w: 7 * DAY, week: 7 * DAY, mo: 30 * DAY, month: 30 * DAY, y: 365 * DAY, year: 365 * DAY };
function relToSec(text, now) {
  const m = REL.exec(text || '');
  return m ? Math.trunc(now - Number(m[1]) * REL_SEC[m[2].toLowerCase()]) : null;
}

// Each source: side (overseas / china), keyword language, request builder, parser.
export const SOURCES = {
  x: {
    side: 'overseas', lang: 'en',
    build: (kw) => ({ method: 'GET', path: '/twitter/tweet/advanced_search', query: { query: `${kw} -filter:replies min_faves:20`, queryType: 'Top' } }),
    parse: (p) => (p.tweets || []).map((t) => {
      const m = { likes: int(t.likeCount), reposts: int(t.retweetCount), replies: int(t.replyCount), views: int(t.viewCount) };
      return { title: strip(t.text).slice(0, 160), url: t.url, author: t.author?.userName,
        publishedAt: t.createdAt ? new Date(t.createdAt).toISOString() : null, approxTime: false, metrics: m,
        engagement: m.likes + 2 * m.reposts + m.replies + m.views / 100 };
    }),
  },
  youtube: {
    side: 'overseas', lang: 'en',
    // sp=EgIIBA== : uploaded this month
    build: (kw) => ({ method: 'GET', path: '/youtube/search', query: { engine: 'youtube', q: kw, sp: 'EgIIBA==' } }),
    parse: (p, now) => (p.videos || []).map((v) => {
      const views = int(v.views);
      return { title: v.title, url: v.link, author: v.channel?.title, publishedAt: iso(relToSec(v.published_time, now)),
        approxTime: true, metrics: { views }, engagement: views / 50 };
    }),
  },
  tiktok: {
    side: 'overseas', lang: 'en',
    build: (kw) => ({ method: 'GET', path: '/tiktok/search', query: { query: kw, datePosted: 'last-3-months', sortBy: 'relevance', trim: true } }),
    parse: (p) => (p.data?.videos || []).map((v) => {
      const s = v.stats || {};
      const m = { views: int(s.views), likes: int(s.likes), comments: int(s.comments), shares: int(s.shares), saves: int(s.saves) };
      return { title: strip(v.caption).slice(0, 160), url: v.url, author: v.url?.match(/@([^/]+)/)?.[1] || null,
        publishedAt: v.createdAt || null, approxTime: false, metrics: m,
        engagement: m.likes + m.comments + 2 * m.shares + m.saves + m.views / 100 };
    }),
  },
  instagram: {
    side: 'overseas', lang: 'en',
    build: (kw) => ({ method: 'GET', path: '/instagram/reels/search', query: { query: kw, date_posted: 'last-month' } }),
    parse: (p) => (p.reels || p.data?.reels || []).map((r) => {
      const m = { plays: int(r.video_play_count ?? r.video_view_count), likes: int(r.like_count), comments: int(r.comment_count) };
      const t = r.taken_at;
      return { title: strip(r.caption).slice(0, 160), url: r.url || (r.shortcode && `https://www.instagram.com/reel/${r.shortcode}/`),
        author: r.owner?.username, publishedAt: typeof t === 'number' ? iso(t) : t || null, approxTime: false, metrics: m,
        engagement: m.likes + m.comments + m.plays / 100 };
    }),
  },
  xiaohongshu: {
    side: 'china', lang: 'zh',
    build: (kw) => ({ method: 'GET', path: '/tikhub/xiaohongshu/app_v2/search_notes', query: { keyword: kw, sort_type: 'popularity_descending' } }),
    parse: (p) => (p.data?.data?.items || []).filter((it) => it.note).map(({ note: n }) => {
      const m = { likes: int(n.liked_count), collects: int(n.collected_count), shares: int(n.shared_count), comments: int(n.comments_count) };
      return { title: n.title || strip(n.desc).slice(0, 80), url: `https://www.xiaohongshu.com/explore/${n.id}`,
        author: n.user?.nickname, publishedAt: iso(int(n.timestamp)), approxTime: false, metrics: m,
        engagement: m.likes + m.collects + 2 * m.shares + m.comments };
    }),
  },
  wechat: {
    side: 'china', lang: 'zh',
    build: (kw) => ({ method: 'POST', path: '/tikhub/wechat_search/v2/fetch_search',
      body: { keyword: kw, business_type: 'article', sort: 'hot', publish_time: 'half_year', raw: false } }),
    // Search results show reads only as a display tag ("阅读 10万+", "阅读 3.2万"), kept as a lower bound.
    parse: (p) => (p.data?.items || []).filter((it) => it.doc_url).map((it) => {
      const tag = (it.source?.tag || []).map((t) => t.title).find((t) => /阅读/.test(t || '')) || '';
      const m = tag.match(/([\d.]+)\s*(万)?/);
      const reads = m ? Math.round(Number(m[1]) * (m[2] ? 10000 : 1)) : 0;
      return { title: strip(it.title), url: it.doc_url.replace(/^http:/, 'https:'), author: strip(it.source?.title),
        publishedAt: iso(int(it.timestamp ?? it.date)), approxTime: false,
        metrics: { reads, readsLabel: tag || null }, engagement: reads / 50 };
    }),
  },
};

async function request(apiKey, call, { quote = false, maxPriceUsd = 0.05 } = {}) {
  const url = new URL(API + call.path);
  for (const [k, v] of Object.entries(call.query || {})) url.searchParams.set(k, String(v));
  const headers = { Authorization: `Bearer ${apiKey}`, 'X-AISA-Max-Price-USD': maxPriceUsd.toFixed(6) };
  if (call.body) headers['Content-Type'] = 'application/json';
  if (quote) headers['X-AISA-Cost-Mode'] = 'quote';
  const res = await fetch(url, { method: call.method, headers, body: call.body ? JSON.stringify(call.body) : undefined,
    signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, data, costUsd: Number(res.headers.get(COST_HEADER) || 0) / 1e6 };
}

export function plan(keywords, platforms = Object.keys(SOURCES)) {
  const calls = [];
  for (const platform of platforms) {
    const src = SOURCES[platform];
    for (const kw of keywords[src.lang] || []) calls.push({ platform, keyword: kw, ...src.build(kw) });
  }
  return calls;
}

export async function quote(apiKey, calls) {
  const out = [];
  for (const c of calls) {
    const r = await request(apiKey, c, { quote: true });
    out.push({ platform: c.platform, keyword: c.keyword, ok: r.ok,
      usd: r.ok ? (r.data?.estimated_cost_micros_usd ?? 0) / 1e6 : null, error: r.ok ? null : JSON.stringify(r.data).slice(0, 160) });
  }
  return out;
}

export async function run(apiKey, calls, { budgetUsd, outDir }) {
  await mkdir(outDir, { recursive: true });
  let spent = 0;
  const log = [];
  for (const [i, c] of calls.entries()) {
    const remaining = budgetUsd - spent;
    if (remaining <= 0) { log.push({ ...c, skipped: 'budget' }); continue; }
    const r = await request(apiKey, c, { maxPriceUsd: Math.min(0.05, remaining) });
    spent += r.costUsd;
    const file = `${String(i).padStart(2, '0')}-${c.platform}.json`;
    await writeFile(join(outDir, file), JSON.stringify({ call: c, collectedAt: new Date().toISOString(), status: r.status, costUsd: r.costUsd, data: r.data }, null, 1));
    log.push({ platform: c.platform, keyword: c.keyword, status: r.status, costUsd: r.costUsd, file });
  }
  return { spentUsd: Math.round(spent * 1e6) / 1e6, log };
}

// Re-parse saved raw responses (free). Keeps items within `windowDays` when a time is known.
export async function parseDir(outDir, { windowDays = 30 } = {}) {
  const items = [];
  const files = (await readdir(outDir)).filter((f) => f.endsWith('.json') && /^\d\d-/.test(f)).sort();
  for (const f of files) {
    const saved = JSON.parse(await readFile(join(outDir, f), 'utf8'));
    const { platform, keyword } = saved.call;
    const src = SOURCES[platform];
    const nowSec = Date.parse(saved.collectedAt) / 1000;
    let parsed = [];
    try { parsed = saved.status < 400 ? src.parse(saved.data, nowSec) : []; } catch (e) { parsed = []; }
    for (const it of parsed) {
      const t = it.publishedAt ? Date.parse(it.publishedAt) / 1000 : null;
      const inWindow = t === null ? null : nowSec - t <= windowDays * DAY;
      items.push({ platform, side: src.side, keyword, collectedAt: saved.collectedAt, inWindow, ...it });
    }
  }
  return items;
}
