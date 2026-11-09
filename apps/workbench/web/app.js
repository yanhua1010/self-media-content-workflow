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

// ---------- 01 账号 ----------
async function accountsPage() {
  const [acc, health, wx] = await Promise.all([api('/accounts'), api('/accounts/health'), api('/wechat/status')]);
  const h = Object.fromEntries((health.data || []).map((x) => [x.accountId, x]));
  const cards = (acc.data || []).map((a) => {
    const hs = h[a.id];
    return `<div class="card">
      <div class="row"><span class="lane write">AIsa 发布通道</span><span class="spacer"></span>
        ${hs?.status === 'healthy' ? '<span class="tag ok"><span class="dot"></span>正常</span>' : `<span class="tag seal">${esc(hs?.status || '未知')}</span>`}</div>
      <div class="row" style="margin-top:14px">
        ${a.avatarUrl ? `<img src="${safeUrl(a.avatarUrl)}" alt="" width="44" height="44" style="border-radius:50%">` : ''}
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
      <div class="row"><span class="lane write">微信官方接口</span><span class="spacer"></span>
        ${wx.credentials && wx.wenyan ? '<span class="tag ok"><span class="dot"></span>可写草稿箱</span>' : '<span class="tag seal">未就绪</span>'}</div>
      <h3 style="margin-top:14px">彦华AI路书</h3><div class="muted small">公众号 · 只写草稿箱，群发在公众号后台手动完成</div>
      <div class="grid g2" style="margin-top:14px">
        <div class="stat"><div class="n mono" style="font-size:14px">${wx.wenyan ? esc(wx.wenyan) : '未安装'}</div><div class="l">wenyan 排版</div></div>
        <div class="stat"><div class="n mono" style="font-size:14px">${wx.credentials ? '已配置' : '缺失'}</div><div class="l">AppID / Secret（只检查是否存在）</div></div>
      </div>
    </div>`;
  const connectable = ['twitter', 'linkedin', 'threads', 'instagram', 'tiktok', 'facebook'];
  page.innerHTML = head('01 / ACCOUNTS', '账号', '平台官方页面授权一次，之后排期、发布都在这里完成。') +
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
  if (!run) { page.innerHTML = head('02 / RADAR', '雷达', '多平台公开内容扫描') + form + '<div class="empty">还没有扫描记录</div>'; bindRadarForm(); return; }

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
  page.innerHTML = head('02 / RADAR', esc(run.topic), `采集于 ${fmtDate(run.collected_at, true)} · 近 ${run.params.windowDays} 天 · 本轮花费 $${(run.cost_usd || 0).toFixed(4)} · 数字是本次样本，不是全平台总量`,
    `<span class="lane read">读接口</span><button class="btn" id="mk-topic" disabled>用勾选的 <span id="pick-n">0</span> 条生成选题</button>`) +
    form +
    `<div class="grid g4" style="grid-template-columns:repeat(6,1fr)">${Object.entries(by).map(([p, b]) =>
      `<div class="card stat"><div class="n">${b.win}<span class="muted" style="font-size:13px"> / ${b.all}</span></div><div class="l">${esc(PLATFORM[p] || p)} · 窗口内 / 样本</div></div>`).join('')}</div>
    <h2>高互动样本</h2>
    <div class="filters">${['all', ...Object.keys(by)].map((p) => `<button data-f="${p}" class="${radarFilter === p ? 'on' : ''}">${p === 'all' ? '全部' : esc(PLATFORM[p] || p)}</button>`).join('')}</div>
    <table><thead><tr><th></th><th>平台</th><th>内容</th><th>发布</th><th style="text-align:right">互动</th></tr></thead><tbody>
    ${shown.slice(0, 80).map((i) => `<tr>
      <td><input type="checkbox" data-pick="${esc(i.url)}" ${radarPicked.has(i.url) ? 'checked' : ''} aria-label="选为证据"></td>
      <td><span class="tag">${esc(PLATFORM[i.platform] || i.platform)}</span></td>
      <td><div class="t">${esc(i.title) || '<span class="muted">（无文字）</span>'}</div>
        <a class="src" href="${safeUrl(i.url)}" target="_blank" rel="noopener">@${esc(i.author || '')} ↗ ${esc((i.url || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</a></td>
      <td class="num">${fmtDate(i.publishedAt)}${i.approxTime ? '<div class="muted small">约</div>' : ''}</td>
      <td class="num">${esc(metric(i))}</td></tr>`).join('')}
    </tbody></table>`;

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
  page.innerHTML = head('03 / TOPICS', '选题', '每个选题都挂着雷达里的证据：链接、发布时间、互动数据、采集时间。') +
    (topics.length ? `<div class="grid g2">${topics.map((t) => `<div class="card">
      <div class="row">${tag(t.status)}<span class="muted small mono">#${t.id} · 证据 ${t.evidence.length} 条</span><span class="spacer"></span>
        ${t.status !== 'picked' ? `<button class="btn sm" data-pick-topic="${t.id}">选定</button>` : `<a class="btn sm ghost" href="#contents" data-new-for="${t.id}">写内容 →</a>`}
        ${t.status === 'proposed' ? `<button class="btn sm ghost" data-drop="${t.id}">放弃</button>` : ''}</div>
      <h3 style="margin-top:10px;font-size:19px">${esc(t.title)}</h3>
      <p class="muted" style="margin:4px 0 0">${esc(t.angle || '')}</p>
      <ul class="evidence">${t.evidence.slice(0, 6).map((e) => `<li><span class="tag">${esc(PLATFORM[e.platform] || e.platform)}</span>
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
  page.innerHTML = head('04 / CONTENT', '内容', '同一个选题，按平台各写一版。改动会让已批准的内容回到草稿，需要重新审核。',
    `<select id="n-platform" style="width:auto"><option value="wechat">公众号长文</option><option value="youtube">YouTube 视频</option></select>
     <select id="n-topic" style="width:auto">${topics.filter((t) => t.status === 'picked').map((t) => `<option value="${t.id}" ${String(t.id) === newFor ? 'selected' : ''}>${esc(t.title.slice(0, 18))}</option>`).join('')}<option value="">（不挂选题）</option></select>
     <button class="btn" id="n-add">新建</button>`) +
    `<div class="split"><div>${contents.map((x) => `<div class="list-item ${x.id === currentContent ? 'on' : ''}" data-open="${x.id}">
        <div class="row"><span class="tag ink">${esc(PLATFORM[x.platform] || x.platform)}</span>${tag(x.status)}</div>
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
    <div class="row"><span class="tag ink">${esc(PLATFORM[c.platform])}</span>${tag(c.status)}<span class="muted small mono">#${c.id} · 更新 ${fmtDate(c.updated_at, true)}</span>
      <span class="spacer"></span><button class="btn ghost sm" id="e-save">保存</button>
      <button class="btn sm" id="e-submit" ${c.status === 'in_review' || c.status === 'approved' ? 'disabled' : ''}>送审</button></div>
    ${c.review_note ? `<div class="note" style="margin-top:12px">审核意见：${esc(c.review_note)}</div>` : ''}
    <div class="grid g2" style="margin-top:14px">
      <label class="f">${isVideo ? '视频标题（≤100 字）' : '文章标题'}<input type="text" id="e-title" value="${esc(c.title || '')}" ${isVideo ? 'maxlength="100"' : ''}></label>
      <label class="f">${isVideo ? '视频文件（本机路径）' : '封面（本机路径或网络地址）'}<input type="text" id="e-media" value="${esc(isVideo ? c.media_path || '' : c.options.cover || '')}"></label>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <label class="f">${isVideo ? '视频简介' : '正文（Markdown）'}<textarea id="e-body">${esc(c.body || '')}</textarea></label>
      <div><div class="f small" style="color:var(--ink-2);margin-bottom:5px">预览</div><div class="preview" id="e-preview">${md(c.body)}</div></div>
    </div></div>`;
}
function bindEditor(c) {
  const isVideo = c.platform === 'youtube';
  $('#e-body').addEventListener('input', (e) => { $('#e-preview').innerHTML = md(e.target.value); });
  const save = async () => {
    const media = $('#e-media').value.trim();
    await api(`/contents/${c.id}`, { method: 'PUT', body: { title: $('#e-title').value.trim(), body: $('#e-body').value,
      ...(isVideo ? { mediaPath: media || null } : { options: { cover: media || undefined } }) } });
  };
  $('#e-save').addEventListener('click', guard(async () => { await save(); toast('已保存（如之前已批准，现在回到草稿）'); contentsPage(); }));
  $('#e-submit').addEventListener('click', guard(async () => { await save(); await api(`/contents/${c.id}/submit`, { method: 'POST' }); toast('已送审'); refreshReviewCount(); contentsPage(); }));
}

// ---------- 05 审核 ----------
async function reviewPage() {
  const contents = await api('/contents');
  const queue = contents.filter((c) => c.status === 'in_review');
  const recent = contents.filter((c) => c.status === 'approved' || c.status === 'rejected').slice(0, 6);
  page.innerHTML = head('05 / REVIEW', '审核', '只有这里盖了章的内容，才会进入排期和发布。') +
    (queue.length ? queue.map((c) => `<div class="card" style="margin-bottom:16px;padding-right:140px" id="rv-${c.id}">
      <div class="row"><span class="tag ink">${esc(PLATFORM[c.platform])}</span><span class="muted small mono">#${c.id}</span></div>
      <h3 style="font-size:20px;margin-top:10px">${esc(c.title || '（无标题）')}</h3>
      ${c.platform === 'youtube' ? `<p class="mono small">视频：${esc(c.media_path || '未设置')}</p>` : `<p class="mono small">封面：${esc(c.options.cover || '未设置')}</p>`}
      <div class="preview" style="max-height:340px">${md(c.body)}</div>
      <div class="row" style="margin-top:14px"><input type="text" placeholder="审核意见（退回时必填）" data-note="${c.id}" style="max-width:420px">
        <button class="btn ghost" data-reject="${c.id}">退回</button><button class="btn seal" data-approve="${c.id}">批准</button></div>
    </div>`).join('') : '<div class="empty">没有待审内容</div>') +
    (recent.length ? `<h2>最近处理</h2><table><tbody>${recent.map((c) => `<tr><td>${tag(c.status)}</td><td>${esc(c.title)}</td><td class="num">${fmtDate(c.approved_at || c.updated_at, true)}</td></tr>`).join('')}</tbody></table>` : '');
  page.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', guard(async () => {
    const id = b.dataset.approve;
    await api(`/contents/${id}/review`, { method: 'POST', body: { approve: true, note: page.querySelector(`[data-note="${id}"]`).value || null } });
    const card = $(`#rv-${id}`);
    card.insertAdjacentHTML('beforeend', `<div class="stamp press">已审<small>${fmtDate(new Date().toISOString())}</small></div>`);
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
  const def = new Date(Date.now() + 3600e3); def.setMinutes(0, 0, 0);
  const localValue = new Date(def.getTime() - def.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

  page.innerHTML = head('06 / SCHEDULE', '排期', '已批准的内容在这里定时间、定可见性，然后交给发布通道。', '<button class="btn ghost" id="c-refresh">刷新状态</button>') +
    `<h2>待排期 · ${ready.length}</h2>` +
    (ready.length ? `<div class="grid g2">${ready.map((c) => c.platform === 'youtube' ? `<div class="card" data-yt="${c.id}">
        <div class="row"><span class="lane write">AIsa 发布通道</span><span class="tag ink">YouTube</span></div>
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
        <div class="row" style="margin-top:14px"><span class="muted small">发布成功后计费，每条约 $0.01</span><span class="spacer"></span><button class="btn seal" data-go-yt="${c.id}">排期</button></div>
      </div>` : `<div class="card">
        <div class="row"><span class="lane write">微信官方接口</span><span class="tag ink">公众号</span></div>
        <h3 style="margin-top:10px">${esc(c.title)}</h3>
        <label class="f" style="margin-top:10px">排版主题<select data-theme="${c.id}"><option value="default">default</option><option value="lapis">lapis</option><option value="orangeheart">orangeheart</option><option value="rainbow">rainbow</option><option value="pie">pie</option><option value="maize">maize</option><option value="purple">purple</option><option value="phycat">phycat</option></select></label>
        <p class="muted small">只写入草稿箱。群发请在公众号后台核对后手动操作。</p>
        <div class="row"><span class="spacer"></span><button class="btn seal" data-go-wx="${c.id}">写入草稿箱</button></div>
      </div>`).join('')}</div>` : '<div class="empty">没有已批准、待排期的内容</div>') +
    `<h2>时间线</h2>` +
    (posts.length ? `<div class="timeline">${posts.map((p) => {
      const c = byId[p.content_id] || {};
      return `<div class="slot ${esc(p.status)}"><div class="card">
        <div class="row"><span class="mono">${fmtDate(p.scheduled_for || p.created_at, true)}</span>${tag(p.status)}
          <span class="tag ink">${esc(PLATFORM[p.platform] || p.platform)}</span><span class="lane ${p.channel === 'aisa' ? 'write' : 'write'}">${p.channel === 'aisa' ? 'AIsa 发布通道' : '微信官方接口'}</span>
          <span class="spacer"></span>${p.url ? `<a class="btn sm ghost" href="${safeUrl(p.url)}" target="_blank" rel="noopener">打开 ↗</a>` : ''}
          ${p.channel === 'aisa' ? `<button class="btn sm ghost" data-refresh="${p.id}">更新</button>` : ''}</div>
        <div style="margin-top:8px;font:600 15px var(--serif)">${esc(c.title || '')}</div>
        <div class="muted small mono">${esc(p.remote_id || '')}</div></div></div>`;
    }).join('')}</div>` : '<div class="empty">还没有排期</div>');

  page.querySelectorAll('[data-go-yt]').forEach((b) => b.addEventListener('click', guard(async () => {
    const id = b.dataset.goYt;
    const card = page.querySelector(`[data-yt="${id}"]`);
    const vis = card.querySelector(`input[name="vis-${id}"]:checked`)?.value;
    const kids = card.querySelector(`input[name="kids-${id}"]:checked`)?.value;
    if (!kids) throw new Error('请明确选择「是否面向儿童」');
    const at = new Date(card.querySelector('[data-k="at"]').value);
    if (!(at > new Date(Date.now() + 60e3))) throw new Error('发布时间需要至少晚于现在 1 分钟');
    const ok = await confirmBox('确认排期', `<p><b>${esc(byId[id].title)}</b></p><p class="mono small">${fmtDate(at.toISOString(), true)} · ${vis === 'public' ? '公开' : vis === 'unlisted' ? '不公开' : '私密'} · 面向儿童：${kids === 'true' ? '是' : '否'}</p><p class="muted small">视频会先上传到 AIsa，到点后由发布通道推送到 YouTube。</p>`, '排期');
    if (!ok) return;
    b.disabled = true; toast('上传视频中…');
    await api(`/contents/${id}/publish/youtube`, { method: 'POST', body: { accountId: card.querySelector('[data-k="account"]').value, visibility: vis,
      madeForKids: kids === 'true', scheduledFor: at.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, containsSyntheticMedia: card.querySelector('[data-k="ai"]').checked } });
    toast('已排期'); calendarPage(); refreshSpend();
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
  const ch = yt ? await api(`/youtube/channel/${yt.id}`).catch(() => null) : null;
  const vids = ch?.videos?.posts || [];
  const publicStats = ch?.publicStats || {};
  const ours = new Set(posts.map((p) => p.url).filter(Boolean));
  page.innerHTML = head('07 / DATA', '数据', `频道数据来自已授权账号；播放量来自公开数据接口，按需拉取。频道数据同步于 ${fmtDate(ch?.videos?.lastUpdated, true)}。`) +
    `<div class="grid g4">
      <div class="card stat"><div class="n">${fmtN(yt?.followersCount)}</div><div class="l">YouTube 粉丝</div></div>
      <div class="card stat"><div class="n">${vids.length}</div><div class="l">频道视频</div></div>
      <div class="card stat"><div class="n">${posts.filter((p) => p.status === 'published').length}</div><div class="l">经工作台发布</div></div>
      <div class="card stat"><div class="n">$${(spend.usd || 0).toFixed(3)}</div><div class="l">本地记账（${spend.calls} 次调用）</div></div>
    </div>
    <h2>频道视频</h2>
    <table><thead><tr><th>发布</th><th>视频</th><th style="text-align:right">赞</th><th style="text-align:right">评论</th><th style="text-align:right">播放（公开）</th></tr></thead><tbody>
    ${vids.map((v) => { const s = publicStats[v.permalink]; return `<tr>
      <td class="num" style="text-align:left">${fmtDate(v.createdTime)}</td>
      <td><div class="t">${esc((v.message || '').split('\n')[0])}</div><a class="src" href="${safeUrl(v.permalink)}" target="_blank" rel="noopener">${esc(v.permalink)}</a>
        ${ours.has(v.permalink) ? ' <span class="tag seal">工作台发布</span>' : ''}</td>
      <td class="num">${fmtN(v.likeCount)}</td><td class="num">${fmtN(v.commentCount)}</td>
      <td class="num">${s ? `${fmtN(s.views)}<div class="muted small">${fmtDate(s.fetched_at, true)} <button class="btn sm ghost" data-views="${esc(v.permalink)}" title="重新拉取 $0.014">↻</button></div>` : `<button class="btn sm ghost" data-views="${esc(v.permalink)}">拉取 $0.014</button>`}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">没有视频</td></tr>'}
    </tbody></table>
    <div class="note" style="margin-top:14px">AIsa 文档里的 YouTube 频道分析接口（每日播放、留存、受众画像）目前线上返回 404，这里先用公开数据兜底，接口可用后换成频道后台数据。</div>
    <h2>调用记账</h2>
    <table><thead><tr><th>时间</th><th>请求</th><th>状态</th><th style="text-align:right">费用</th></tr></thead><tbody>
    ${spend.recent.map((s) => `<tr><td class="num" style="text-align:left">${fmtDate(s.at, true)}</td><td class="mono small">${esc(s.method)} ${esc(s.path.replace(/.*\/data\//, 'data/'))}</td><td class="num">${s.http_status}</td><td class="num">$${s.cost_usd.toFixed(4)}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">发布费在发布成功后异步结算，不在请求响应里，以 AIsa 后台用量为准。</p>`;
  page.querySelectorAll('[data-views]').forEach((b) => b.addEventListener('click', guard(async () => {
    b.disabled = true;
    await api('/youtube/public-stats', { method: 'POST', body: { url: b.dataset.views } });
    dataPage(); refreshSpend();
  })));
}

// ---------- shell ----------
const PAGES = { accounts: accountsPage, radar: radarPage, topics: topicsPage, contents: contentsPage, review: reviewPage, calendar: calendarPage, data: dataPage };
async function route() {
  const name = (location.hash.slice(1) || 'accounts').split('?')[0];
  document.querySelectorAll('#rail a').forEach((a) => a.classList.toggle('on', a.dataset.page === name));
  page.innerHTML = '<div class="muted">加载中…</div>';
  try { await (PAGES[name] || accountsPage)(); } catch (e) { page.innerHTML = `<div class="empty">出错了：${esc(e.message)}</div>`; }
}
async function refreshSpend() { const s = await api('/spend').catch(() => null); if (s) $('#spend').textContent = `$${(s.usd || 0).toFixed(4)} · ${s.calls} 次`; }
async function refreshReviewCount() { const c = await api('/contents').catch(() => []); const n = c.filter((x) => x.status === 'in_review').length; $('#review-count').textContent = n || ''; }

$('#today').textContent = fmtDate(new Date().toISOString());
window.addEventListener('hashchange', route);
route(); refreshSpend(); refreshReviewCount();
