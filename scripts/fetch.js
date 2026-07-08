// scripts/fetch.js
// 抓取各平台热榜 -> 按 16 个领域归一化 -> 写带时间戳的快照 + 更新 manifest + 清理 30 天前数据
// 零外部依赖（使用 Node 内置 fetch，需 Node >= 18）
//
// 数据源（全部免 key）：
//   1) DailyHotApi 兼容实例（多实例自动回退，用第一个能连通的）
//   2) 60s.viki.moe（Cloudflare Workers，仅 weibo/zhihu/douyin/toutiao，作为保底）
//   3) Hacker News Algolia API（科技 / 人工智能的保底源，永不落空）
import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const SNAP_DIR = join(DATA_DIR, 'snapshots');
const MANIFEST = join(DATA_DIR, 'manifest.json');

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const MAX_PER_DOMAIN = 12; // 每个领域最多 12 条
const MIN_PER_DOMAIN = 6;  // 每个领域至少 6 条（不足则用各平台热榜补齐）

// DailyHotApi 兼容实例列表（逗号分隔可覆盖，按顺序自动回退）
const FULL_PROVIDERS = (process.env.DAILYHOT_API_BASE ||
  'https://api-hot.imsyy.top,https://hot-api.efefee.cn,https://api.66mz.top,' +
  'https://api-hot.ououe.com,https://api-hot.pages.dev,https://api-hot.vercel.app,' +
  'https://hot.baiyu.site,https://m.didiyf.cn,https://dailyhotapi.ismsb.com')
  .split(',').map((s) => s.trim()).filter(Boolean);

const SIXTY_BASE = 'https://60s.viki.moe';
const SIXTY_SUPPORTED = new Set(['weibo', 'zhihu', 'douyin', 'toutiao']);
const HN_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60';

// 平台调用名 -> 中文展示名
const PLATFORM_LABELS = {
  weibo: '微博', zhihu: '知乎', 'zhihu-daily': '知乎日报', baidu: '百度',
  douyin: '抖音', kuaishou: '快手', bilibili: 'B站', acfun: 'AcFun',
  'douban-movie': '豆瓣电影', 'douban-group': '豆瓣小组', tieba: '百度贴吧',
  sspai: '少数派', ithome: 'IT之家', jianshu: '简书', guokr: '果壳',
  thepaper: '澎湃新闻', toutiao: '今日头条', '36kr': '36氪', '51cto': '51CTO',
  csdn: 'CSDN', nodeseek: 'NodeSeek', juejin: '掘金', 'qq-news': '腾讯新闻',
  sina: '新浪', 'sina-news': '新浪新闻', 'netease-news': '网易新闻',
  '52pojie': '吾爱破解', hostloc: '全球主机交流', huxiu: '虎嗅', coolapk: '酷安',
  hupu: '虎扑', ifanr: '爱范儿', lol: '英雄联盟', miyoushe: '米游社',
  genshin: '原神', honkai: '崩坏3', starrail: '星穹铁道', weread: '微信读书',
  ngabbs: 'NGA', v2ex: 'V2EX', hellogithub: 'HelloGitHub',
};

