// assets/js/app.js
const MANIFEST_URL = 'data/manifest.json';
const SNAP_BASE = 'data/snapshots/';

const tabsEl = document.getElementById('tabs');
const contentEl = document.getElementById('content');
const historyEl = document.getElementById('history');
const searchEl = document.getElementById('search');
const updatedEl = document.getElementById('updated');

const state = { manifest: null, snapshot: null, domain: '全部', query: '' };

const $ = (sel) => document.querySelector(sel);

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
  render();
}

function buildTabs(cats) {
  tabsEl.innerHTML = '';
  ['全部', ...cats].forEach((name) => {
    const b = document.createElement('button');
    b.className = 'tab' + (name === state.domain ? ' active' : '');
    b.textContent = name;
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
      ? items.filter((it) => (it.title || '').toLowerCase().includes(state.query))
      : items;
    if (!filtered.length) continue;
    html += `<section class="domain"><h2 class="domain-title">${esc(d)} <span class="count">${filtered.length}</span></h2><div class="grid">`;
    for (const it of filtered) html += cardHtml(it);
    html += '</div></section>';
  }
  contentEl.innerHTML = html || '<p class="empty">没有匹配的结果。</p>';
}

function cardHtml(it) {
  const hot = formatHot(it.hot);
  const titleHtml = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);
  return `<article class="card">
    <div class="rank">${esc(it.rank)}</div>
    <div class="card-body">
      <h3 class="card-title">${titleHtml}</h3>
      <div class="card-meta">
        <span class="tag">${esc(it.source || '')}</span>
        ${hot ? `<span class="hot">🔥 ${esc(hot)}</span>` : ''}
      </div>
    </div>
  </article>`;
}

init();
