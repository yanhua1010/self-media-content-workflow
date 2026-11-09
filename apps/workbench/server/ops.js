// Workbench operations shared by the HTTP server and the CLI.
// The approval gate lives here: nothing reaches a platform unless a person approved that content.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class GateError extends Error {}

const now = () => new Date().toISOString();
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

function rowToContent(r) {
  return r && { ...r, options: parse(r.options_json, {}) };
}

export function createOps({ db, aisa }) {
  const q = {
    content: db.prepare('SELECT * FROM contents WHERE id = ?'),
    contents: db.prepare('SELECT * FROM contents ORDER BY id DESC'),
    insertContent: db.prepare(`INSERT INTO contents (topic_id, platform, title, body, media_path, options_json)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING *`),
    setStatus: db.prepare(`UPDATE contents SET status = ?, review_note = ?, approved_at = ?, updated_at = ? WHERE id = ? RETURNING *`),
    insertPost: db.prepare(`INSERT INTO posts (content_id, channel, platform, account_id, remote_id, status, scheduled_for, timezone, url, last_response_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
    updatePost: db.prepare(`UPDATE posts SET status = ?, url = COALESCE(?, url), last_response_json = ?, updated_at = ? WHERE id = ? RETURNING *`),
    post: db.prepare('SELECT * FROM posts WHERE id = ?'),
    activePost: db.prepare(`SELECT * FROM posts WHERE content_id = ? AND platform = ?
      AND status NOT IN ('failed','cancelled','deleted') LIMIT 1`),
    posts: db.prepare('SELECT * FROM posts ORDER BY COALESCE(scheduled_for, created_at) DESC'),
    updateContent: db.prepare(`UPDATE contents SET title = ?, body = ?, media_path = ?, options_json = ?,
      status = 'draft', review_note = NULL, approved_at = NULL, updated_at = ? WHERE id = ? RETURNING *`),
    topics: db.prepare('SELECT * FROM topics ORDER BY id DESC'),
    insertTopic: db.prepare('INSERT INTO topics (title, angle, evidence_json, radar_run_id) VALUES (?, ?, ?, ?) RETURNING *'),
    setTopicStatus: db.prepare('UPDATE topics SET status = ? WHERE id = ? RETURNING *'),
    radarRuns: db.prepare('SELECT id, topic, cost_usd, collected_at FROM radar_runs ORDER BY id DESC'),
    radarRun: db.prepare('SELECT * FROM radar_runs WHERE id = ?'),
    latestRadarRun: db.prepare('SELECT * FROM radar_runs ORDER BY id DESC LIMIT 1'),
    spendTotal: db.prepare('SELECT COUNT(*) AS calls, ROUND(SUM(cost_usd), 6) AS usd FROM spend'),
    spendRecent: db.prepare('SELECT * FROM spend ORDER BY id DESC LIMIT ?'),
  };

  return {
    listContents: () => q.contents.all().map(rowToContent),
    getContent: (id) => rowToContent(q.content.get(id)),

    addContent({ topicId = null, platform, title = null, body = null, mediaPath = null, options = {} }) {
      if (!platform) throw new GateError('platform is required');
      return rowToContent(q.insertContent.get(topicId, platform, title, body, mediaPath, JSON.stringify(options)));
    },

    submitForReview(id) {
      const c = q.content.get(id);
      if (!c) throw new GateError(`content ${id} not found`);
      return rowToContent(q.setStatus.get('in_review', null, null, now(), id));
    },

    // Called only from a human action (button in the UI, or an explicit CLI flag).
    review(id, { approve, note = null }) {
      const c = q.content.get(id);
      if (!c) throw new GateError(`content ${id} not found`);
      if (c.status !== 'in_review') throw new GateError(`content ${id} is ${c.status}, not in_review`);
      return rowToContent(q.setStatus.get(approve ? 'approved' : 'rejected', note, approve ? now() : null, now(), id));
    },

    // Publish or schedule one approved video through AIsa: YouTube, plus optionally the same video on X
    // in the same request. The X text comes from options.xText, so it was part of what the reviewer approved.
    async publishYoutube(id, { accountId, scheduledFor = null, timezone = 'Asia/Shanghai', visibility, madeForKids, containsSyntheticMedia = false, x = null }) {
      const c = rowToContent(q.content.get(id));
      if (!c) throw new GateError(`content ${id} not found`);
      if (c.status !== 'approved') throw new GateError(`content ${id} is ${c.status}; approve it before publishing`);
      if (c.platform !== 'youtube') throw new GateError(`content ${id} is for ${c.platform}, not youtube`);
      if (!c.media_path) throw new GateError('a YouTube post needs a video file (media_path)');
      if (!accountId) throw new GateError('accountId is required');
      if (typeof madeForKids !== 'boolean') throw new GateError('madeForKids must be an explicit true/false choice');
      const live = q.activePost.get(id, 'youtube');
      if (live) throw new GateError(`content ${id} already has YouTube post ${live.id} (${live.status}); cancel it first`);
      if (!['public', 'private', 'unlisted'].includes(visibility)) throw new GateError('visibility must be public, private or unlisted');

      let xTarget = null;
      if (x) {
        const text = (c.options.xText || '').trim();
        if (!x.accountId) throw new GateError('x.accountId is required');
        if (!text) throw new GateError('no X text in this content; add it in the editor and get it approved first');
        // AIsa bills an X post with a URL in its text at $0.20 instead of $0.015; links go in a reply instead.
        if (/https?:\/\/|www\.|\b[\w-]+\.(com|io|ai|dev|one|net|org|cn)\b/i.test(text)) throw new GateError('X text contains a link; move links to a reply');
        const liveX = q.activePost.get(id, 'twitter');
        if (liveX) throw new GateError(`content ${id} already has X post ${liveX.id} (${liveX.status})`);
        xTarget = { platform: 'twitter', accountId: x.accountId, customContent: text };
      }

      const media = await aisa.uploadFile(c.media_path);
      const body = {
        content: c.body || '',
        title: c.title,
        mediaItems: [{ mediaId: media.mediaId, type: media.type }],
        platforms: [
          { platform: 'youtube', accountId, platformSpecificData: { title: c.title, visibility, madeForKids, containsSyntheticMedia } },
          ...(xTarget ? [xTarget] : []),
        ],
        ...(scheduledFor ? { scheduledFor, timezone } : { publishNow: true }),
      };
      const targetsKey = body.platforms.map((t) => `${t.platform}:${t.accountId}`).join(',');
      const idempotencyKey = createHash('sha256').update(`content:${id}:${scheduledFor || 'now'}:${targetsKey}`).digest('hex').slice(0, 40);
      // Cap covers every target in the request: $0.01 YouTube + $0.015 X, with headroom.
      const { status, data } = await aisa.createPost(body, { idempotencyKey, maxPriceUsd: xTarget ? 0.08 : 0.05 });
      // One local row per platform target; they share the AIsa post id and each tracks its own result.
      return body.platforms.map((t) => q.insertPost.get(id, 'aisa', t.platform, t.accountId, data?.id ?? null,
        data?.status ?? `http_${status}`, scheduledFor, scheduledFor ? timezone : null, null, JSON.stringify(data)));
    },

    // Pull the latest state of an AIsa post into the local row.
    async refreshPost(localId) {
      const p = q.post.get(localId);
      if (!p) throw new GateError(`post ${localId} not found`);
      if (p.channel !== 'aisa' || !p.remote_id) return p;
      const { data } = await aisa.getPost(p.remote_id);
      const target = (data?.platforms || []).find((t) => t.platform === p.platform && (!p.account_id || t.accountId === p.account_id)) || {};
      const url = target.platformPostUrl || target.url || null;
      // A multi-platform post can be partial: each local row follows its own target's result.
      const status = ['published', 'failed'].includes(target.status) ? target.status : (data?.status ?? p.status);
      return q.updatePost.get(status, url, JSON.stringify(data), now(), localId);
    },

    // Any edit sends the content back to draft: an approval covers exactly what the person saw.
    updateContent(id, { title, body, mediaPath, options }) {
      const c = rowToContent(q.content.get(id));
      if (!c) throw new GateError(`content ${id} not found`);
      return rowToContent(q.updateContent.get(
        title ?? c.title, body ?? c.body, mediaPath ?? c.media_path,
        JSON.stringify(options ? { ...c.options, ...options } : c.options), now(), id));
    },

    // Write an approved article into the WeChat Official Account draft box (never mass-send).
    async publishWechat(id, { theme = 'default', runner = runWenyan } = {}) {
      const c = rowToContent(q.content.get(id));
      if (!c) throw new GateError(`content ${id} not found`);
      if (c.status !== 'approved') throw new GateError(`content ${id} is ${c.status}; approve it before publishing`);
      if (c.platform !== 'wechat') throw new GateError(`content ${id} is for ${c.platform}, not wechat`);
      if (!c.title || !c.body) throw new GateError('a WeChat article needs a title and a body');
      const cover = c.options.cover;
      if (!cover && !/!\[[^\]]*\]\([^)]+\)/.test(c.body)) throw new GateError('set options.cover or include an image in the body');
      const live = q.activePost.get(id, 'wechat');
      if (live) throw new GateError(`content ${id} already has a WeChat draft (post ${live.id})`);

      const fm = ['---', `title: ${JSON.stringify(c.title)}`];
      if (cover) fm.push(`cover: ${JSON.stringify(cover)}`);
      if (c.options.author) fm.push(`author: ${JSON.stringify(c.options.author)}`);
      fm.push('---', '');
      const file = join(WECHAT_DIR, `content-${id}.md`);
      await mkdir(WECHAT_DIR, { recursive: true });
      await writeFile(file, fm.join('\n') + c.body);

      const result = await runner(file, theme);
      const summary = redact(result.output).slice(-400);
      if (!result.ok) throw new GateError(`wenyan publish failed: ${summary}`);
      const mediaId = summary.match(/media_id["':\s]+([\w-]+)/i)?.[1] || null;
      return q.insertPost.get(id, 'wechat', 'wechat', null, mediaId, 'draft_saved', null, null, null,
        JSON.stringify({ theme, output: summary }));
    },

    // Topics
    listTopics: () => q.topics.all().map((t) => ({ ...t, evidence: parse(t.evidence_json, []) })),
    addTopic({ title, angle = null, evidence = [], radarRunId = null }) {
      if (!title) throw new GateError('title is required');
      const t = q.insertTopic.get(title, angle, JSON.stringify(evidence), radarRunId);
      return { ...t, evidence };
    },
    setTopicStatus(id, status) {
      if (!['proposed', 'picked', 'dropped'].includes(status)) throw new GateError(`bad topic status ${status}`);
      return q.setTopicStatus.get(status, id);
    },

    // Radar
    radarRuns: () => q.radarRuns.all(),
    radarRun(id) {
      const r = id ? q.radarRun.get(id) : q.latestRadarRun.get();
      return r && { ...r, params: parse(r.params_json, {}), items: parse(r.results_json, []), params_json: undefined, results_json: undefined };
    },

    listPosts: () => q.posts.all(),
    spend: (limit = 20) => ({ ...q.spendTotal.get(), recent: q.spendRecent.all(limit) }),
  };
}

const WECHAT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'wechat');

// Strip anything that looks like a credential before output is stored or shown.
export function redact(s) {
  return String(s || '')
    .replace(/(access_token|appsecret|app_secret|secret|token)(["'=:\s]+)[\w.-]{8,}/gi, '$1$2[redacted]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[redacted]');
}

function runWenyan(file, theme) {
  return new Promise((resolveRun) => {
    const child = spawn('wenyan', ['publish', '-f', file, '-t', theme], { env: process.env });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (e) => resolveRun({ ok: false, output: e.message }));
    child.on('close', (code) => resolveRun({ ok: code === 0, output }));
  });
}
