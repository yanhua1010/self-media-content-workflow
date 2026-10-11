#!/usr/bin/env node
// Node 18+; no package dependencies.
import { readFile, stat, appendFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolve, join } from 'node:path';
import { stdin, stdout } from 'node:process';

const platforms = {
  douyin: { file: '抖音.md', sau: 'douyin' },
  weixin: { file: '视频号.md', sau: 'tencent' },
  xhs: { file: '小红书.md', sau: 'xiaohongshu' },
  youtube: { file: 'youtube.md', sau: 'youtube' },
};

function usage() {
  throw new Error('用法: node publish.mjs --episode <dir> --platforms douyin,weixin,xhs,youtube [--mode draft|schedule] [--at "YYYY-MM-DD HH:mm"] [--sau <binary>] [--account <名称>] [--dry-run] [--yes]');
}

function parseArgs(argv) {
  const options = { mode: 'draft', sau: 'sau', dryRun: false, yes: false, account: 'default' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--dry-run' || key === '--yes') {
      options[key === '--dry-run' ? 'dryRun' : 'yes'] = true;
    } else if (['--episode', '--platforms', '--mode', '--at', '--sau', '--account'].includes(key)) {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) usage();
      options[key.slice(2)] = argv[++index];
    } else {
      usage();
    }
  }
  if (!options.episode || !options.platforms || !['draft', 'schedule'].includes(options.mode)) usage();
  options.platforms = options.platforms.split(',').map((item) => item.trim());
  if (options.platforms.some((item) => !platforms[item]) || new Set(options.platforms).size !== options.platforms.length) usage();
  if (options.at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(options.at)) {
    throw new Error('--at 必须为 YYYY-MM-DD HH:mm');
  }
  if (options.mode === 'schedule' && !options.at) throw new Error('--mode schedule 需要 --at');
  if (options.mode === 'draft' && options.at) throw new Error('--at 只能与 --mode schedule 同用');
  if (options.mode === 'schedule') {
    const [date, time] = options.at.split(' ');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const scheduled = new Date(year, month - 1, day, hour, minute);
    if (scheduled.getFullYear() !== year || scheduled.getMonth() !== month - 1 || scheduled.getDate() !== day || scheduled.getHours() !== hour || scheduled.getMinutes() !== minute || scheduled <= new Date()) {
      throw new Error('--at 必须是有效的未来本地时间');
    }
  }
  return options;
}

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

function firstCodeBlock(markdown, headings) {
  for (const heading of headings) {
    const match = section(markdown, heading).match(/```[^\n]*\n([\s\S]*?)\n```/);
    if (match) return match[1].trim();
  }
  return '';
}

function cleanTitle(value) {
  return value.replace(/\*\*/g, '').replace(/（(?:推荐|备选|含逗号|与封面)[^）]*）\s*$/, '').trim();
}

function candidate(markdown, heading) {
  const match = section(markdown, heading).match(/^1\.\s+(.+)$/m);
  return match ? cleanTitle(match[1]) : '';
}

function fieldPath(markdown, label, base) {
  const match = section(markdown, '文件').match(new RegExp(`^- ${label}：\x60([^\x60]+)\x60`, 'm'));
  return match ? resolve(base, match[1]) : '';
}

async function requiredFile(path, label) {
  if (!path) throw new Error(`缺少${label}`);
  try { if (!(await stat(path)).isFile()) throw new Error('not a file'); }
  catch { throw new Error(`${label}不存在或不可读: ${path}`); }
}

