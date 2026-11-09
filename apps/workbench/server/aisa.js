// Thin client for the AIsa Social unified API (https://aisa.one/docs/resources/unified-apis).
// The API key stays on the server: read from AISA_API_KEY, never sent to the browser.
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const ROOT = 'https://api.aisa.one/apis/v1';
const BASE = `${ROOT}/social`;
const COST_HEADER = 'x-aisa-customer-cost-micros-usd';
const DEFAULT_MAX_PRICE_USD = 0.05;

const VIDEO_TYPES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export class AisaError extends Error {
  constructor(message, { status, code, retryHint, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryHint = retryHint;
    this.body = body;
  }
}

export function createAisa({ apiKey = process.env.AISA_API_KEY, db, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new AisaError('AISA_API_KEY is not set');

  const logSpend = db
    ? db.prepare('INSERT INTO spend (method, path, http_status, cost_usd) VALUES (?, ?, ?, ?)')
    : null;

  async function call(method, path, { query, body, maxPriceUsd, idempotencyKey, root = BASE } = {}) {
    const url = new URL(root + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (maxPriceUsd !== undefined) headers['X-AISA-Max-Price-USD'] = maxPriceUsd.toFixed(6);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
    const costUsd = Number(res.headers.get(COST_HEADER) || 0) / 1e6;
    logSpend?.run(method, path, res.status, costUsd);

    if (!res.ok) {
      const err = data?.error || {};
      throw new AisaError(`${method} ${path} → HTTP ${res.status}: ${err.message || text.slice(0, 200)}`, {
        status: res.status, code: err.code, retryHint: err.retryHint, body: data,
      });
    }
    return { status: res.status, data, costUsd };
  }

  return {
    call,
    // Accounts
    listAccounts: (query) => call('GET', '/accounts', { query }),
    accountsHealth: (query) => call('GET', '/accounts/health', { query }),
    startConnect: (platform, query) => call('GET', `/connect/${encodeURIComponent(platform)}`, { query }),
    getConnectSession: (id) => call('GET', `/connect/sessions/${encodeURIComponent(id)}`),

    // Media: presign, then PUT the bytes to the returned URL.
    async uploadFile(localPath) {
      const ext = extname(localPath).toLowerCase();
      const contentType = VIDEO_TYPES[ext] || IMAGE_TYPES[ext];
      if (!contentType) throw new AisaError(`Unsupported media type: ${ext}`);
      const { size } = await stat(localPath);
      const { data: presign } = await call('POST', '/media/presign', {
        body: { filename: basename(localPath), contentType, size },
      });
      const bytes = await readFile(localPath);
      const put = await fetchImpl(presign.uploadUrl, {
        method: presign.method || 'PUT',
        headers: { 'Content-Type': contentType, ...(presign.headers || {}) },
        body: bytes,
      });
      if (!put.ok) throw new AisaError(`Media upload failed: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
      return { mediaId: presign.mediaId, contentType, size, type: contentType.startsWith('video') ? 'video' : 'image' };
    },

    // Posts. createPost is the only paid write here; it always carries a price cap.
    createPost: (body, { maxPriceUsd = DEFAULT_MAX_PRICE_USD, idempotencyKey } = {}) =>
      call('POST', '/posts', { body, maxPriceUsd, idempotencyKey }),
    getPost: (postId) => call('GET', `/posts/${encodeURIComponent(postId)}`),
    listPosts: (query) => call('GET', '/posts', { query }),
    deletePost: (postId) => call('DELETE', `/posts/${encodeURIComponent(postId)}`),
    postAnalytics: (postId) => call('GET', '/analytics', { query: { postId } }),

    // YouTube Analytics for the connected channel ($0.001 per request).
    youtubeChannelInsights: (query) => call('GET', '/analytics/youtube/channel-insights', { query, maxPriceUsd: 0.01 }),
    youtubeDailyViews: (query) => call('GET', '/analytics/youtube/daily-views', { query, maxPriceUsd: 0.01 }),
    youtubeRetention: (query) => call('GET', '/analytics/youtube/video-retention', { query, maxPriceUsd: 0.01 }),
    followerStats: (accountIds) => call('GET', '/accounts/follower-stats', { query: { accountIds } }),
    channelVideos: (accountId) => call('GET', `/accounts/${encodeURIComponent(accountId)}/posts`),

    // Public read API (not the connected account): one YouTube video's public stats, about $0.014.
    youtubePublicVideo: (url) => call('GET', '/youtube/videos', { query: { url }, maxPriceUsd: 0.03, root: ROOT }),
  };
}
