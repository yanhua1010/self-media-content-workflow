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
  const post = await ops.publishYoutube(c.id, youtube);
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
