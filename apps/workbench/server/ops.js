// Workbench operations shared by the HTTP server and the CLI.
// The approval gate lives here: nothing reaches a platform unless a person approved that content.
import { createHash } from 'node:crypto';

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

    // Publish or schedule one approved YouTube video through AIsa.
    async publishYoutube(id, { accountId, scheduledFor = null, timezone = 'Asia/Shanghai', visibility, madeForKids, containsSyntheticMedia = false }) {
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

      const media = await aisa.uploadFile(c.media_path);
      const body = {
        content: c.body || '',
        title: c.title,
        mediaItems: [{ mediaId: media.mediaId, type: media.type }],
        platforms: [{
          platform: 'youtube',
          accountId,
          platformSpecificData: { title: c.title, visibility, madeForKids, containsSyntheticMedia },
        }],
        ...(scheduledFor ? { scheduledFor, timezone } : { publishNow: true }),
      };
      const idempotencyKey = createHash('sha256').update(`content:${id}:${scheduledFor || 'now'}:${accountId}`).digest('hex').slice(0, 40);
      const { status, data } = await aisa.createPost(body, { idempotencyKey });
      return q.insertPost.get(id, 'aisa', 'youtube', accountId, data?.id ?? null, data?.status ?? `http_${status}`,
        scheduledFor, scheduledFor ? timezone : null, null, JSON.stringify(data));
    },

    // Pull the latest state of an AIsa post into the local row.
    async refreshPost(localId) {
      const p = q.post.get(localId);
      if (!p) throw new GateError(`post ${localId} not found`);
      if (p.channel !== 'aisa' || !p.remote_id) return p;
      const { data } = await aisa.getPost(p.remote_id);
      const target = (data?.platforms || []).find((t) => t.platform === p.platform) || {};
      const url = target.platformPostUrl || target.url || null;
      return q.updatePost.get(data?.status ?? p.status, url, JSON.stringify(data), now(), localId);
    },

    listPosts: () => q.posts.all(),
    spend: (limit = 20) => ({ ...q.spendTotal.get(), recent: q.spendRecent.all(limit) }),
  };
}
