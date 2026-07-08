# 静态新闻热点聚合站 — 实施方案（PLAN）

> 状态：**已实现并部署**。本文件为开发契约（实际抓取频率已改为每两天一次，见 fetch.yml）。
> 目标：一个可部署到 GitHub Pages 的纯静态网站，按 16 个行业领域聚合各新闻平台热点，每天自动更新，并支持历史回溯。

---

## 1. 项目目标

- 收集各大新闻平台热点，按 **科技 / 人工智能 / 人文 / 社会 / 教育 / 娱乐 / 医疗 / 财经 / 体育 / 游戏 / 汽车 / 美食 / 旅游 / 军事 / 国际 / 文化** 共 **16 个领域**分类展示。
- 每个领域展示 **6–13 条**热门新闻。
- 纯静态托管（GitHub Pages），**无后端、无数据库**。
- 数据通过 GitHub Actions 定时自动抓取，**每两天一次**。
- 支持按时间回溯历史快照。

---

## 2. 技术选型与理由

| 层 | 选择 | 理由 |
|---|---|---|
| 托管 | GitHub Pages | 免费、纯静态、与 Actions 天然集成 |
| 前端 | 原生 HTML / CSS / JS（零构建） | 内容展示型站点，无需框架，部署最简单 |
| 抓取 | Node.js 脚本（`scripts/fetch.js`） | 跑在 Actions 服务端，无需浏览器、无 CORS 限制 |
| 调度 | GitHub Actions（`schedule` + `workflow_dispatch`） | 仓库自带，免费额度足够每天 2 次 |
| 数据源 | DailyHotApi 类**无 key** 公开聚合接口 | 覆盖 80+ 平台热榜，开源可自托管，免注册 key |

**为什么不前端直连 API**：GitHub Pages 无后端，浏览器直连新闻平台接口会被 CORS / 鉴权拦截；因此抓取必须在 Actions 服务端完成，产物落地为静态 JSON，前端只读取本地文件。

---

