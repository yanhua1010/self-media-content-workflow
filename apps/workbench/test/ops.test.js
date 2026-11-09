import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createOps, GateError } from '../server/ops.js';
import { SOURCES } from '../server/radar.js';

function fakeAisa() {
  const calls = [];
  return {
    calls,
    uploadFile: async (p) => { calls.push(['upload', p]); return { mediaId: 'med_TEST', type: 'video' }; },
    createPost: async (body, opts) => { calls.push(['createPost', body, opts]); return { status: 202, data: { id: 'pst_TEST', status: 'scheduled' } }; },
  };
}

const youtube = { accountId: 'acc_X', visibility: 'private', madeForKids: false, scheduledFor: '2030-01-01T00:00:00Z' };

test('publishing is blocked until a person approves the content', async () => {
  const aisa = fakeAisa();
  const ops = createOps({ db: openDb(':memory:'), aisa });
  const c = ops.addContent({ platform: 'youtube', title: 't', mediaPath: '/tmp/v.mp4' });
  await assert.rejects(ops.publishYoutube(c.id, youtube), GateError);
  ops.submitForReview(c.id);
  await assert.rejects(ops.publishYoutube(c.id, youtube), GateError);
  ops.review(c.id, { approve: false, note: 'no' });
  await assert.rejects(ops.publishYoutube(c.id, youtube), GateError);
  assert.equal(aisa.calls.length, 0);
});

test('approved content is scheduled once with explicit YouTube choices', async () => {
  const aisa = fakeAisa();
  const ops = createOps({ db: openDb(':memory:'), aisa });
  const c = ops.addContent({ platform: 'youtube', title: 't', mediaPath: '/tmp/v.mp4' });
  ops.submitForReview(c.id);
  ops.review(c.id, { approve: true });
  await assert.rejects(ops.publishYoutube(c.id, { ...youtube, madeForKids: undefined }), /madeForKids/);
  const [post] = await ops.publishYoutube(c.id, youtube);
  assert.equal(post.remote_id, 'pst_TEST');
  assert.equal(post.status, 'scheduled');
  const [, body, opts] = aisa.calls.find((x) => x[0] === 'createPost');
  assert.equal(body.scheduledFor, youtube.scheduledFor);
  assert.equal(body.publishNow, undefined);
  assert.deepEqual(body.platforms[0].platformSpecificData, { title: 't', visibility: 'private', madeForKids: false, containsSyntheticMedia: false });
  assert.ok(opts.idempotencyKey);
  await assert.rejects(ops.publishYoutube(c.id, youtube), /already has YouTube post/);
});

test('radar parsers keep link, time and engagement', () => {
  const [tk] = SOURCES.tiktok.parse({ data: { videos: [{ caption: 'c', url: 'https://www.tiktok.com/@a/video/1', createdAt: '2026-11-01T00:00:00Z', stats: { views: 100, likes: 2, comments: 1, shares: 1, saves: 1 } }] } });
  assert.equal(tk.author, 'a');
  assert.equal(tk.engagement, 2 + 1 + 2 + 1 + 1);
  const [wx] = SOURCES.wechat.parse({ data: { items: [{ title: '<em>x</em>', doc_url: 'http://mp.weixin.qq.com/s?a=1', timestamp: 1789894800, source: { title: '号', tag: [{ title: '阅读 2.9万' }] } }] } });
  assert.equal(wx.title, 'x');
  assert.equal(wx.metrics.reads, 29000);
  assert.ok(wx.url.startsWith('https://'));
});

test('editing approved content sends it back to draft', () => {
  const ops = createOps({ db: openDb(':memory:'), aisa: fakeAisa() });
  const c = ops.addContent({ platform: 'wechat', title: 't', body: 'b' });
  ops.submitForReview(c.id);
  ops.review(c.id, { approve: true });
  const edited = ops.updateContent(c.id, { body: 'b2' });
  assert.equal(edited.status, 'draft');
  assert.equal(edited.approved_at, null);
});

