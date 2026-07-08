// scripts/fetch.js
// 抓取 DailyHotApi 各平台热榜 -> 按 16 个领域归一化 -> 写带时间戳的快照 + 更新 manifest + 清理 30 天前数据
// 零外部依赖（使用 Node 内置 fetch，需 Node >= 18）
import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const SNAP_DIR = join(DATA_DIR, 'snapshots');
const MANIFEST = join(DATA_DIR, 'manifest.json');

const BASE = process.env.DAILYHOT_API_BASE || 'https://api-hot.imsyy.top';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const MAX_PER_DOMAIN = 13;
const MIN_PER_DOMAIN = 6;

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

function fmtFile(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}Z`;
}

// ---------- mock（离线验证管线用，BASE=mock）----------
function mockItems(platform, n = 30) {
  const label = PLATFORM_LABELS[platform] || platform;
  return Array.from({ length: n }, (_, i) => ({
    title: `【${label}】示例热点 ${i + 1}：本领域话题持续受到关注`,
    url: `https://example.com/${platform}/${i + 1}`,
    hot: Math.floor(Math.random() * 900000) + 10000,
    desc: '',
  }));
}

// ---------- 真实抓取 ----------
async function fetchPlatform(platform) {
  if (BASE === 'mock') return mockItems(platform, 30);
  const url = `${BASE}/api/${platform}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'news-hot-site' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const data = json && json.data;
    if (!Array.isArray(data)) throw new Error('响应缺少 data 数组');
    return data
      .map((it) => ({
        title: String(it.title ?? it.name ?? '').trim(),
        url: String(it.url || it.mobileUrl || it.link || '').trim(),
        hot: it.hot ?? null,
        desc: String(it.desc || it.description || '').trim(),
      }))
      .filter((it) => it.title);
  } catch (e) {
    console.warn(`[warn] 平台 ${platform} 抓取失败: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 主流程 ----------
async function main() {
  const generatedAt = new Date();

  const platforms = new Set();
  for (const cols of Object.values(DOMAINS)) for (const c of cols) platforms.add(c.p);
  console.log(`[info] 从 ${BASE} 抓取 ${platforms.size} 个平台`);

  const cache = {};
  await Promise.all(
    [...platforms].map(async (p) => {
      cache[p] = await fetchPlatform(p);
    })
  );

  const categories = {};
  const counts = {};
  for (const [domain, collectors] of Object.entries(DOMAINS)) {
    const acc = [];
    const seen = new Set();
    const add = (it, platform) => {
      const key = it.url || it.title;
      if (!key || seen.has(key)) return;
      seen.add(key);
      acc.push({
        title: it.title,
        url: it.url,
        hot: it.hot,
        source: PLATFORM_LABELS[platform] || platform,
      });
    };

    // 第一轮：命中关键词（或直接采用）
    for (const c of collectors) {
      const arr = cache[c.p] || [];
      for (const it of arr) if (kwMatch(it, c.kw)) add(it, c.p);
    }
    // 第二轮：不足 MIN 时，用同平台未命中条目补齐（保持来源一致）
    if (acc.length < MIN_PER_DOMAIN) {
      for (const c of collectors) {
        const arr = cache[c.p] || [];
        for (const it of arr) {
          if (acc.length >= MIN_PER_DOMAIN) break;
          add(it, c.p);
        }
      }
    }

    const items = acc
      .slice(0, MAX_PER_DOMAIN)
      .map((it, i) => ({ ...it, rank: i + 1, category: domain }));
    categories[domain] = items;
    counts[domain] = items.length;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  await mkdir(SNAP_DIR, { recursive: true });
  const file = fmtFile(generatedAt) + '.json';
  const snapshot = { generatedAt: generatedAt.toISOString(), categories, total };
  await writeFile(join(SNAP_DIR, file), JSON.stringify(snapshot, null, 2), 'utf8');

  // 更新 manifest + 清理
  let manifest = { updatedAt: '', snapshots: [] };
  if (existsSync(MANIFEST)) {
    try {
      manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
    } catch {
      /* 损坏则重建 */
    }
  }
  manifest.snapshots = manifest.snapshots || [];
  manifest.snapshots.push({ file, generatedAt: generatedAt.toISOString(), total, counts });
  manifest.snapshots.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  manifest.updatedAt = generatedAt.toISOString();

  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  const keep = [];
  for (const s of manifest.snapshots) {
    if (new Date(s.generatedAt).getTime() >= cutoff) {
      keep.push(s);
    } else {
      try {
        await unlink(join(SNAP_DIR, s.file));
      } catch {
        /* ignore */
      }
    }
  }
  manifest.snapshots = keep;
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`[info] 已写入 ${file}，总计 ${total} 条，保留快照 ${keep.length} 个`);
}

main().catch((e) => {
  console.error('[error]', e);
  process.exit(1);
});