## 3. 架构与数据流

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Actions (每两天 UTC 01:00, 或手动触发)          │
│   1. node scripts/fetch.js                                    │
│      ├─ 读取 DAILYHOT_API_BASE (Secret)                       │
│      ├─ 调 DailyHotApi 取各平台热榜                           │
│      ├─ 按 16 领域归一化 (直接映射 + 关键词过滤)              │
│      ├─ 写 data/snapshots/<时间戳>.json                       │
│      ├─ 更新 data/manifest.json                               │
│      └─ 清理 30 天前的快照                                     │
│   2. git commit & push (仅 data/ 变化)                        │
└─────────────────────────────────────────────────────────────┘
                          │ push 触发 Pages 重发
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  GitHub Pages (静态)                                          │
│   index.html (固定) + assets/ (固定)                          │
│   前端 app.js 运行时:                                         │
│     fetch('data/manifest.json') → 选快照 →                    │
│     fetch('data/snapshots/<时间戳>.json') → 渲染卡片          │
└─────────────────────────────────────────────────────────────┘
```

**关键原则**：页面框架（`index.html` + `assets/`）提交一次、永不变；每次抓取**只新增一份数据快照**，不重写框架。

---

## 4. 文件结构

```
news-hot-site/
├── index.html                  # 页面框架（固定）
├── assets/
│   ├── css/style.css           # 响应式浅色主题（固定）
│   └── js/app.js               # 读取 manifest + 快照并渲染（固定）
├── data/
│   ├── manifest.json           # 快照索引（每次抓取更新）
│   └── snapshots/
│       ├── 2026-07-07T01-00-00Z.json   # 每次抓取一份
│       └── 2026-07-07T10-00-00Z.json
├── scripts/
│   └── fetch.js                # 抓取 + 归一化 + 写盘 + 清理
├── .github/workflows/
│   └── fetch.yml               # 定时调度 + 提交
└── README.md                   # 部署说明（可选）
```

---

## 5. 数据源与领域映射

### 5.1 DailyHotApi 说明
- 开源聚合服务（`imsyy/DailyHotApi`），支持 **80+ 平台**热榜（微博、知乎、百度、B站、抖音、豆瓣、36氪、掘金、少数派、GitHub、Hacker News、微信、贴吧、虎扑等），**无需 key**。
- **按"平台"聚合，不是按"话题领域"聚合** —— 这是本方案的核心约束。
- 提供方式（二选一，先前者）：
  - **(a) 公开实例**：零搭建，但承担限流 / 宕机 / ToS 风险（先这样跑通）；
  - **(b) 自托管**：部署到 Cloudflare Workers（免费，约 5 分钟），更稳，仍无 key。

### 5.2 映射策略（两类）
- **A 类 · 专属平台直接映射**：该领域能找到主题契合的平台，直接取该平台热榜。
- **B 类 · 综合平台 + 关键词过滤**：无专属平台，从微博 / 知乎 / 百度热搜中按关键词筛出对应领域。

### 5.3 领域映射草案（开工时按 DailyHotApi 实际平台清单核对修正）

| 领域 | 类型 | 来源 / 关键词 |
|---|---|---|
| 科技 | A | 36氪、少数派、Hacker News、GitHub Trending |
| 人工智能 | A+B | GitHub Trending（AI 仓库）+ 36氪/少数派 关键词「AI/大模型/LLM」 |
| 人文 | B | 知乎 关键词「人文/历史/哲学/文化」+ 豆瓣 |
| 社会 | B | 微博 + 百度（社会类天然占比高） |
| 教育 | B | 知乎 关键词「教育/考研/高考/升学」 |
| 娱乐 | A | 微博、抖音、豆瓣影视 |
| 医疗 | B | 微博/知乎 关键词「医疗/健康/医院/疾控」 |
| 财经 | A+B | 雪球 / 华尔街见闻 + 微博财经关键词 |
| 体育 | A+B | 微博体育 / 直播吧 + 关键词 |
| 游戏 | A | 游民星空 / NGA / 微博游戏 |
| 汽车 | A+B | 懂车帝 + 微博汽车关键词 |
| 美食 | B | 微博/小红书 关键词「美食/菜谱/探店」 |
| 旅游 | B | 微博/马蜂窝 关键词「旅游/出行/攻略」 |
| 军事 | B | 微博/知乎 关键词「军事/国防」 |
| 国际 | B | 微博/百度 关键词「国际/海外/全球」 |
| 文化 | A+B | 豆瓣 + 知乎 关键词「文化/艺术/展览」 |

> ⚠️ 带 B 类的领域依赖关键词过滤，质量参差；**开工第一步**先打印 DailyHotApi 实际支持的平台清单，再敲定每个领域的确切来源与关键词，确保每领域都能稳定凑到 ≥6 条。单源失败不影响整体（`fetch.js` 内每源独立 try/catch）。

---

## 6. 数据 Schema

**单条新闻 `NewsItem`**
```json
{
  "title": "标题文本",
  "url": "原文链接",
  "source": "平台名(如 微博/知乎/36氪)",
  "category": "领域(如 科技)",
  "hot": 12345,            // 热度值或排名，无法获取时为 null
  "fetchedAt": "2026-07-07T01:00:00Z"
}
```

**快照文件 `data/snapshots/<时间戳>.json`**
```json
{
  "generatedAt": "2026-07-07T01:00:00Z",
  "categories": {
    "科技": [ {NewsItem}, ... ],
    "人工智能": [ ... ],
    "...": [ ... ]           // 共 16 个 key
  },
  "total": 182
}
```

**索引文件 `data/manifest.json`**
```json
{
  "updatedAt": "2026-07-07T01:00:00Z",
  "snapshots": [
    { "file": "2026-07-07T01-00-00Z.json", "generatedAt": "2026-07-07T01:00:00Z", "total": 182, "counts": { "科技": 12, "人工智能": 8 } },
    { "file": "2026-07-06T10-00-00Z.json", "generatedAt": "2026-07-06T10:00:00Z", "total": 175, "counts": { ... } }
  ]
}
```
> `manifest.snapshots` 按 `generatedAt` **倒序**排列，方便前端默认取第一个为「最新」。

---

## 7. 前端设计

- **框架固定**：`index.html` + `assets/` 仅提交一次。
- **渲染逻辑（`app.js`）**：
  1. `fetch('data/manifest.json')` 拿到快照列表；
  2. 默认渲染 `snapshots[0]`（最新）；
  3. 顶部「历史日期」下拉框由 manifest 填充，选中后 `fetch` 对应快照并重渲染；
  4. 领域以标签 / 侧边导航切换，主区为卡片网格。
- **卡片字段（基础版）**：标题（可点击外链）+ 来源平台 + 领域标签 + 热度/排名。
- **主题**：浅色（与 IDE 浅色主题一致），响应式卡片网格，移动端单列。
- **健壮性**：manifest 或快照缺失时显示友好空状态；加载中显示 loading。

---

## 8. GitHub Actions 工作流（`.github/workflows/fetch.yml`）

- **触发**：`schedule: cron "0 1 */2 * *"`（UTC，对应北京时间 09:00，每两天）+ `workflow_dispatch`（手动）。
- **步骤**：
  1. `actions/checkout@v4`（带 `GITHUB_TOKEN` 写入权限）；
  2. 安装 Node（managed 22.x）；
  3. `node scripts/fetch.js`（读取 `DAILYHOT_API_BASE` 环境变量，由 Secret 注入）；
  4. 若 `data/` 有变化，`git commit` 并 `git push`（提交信息含时间戳）。
- **清理策略**：`fetch.js` 内删除 `generatedAt` 早于 **30 天**的快照文件，并同步更新 `manifest.json`（保留约 60 个文件）。
- **权限**：`permissions: contents: write`。

---

## 9. 部署步骤

1. 在 GitHub 新建**公开**仓库（如 `news-hot-site`）；私有仓库需 GitHub Pages 付费/特定计划。
2. 将本仓库文件推到 `main` 分支根目录（`index.html` 在根）。
3. 仓库 **Settings → Secrets and variables → Actions** 添加：
   - `DAILYHOT_API_BASE` = 公开 DailyHotApi 实例地址（或自托管 Worker URL）。
4. **Settings → Pages → Build and deployment → Source**: Deploy from a branch → `main` / `(root)`。
5. 推送后 Actions 自动跑首次抓取 → Pages 自动发布。
6. 访问 `https://<用户名>.github.io/news-hot-site/`。

