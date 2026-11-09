#!/usr/bin/env node
// Agent-facing CLI. Same operations as the web UI, same approval gate.
import { parseArgs } from 'node:util';
import { openDb } from './db.js';
import { createAisa } from './aisa.js';
import { createOps } from './ops.js';
import * as radar from './radar.js';

const HELP = `usage: npm run cli -- <command> [options]

accounts                         list connected accounts
health                           account health
connect <platform>               start an account connection, prints the auth URL
connect-status <sessionId>
content:add --platform youtube --title T [--body B] [--media path] [--topic id]
content:list
content:submit <id>              move a draft into review
content:review <id> --approve|--reject [--note N]   human decision only
publish:youtube <id> --account acc_... --visibility private|unlisted|public
                --made-for-kids true|false [--at ISO] [--tz Asia/Shanghai] [--ai]
post:refresh <localPostId>
posts
yt:channel --account acc_... [--from YYYY-MM-DD] [--to YYYY-MM-DD]
yt:daily --account acc_... --video VIDEO_ID
spend
radar:quote --en "k1,k2" --zh "k1,k2" [--platforms x,youtube,tiktok,instagram,xiaohongshu,wechat]
radar:run   (same flags) [--budget 0.3]      saves raw responses under data/radar/<time>/
radar:parse <dir> --topic T [--days 30] [--en ..] [--zh ..]   free, stores a radar run
topic:add --title T [--body angle]
publish:wechat <id> [--theme default]      approved article → 公众号草稿箱 (never mass-send)`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    platform: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
    media: { type: 'string' }, topic: { type: 'string' }, note: { type: 'string' },
    approve: { type: 'boolean' }, reject: { type: 'boolean' },
    account: { type: 'string' }, visibility: { type: 'string' }, 'made-for-kids': { type: 'string' },
    at: { type: 'string' }, tz: { type: 'string' }, ai: { type: 'boolean' },
    from: { type: 'string' }, to: { type: 'string' }, video: { type: 'string' },
    en: { type: 'string' }, zh: { type: 'string' }, platforms: { type: 'string' },
    budget: { type: 'string' }, days: { type: 'string' }, theme: { type: 'string' },
  },
});

const [cmd, arg] = positionals;
const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
const radarPlan = () => radar.plan({ en: list(values.en), zh: list(values.zh) }, values.platforms ? list(values.platforms) : undefined);
if (!cmd || cmd === 'help') { console.log(HELP); process.exit(0); }

const db = openDb();
const aisa = createAisa({ db });
const ops = createOps({ db, aisa });
const out = (x) => console.log(JSON.stringify(x?.data ?? x, null, 2));
const bool = (s) => (s === 'true' ? true : s === 'false' ? false : undefined);

const commands = {
  accounts: () => aisa.listAccounts(),
  health: () => aisa.accountsHealth(),
  connect: () => aisa.startConnect(arg),
  'connect-status': () => aisa.getConnectSession(arg),
  'content:add': () => ops.addContent({
    platform: values.platform, title: values.title, body: values.body,
    mediaPath: values.media, topicId: values.topic ? Number(values.topic) : null,
  }),
  'content:list': () => ops.listContents(),
  'content:submit': () => ops.submitForReview(Number(arg)),
  'content:review': () => {
    if (values.approve === values.reject) throw new Error('pass exactly one of --approve or --reject');
    return ops.review(Number(arg), { approve: !!values.approve, note: values.note });
  },
  'publish:youtube': () => ops.publishYoutube(Number(arg), {
    accountId: values.account, visibility: values.visibility, madeForKids: bool(values['made-for-kids']),
    scheduledFor: values.at || null, timezone: values.tz || 'Asia/Shanghai', containsSyntheticMedia: !!values.ai,
  }),
  'post:refresh': () => ops.refreshPost(Number(arg)),
  posts: () => ops.listPosts(),
  'yt:channel': () => aisa.youtubeChannelInsights({ accountId: values.account, fromDate: values.from, toDate: values.to }),
  'yt:daily': () => aisa.youtubeDailyViews({ accountId: values.account, videoId: values.video }),
  spend: () => ops.spend(),
  'radar:quote': async () => {
    const q = await radar.quote(process.env.AISA_API_KEY, radarPlan());
    return { calls: q.length, totalUsd: +q.reduce((s, x) => s + (x.usd || 0), 0).toFixed(6), quotes: q };
  },
  'radar:run': () => radar.runAndStore(db, process.env.AISA_API_KEY, {
    topic: values.topic || 'untitled', keywords: { en: list(values.en), zh: list(values.zh) },
    platforms: values.platforms ? list(values.platforms) : undefined,
    budgetUsd: Number(values.budget || 0.3), windowDays: Number(values.days || 30),
  }),
  'radar:parse': () => radar.storeRun(db, arg, {
    topic: values.topic || 'untitled', keywords: { en: list(values.en), zh: list(values.zh) }, windowDays: Number(values.days || 30),
  }),
  'topic:add': () => ops.addTopic({ title: values.title, angle: values.body }),
  'publish:wechat': () => ops.publishWechat(Number(arg), { theme: values.theme || 'default' }),
};

const fn = commands[cmd];
if (!fn) { console.error(`unknown command: ${cmd}\n\n${HELP}`); process.exit(2); }
try {
  out(await fn());
} catch (e) {
  console.error(`error: ${e.message}`);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
}
