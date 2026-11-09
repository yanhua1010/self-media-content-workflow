// 内容值班台 — vanilla JS, hash routing, talks only to the local backend.
const $ = (s, el = document) => el.querySelector(s);
const page = $('#page');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const fmtN = (n) => (n == null ? '—' : n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : String(n));
const fmtDate = (iso, withTime = false) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day} ${p(d.getHours())}:${p(d.getMinutes())}` : day;
};
const PLATFORM = {
  x: 'X', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', xiaohongshu: '小红书', wechat: '公众号',
  linkedin: 'LinkedIn', threads: 'Threads', facebook: 'Facebook', reddit: 'Reddit', pinterest: 'Pinterest', twitter: 'X',
};
const STATUS = {
  draft: ['草稿', ''], in_review: ['待审', 'warn'], approved: ['已批准', 'ok'], rejected: ['退回', 'seal'],
  scheduled: ['已排期', 'warn'], publishing: ['发布中', 'warn'], published: ['已发布', 'ok'], partial: ['部分成功', 'warn'],
  failed: ['失败', 'seal'], draft_saved: ['已进草稿箱', 'ok'], proposed: ['候选', ''], picked: ['选定', 'ok'], dropped: ['放弃', ''],
};
const tag = (s) => { const [l, c] = STATUS[s] || [s, '']; return `<span class="tag ${c}">${esc(l)}</span>`; };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function confirmBox(title, html, okLabel = '确认') {
  const d = $('#dialog');
  d.innerHTML = `<h3>${esc(title)}</h3><div>${html}</div>
    <div class="row" style="margin-top:18px;justify-content:flex-end">
      <button class="btn ghost" value="no">取消</button><button class="btn seal" value="yes">${esc(okLabel)}</button></div>`;
  return new Promise((resolve) => {
    d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { d.close(); resolve(b.value === 'yes'); }));
    d.addEventListener('cancel', () => resolve(false), { once: true });
    d.showModal();
  });
}

const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// Minimal Markdown → HTML for previews. Input is escaped first.
function md(src) {
  const lines = esc(src || '').split('\n');
  let html = '', inList = false, inCode = false;
  const inline = (s) => s
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, a, u) => (/^https?:/.test(u) ? `<img alt="${a}" src="${u}">` : `<span class="tag">图片：${a || u}</span>`))
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (line.startsWith('```')) { html += inCode ? '</pre>' : '<pre>'; inCode = !inCode; continue; }
    if (inCode) { html += `${line}\n`; continue; }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
    else if (line.startsWith('&gt; ')) html += `<blockquote>${inline(line.slice(5))}</blockquote>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? '</ul>' : '') + (inCode ? '</pre>' : '');
}

const head = (kicker, title, sub, right = '') =>
  `<div class="head"><div><div class="kicker">${kicker}</div><h1>${title}<small>${sub}</small></h1></div><div class="row">${right}</div></div>`;
const ptag = (p) => `<span class="tag p-${esc(p)}">${esc(PLATFORM[p] || p)}</span>`;
const AV_BG = { twitter: '#18181b', x: '#18181b', youtube: '#dc2626', wechat: '#16a34a', instagram: '#db2777', tiktok: '#0f172a', linkedin: '#0a66c2' };
const AV_TXT = { twitter: 'X', x: 'X', youtube: '▶', wechat: '微', instagram: 'IG', tiktok: 'TT', linkedin: 'in' };
const avatar = (a, size = 34) => `<div class="av" style="width:${size}px;height:${size}px;background:${AV_BG[a.platform] || '#71717a'}">${
  a.avatarUrl ? `<img src="${safeUrl(a.avatarUrl)}" alt="" onerror="this.remove()">` : ''}${esc(AV_TXT[a.platform] || '?')}</div>`;

// ---------- 总览 ----------
async function overviewPage() {
  const [acc, health, contents, topics, posts, radarRun, wx] = await Promise.all([
    api('/accounts'), api('/accounts/health'), api('/contents'), api('/topics'), api('/posts'),
    api('/radar/runs/latest').catch(() => null), api('/wechat/status'),
  ]);
  const h = Object.fromEntries((health.data || []).map((x) => [x.accountId, x.status]));
  const byPlat = (p) => (acc.data || []).find((a) => a.platform === p);
  const xa = byPlat('twitter') || byPlat('x');
  const ya = byPlat('youtube');
  const win = radarRun ? dedupe(radarRun.items.filter((i) => i.inWindow)) : [];
  const weekAgo = Date.now() - 7 * 864e5;
  const published = posts.filter((p) => p.status === 'published' && Date.parse(p.updated_at) > weekAgo);
  const cById = Object.fromEntries(contents.map((c) => [c.id, c]));
  const postsBy = {};
  for (const p of posts) (postsBy[p.content_id] ||= []).push(p);
  const stage = (c) => {
    const ps = postsBy[c.id] || [];
    if (ps.some((p) => p.status === 'published')) return 'published';
    if (ps.some((p) => !['failed', 'cancelled', 'deleted'].includes(p.status))) return 'scheduled';
    return c.status === 'in_review' ? 'review' : c.status === 'approved' ? 'approved' : 'draft';
  };
  const card = (c) => `<a class="it" href="#contents" data-open-content="${c.id}">${esc(c.title || '（无标题）')}
    <div class="m">${ptag(c.platform)}${c.platform === 'youtube' && c.options.xText ? ptag('twitter') : ''}</div></a>`;
  const cols = [
    ['选题', topics.filter((t) => t.status !== 'dropped').map((t) => `<a class="it" href="#topics">${esc(t.title)}<div class="m">${tag(t.status)}</div></a>`)],
    ['草稿', contents.filter((c) => ['draft', 'rejected'].includes(stage(c))).map(card)],
    ['待审 / 已批准', contents.filter((c) => ['review', 'approved'].includes(stage(c))).map(card)],
    ['已排期', contents.filter((c) => stage(c) === 'scheduled').map(card)],
    ['已发布', contents.filter((c) => stage(c) === 'published').map(card)],
  ];
  const upcoming = posts.slice().sort((a, b) => Date.parse(b.scheduled_for || b.created_at) - Date.parse(a.scheduled_for || a.created_at)).slice(0, 4);
  const top = win.filter((i) => i.engagement != null).sort((a, b) => b.engagement - a.engagement);
  const best = ['instagram', 'youtube', 'tiktok', 'x', 'xiaohongshu', 'wechat'].map((p) => top.find((i) => i.platform === p)).filter(Boolean);
  const metric = (i) => { const m = i.metrics || {}; return m.views ?? m.plays ? `播放 ${fmtN(m.views ?? m.plays)}` : m.likes != null ? `赞 ${fmtN(m.likes)}` : m.readsLabel || '—'; };
  const now = new Date();

  page.innerHTML = head('', '总览', `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${'日一二三四五六'[now.getDay()]}`,
    `<a class="btn" href="#radar">跑一轮雷达</a><a class="btn primary" href="#contents">＋ 新建内容</a>`) +
    `<div class="grid g4">
      <div class="card kpi"><div class="l">X 粉丝</div><div class="v">${xa ? xa.followersCount.toLocaleString() : '—'}</div><div class="d">${xa ? `@${esc(xa.username)} · ${h[xa.id] === 'healthy' ? '正常' : esc(h[xa.id] || '未知')}` : '未连接'}</div></div>
      <div class="card kpi"><div class="l">YouTube 订阅</div><div class="v">${ya ? ya.followersCount.toLocaleString() : '—'}</div><div class="d">${ya ? `@${esc(ya.username)} · ${h[ya.id] === 'healthy' ? '正常' : esc(h[ya.id] || '未知')}` : '未连接'}</div></div>
      <div class="card kpi"><div class="l">雷达样本（近 ${radarRun?.params?.windowDays || 30} 天）</div><div class="v">${win.length}</div><div class="d">${radarRun ? `${new Set(radarRun.items.map((i) => i.platform)).size} 个平台 · ${fmtDate(radarRun.collected_at, true).slice(5)}` : '还没扫描'}</div></div>
      <div class="card kpi"><div class="l">近 7 天发布</div><div class="v">${published.length}</div><div class="d">${published.length ? esc(published.map((p) => PLATFORM[p.platform]).join('、')) : '—'}</div></div>
    </div>
    <div class="grid" style="grid-template-columns:1.55fr 1fr;margin-top:14px">
      <div class="card"><div class="ch"><h3>内容流水线</h3><a href="#contents">全部内容 →</a></div>
        <div class="pipe">${cols.map(([name, items]) => `<div class="col"><h4>${name}<span>${items.length}</span></h4>${items.join('')}</div>`).join('')}</div></div>
      <div class="card"><div class="ch"><h3>最近排期</h3><a href="#calendar">排期 →</a></div>
        ${upcoming.map((p) => { const d = new Date(p.scheduled_for || p.created_at); const c = cById[p.content_id] || {};
          return `<div class="sched"><div class="when">${d.getMonth() + 1}月<b>${String(d.getDate()).padStart(2, '0')}</b></div><div style="min-width:0"><div style="font-weight:600">${esc(c.title || '')}</div>
            <div class="row small" style="margin-top:3px"><span class="mono">${fmtDate(d.toISOString(), true).slice(11)}</span>${ptag(p.platform)}${tag(p.status)}</div></div></div>`; }).join('') || '<div class="muted small">还没有排期</div>'}
        <div class="ch" style="margin-top:16px"><h3>账号</h3><a href="#accounts">管理 →</a></div>
        ${(acc.data || []).map((a) => `<div class="acc">${avatar(a)}<div><div class="nm">${esc(a.displayName)}</div><div class="s">${esc(PLATFORM[a.platform] || a.platform)} · @${esc(a.username)} · AIsa 发布通道</div></div><span class="spacer"></span>
          ${h[a.id] === 'healthy' ? '<span class="ok-text"><span class="dot"></span>正常</span>' : `<span class="tag seal">${esc(h[a.id] || '未知')}</span>`}</div>`).join('')}
        <div class="acc"><div class="av" style="background:#16a34a">微</div><div><div class="nm">彦华AI路书</div><div class="s">公众号 · 只写草稿箱</div></div><span class="spacer"></span>
          ${wx.credentials && wx.wenyan ? '<span class="ok-text"><span class="dot"></span>可用</span>' : '<span class="tag seal">未就绪</span>'}</div>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><div class="ch"><h3>雷达 · 各平台互动最高</h3><span class="muted small">${radarRun ? esc(radarRun.topic) : ''}</span><a href="#radar">打开雷达 →</a></div>
      ${best.length ? `<table><tbody>${best.map((i) => `<tr><td style="width:96px">${ptag(i.platform)}</td>
        <td><a href="${safeUrl(i.url)}" target="_blank" rel="noopener" style="text-decoration:none"><span class="t">${esc(i.title || '（无文字）')}</span></a></td>
        <td class="num">${esc(metric(i))}</td><td class="num">${i.approxTime ? '约 ' : ''}${fmtDate(i.publishedAt).slice(5)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small">还没有雷达数据</div>'}
    </div>`;
  page.querySelectorAll('[data-open-content]').forEach((a) => a.addEventListener('click', () => { currentContent = Number(a.dataset.openContent); }));
}

// ---------- 01 账号 ----------
async function accountsPage() {
  const [acc, health, wx] = await Promise.all([api('/accounts'), api('/accounts/health'), api('/wechat/status')]);
  const h = Object.fromEntries((health.data || []).map((x) => [x.accountId, x]));
  const cards = (acc.data || []).map((a) => {
    const hs = h[a.id];
    return `<div class="card">
      <div class="row">${ptag(a.platform)}<span class="lane write">AIsa 发布通道</span><span class="spacer"></span>
        ${hs?.status === 'healthy' ? '<span class="ok-text"><span class="dot"></span>正常</span>' : `<span class="tag seal">${esc(hs?.status || '未知')}</span>`}</div>
      <div class="row" style="margin-top:14px">
        ${avatar(a, 44)}
        <div><h3 style="margin:0">${esc(a.displayName)}</h3><div class="muted small">${esc(PLATFORM[a.platform] || a.platform)} · @${esc(a.username)}</div></div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="stat"><div class="n">${fmtN(a.followersCount)}</div><div class="l">粉丝</div></div>
        <div class="stat"><div class="n mono" style="font-size:14px">${fmtDate(a.connectedAt)}</div><div class="l">授权时间</div></div>
      </div>
      <div class="muted small mono" style="margin-top:10px">${esc(a.id)}</div>
    </div>`;
  }).join('');
  const wechat = `<div class="card">
      <div class="row">${ptag('wechat')}<span class="lane write">微信官方接口</span><span class="spacer"></span>
        ${wx.credentials && wx.wenyan ? '<span class="ok-text"><span class="dot"></span>可写草稿箱</span>' : '<span class="tag seal">未就绪</span>'}</div>
      <div class="row" style="margin-top:14px"><div class="av" style="width:44px;height:44px;background:#16a34a">微</div>
        <div><h3 style="margin:0">彦华AI路书</h3><div class="muted small">公众号 · 只写草稿箱，群发在后台手动完成</div></div></div>
      <div class="grid g2" style="margin-top:14px">
        <div class="stat"><div class="n mono" style="font-size:14px">${wx.wenyan ? esc(wx.wenyan) : '未安装'}</div><div class="l">wenyan 排版</div></div>
        <div class="stat"><div class="n mono" style="font-size:14px">${wx.credentials ? '已配置' : '缺失'}</div><div class="l">AppID / Secret（只检查是否存在）</div></div>
      </div>
    </div>`;
  const connectable = ['twitter', 'linkedin', 'threads', 'instagram', 'tiktok', 'facebook'];
  page.innerHTML = head('运营', '账号', '平台官方页面授权一次，之后排期、发布都在这里完成。') +
    `<div class="grid g3">${cards}${wechat}</div>
    <h2>连接更多账号</h2>
    <div class="row">${connectable.map((p) => `<button class="btn ghost sm" data-connect="${p}">＋ ${esc(PLATFORM[p])}</button>`).join('')}</div>
    <p class="muted small">点击后在新标签页打开平台官方授权页，完成后回到这里刷新。Instagram 需要商家号或创作者号，Facebook 需要主页。</p>`;
  page.querySelectorAll('[data-connect]').forEach((b) => b.addEventListener('click', guard(async () => {
    const r = await api(`/connect/${b.dataset.connect}`, { method: 'POST' });
    if (r.authUrl) { window.open(r.authUrl, '_blank', 'noopener'); toast('已打开授权页，完成后刷新本页'); } else toast('没有拿到授权链接', true);
  })));
}

// ---------- 02 雷达 ----------
let radarFilter = 'all';
let radarPicked = new Set();
async function radarPage() {
  const run = await api('/radar/runs/latest').catch(() => null);
  const form = `<details class="card flat" style="margin-bottom:18px"><summary style="cursor:pointer;font-weight:600">新一轮扫描</summary>
    <div class="grid g3" style="margin-top:12px">
      <label class="f">选题名<input type="text" id="r-topic" value="${esc(run?.topic || '')}"></label>
      <label class="f">海外关键词（逗号分隔）<input type="text" id="r-en" value="${esc((run?.params?.keywords?.en || []).join(', '))}"></label>
      <label class="f">国内关键词（逗号分隔）<input type="text" id="r-zh" value="${esc((run?.params?.keywords?.zh || []).join(', '))}"></label>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn ghost" id="r-quote">估价（免费）</button><span class="muted small">先估价，确认费用后才会真正调用。</span></div>
  </details>`;
  if (!run) { page.innerHTML = head('内容流程', '雷达', '多平台公开内容扫描') + form + '<div class="empty">还没有扫描记录</div>'; bindRadarForm(); return; }

  const items = dedupe(run.items.filter((i) => i.inWindow));
  const by = {};
  for (const i of run.items) { const b = (by[i.platform] ||= { all: 0, win: 0 }); b.all++; if (i.inWindow) b.win++; }
  const shown = items.filter((i) => radarFilter === 'all' || i.platform === radarFilter)
    .sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1));
  const metric = (i) => {
    const m = i.metrics || {};
    const parts = [m.views ?? m.plays ? `播放 ${fmtN(m.views ?? m.plays)}` : null, m.likes != null ? `赞 ${fmtN(m.likes)}` : null,
      m.collects != null ? `藏 ${fmtN(m.collects)}` : null, m.comments != null ? `评 ${fmtN(m.comments)}` : null,
      m.reposts != null ? `转 ${fmtN(m.reposts)}` : null, m.readsLabel || null].filter(Boolean);
    return parts.join(' · ') || '—';
  };
  page.innerHTML = head('内容流程', esc(run.topic), `采集于 ${fmtDate(run.collected_at, true)} · 近 ${run.params.windowDays} 天 · 本轮花费 $${(run.cost_usd || 0).toFixed(4)} · 数字是本次样本，不是全平台总量`,
    `<span class="lane read">读接口</span><button class="btn" id="mk-topic" disabled>用勾选的 <span id="pick-n">0</span> 条生成选题</button>`) +
    form +
    `<div class="grid g4" style="grid-template-columns:repeat(6,1fr)">${Object.entries(by).map(([p, b]) =>
      `<div class="card stat"><div class="n">${b.win}<span class="muted" style="font-size:13px"> / ${b.all}</span></div><div class="l">${esc(PLATFORM[p] || p)} · 窗口内 / 样本</div></div>`).join('')}</div>
    <h2>高互动样本</h2>
    <div class="filters">${['all', ...Object.keys(by)].map((p) => `<button data-f="${p}" class="${radarFilter === p ? 'on' : ''}">${p === 'all' ? '全部' : esc(PLATFORM[p] || p)}</button>`).join('')}</div>
    <div class="card table-card"><table><thead><tr><th></th><th>平台</th><th>内容</th><th>发布</th><th style="text-align:right">互动</th></tr></thead><tbody>
    ${shown.slice(0, 80).map((i) => `<tr>
      <td><input type="checkbox" data-pick="${esc(i.url)}" ${radarPicked.has(i.url) ? 'checked' : ''} aria-label="选为证据"></td>
      <td>${ptag(i.platform)}</td>
      <td><div class="t">${esc(i.title) || '<span class="muted">（无文字）</span>'}</div>
        <a class="src" href="${safeUrl(i.url)}" target="_blank" rel="noopener">@${esc(i.author || '')} ↗ ${esc((i.url || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</a></td>
      <td class="num">${fmtDate(i.publishedAt)}${i.approxTime ? '<div class="muted small">约</div>' : ''}</td>
      <td class="num">${esc(metric(i))}</td></tr>`).join('')}
    </tbody></table></div>`;

  page.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { radarFilter = b.dataset.f; radarPage(); }));
  const sync = () => { $('#pick-n').textContent = radarPicked.size; $('#mk-topic').disabled = radarPicked.size === 0; };
  page.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => { c.checked ? radarPicked.add(c.dataset.pick) : radarPicked.delete(c.dataset.pick); sync(); }));
  sync();
  $('#mk-topic').addEventListener('click', guard(async () => {
    const d = $('#dialog');
    d.innerHTML = `<h3>生成选题</h3>
      <label class="f">选题标题<input type="text" id="t-title"></label>
      <label class="f" style="margin-top:10px">切入角度<textarea id="t-angle" style="min-height:90px"></textarea></label>
      <p class="muted small">已勾选 ${radarPicked.size} 条作为证据，来源、时间和互动数据会一起保存。</p>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="t-no">取消</button><button class="btn" id="t-ok">保存</button></div>`;
    d.showModal();
    $('#t-no', d).onclick = () => d.close();
    $('#t-ok', d).onclick = guard(async () => {
      const evidence = run.items.filter((i) => radarPicked.has(i.url)).filter((i, k, a) => a.findIndex((x) => x.url === i.url) === k)
        .map(({ platform, title, url, author, publishedAt, metrics, collectedAt }) => ({ platform, title, url, author, publishedAt, metrics, collectedAt }));
      await api('/topics', { method: 'POST', body: { title: $('#t-title', d).value.trim(), angle: $('#t-angle', d).value.trim(), evidence, radarRunId: run.id } });
      d.close(); radarPicked = new Set(); toast('选题已保存'); location.hash = '#topics';
    });
  }));
  bindRadarForm();
}
function dedupe(items) { const seen = new Set(); return items.filter((i) => (seen.has(i.url) ? false : seen.add(i.url))); }
function bindRadarForm() {
  const split = (s) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  $('#r-quote')?.addEventListener('click', guard(async () => {
    const keywords = { en: split($('#r-en').value), zh: split($('#r-zh').value) };
    const topic = $('#r-topic').value.trim() || '未命名';
    const q = await api('/radar/quote', { method: 'POST', body: { keywords } });
    const ok = await confirmBox('确认扫描费用', `<p>${q.calls} 次调用，预估 <b class="mono">$${q.totalUsd.toFixed(4)}</b>。本轮上限按预估的 1.5 倍设置，超出时网关直接拒绝。</p>
      <p class="muted small">${q.quotes.map((x) => `${esc(PLATFORM[x.platform])} · ${esc(x.keyword)} · ${x.usd == null ? '估价失败' : `$${x.usd}`}`).join('<br>')}</p>`, '开始扫描');
    if (!ok) return;
    toast('扫描中，约 1 分钟…');
    const r = await api('/radar/run', { method: 'POST', body: { topic, keywords, budgetUsd: Math.min(1, +(q.totalUsd * 1.5).toFixed(4)) } });
    toast(`完成：${r.items} 条，花费 $${r.spentUsd}`); radarPage(); refreshSpend();
  }));
}

// ---------- 03 选题 ----------
async function topicsPage() {
  const topics = await api('/topics');
  page.innerHTML = head('内容流程', '选题', '每个选题都挂着雷达里的证据：链接、发布时间、互动数据、采集时间。') +
    (topics.length ? `<div class="grid g2">${topics.map((t) => `<div class="card">
      <div class="row">${tag(t.status)}<span class="muted small mono">#${t.id} · 证据 ${t.evidence.length} 条</span><span class="spacer"></span>
        ${t.status !== 'picked' ? `<button class="btn sm" data-pick-topic="${t.id}">选定</button>` : `<a class="btn sm ghost" href="#contents" data-new-for="${t.id}">写内容 →</a>`}
        ${t.status === 'proposed' ? `<button class="btn sm ghost" data-drop="${t.id}">放弃</button>` : ''}</div>
      <h3 style="margin-top:10px;font-size:19px">${esc(t.title)}</h3>
      <p class="muted" style="margin:4px 0 0">${esc(t.angle || '')}</p>
      <ul class="evidence">${t.evidence.slice(0, 6).map((e) => `<li>${ptag(e.platform)}
        <a href="${safeUrl(e.url)}" target="_blank" rel="noopener" style="text-decoration:none">${esc((e.title || '').slice(0, 60))}</a>
        <span class="mono muted">${fmtDate(e.publishedAt)}</span></li>`).join('')}</ul>
    </div>`).join('')}</div>` : '<div class="empty">还没有选题。到「雷达」勾选证据生成。</div>');
  page.querySelectorAll('[data-pick-topic]').forEach((b) => b.addEventListener('click', guard(async () => { await api(`/topics/${b.dataset.pickTopic}/status`, { method: 'POST', body: { status: 'picked' } }); topicsPage(); })));
  page.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', guard(async () => { await api(`/topics/${b.dataset.drop}/status`, { method: 'POST', body: { status: 'dropped' } }); topicsPage(); })));
  page.querySelectorAll('[data-new-for]').forEach((a) => a.addEventListener('click', () => { sessionStorage.setItem('newFor', a.dataset.newFor); }));
}

// ---------- 04 内容 ----------
let currentContent = null;
async function contentsPage() {
  const [contents, topics] = await Promise.all([api('/contents'), api('/topics')]);
  const topicName = Object.fromEntries(topics.map((t) => [t.id, t.title]));
  const newFor = sessionStorage.getItem('newFor'); sessionStorage.removeItem('newFor');
  if (!currentContent && contents.length) currentContent = contents[0].id;
  const c = contents.find((x) => x.id === currentContent);
  page.innerHTML = head('内容流程', '内容', '同一个选题，按平台各写一版。改动会让已批准的内容回到草稿，需要重新审核。',
    `<select id="n-platform" style="width:auto"><option value="wechat">公众号长文</option><option value="youtube">YouTube 视频</option></select>
     <select id="n-topic" style="width:auto">${topics.filter((t) => t.status === 'picked').map((t) => `<option value="${t.id}" ${String(t.id) === newFor ? 'selected' : ''}>${esc(t.title.slice(0, 18))}</option>`).join('')}<option value="">（不挂选题）</option></select>
     <button class="btn" id="n-add">新建</button>`) +
    `<div class="split"><div>${contents.map((x) => `<div class="list-item ${x.id === currentContent ? 'on' : ''}" data-open="${x.id}">
        <div class="row">${ptag(x.platform)}${tag(x.status)}</div>
        <div class="t">${esc(x.title || '（无标题）')}</div><div class="muted small">${esc(topicName[x.topic_id] || '')}</div></div>`).join('') || '<div class="empty">空</div>'}</div>
      <div>${c ? editor(c) : '<div class="empty">选择或新建一条内容</div>'}</div></div>`;
  page.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => { currentContent = Number(el.dataset.open); contentsPage(); }));
  $('#n-add').addEventListener('click', guard(async () => {
    const r = await api('/contents', { method: 'POST', body: { platform: $('#n-platform').value, topicId: Number($('#n-topic').value) || null, title: '' } });
    currentContent = r.id; contentsPage();
  }));
  if (c) bindEditor(c);
}
function editor(c) {
  const isVideo = c.platform === 'youtube';
  return `<div class="card">
    <div class="row">${ptag(c.platform)}${tag(c.status)}<span class="muted small mono">#${c.id} · 更新 ${fmtDate(c.updated_at, true)}</span>
      <span class="spacer"></span><button class="btn ghost sm" id="e-save">保存</button>
      <button class="btn sm" id="e-submit" ${c.status === 'in_review' || c.status === 'approved' ? 'disabled' : ''}>送审</button></div>
    ${c.review_note ? `<div class="note" style="margin-top:12px">审核意见：${esc(c.review_note)}</div>` : ''}
    <div class="grid g2" style="margin-top:14px">
      <label class="f">${isVideo ? '视频标题（≤100 字）' : '文章标题'}<input type="text" id="e-title" value="${esc(c.title || '')}" ${isVideo ? 'maxlength="100"' : ''}></label>
      <label class="f">${isVideo ? '视频文件（本机路径）' : '封面（本机路径或网络地址）'}<input type="text" id="e-media" value="${esc(isVideo ? c.media_path || '' : c.options.cover || '')}"></label>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <label class="f">${isVideo ? '视频简介' : '正文（Markdown）'}<textarea id="e-body">${esc(c.body || '')}</textarea></label>
      <div><div class="f small" style="color:var(--t2);margin-bottom:5px">预览</div><div class="preview" id="e-preview">${md(c.body)}</div></div>
    </div>
    ${isVideo ? `<label class="f" style="margin-top:12px">X 同发文案（可选。和视频一起审核；不要放链接，带链接的帖子按 $0.20 计费，链接放评论）
      <textarea id="e-xtext" style="min-height:110px">${esc(c.options.xText || '')}</textarea></label>
      <div class="row small"><span class="muted" id="e-xcount"></span></div>` : ''}
  </div>`;
}
const X_LINK = /https?:\/\/|www\.|\b[\w-]+\.(com|io|ai|dev|one|net|org|cn)\b/i;
function xCount(text) {
  // X counts CJK characters as 2.
  const n = [...text].reduce((s, ch) => s + (/[ᄀ-￿]/.test(ch) ? 2 : 1), 0);
  const warn = [n > 280 ? `超过 280（${n}），需要 X Premium 才能发长帖` : `${n} / 280`, X_LINK.test(text) ? '含链接，排期时会被拦下' : ''].filter(Boolean);
  return warn.join(' · ');
}
function bindEditor(c) {
  const isVideo = c.platform === 'youtube';
  $('#e-body').addEventListener('input', (e) => { $('#e-preview').innerHTML = md(e.target.value); });
  if (isVideo) {
    const upd = () => { $('#e-xcount').textContent = xCount($('#e-xtext').value); };
    $('#e-xtext').addEventListener('input', upd); upd();
  }
  const save = async () => {
    const media = $('#e-media').value.trim();
    await api(`/contents/${c.id}`, { method: 'PUT', body: { title: $('#e-title').value.trim(), body: $('#e-body').value,
      ...(isVideo ? { mediaPath: media || null, options: { xText: $('#e-xtext').value.trim() } } : { options: { cover: media || undefined } }) } });
  };
  $('#e-save').addEventListener('click', guard(async () => { await save(); toast('已保存（如之前已批准，现在回到草稿）'); contentsPage(); }));
  $('#e-submit').addEventListener('click', guard(async () => { await save(); await api(`/contents/${c.id}/submit`, { method: 'POST' }); toast('已送审'); refreshReviewCount(); contentsPage(); }));
}

// ---------- 05 审核 ----------
async function reviewPage() {
  const contents = await api('/contents');
  const queue = contents.filter((c) => c.status === 'in_review');
  const recent = contents.filter((c) => c.status === 'approved' || c.status === 'rejected').slice(0, 6);
  page.innerHTML = head('内容流程', '审核', '只有在这里批准的内容，才会进入排期和发布。') +
    (queue.length ? queue.map((c) => `<div class="card" style="margin-bottom:16px;padding-right:140px" id="rv-${c.id}">
      <div class="row">${ptag(c.platform)}<span class="muted small mono">#${c.id}</span></div>
      <h3 style="font-size:20px;margin-top:10px">${esc(c.title || '（无标题）')}</h3>
      ${c.platform === 'youtube' ? `<p class="mono small">视频：${esc(c.media_path || '未设置')}</p>` : `<p class="mono small">封面：${esc(c.options.cover || '未设置')}</p>`}
      <div class="preview" style="max-height:340px">${md(c.body)}</div>
      ${c.platform === 'youtube' && c.options.xText ? `<div class="f small" style="margin-top:12px;color:var(--t2)">X 同发文案 · ${esc(xCount(c.options.xText))}</div>
        <div class="preview" style="max-height:200px;white-space:pre-wrap">${esc(c.options.xText)}</div>` : ''}
      <div class="row" style="margin-top:14px"><input type="text" placeholder="审核意见（退回时必填）" data-note="${c.id}" style="max-width:420px">
        <button class="btn ghost" data-reject="${c.id}">退回</button><button class="btn seal" data-approve="${c.id}">批准</button></div>
    </div>`).join('') : '<div class="empty">没有待审内容</div>') +
    (recent.length ? `<h2>最近处理</h2><div class="card table-card"><table><tbody>${recent.map((c) => `<tr><td>${tag(c.status)}</td><td>${esc(c.title)}</td><td class="num">${fmtDate(c.approved_at || c.updated_at, true)}</td></tr>`).join('')}</tbody></table></div>` : '');
  page.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', guard(async () => {
    const id = b.dataset.approve;
    await api(`/contents/${id}/review`, { method: 'POST', body: { approve: true, note: page.querySelector(`[data-note="${id}"]`).value || null } });
    const card = $(`#rv-${id}`);
    card.insertAdjacentHTML('beforeend', `<div class="stamp press">已批准<small>${fmtDate(new Date().toISOString())}</small></div>`);
    card.querySelectorAll('button,input').forEach((x) => { x.disabled = true; });
    refreshReviewCount();
    setTimeout(() => toast('已批准，可以去「排期」了'), 450);
  })));
  page.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', guard(async () => {
    const id = b.dataset.reject;
    const note = page.querySelector(`[data-note="${id}"]`).value.trim();
    if (!note) throw new Error('退回请写一句原因');
    await api(`/contents/${id}/review`, { method: 'POST', body: { approve: false, note } });
    toast('已退回'); refreshReviewCount(); reviewPage();
  })));
}