---

## 10. 风险与备选

| 风险 | 应对 |
|---|---|
| 公开 DailyHotApi 实例限流 / 关停 | 备选自托管 Cloudflare Workers（免费），改 `DAILYHOT_API_BASE` 即可 |
| 某些领域无专属平台、关键词过滤质量差 | 开工先核实真实平台清单；B 类领域允许条数略少（≥6 即可），必要时人工补关键词 |
| 平台接口变动导致某源失败 | `fetch.js` 每源独立 try/catch，失败跳过并记日志；manifest 记录各源成功条数便于监控 |
| 仓库随历史增长 | 30 天自动清理，单文件体积小，可控 |

---

## 11. 开工清单（待用户确认后执行）

- [ ] 初始化仓库结构与骨架文件
- [ ] 编写 `scripts/fetch.js`（抓取 + 16 领域归一化 + 写快照 + 更新 manifest + 30 天清理）
- [ ] 核实 DailyHotApi 实际平台清单，最终敲定领域映射与关键词
- [ ] 编写 `index.html` + `assets/css/style.css` + `assets/js/app.js`（最新 + 历史选择器）
- [ ] 编写 `.github/workflows/fetch.yml`
- [ ] 本地 dry-run `fetch.js` 验证产出
- [ ] 指导用户建仓、开 Pages、配 `DAILYHOT_API_BASE`、首次部署
