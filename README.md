# 热点聚合 · 静态新闻热榜站

一个**纯静态**、可部署到 **GitHub Pages** 的网站：按 16 个行业领域（科技 / 人工智能 / 人文 / 社会 / 教育 / 娱乐 / 医疗 / 财经 / 体育 / 游戏 / 汽车 / 美食 / 旅游 / 军事 / 国际 / 文化）聚合各大新闻平台的热点，每两天自动更新，并支持按时间回溯历史快照。

- 前端：原生 HTML / CSS / JS，**零构建**
- 数据：由 GitHub Actions 定时调用 [DailyHotApi](https://github.com/imsyy/DailyHotApi)（无 key 的公开聚合接口）抓取
- 存储：每次抓取生成一份带时间戳的 JSON 快照 + `manifest.json` 索引，保留 30 天

---

## 目录结构

```
.
├── index.html              # 页面框架（固定，提交一次）
├── assets/
│   ├── css/style.css       # 浅色响应式主题
│   └── js/app.js           # 读取 manifest + 快照并渲染
├── data/
│   ├── manifest.json       # 快照索引（每次抓取更新）
│   └── snapshots/          # 每次抓取一份 <时间戳>.json
├── scripts/
│   └── fetch.js            # 抓取 + 16 领域归一化 + 写盘 + 30 天清理
├── .github/workflows/
│   └── fetch.yml           # 每两天一次定时 + 手动触发
└── package.json
```

---

## 部署步骤

1. **建仓库**：在 GitHub 新建一个**公开**仓库（如 `news-hot-site`）。GitHub Pages 免费版要求公开仓库。
2. **推代码**：把本仓库全部文件推到 `main` 分支根目录（`index.html` 在根）。
3. **配置密钥**：仓库 `Settings → Secrets and variables → Actions → New repository secret`：
   - 名称：`DAILYHOT_API_BASE`
   - 值：DailyHotApi 实例地址，默认填 `https://api-hot.imsyy.top`（维护者公开实例，可能限流；建议自托管，见下文）。
4. **开启 Pages**：`Settings → Pages → Build and deployment → Source` 选择 **Deploy from a branch** → 分支 `main` → 目录 `(root)`，保存。
5. **首次抓取**：进入仓库 `Actions` 标签，找到 **Fetch news hot** 工作流，点 **Run workflow** 手动跑一次（调度任务每两天 09:00 北京时间自动跑）。
6. 访问 `https://<你的用户名>.github.io/<仓库名>/`。

---

## 数据源说明

数据来自 DailyHotApi 聚合的各平台公开热榜（微博 / 知乎 / 百度 / 抖音 / B站 / 36氪 / 少数派 / IT之家 / 掘金 / 酷安 / 爱范儿 / V2EX / 果壳 / 微信读书 / 简书 / 豆瓣 / 澎湃 / 头条 / 腾讯新闻 / 新浪 / 网易 / 虎嗅 / 虎扑 / NGA / 各大游戏板等）。

> ⚠️ DailyHotApi 按**平台**聚合，不是按**话题领域**聚合。本项目的 16 个领域映射规则见 `scripts/fetch.js` 中的 `DOMAINS`：
> - 有对应平台的直接采用（科技 / 娱乐 / 游戏 / 财经 / 体育 / 文化等）；
> - 无专属平台的用综合平台（微博 / 知乎 / 百度）按**关键词过滤**（社会 / 教育 / 医疗 / 人文 / 美食 / 旅游 / 军事 / 国际 / 人工智能 / 汽车）。

### 自托管 DailyHotApi（更稳，推荐）

公开实例可能限流或波动。可把 DailyHotApi 部署到 Cloudflare Workers / Vercel / 任意容器（免费），然后把 `DAILYHOT_API_BASE` 改成你自己的地址：

```bash
git clone https://github.com/imsyy/DailyHotApi.git
cd DailyHotApi
npm install && npm run build && npm run start   # 或 Docker / Vercel 一键部署
```

部署后你的实例地址形如 `https://your-dailyhot.workers.dev`，填进 `DAILYHOT_API_BASE` 即可。

---

## 本地运行 / 调试

```bash
# 默认抓取真实数据（需联网，且 DAILYHOT_API_BASE 可达）
node scripts/fetch.js

# 离线验证管线（生成 mock 数据，不依赖网络）
DAILYHOT_API_BASE=mock node scripts/fetch.js

# 指定保留天数（默认 30）
RETENTION_DAYS=60 node scripts/fetch.js
```

本地起一个静态服务器预览前端：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

---

## 自定义

- **改领域 / 来源 / 关键词**：编辑 `scripts/fetch.js` 顶部的 `DOMAINS` 与 `PLATFORM_LABELS`。
- **改更新频率**：编辑 `.github/workflows/fetch.yml` 里的 cron（`"0 1 */2 * *"` 为每两天 UTC 01:00，对应北京时间 09:00）。
- **改保留时长**：环境变量 `RETENTION_DAYS`（默认 30）。

---

## 免责声明

本站聚合的数据来自公开渠道，仅供技术研究与开发测试参考，不代表任何立场，也不对其准确性、完整性作保证。请确保你的使用方式符合各数据源的相关规则与当地法律法规。
