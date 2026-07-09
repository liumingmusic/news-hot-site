// assets/js/app.js
const MANIFEST_URL = 'data/manifest.json';
const SNAP_BASE = 'data/snapshots/';

const tabsEl = document.getElementById('tabs');
const contentEl = document.getElementById('content');
const historyEl = document.getElementById('history');
const searchEl = document.getElementById('search');
const updatedEl = document.getElementById('updated');
const headlinesEl = document.getElementById('headlines');

const state = { manifest: null, snapshot: null, domain: '全部', query: '' };

// 领域对应的 emoji 图标
const DOMAIN_EMOJI = {
  全部: '🔥', 科技: '💡', 人工智能: '🤖', 人文: '📚', 社会: '🏙️',
  教育: '🎓', 娱乐: '🎬', 医疗: '🏥', 财经: '💰', 体育: '⚽',
  游戏: '🎮', 汽车: '🚗', 美食: '🍜', 旅游: '✈️', 军事: '🛡️',
  国际: '🌐', 文化: '🎭',
};

// 领域对应的专属配色（标签激活色 / 卡片左侧条 / 排名徽章 / 头版标签 等均跟随此色）
const DOMAIN_COLOR = {
  全部: '#ff5a3c',     // 站点主色（橙红）
  科技: '#2563eb',     // 蓝
  人工智能: '#8b5cf6', // 紫
  人文: '#b45309',     // 琥珀棕
  社会: '#0d9488',     // 青
  教育: '#4338ca',     // 靛
  娱乐: '#ec4899',     // 粉
  医疗: '#dc2626',     // 红
  财经: '#059669',     // 翠绿
  体育: '#ea580c',     // 橙
  游戏: '#7c3aed',     // 紫罗兰
  汽车: '#0284c7',     // 天蓝
  美食: '#d97706',     // 橙黄
  旅游: '#06b6d4',     // 青蓝
  军事: '#65a30d',     // 橄榄绿
  国际: '#1e3a8a',     // 深蓝
  文化: '#c026d3',     // 品红
};
function colorOf(name) { return DOMAIN_COLOR[name] || 'var(--accent)'; }

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function formatTs(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期
function formatTime(ms) {
  if (!ms || isNaN(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return formatTs(new Date(ms).toISOString());
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' 小时前';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + ' 天前';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatHot(hot) {
  if (hot == null || hot === '') return '';
  if (typeof hot === 'number') {
    return hot >= 10000 ? (hot / 10000).toFixed(1) + '万' : String(hot);
  }
  const s = String(hot);
  if (/万/.test(s)) return s;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  if (isNaN(n)) return s;
  return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);
}

async function init() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest ' + res.status);
    state.manifest = await res.json();
  } catch (e) {
    updatedEl.textContent = '暂无数据，等待首次自动抓取（GitHub Actions 每两天一次）。';
    contentEl.innerHTML =
      '<p class="empty">还没有任何快照。推送代码后 Actions 会自动抓取并生成数据；也可在仓库 Actions 页手动触发一次。</p>';
    return;
  }

  const snaps = state.manifest.snapshots || [];
  if (!snaps.length) {
    contentEl.innerHTML = '<p class="empty">暂无快照数据。</p>';
    return;
  }

  snaps.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = s.file;
    opt.textContent = formatTs(s.generatedAt) + (i === 0 ? '（最新）' : '');
    historyEl.appendChild(opt);
  });
  historyEl.addEventListener('change', () => loadSnapshot(historyEl.value));

  searchEl.addEventListener('input', () => {
    state.query = searchEl.value.trim().toLowerCase();
    render();
  });

  await loadSnapshot(snaps[0].file);
}

async function loadSnapshot(file) {
  try {
    const res = await fetch(SNAP_BASE + file, { cache: 'no-cache' });
    state.snapshot = await res.json();
  } catch (e) {
    contentEl.innerHTML = '<p class="empty">加载快照失败：' + esc(e.message) + '</p>';
    return;
  }
  state.domain = '全部';
  buildTabs(Object.keys(state.snapshot.categories || {}));
  renderHeadlines();
  render();
}

function buildTabs(cats) {
  tabsEl.innerHTML = '';
  ['全部', ...cats].forEach((name) => {
    const b = document.createElement('button');
    b.className = 'tab' + (name === state.domain ? ' active' : '');
    b.innerHTML = `<span class="tab-emoji">${DOMAIN_EMOJI[name] || '📌'}</span>${esc(name)}`;
    b.style.setProperty('--c', colorOf(name));
    b.onclick = () => {
      state.domain = name;
      [...tabsEl.children].forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      render();
    };
    tabsEl.appendChild(b);
  });
  // 重置搜索
  searchEl.value = '';
  state.query = '';
}