// ---------- 06 排期 ----------
async function calendarPage() {
  const [posts, contents, acc] = await Promise.all([api('/posts'), api('/contents'), api('/accounts')]);
  const byId = Object.fromEntries(contents.map((c) => [c.id, c]));
  const busy = new Set(posts.filter((p) => !['failed', 'cancelled', 'deleted'].includes(p.status)).map((p) => `${p.content_id}:${p.platform}`));
  const ready = contents.filter((c) => c.status === 'approved' && !busy.has(`${c.id}:${c.platform}`));
  const yt = (acc.data || []).filter((a) => a.platform === 'youtube');
  const xs = (acc.data || []).filter((a) => a.platform === 'twitter' || a.platform === 'x');
  const def = new Date(Date.now() + 3600e3); def.setMinutes(0, 0, 0);
  const localValue = new Date(def.getTime() - def.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

  page.innerHTML = head('内容流程', '排期', '已批准的内容在这里定时间、定可见性，然后交给发布通道。', '<button class="btn ghost" id="c-refresh">刷新状态</button>') +
    `<h2>待排期 · ${ready.length}</h2>` +
    (ready.length ? `<div class="grid g2">${ready.map((c) => c.platform === 'youtube' ? `<div class="card" data-yt="${c.id}">
        <div class="row"><span class="lane write">AIsa 发布通道</span>${ptag('youtube')}</div>
        <h3 style="margin-top:10px">${esc(c.title)}</h3>
        <div class="grid g2" style="margin-top:10px">
          <label class="f">频道<select data-k="account">${yt.map((a) => `<option value="${esc(a.id)}">@${esc(a.username)}</option>`).join('')}</select></label>
          <label class="f">发布时间（本机时区）<input type="datetime-local" data-k="at" value="${localValue}"></label>
        </div>
        <div class="f small" style="margin-top:10px">可见性</div>
        <div class="choice">${['private:私密', 'unlisted:不公开', 'public:公开'].map((v) => { const [k, l] = v.split(':'); return `<label><input type="radio" name="vis-${c.id}" value="${k}" ${k === 'private' ? 'checked' : ''}><span>${l}</span></label>`; }).join('')}</div>
        <div class="f small" style="margin-top:10px">是否面向儿童（YouTube 要求明确选择）</div>
        <div class="choice"><label><input type="radio" name="kids-${c.id}" value="false"><span>不是</span></label><label><input type="radio" name="kids-${c.id}" value="true"><span>是</span></label></div>
        <label class="row small" style="margin-top:10px"><input type="checkbox" data-k="ai"> 含 AI 生成的逼真内容（YouTube 会加标注）</label>
        <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
          ${xs.length && c.options.xText ? `<label class="row small"><input type="checkbox" data-k="x"> 同一个请求，把这条视频也发到 X
            <select data-k="xacc" style="width:auto">${xs.map((a) => `<option value="${esc(a.id)}">@${esc(a.username)}</option>`).join('')}</select></label>
            <div class="preview small" style="margin-top:8px;max-height:120px;white-space:pre-wrap;padding:10px 12px">${esc(c.options.xText)}</div>
            <div class="muted small" style="margin-top:4px">X 上公开可见，不能设私密 · 已审核的文案 · ${esc(xCount(c.options.xText))}</div>`
            : `<span class="muted small">${xs.length ? '这条内容没有 X 文案，要同发先在「内容」里写好并重新送审。' : '还没连接 X 账号。'}</span>`}
        </div>
        <div class="row" style="margin-top:14px"><span class="muted small">发布成功后计费：YouTube 约 $0.01，X 约 $0.015</span><span class="spacer"></span><button class="btn seal" data-go-yt="${c.id}">排期</button></div>
      </div>` : `<div class="card">
        <div class="row"><span class="lane write">微信官方接口</span>${ptag('wechat')}</div>
        <h3 style="margin-top:10px">${esc(c.title)}</h3>
        <label class="f" style="margin-top:10px">排版主题<select data-theme="${c.id}"><option value="default">default</option><option value="lapis">lapis</option><option value="orangeheart">orangeheart</option><option value="rainbow">rainbow</option><option value="pie">pie</option><option value="maize">maize</option><option value="purple">purple</option><option value="phycat">phycat</option></select></label>
        <p class="muted small">只写入草稿箱。群发请在公众号后台核对后手动操作。</p>
        <div class="row"><span class="spacer"></span><button class="btn seal" data-go-wx="${c.id}">写入草稿箱</button></div>
      </div>`).join('')}</div>` : '<div class="empty">没有已批准、待排期的内容</div>') +
    `<h2>时间线</h2>` +
    (posts.length ? `<div class="timeline">${posts.map((p) => {
      const c = byId[p.content_id] || {};
      const d = new Date(p.scheduled_for || p.created_at);
      return `<div class="card sched" style="padding:12px 16px;margin-bottom:10px">
        <div class="when">${d.getMonth() + 1}月<b>${String(d.getDate()).padStart(2, '0')}</b></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${esc(c.title || '')}</div>
          <div class="row small" style="margin-top:4px"><span class="mono">${fmtDate(d.toISOString(), true).slice(11)}</span>${ptag(p.platform)}${tag(p.status)}
            <span class="muted">${p.channel === 'aisa' ? 'AIsa 发布通道' : '微信官方接口'}</span><span class="muted mono">${esc(p.remote_id || '')}</span></div>
        </div>
        ${p.url ? `<a class="btn sm" href="${safeUrl(p.url)}" target="_blank" rel="noopener">打开 ↗</a>` : ''}
        ${p.channel === 'aisa' ? `<button class="btn sm" data-refresh="${p.id}">更新状态</button>` : ''}</div>`;
    }).join('')}</div>` : '<div class="empty">还没有排期</div>');

  page.querySelectorAll('[data-go-yt]').forEach((b) => b.addEventListener('click', guard(async () => {
    const id = b.dataset.goYt;
    const card = page.querySelector(`[data-yt="${id}"]`);
    const vis = card.querySelector(`input[name="vis-${id}"]:checked`)?.value;
    const kids = card.querySelector(`input[name="kids-${id}"]:checked`)?.value;
    if (!kids) throw new Error('请明确选择「是否面向儿童」');
    const at = new Date(card.querySelector('[data-k="at"]').value);
    if (!(at > new Date(Date.now() + 60e3))) throw new Error('发布时间需要至少晚于现在 1 分钟');
    const withX = card.querySelector('[data-k="x"]')?.checked;
    const xAcc = withX ? card.querySelector('[data-k="xacc"]').value : null;
    const xName = withX ? card.querySelector('[data-k="xacc"]').selectedOptions[0].textContent : '';
    const ok = await confirmBox(withX ? '确认排期：YouTube + X' : '确认排期', `<p><b>${esc(byId[id].title)}</b></p>
      <p class="mono small">${fmtDate(at.toISOString(), true)}</p>
      <p class="small">YouTube：${vis === 'public' ? '公开' : vis === 'unlisted' ? '不公开' : '私密'} · 面向儿童：${kids === 'true' ? '是' : '否'}</p>
      ${withX ? `<p class="small">X ${esc(xName)}：<b>公开发布</b>，同一条视频 + 已审核的文案</p>` : ''}
      <p class="muted small">视频先上传到 AIsa，到点后由发布通道推送${withX ? '，每个平台各自返回结果' : '到 YouTube'}。</p>`, '排期');
    if (!ok) return;
    b.disabled = true; toast('上传视频中…');
    await api(`/contents/${id}/publish/youtube`, { method: 'POST', body: { accountId: card.querySelector('[data-k="account"]').value, visibility: vis,
      madeForKids: kids === 'true', scheduledFor: at.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      containsSyntheticMedia: card.querySelector('[data-k="ai"]').checked, x: withX ? { accountId: xAcc } : null } });
    toast(withX ? '已排期：YouTube + X' : '已排期'); calendarPage(); refreshSpend();
  })));
  page.querySelectorAll('[data-go-wx]').forEach((b) => b.addEventListener('click', guard(async () => {
    const id = b.dataset.goWx;
    const theme = page.querySelector(`[data-theme="${id}"]`).value;
    if (!(await confirmBox('写入公众号草稿箱', `<p><b>${esc(byId[id].title)}</b></p><p class="muted small">主题 ${esc(theme)}。只创建草稿，不会群发。</p>`, '写入'))) return;
    b.disabled = true; toast('排版并上传图片中…');
    await api(`/contents/${id}/publish/wechat`, { method: 'POST', body: { theme } });
    toast('已写入草稿箱，去公众号后台核对'); calendarPage();
  })));
  page.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', guard(async () => { await api(`/posts/${b.dataset.refresh}/refresh`, { method: 'POST' }); calendarPage(); })));
  $('#c-refresh').addEventListener('click', guard(async () => {
    await Promise.all(posts.filter((p) => p.channel === 'aisa' && !['published', 'failed'].includes(p.status)).map((p) => api(`/posts/${p.id}/refresh`, { method: 'POST' })));
    calendarPage();
  }));
}

// ---------- 07 数据 ----------
async function dataPage() {
  const [acc, spend, posts] = await Promise.all([api('/accounts'), api('/spend'), api('/posts')]);
  const yt = (acc.data || []).find((a) => a.platform === 'youtube');
  const [ch, ins] = yt ? await Promise.all([api(`/youtube/channel/${yt.id}`).catch(() => null), api(`/youtube/insights/${yt.id}`).catch(() => null)]) : [null, null];
  const m = ins?.metrics || {};
  const mv = (k) => fmtN(m[k]?.total);
  const vids = ch?.videos?.posts || [];
  const publicStats = ch?.publicStats || {};
  const ours = new Set(posts.map((p) => p.url).filter(Boolean));
  page.innerHTML = head('运营', '数据', `频道数据来自已授权账号；播放量来自公开数据接口，按需拉取。频道数据同步于 ${fmtDate(ch?.videos?.lastUpdated, true)}。`) +
    `<div class="grid g4">
      <div class="card stat"><div class="n">${fmtN(yt?.followersCount)}</div><div class="l">YouTube 粉丝</div></div>
      <div class="card stat"><div class="n">${vids.length}</div><div class="l">频道视频</div></div>
      <div class="card stat"><div class="n">${posts.filter((p) => p.status === 'published').length}</div><div class="l">经工作台发布</div></div>
      <div class="card stat"><div class="n">$${(spend.usd || 0).toFixed(3)}</div><div class="l">本地记账（${spend.calls} 次调用）</div></div>
    </div>
    <h2>频道后台 · 近 30 天${ins?.dateRange ? `（${esc(ins.dateRange.since)} 至 ${esc(ins.dateRange.until)}）` : ''}</h2>
    ${ins ? `<div class="grid g4">
      <div class="card stat"><div class="n">${mv('views')}</div><div class="l">播放</div></div>
      <div class="card stat"><div class="n">${mv('estimatedMinutesWatched')}</div><div class="l">观看分钟</div></div>
      <div class="card stat"><div class="n">+${mv('subscribersGained')}</div><div class="l">新增订阅</div></div>
      <div class="card stat"><div class="n">−${mv('subscribersLost')}</div><div class="l">取消订阅</div></div>
    </div><p class="muted small">来自 YouTube Analytics，数据有 2 到 3 天延迟。</p>` : '<div class="note">频道分析接口暂时拿不到数据，下面先看公开数据。</div>'}
    <h2>频道视频</h2>
    <div class="card table-card"><table><thead><tr><th>发布</th><th>视频</th><th style="text-align:right">赞</th><th style="text-align:right">评论</th><th style="text-align:right">播放（公开）</th></tr></thead><tbody>
    ${vids.map((v) => { const s = publicStats[v.permalink]; return `<tr>
      <td class="num" style="text-align:left">${fmtDate(v.createdTime)}</td>
      <td><div class="t">${esc((v.message || '').split('\n')[0])}</div><a class="src" href="${safeUrl(v.permalink)}" target="_blank" rel="noopener">${esc(v.permalink)}</a>
        ${ours.has(v.permalink) ? ' <span class="tag seal">工作台发布</span>' : ''}</td>
      <td class="num">${fmtN(v.likeCount)}</td><td class="num">${fmtN(v.commentCount)}</td>
      <td class="num">${s ? `${fmtN(s.views)}<div class="muted small">${fmtDate(s.fetched_at, true)} <button class="btn sm ghost" data-views="${esc(v.permalink)}" title="重新拉取 $0.014">↻</button></div>` : `<button class="btn sm ghost" data-views="${esc(v.permalink)}">拉取 $0.014</button>`}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">没有视频</td></tr>'}
    </tbody></table></div>
    <h2>调用记账</h2>
    <div class="card table-card"><table><thead><tr><th>时间</th><th>请求</th><th>状态</th><th style="text-align:right">费用</th></tr></thead><tbody>
    ${spend.recent.map((s) => `<tr><td class="num" style="text-align:left">${fmtDate(s.at, true)}</td><td class="mono small">${esc(s.method)} ${esc(s.path.replace(/.*\/data\//, 'data/'))}</td><td class="num">${s.http_status}</td><td class="num">$${s.cost_usd.toFixed(4)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">发布费在发布成功后异步结算，不在请求响应里，以 AIsa 后台用量为准。</p>`;
  page.querySelectorAll('[data-views]').forEach((b) => b.addEventListener('click', guard(async () => {
    b.disabled = true;
    await api('/youtube/public-stats', { method: 'POST', body: { url: b.dataset.views } });
    dataPage(); refreshSpend();
  })));
}

// ---------- shell ----------
const PAGES = { overview: overviewPage, accounts: accountsPage, radar: radarPage, topics: topicsPage, contents: contentsPage, review: reviewPage, calendar: calendarPage, data: dataPage };
async function route() {
  const name = (location.hash.slice(1) || 'overview').split('?')[0];
  document.querySelectorAll('#rail a').forEach((a) => a.classList.toggle('on', a.dataset.page === name));
  page.innerHTML = '<div class="muted">加载中…</div>';
  try { await (PAGES[name] || overviewPage)(); } catch (e) { page.innerHTML = `<div class="empty">出错了：${esc(e.message)}</div>`; }
}
async function refreshSpend() {
  const [s, b] = await Promise.all([api('/spend').catch(() => null), api('/balance').catch(() => null)]);
  if (s) $('#spend').textContent = `$${(s.usd || 0).toFixed(3)} · ${s.calls} 次`;
  if (b) $('#balance').textContent = `$${b.usd.toFixed(2)}`;
}
async function refreshReviewCount() { const c = await api('/contents').catch(() => []); const n = c.filter((x) => x.status === 'in_review').length; $('#review-count').textContent = n || ''; }

api('/accounts').then((r) => { $('#ws-sub').textContent = `本地 · ${(r.data || []).length + 1} 个账号已连接`; }).catch(() => {});
window.addEventListener('hashchange', route);
route(); refreshSpend(); refreshReviewCount();