test('WeChat draft needs approval and a cover, and never stores secrets', async () => {
  const { redact } = await import('../server/ops.js');
  const ops = createOps({ db: openDb(':memory:'), aisa: fakeAisa() });
  const runs = [];
  const runner = async (file) => { runs.push(file); return { ok: true, output: 'access_token=abcdefghijklmnop\n草稿创建成功 media_id: Mx9_aBc-123' }; };
  const c = ops.addContent({ platform: 'wechat', title: '标题', body: '正文' });
  await assert.rejects(ops.publishWechat(c.id, { runner }), /approve/);
  ops.submitForReview(c.id);
  ops.review(c.id, { approve: true });
  await assert.rejects(ops.publishWechat(c.id, { runner }), /cover/);
  ops.updateContent(c.id, { options: { cover: '/tmp/c.png' } });
  ops.submitForReview(c.id);
  ops.review(c.id, { approve: true });
  const post = await ops.publishWechat(c.id, { runner });
  assert.equal(post.status, 'draft_saved');
  assert.equal(post.remote_id, 'Mx9_aBc-123');
  assert.ok(!post.last_response_json.includes('abcdefghijklmnop'));
  assert.equal(runs.length, 1);
  await assert.rejects(ops.publishWechat(c.id, { runner }), /already has a WeChat draft/);
  assert.equal(redact('secret: 0123456789abcdef0123'), 'secret: [redacted]');
});

test('YouTube + X go out in one request, X text must be approved and link-free', async () => {
  const aisa = fakeAisa();
  const ops = createOps({ db: openDb(':memory:'), aisa });
  const approve = (id) => { ops.submitForReview(id); ops.review(id, { approve: true }); };
  const c = ops.addContent({ platform: 'youtube', title: 't', body: 'yt desc', mediaPath: '/tmp/v.mp4' });
  approve(c.id);
  const x = { accountId: 'acc_XX' };
  await assert.rejects(ops.publishYoutube(c.id, { ...youtube, x }), /no X text/);

  ops.updateContent(c.id, { options: { xText: '看这里 https://example.com' } });
  approve(c.id);
  await assert.rejects(ops.publishYoutube(c.id, { ...youtube, x }), /link/);

  ops.updateContent(c.id, { options: { xText: '我搭了一个内容值班台' } });
  assert.equal(ops.getContent(c.id).status, 'draft');
  await assert.rejects(ops.publishYoutube(c.id, { ...youtube, x }), /approve/);
  approve(c.id);
  assert.equal(aisa.calls.length, 0);

  const rows = await ops.publishYoutube(c.id, { ...youtube, x });
  const creates = aisa.calls.filter((k) => k[0] === 'createPost');
  assert.equal(creates.length, 1);
  const [, body, opts] = creates[0];
  assert.deepEqual(body.platforms.map((t) => t.platform), ['youtube', 'twitter']);
  assert.equal(body.platforms[1].customContent, '我搭了一个内容值班台');
  assert.equal(body.platforms[1].accountId, 'acc_XX');
  assert.equal(body.content, 'yt desc');
  assert.ok(opts.maxPriceUsd >= 0.025);
  assert.deepEqual(rows.map((r) => r.platform), ['youtube', 'twitter']);
  assert.ok(rows.every((r) => r.remote_id === 'pst_TEST'));
  await assert.rejects(ops.publishYoutube(c.id, { ...youtube, x }), /already has YouTube post/);
});

test('refresh tracks each platform target of a shared post separately', async () => {
  const aisa = { ...fakeAisa(), getPost: async () => ({ data: { id: 'pst_TEST', status: 'partial', platforms: [
    { platform: 'youtube', accountId: 'acc_X', status: 'published', platformPostUrl: 'https://youtube.com/watch?v=1' },
    { platform: 'twitter', accountId: 'acc_XX', status: 'failed', error: { message: 'x' } }] } }) };
  const ops = createOps({ db: openDb(':memory:'), aisa });
  const c = ops.addContent({ platform: 'youtube', title: 't', mediaPath: '/tmp/v.mp4', options: { xText: 'hi' } });
  ops.submitForReview(c.id); ops.review(c.id, { approve: true });
  const [yt, xp] = await ops.publishYoutube(c.id, { ...youtube, x: { accountId: 'acc_XX' } });
  assert.equal((await ops.refreshPost(yt.id)).status, 'published');
  assert.equal((await ops.refreshPost(yt.id)).url, 'https://youtube.com/watch?v=1');
  assert.equal((await ops.refreshPost(xp.id)).status, 'failed');
});