async function readPack(platform, base) {
  const mdPath = join(base, platforms[platform].file);
  await requiredFile(mdPath, '发布包');
  const markdown = await readFile(mdPath, 'utf8');
  const video = fieldPath(markdown, '视频', base);
  const cover = fieldPath(markdown, '封面', base) || fieldPath(markdown, '缩略图', base);
  await requiredFile(video, '视频');
  await requiredFile(cover, '封面');
  const title = platform === 'weixin' ? candidate(markdown, '短标题')
    : platform === 'youtube' ? cleanTitle((section(markdown, '字段').match(/^- 标题（推荐）：(.+)$/m) || [])[1] || '')
      : candidate(markdown, '标题候选');
  const body = firstCodeBlock(markdown, ['发布文案', '描述全文', '描述', '正文']);
  if (!title || !body) throw new Error(`${platforms[platform].file} 缺少标题或正文代码块`);
  const tags = [...new Set((body.match(/#[^\s#，,。；;]+/gu) || []).map((tag) => tag.slice(1)))];
  if (platform === 'xhs' && tags.length > 10) throw new Error('小红书标签超过 SAU 的 10 个上限');
  const collection = (markdown.match(/^- 合集：([^\n（]+)/m) || [])[1]?.trim() || '';
  const playlist = (markdown.match(/^- 播放列表：([^\n（]+)/m) || [])[1]?.trim() || '';
  return { platform, mdPath, markdown, video, cover, title, body, tags, collection, playlist };
}

function command(pack, options) {
  const args = [platforms[pack.platform].sau, 'upload-video', '--account', options.account,
    '--file', pack.video, '--title', pack.title, '--desc', pack.body];
  if (pack.tags.length) args.push('--tags', pack.tags.join(','));
  if (pack.platform === 'douyin') {
    args.push('--thumbnail', pack.cover, '--declaration', '内容由AI生成');
    if (pack.collection) args.push('--collection', pack.collection);
    if (options.mode === 'schedule') args.push('--schedule', options.at);
  } else if (pack.platform === 'weixin') {
    args.push('--thumbnail', pack.cover, '--short-title', pack.title, '--draft');
    if (pack.collection) args.push('--collection', pack.collection);
  } else if (pack.platform === 'xhs') {
    args.push('--thumbnail', pack.cover);
    if (options.mode === 'schedule') args.push('--schedule', options.at);
  } else {
    args.push('--thumbnail', pack.cover, '--visibility', 'private');
    if (pack.playlist) args.push('--playlist', pack.playlist);
  }
  return args;
}

function status(pack, options) {
  // 抖音、小红书在 SAU 里没有草稿/私密参数：draft 模式拒绝；schedule 模式属于工作流的 L3（用户明确给出平台、视频、时间并逐平台确认后，到点自动公开）。
  if (['douyin', 'xhs'].includes(pack.platform) && options.mode === 'draft') return 'SAU 无草稿/私密参数，拒绝执行（改用 --mode schedule --at 做 L3 定时）';
  if (['douyin', 'xhs'].includes(pack.platform) && options.mode === 'schedule') return '可执行（L3 定时，到点自动公开，需逐平台确认）';
  return '可执行';
}

function quote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function showPlan(packs, options) {
  console.log('platform | file | cover | title | tag count | collection | mode/time | visibility');
  console.log('--- | --- | --- | --- | --- | --- | --- | ---');
  for (const pack of packs) {
    const mode = ['douyin', 'xhs'].includes(pack.platform) ? (options.mode === 'schedule' ? `schedule ${options.at}` : 'unsupported draft') : 'draft';
    const visibility = pack.platform === 'youtube' ? 'private' : pack.platform === 'weixin' ? 'draft' : mode.startsWith('schedule') ? 'scheduled public' : 'none';
    console.log([pack.platform, pack.video, pack.cover, pack.title, pack.tags.length, pack.collection || pack.playlist || '-', mode, visibility].join(' | '));
    console.log(`状态: ${status(pack, options)}`);
  }
}

function runSau(binary, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: ['inherit', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code, out, err }));
  });
}

async function record(pack, level, result) {
  const entry = `\n- 发布方式：${level}\n- 适配器：sau\n- 执行时间：${new Date().toISOString()}\n- 结果：${result}\n`;
  if (!/^## 发布后回填\s*$/m.test(pack.markdown)) {
    await appendFile(pack.mdPath, `\n## 发布后回填\n${entry}`, 'utf8');
    return;
  }
  const match = /^## 发布后回填\s*$/m.exec(pack.markdown);
  const tail = pack.markdown.slice(match.index + match[0].length);
  const next = /^## /m.exec(tail);
  const position = match.index + match[0].length + (next ? next.index : tail.length);
  await writeFile(pack.mdPath, `${pack.markdown.slice(0, position).trimEnd()}${entry}\n${pack.markdown.slice(position)}`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = resolve(options.episode, 'self-media');
  const packs = await Promise.all(options.platforms.map((platform) => readPack(platform, base)));
  showPlan(packs, options);
  if (options.dryRun) {
    for (const pack of packs) {
      console.log(`\n${pack.platform}: ${status(pack, options)}`);
      if (status(pack, options) === '可执行' || options.mode === 'schedule') {
        console.log([options.sau, ...command(pack, options)].map(quote).join(' '));
      } else console.log('无安全的 SAU 上传命令');
    }
    return;
  }
  if (packs.some((pack) => status(pack, options).includes('拒绝执行'))) {
    throw new Error('所选平台包含 SAU 无法安全创建草稿或私密视频的平台；只能 dry-run 预览，实际上传请只选视频号/YouTube');
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (const pack of packs) {
      const autoPublic = ['douyin', 'xhs'].includes(pack.platform) && options.mode === 'schedule';
      if (!options.yes || autoPublic) {
        // L3 定时（到点自动公开）永远逐平台人工确认，--yes 不能跳过
        const answer = await rl.question(`${pack.platform} 确认执行？${autoPublic ? `（L3 定时，${options.at} 自动公开）` : ''}(y/N) `);
        if (answer.trim().toLowerCase() !== 'y') { console.log(`${pack.platform}: 已跳过`); continue; }
      }
      const result = await runSau(options.sau, command(pack, options));
      if (result.code !== 0) {
        console.error(`${pack.platform}: SAU 失败（退出码 ${result.code}）。请在本机查看 SAU 输出并核对草稿状态。`);
        break;
      }
      const level = ['douyin', 'xhs'].includes(pack.platform) ? 'L3 定时发布' : 'L2 私密上传或草稿';
      await record(pack, level, 'SAU 命令返回成功；仍需在平台后台核对');
      console.log(`${pack.platform}: SAU 返回成功。请在 app 中核对视频、封面、文案和 AI 声明。`);
      if (pack.platform === 'xhs') console.log('小红书：SAU 无 AI 声明参数，请在 app 中勾选 AI 生成标识。');
      if (pack.platform === 'youtube') console.log('YouTube：保持私密，只有你本人可在 Studio 改为公开。');
      if (pack.platform === 'weixin') console.log('视频号：请在 app 中核对并由你本人发布草稿。');
    }
  } finally { rl.close(); }
}

main().catch((error) => { console.error(`错误：${error.message}`); process.exitCode = 1; });