function render() {
  const snap = state.snapshot;
  if (!snap) return;
  updatedEl.textContent =
    '快照时间：' + formatTs(snap.generatedAt) + ' · 共 ' + (snap.total || 0) + ' 条';

  const domains = state.domain === '全部' ? Object.keys(snap.categories || {}) : [state.domain];
  let html = '';
  for (const d of domains) {
    const items = snap.categories[d] || [];
    const filtered = state.query
      ? items.filter((it) => {
          const hay = ((it.title || '') + ' ' + (it.desc || '') + ' ' + (it.source || '')).toLowerCase();
          return hay.includes(state.query);
        })
      : items;
    if (!filtered.length) continue;
    const emoji = DOMAIN_EMOJI[d] || '📌';
    html += `<section class="domain" style="--c:${colorOf(d)}"><h2 class="domain-title"><span class="domain-emoji">${emoji}</span>${esc(d)} <span class="count">${filtered.length}</span></h2><div class="grid">`;
    for (const it of filtered) html += cardHtml(it);
    html += '</div></section>';
  }
  contentEl.innerHTML = html || '<p class="empty">没有匹配的结果。</p>';
}

function cardHtml(it) {
  const hot = formatHot(it.hot);
  const time = formatTime(it.time);
  const desc = (it.desc || '').trim();
  const titleHtml = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);

  const descHtml = desc
    ? `<p class="card-desc">${esc(desc)}</p>`
    : '';

  const meta = [];
  if (it.source) meta.push(`<span class="meta-source">${esc(it.source)}</span>`);
  if (time) meta.push(`<span class="meta-time">🕒 ${esc(time)}</span>`);
  if (hot) meta.push(`<span class="meta-hot">🔥 ${esc(hot)}</span>`);

  return `<article class="card" style="--c:${colorOf(it.category)}">
    <div class="card-rank${it.rank <= 3 ? ' top' : ''}">${esc(it.rank)}</div>
    <div class="card-body">
      <h3 class="card-title">${titleHtml}</h3>
      ${descHtml}
      <div class="card-meta">${meta.join('')}</div>
    </div>
  </article>`;
}

// ---------- 今日头版（置顶） ----------
function hotRankClient(hot) {
  if (hot == null) return -1;
  const n = typeof hot === 'number' ? hot : parseFloat(String(hot).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? -1 : n;
}

// 兼容旧快照（无 headlines 字段）：取每个领域最热 1 条，按热度排前 6
function buildHeadlinesFallback(categories) {
  const arr = Object.entries(categories || {})
    .filter(([, items]) => Array.isArray(items) && items.length)
    .map(([domain, items]) => ({ ...items[0], _domain: domain }));
  arr.sort((a, b) => hotRankClient(b.hot) - hotRankClient(a.hot));
  return arr.slice(0, 6);
}

function getHeadlines() {
  const snap = state.snapshot;
  if (!snap) return [];
  if (Array.isArray(snap.headlines) && snap.headlines.length) return snap.headlines;
  return buildHeadlinesFallback(snap.categories || {});
}

function headlineCardHtml(it, idx) {
  const isLead = idx === 0;
  const domain = it._domain || it.category || '';
  const emoji = DOMAIN_EMOJI[domain] || '📌';
  const hot = formatHot(it.hot);
  const time = formatTime(it.time);
  const desc = (it.desc || '').trim();
  const titleHtml = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);
  const descHtml = desc ? `<p class="hl-desc">${esc(desc)}</p>` : '';
  const meta = [];
  if (it.source) meta.push(`<span class="meta-source">${esc(it.source)}</span>`);
  if (time) meta.push(`<span class="meta-time">🕒 ${esc(time)}</span>`);
  if (hot) meta.push(`<span class="meta-hot">🔥 ${esc(hot)}</span>`);
  return `<article class="head-line-card${isLead ? ' lead' : ''}" style="--c:${colorOf(domain)}">
    <div class="hl-badge">头版</div>
    <div class="hl-body">
      ${domain ? `<span class="hl-domain">${emoji} ${esc(domain)}</span>` : ''}
      <h3 class="hl-title">${titleHtml}</h3>
      ${descHtml}
      <div class="hl-meta">${meta.join('')}</div>
    </div>
  </article>`;
}

function renderHeadlines() {
  if (!headlinesEl) return;
  const items = getHeadlines();
  if (!items.length) {
    headlinesEl.style.display = 'none';
    headlinesEl.innerHTML = '';
    return;
  }
  headlinesEl.style.display = '';
  const cards = items.map((it, i) => headlineCardHtml(it, i)).join('');
  headlinesEl.innerHTML =
    `<div class="headlines-head">🔥 今日头版 · 各大领域最热</div><div class="headlines-grid">${cards}</div>`;
}

init();