// 16 个领域 -> 采集器列表
// 采集器: { p: 平台调用名, kw?: 关键词数组 }
// 无 kw: 直接采用该平台热榜; 有 kw: 仅保留标题/摘要命中任一关键词的条目
const DOMAINS = {
  '科技': [
    { p: 'sspai' }, { p: 'ithome' }, { p: '36kr' }, { p: 'juejin' },
    { p: 'coolapk' }, { p: 'ifanr' }, { p: 'v2ex' }, { p: 'hellogithub' },
  ],
  '人工智能': [
    { p: '36kr', kw: ['AI', '人工智能', '大模型', 'LLM', 'GPT', '机器学习', '深度学习', '算力', '芯片', '机器人'] },
    { p: 'sspai', kw: ['AI', '人工智能', '大模型', 'LLM', 'GPT'] },
    { p: 'ithome', kw: ['AI', '人工智能', '大模型', '芯片', '算力'] },
    { p: 'juejin', kw: ['AI', '大模型', 'LLM', '人工智能', '深度学习'] },
  ],
  '人文': [
    { p: 'guokr' }, { p: 'weread' }, { p: 'jianshu' }, { p: 'douban-group' },
    { p: 'zhihu', kw: ['人文', '历史', '哲学', '文化', '思想', '读书'] },
    { p: 'baidu', kw: ['人文', '历史', '哲学', '文化'] },
  ],
  '社会': [
    { p: 'weibo' }, { p: 'baidu' }, { p: 'thepaper' },
    { p: 'qq-news' }, { p: 'sina-news' }, { p: 'netease-news' },
  ],
  '教育': [
    { p: 'zhihu', kw: ['教育', '考研', '高考', '升学', '大学', '学校', '留学', '中考', '双减'] },
    { p: 'baidu', kw: ['教育', '考研', '高考', '升学', '大学', '留学'] },
    { p: 'weibo', kw: ['教育', '考研', '高考', '升学', '大学'] },
  ],
  '娱乐': [
    { p: 'douyin' }, { p: 'douban-movie' }, { p: 'weibo' }, { p: 'kuaishou' },
  ],
  '医疗': [
    { p: 'weibo', kw: ['医疗', '健康', '医院', '疾控', '养生', '医保', '疫苗', '疾病', '医生'] },
    { p: 'zhihu', kw: ['医疗', '健康', '医院', '养生', '医保', '疾病'] },
    { p: 'baidu', kw: ['医疗', '健康', '医院', '养生', '医保', '疫苗'] },
  ],
  '财经': [
    { p: '36kr' }, { p: 'huxiu' }, { p: 'nodeseek' },
    { p: 'weibo', kw: ['财经', '股市', '基金', '经济', 'A股', '美股', '比特币', '汇率', '理财'] },
  ],
  '体育': [
    { p: 'hupu' },
    { p: 'weibo', kw: ['体育', 'NBA', '中超', '世界杯', '球赛', '联赛', '奥运', '国足', '羽毛球'] },
    { p: 'douyin', kw: ['体育', 'NBA', '中超', '世界杯', '奥运'] },
  ],
  '游戏': [
    { p: 'ngabbs' }, { p: 'lol' }, { p: 'miyoushe' }, { p: 'genshin' }, { p: 'starrail' },
    { p: 'douyin', kw: ['游戏', '原神', '王者', 'Steam', '手游', '电竞'] },
  ],
  '汽车': [
    { p: 'weibo', kw: ['汽车', '新能源', '特斯拉', '比亚迪', '车展', '车型', '智驾', '电动车'] },
    { p: 'baidu', kw: ['汽车', '新能源', '特斯拉', '比亚迪', '车展', '智驾'] },
    { p: 'douyin', kw: ['汽车', '新能源', '特斯拉', '比亚迪'] },
    { p: '36kr', kw: ['汽车', '新能源', '智能驾驶'] },
  ],
  '美食': [
    { p: 'weibo', kw: ['美食', '菜谱', '探店', '餐厅', '小吃', '料理', '烘焙'] },
    { p: 'douyin', kw: ['美食', '菜谱', '探店', '餐厅', '小吃'] },
    { p: 'baidu', kw: ['美食', '菜谱', '餐厅', '小吃'] },
  ],
  '旅游': [
    { p: 'weibo', kw: ['旅游', '出行', '攻略', '景点', '机票', '民宿', '度假'] },
    { p: 'baidu', kw: ['旅游', '出行', '攻略', '景点', '机票'] },
    { p: 'douyin', kw: ['旅游', '出行', '攻略', '景点'] },
  ],
  '军事': [
    { p: 'weibo', kw: ['军事', '国防', '战机', '航母', '演习', '导弹', '部队'] },
    { p: 'zhihu', kw: ['军事', '国防', '航母', '导弹', '战机'] },
    { p: 'baidu', kw: ['军事', '国防', '航母', '导弹', '演习'] },
  ],
  '国际': [
    { p: 'weibo', kw: ['国际', '海外', '全球', '美国', '俄乌', '中东', '欧盟', '联合国'] },
    { p: 'baidu', kw: ['国际', '海外', '全球', '美国', '俄乌', '中东'] },
    { p: 'toutiao', kw: ['国际', '海外', '全球', '美国', '俄乌', '中东'] },
  ],
  '文化': [
    { p: 'douban-group' }, { p: 'guokr' }, { p: 'weread' }, { p: 'jianshu' },
    { p: 'zhihu', kw: ['文化', '艺术', '展览', '非遗', '博物馆', '戏曲', '文学'] },
    { p: 'baidu', kw: ['文化', '艺术', '展览', '非遗', '博物馆'] },
  ],
};

// ---------- 工具 ----------
function kwMatch(item, kws) {
  if (!kws || !kws.length) return true;
  const hay = ((item.title || '') + ' ' + (item.desc || '')).toLowerCase();
  return kws.some((k) => hay.includes(k.toLowerCase()));
}

// 把各种时间字段归一化为毫秒时间戳（无法解析则返回 null）
function parseTime(raw) {
  if (raw == null) return null;
  let t = raw;
  if (typeof t === 'string') {
    // 形如 "1710000000" 的纯数字字符串
    if (/^\d+$/.test(t.trim())) t = Number(t.trim());
    else { const n = Date.parse(t); return isNaN(n) ? null : n; }
  }
  if (typeof t === 'number') {
    if (t > 1e12) return Math.floor(t);       // 毫秒
    if (t > 1e9) return Math.floor(t * 1000); // 秒
    return null;
  }
  return null;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 热度排序辅助：无热度的排最后
function hotRank(hot) {
  if (hot == null) return -1;
  const n = typeof hot === 'number' ? hot : parseFloat(String(hot).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? -1 : n;
}

function fmtFile(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}Z`;
}

async function getJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'news-hot-site' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 把一个源返回的 item 归一化（兼容不同字段命名）
function normalize(item, provider) {
  const title = String(item.title ?? item.name ?? item.query ?? '').trim();
  if (!title) return null;
  const url = String(item.url || item.link || item.mobileUrl || item.href || '').trim();
  let hot = item.hot ?? item.hot_value ?? item.heat ?? item.score ?? null;
  if (typeof hot === 'string') hot = parseInt(hot.replace(/[^0-9]/g, ''), 10) || null;
  const desc = String(item.desc || item.description || item.content || '').trim();
  const time = parseTime(item.timestamp || item.mtime || item.created_at || item.createdAt || item.time || item.publish_time || null);
  return { title, url, hot, desc, time };
}

// 探活 DailyHotApi 兼容实例：用 /api/weibo 探测，返回第一个可用的 base
async function pickFullProvider() {
  const probe = async (base) => {
    try {
      const json = await getJson(`${base}/api/weibo`, 9000);
      const data = json && json.data;
      if (Array.isArray(data) && data.length) return base;
    } catch { /* 跳过 */ }
    return null;
  };
  const results = await Promise.all(FULL_PROVIDERS.map(probe));
  const ok = results.find((r) => r);
  return ok || null;
}

// 从某个 DailyHotApi 实例取某平台热榜（返回归一化数组）
async function fetchFromFull(base, platform) {
  try {
    const json = await getJson(`${base}/api/${platform}`, 9000);
    const data = json && json.data;
    if (!Array.isArray(data)) throw new Error('响应缺少 data 数组');
    return data.map((it) => normalize(it, 'full')).filter(Boolean);
  } catch (e) {
    console.warn(`[warn] ${base}/api/${platform} 抓取失败: ${e.message}`);
    return [];
  }
}

// 从 60s.viki.moe 取（仅支持的 4 个平台），字段 link/hot_value
async function fetchFromSixty(platform) {
  if (!SIXTY_SUPPORTED.has(platform)) return [];
  try {
    const json = await getJson(`${SIXTY_BASE}/v2/${platform}`, 9000);
    const data = json && json.data;
    if (!Array.isArray(data)) throw new Error('响应缺少 data 数组');
    return data.map((it) => normalize(it, '60s')).filter(Boolean);
  } catch (e) {
    console.warn(`[warn] 60s ${platform} 抓取失败: ${e.message}`);
    return [];
  }
}

// Hacker News 热门（科技 / AI 保底）
async function fetchHN() {
  try {
    const json = await getJson(HN_URL, 9000);
    const hits = json && json.hits;
    if (!Array.isArray(hits)) throw new Error('响应缺少 hits');
    return hits
      .map((h) => ({
        title: h.title || h.story_title || '',
        url: h.url || h.story_url || '',
        hot: h.points ?? null,
        desc: h.story_text || h.comment_text || '',
        time: h.created_at_i ? h.created_at_i * 1000 : null,
      }))
      .filter((x) => x.title);
  } catch (e) {
    console.warn(`[warn] HN 抓取失败: ${e.message}`);
    return [];
  }
}

// ---------- 主流程 ----------
async function main() {
  const generatedAt = new Date();
  console.log(`[info] 探测 DailyHotApi 兼容实例（共 ${FULL_PROVIDERS.length} 个）…`);
  const fullBase = await pickFullProvider();
  if (fullBase) console.log(`[info] 选定主实例: ${fullBase}`);
  else console.log(`[warn] 所有 DailyHotApi 实例均不可达，将仅用 60s + HN 保底源`);

  // 收集所有需要的平台
  const platforms = new Set();
  for (const cols of Object.values(DOMAINS)) for (const c of cols) platforms.add(c.p);

  // 并行抓取：主实例 + 60s 保底（每个平台都抓 60s，若支持）
  const cache = {};
  await Promise.all([...platforms].map(async (p) => {
    const arr = [];
    if (fullBase) arr.push(...(await fetchFromFull(fullBase, p)));
    const s = await fetchFromSixty(p);
    // 60s 结果补充（去重）
    const seen = new Set(arr.map((x) => x.url || x.title));
    for (const it of s) { if (!seen.has(it.url || it.title)) { arr.push(it); seen.add(it.url || it.title); } }
    cache[p] = arr;
  }));

  const hnItems = await fetchHN();

  const categories = {};
  const counts = {};
  for (const [domain, collectors] of Object.entries(DOMAINS)) {
    // 候选池：先按关键词收录，不足 MIN 再用各平台热榜补齐
    const pool = [];
    const seen = new Set();
    const add = (it, platform) => {
      const key = it.url || it.title;
      if (!key || seen.has(key)) return;
      seen.add(key);
      pool.push({
        title: it.title,
        url: it.url,
        hot: it.hot ?? null,
        desc: it.desc || '',
        time: it.time ?? null,
        source: PLATFORM_LABELS[platform] || platform,
      });
    };

    for (const c of collectors) {
      const arr = cache[c.p] || [];
      for (const it of arr) if (kwMatch(it, c.kw)) add(it, c.p);
    }
    if (pool.length < MIN_PER_DOMAIN) {
      for (const c of collectors) {
        const arr = cache[c.p] || [];
        for (const it of arr) { if (pool.length >= MIN_PER_DOMAIN) break; add(it, c.p); }
      }
    }
    // 科技 / 人工智能：注入 HN 保底源（去重后追加到候选池）
    if ((domain === '科技' || domain === '人工智能') && hnItems.length) {
      for (const it of hnItems) {
        const key = it.url || it.title;
        if (key && !seen.has(key)) { seen.add(key); pool.push({ ...it, source: 'Hacker News' }); }
      }
      console.log(`[info] ${domain} 候选池 ${pool.length} 条（含 HN 保底）`);
    }

    // 随机抽 6–12 条：先打乱再从候选池取随机数量，最后按热度排序保证可读性
    const target = Math.min(pool.length, randInt(MIN_PER_DOMAIN, MAX_PER_DOMAIN));
    const items = shuffle(pool)
      .slice(0, target)
      .sort((a, b) => hotRank(b.hot) - hotRank(a.hot))
      .map((it, i) => ({ ...it, rank: i + 1, category: domain }));

    categories[domain] = items;
    counts[domain] = items.length;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  await mkdir(SNAP_DIR, { recursive: true });
  const file = fmtFile(generatedAt) + '.json';
  const snapshot = { generatedAt: generatedAt.toISOString(), source: fullBase || '60s.viki.moe + HN', categories, total };
  await writeFile(join(SNAP_DIR, file), JSON.stringify(snapshot, null, 2), 'utf8');

  // 更新 manifest + 清理
  let manifest = { updatedAt: '', snapshots: [] };
  if (existsSync(MANIFEST)) {
    try { manifest = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { /* 重建 */ }
  }
  manifest.snapshots = manifest.snapshots || [];
  manifest.snapshots.push({ file, generatedAt: generatedAt.toISOString(), total, counts });
  manifest.snapshots.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  manifest.updatedAt = generatedAt.toISOString();

  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  const keep = [];
  for (const s of manifest.snapshots) {
    if (new Date(s.generatedAt).getTime() >= cutoff) keep.push(s);
    else { try { await unlink(join(SNAP_DIR, s.file)); } catch { /* ignore */ } }
  }
  manifest.snapshots = keep;
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`[info] 已写入 ${file}，总计 ${total} 条，保留快照 ${keep.length} 个`);
  console.log(`[info] 各域条数: ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join('  ')}`);
}

main().catch((e) => { console.error('[error]', e); process.exit(1); });
