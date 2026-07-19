# Robotics Daily Papers
![](cover.png)

> 如果你也想有一个自己研究领域持续更新的0服务器成本论文摘要站点，欢迎**Star+Fork**本仓库,按需调整关键词与主题分类。部署仅需额外Cloudflare Worker，开箱即用，五分钟搞定~

机器人学论文 arXiv 每日自动摘要。GitHub Actions 定时工作流摄取 `cs.RO`、`cs.AI`、`cs.CV`、`cs.LG` 类目下的最新投稿，依次经关键词预筛与 LLM 评分两级过滤，并按 **VLA**、**世界（动作）模型**、**自动驾驶**、**具身智能** 四条研究主线进行分类，最终渲染为静态站点经 GitHub Pages 发布。

可选的**个人模式**经站点密码门控，提供基于 Zotero 的一键收藏，及向 WebDAV 文件库的 PDF 自动上传，并集成 [hjfy.top](https://hjfy.top) 的 arXiv 中英对照阅读跳转。

**v0.3 新增**：跨平台**桌面应用**（[`app/`](app/README.md)，Windows + macOS），在每日列表里一键 **「帮我读」**——用你*本地*的 Claude Code 订阅深读任一论文并生成结构化 Obsidian 笔记，并带已读标记与启动即最新。公网站点不受影响。



---

## 功能

### 每日流水线（始终启用）

1. **数据摄取** — arXiv API 客户端，含针对 HTTP 429 的重试与指数退避。
2. **两级过滤**
    - *一级（关键词预筛，不调 LLM）：* 四级关键词分级（Tier-0 核心、Tier-1 强支撑、Tier-2 弱上下文、Tier-3 硬排除），定义在 [src/config.py](src/config.py)。标题命中权重高于摘要命中；`cs.RO` / `cs.AI` 类别附加分；Tier-3 命中即拒。词边界正则配合轻量复数容忍，避免子串误判。
    - *二级（LLM 评分，DeepSeek）：* 通过预筛的论文获得 `relevance`、`novelty`、`clarity`、`potential_impact`、`overall_priority` 五项 `[1, 10]` 整数评分；从 `{VLA, WorldModel, AutonomousDriving, VLN, Manipulation, Locomotion, HumanoidEmbodied, RLRobot, Perception3D, Other}` 中产出唯一主题标签；附短关键词标签与中英文 TLDR。Prompt 内置 few-shot 校准样本以稳定打分分布。
3. **JSON 归档** — 按日期键入的记录置于 `daily_json/`，包含标题、摘要、链接、评分、主题、关键词与一级命中明细。
4. **HTML 渲染** — Jinja2 模板（[templates/paper_template.html](templates/paper_template.html)）每日产出三段：headline（`overall ≥ 6`）、低分（`< 6`）、一级未通过；主题标签以彩色 chip 呈现。
5. **持续部署** — 工作流 [.github/workflows/daily_arxiv.yml](.github/workflows/daily_arxiv.yml)。
6. **缺日补全** — `daily_json/` 中缺失日期由 `--backfill --backfill-limit N` 检测并按批处理。
7. **一级回填** — [src/rescore_stage1.py](src/rescore_stage1.py) 对所有历史 JSON 重新应用当前关键词分类，不调用 LLM，零 API 成本支持回溯调整。
8. **全文检索** — [MiniSearch](https://lucaong.github.io/minisearch/) 客户端索引覆盖标题、摘要、TLDR 与作者，AND 匹配。完整历史按月生成带体积上限的分片，避免每日工作流再次产生超过 GitHub 100 MiB 限制的单文件。

### 个人模式（可选，密码门控）

9. **Zotero 集成** — 每篇论文一个 "Add to Zotero" 控件，向按需创建的 `Daily Paper / YYYY-MM-DD` 子集合写入 `preprint` 类型条目（含 arXiv DOI、作者、摘要）。
10. **WebDAV PDF + LaTeX 源码上传** — 经 Cloudflare Worker（绕开 CORS）抓取 arXiv PDF *与* 源码 tarball（`https://arxiv.org/e-print/<id>`），分别封装为 Zotero 的 `<key>.zip` + `<key>.prop` 格式，PUT 至用户的 WebDAV 服务器。下次桌面同步后两份文件均本地可用。源码上传为尽力而为，单文件上限 50 MB；仅 PDF 投稿（无 LaTeX 源）按 `%PDF` 魔数检测后跳过。
11. **翻译跳转** — 每篇论文附跳转控件，按 arXiv ID 打开 [hjfy.top](https://hjfy.top) 进行中英对照阅读。该深层链接要求用户预先在同一浏览器会话中登录 hjfy.top；未登录时请求会被重定向至 hjfy.top 首页。翻译控件在访客模式与个人模式中均可见，hjfy.top 账户凭据完全由 hjfy.top 自行管理，不属于本项目的 secrets。
12. **默认访客模式** — 公网站点公开全部内容但隐藏个人功能控件；只有通过密码门解密凭据 bundle 后方可解锁。

### 桌面应用 PaperReader（v0.3，可选）

一个跨平台 Electron 应用（[`app/`](app/README.md)，Windows + macOS），用你**本地的 Claude Code 订阅**直接从每日列表精读论文。公网站点不受影响——这些控件是 app 自己注入的，公开站永不显示。

13. **「帮我读」** — 每篇论文一个按钮，调用本地 `claude` CLI 跑 `paper-reading` 技能（在你的 Obsidian vault 内），深读该论文并生成结构化笔记文件夹；右侧栏实时显示进度，完成后可"在 Obsidian 打开"。走订阅（OAuth），不用 API key。
14. **已读标记** — 本机 vault 里已有笔记的论文显示 **✓ 已读** 按钮，点击直接打开已有笔记而非重读。跨设备靠你自己的 Obsidian 同步，app 只读本机。
15. **启动即最新，无需 git pull** — app 启动时从已发布站点 live-fetch `reports.json` 与报告页（离线缓存），各设备无需拉取仓库即显示最新论文。
16. **应用内 Zotero** — 同一道密码门在 app 内解锁个人模式，报告里的 "Add to Zotero" 按钮一并可用。

前置条件、运行/打包、设置详见 [app/README.md](app/README.md)。

---

## 快速上手（仅 GitHub 部署）

整套系统在 GitHub Actions 中运行，无需本地环境。GitHub 之外仅需部署一个 Cloudflare Worker（约 3 分钟，复制粘贴即可）。

1. Fork 本仓库。
2. **Settings → Pages**：source 选 "Deploy from a branch"，branch 设为 `main`，folder 设为 `/`。
3. 准备 [配置](#配置) 一节列出的 secrets。仅 `DEEPSEEK_API_KEY` 必须，其余可选，按需逐步启用。
4. *（仅个人模式）* 部署 Cloudflare Worker — 见 [Cloudflare Worker](#cloudflare-worker)。
5. **Settings → Secrets and variables → Actions**：注册各 secret。
6. **Actions → Daily arXiv Paper Fetch and Filter → Run workflow** 触发首次构建。
7. 工作流完成后（通常 3–5 分钟），站点经 `https://<用户名>.github.io/<仓库名>/` 访问；后续每日 `00:00 UTC`（北京时间 `08:00`）自动更新。

本地开发流程见 [本地开发](#本地开发) 一节，但部署本身并不依赖。

---

## 配置

凭据本地经环境变量、GitHub Actions 经仓库 secrets 注入。可选字段彼此独立，缺省时前端优雅降级。

| Secret | 用途 | 备注 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 过滤流水线 | 二级 LLM 评分 |
| `ZOTERO_API_KEY`   | 个人模式 | 24 位 Zotero API 密钥，需读+写权限 |
| `ZOTERO_USER_ID`   | 个人模式 | zotero.org 数字 user ID |
| `SITE_PASSWORD`    | 个人模式 | 站点访问口令（≥ 8 字符），用于加密凭据 bundle |
| `PDF_PROXY_URL`    | 个人模式 | Cloudflare Worker URL |
| `WEBDAV_URL`       | PDF 上传 | 完整目录路径，含 Zotero 桌面所用的 `/zotero/` 子路径 |
| `WEBDAV_USER`      | PDF 上传 | basic auth 用户名 |
| `WEBDAV_PASS`      | PDF 上传 | basic auth 密码 |

当 `ZOTERO_API_KEY`、`ZOTERO_USER_ID`、`SITE_PASSWORD` 任一缺失时，工作流的 `Build encrypted Zotero credentials bundle` 步骤将向 `js/secrets.enc.js` 写入 disabled 占位，站点回退至访客模式继续可用，无错误。

二级 LLM 默认使用 DeepSeek（经 SJTU 镜像）— 见 [src/filter.py](src/filter.py)。任意 OpenAI 兼容接口均可支持，调整该文件中的 base URL 与 model 标识符即可。

---

## 个人模式配置

### Zotero 凭据

1. 在 [zotero.org](https://www.zotero.org/) 进入 *Settings → Feeds/API*。
2. 创建 private key，勾选 `Allow library access`、`Allow notes access`、`Allow write access`。
3. 记录 24 位 API key 与同页面显示的数字 user ID。

### WebDAV（可选）

WebDAV 文件存储适用于超出 Zotero 自带 300 MB 免费配额的库。所需信息：

- **WebDAV URL** — 必须与 Zotero 桌面所用目录一致，包含桌面端追加的 `/zotero/` 子路径。可在 *Edit → Preferences → Sync → File Syncing* 处确认。示例：`https://mori.teracloud.jp/dav/zotero`。
- **用户名** — 通常为账户用户名。
- **密码** — 部分服务商（TeraCloud、Synology 等）需在后台单独生成 WebDAV 专用密码，与账户登录密码不同。

未配置 WebDAV 时，"Add to Zotero" 控件仍可创建父条目，但仅附挂可点击 URL；后续可在 Zotero 桌面端经 *Find Available PDF* 拉取文件。

### Cloudflare Worker

需要 Worker 的两个原因：arXiv 不返回 CORS 头（浏览器无法直接拉 PDF），且多数 WebDAV 服务器不响应浏览器发起的 PUT 预检（同因）。Worker 转发上述两类请求。Cloudflare 免费版足够支撑。

步骤：

1. 创建 Cloudflare 账户 → *Workers & Pages → Create Worker*。
2. 以下方代码替换默认模板。
3. 将 `WEBDAV_HOST` 设为 WebDAV 服务器域名。
4. Save 并 Deploy；记录返回的 `*.workers.dev` URL。

```javascript
// arxiv-pdf-proxy
//   GET  /?url=<https://arxiv.org/pdf/...>     → 抓取 arXiv PDF
//   GET  /?url=<https://arxiv.org/e-print/...> → 抓取 arXiv LaTeX 源码
//   PUT  /?webdav-put=<https://webdav/...>     → 转发 PUT 至 WebDAV
// 三种模式均返回 CORS 头。upstream Content-Type 透传
// （PDF 仍为 application/pdf，源码为 application/gzip）。

const ARXIV_HOST = 'arxiv.org';
const WEBDAV_HOST = 'mori.teracloud.jp';   // ← 设为你的 WebDAV 域名

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    // WebDAV PUT 转发
    const webdavTarget = url.searchParams.get('webdav-put');
    if (webdavTarget) {
      if (request.method !== 'PUT') {
        return cors(new Response('webdav-put requires PUT', { status: 405 }));
      }
      let target;
      try { target = new URL(webdavTarget); }
      catch { return cors(new Response('bad webdav target url', { status: 400 })); }
      if (target.protocol !== 'https:' || target.hostname !== WEBDAV_HOST) {
        return cors(new Response(`forbidden host: ${target.hostname}`, { status: 403 }));
      }
      const auth = request.headers.get('X-WebDAV-Auth');
      if (!auth) {
        return cors(new Response('missing X-WebDAV-Auth', { status: 401 }));
      }
      // 缓存请求体以显式设置 Content-Length；部分 WebDAV 服务器
      // 不接受客户端的 chunked transfer-encoding。
      const bodyBytes = await request.arrayBuffer();
      const upstream = await fetch(target.toString(), {
        method: 'PUT',
        headers: {
          'Authorization': auth,
          'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream',
          'Content-Length': String(bodyBytes.byteLength),
        },
        body: bodyBytes,
      });
      const text = await upstream.text();
      return cors(new Response(text || `webdav ${upstream.status}`, { status: upstream.status }));
    }

    // arXiv GET 转发
    const arxivUrl = url.searchParams.get('url');
    if (arxivUrl) {
      let target;
      try { target = new URL(arxivUrl); }
      catch { return cors(new Response('bad arxiv url', { status: 400 })); }
      if (target.hostname !== ARXIV_HOST) {
        return cors(new Response('forbidden host', { status: 403 }));
      }
      const upstream = await fetch(target.toString());
      return cors(new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type':
            upstream.headers.get('Content-Type') || 'application/octet-stream',
        },
      }));
    }

    return cors(new Response('bad request', { status: 400 }));
  },
};

function cors(response) {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'X-WebDAV-Auth, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers: h });
}
```

Worker 锁定域名：URL 泄露不致使其被用作通用代理，PUT 操作仍依赖调用方提供的 auth 头。

---

## 架构

### 每日流水线

```
arXiv API → scraper.py → filter.py（一级关键词）
                            │
                            ▼
                       DeepSeek LLM（二级评分 + 主题 + TLDR）
                            │
                            ▼
                       daily_json/YYYY-MM-DD.json
                            │
                            ▼
                       html_generator.py（Jinja2）
                            │
                            ▼
                       daily_html/YYYY_MM_DD.html
                            │
                            ▼
                       GitHub Pages（cron，每日）
```

### 个人模式上传流程

```
浏览器 ──[用户点击 Add to Zotero]──┐
                                    │
              [1] 经 Worker 拉取 PDF（绕开 CORS）
              │
   Cloudflare Worker ──► arxiv.org
              │
              ▼
          PDF 字节
              │
              [2] 计算 PDF 的 MD5
              │
              [3] 创建 Zotero 附件（md5 / mtime / filename 预先填写）
              │
              [4] 构建 <key>.zip 与 <key>.prop，对 zip 取 MD5
              │
              [5] 经 Worker PUT 两个文件
              │
              ▼
   WebDAV 服务器（如 mori.teracloud.jp/dav/zotero）
              │
              ▼
   Zotero 桌面端同步 → PDF 本地可用

   [6]（尽力而为）对 https://arxiv.org/e-print/<id>
       重复 [1]–[5] 上传 LaTeX 源码 tarball ——
       新的附件 key、第二组 <key>.zip + <key>.prop。
```

---

## 安全模型

- **加密 bundle** `js/secrets.enc.js` 公开发布。无站点密码时，Zotero API key、Worker URL、WebDAV 凭据均无法恢复。
- **加密算法** 为认证加密 AES-GCM；密钥经 PBKDF2-SHA256 自站点密码派生，迭代 600 000 次（在现代浏览器中单次解密约 300 ms）。
- **解密后的凭据** 仅存于 `sessionStorage`，作用域限定于当前标签页，关闭浏览器即丢弃。
- **salt 与 nonce** 为确定性派生（`SHA-512(明文输入 ‖ 密码)`），输入不变时 bundle 字节稳定，避免 git diff 抖动。
- **Worker** 锁定 GET 至 `arxiv.org`、PUT 至配置的 WebDAV 域名，限制 URL 泄露的影响半径。

---

## 本地开发

正常使用不要求本地环境，但开发与离线迭代支持本地运行。

```bash
git clone <repository-url>
cd Robotics-paper-daily.github.io
python3 -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\activate
pip install -r requirements.txt
```

设置 `DEEPSEEK_API_KEY` 后：

```bash
python src/main.py                       # 处理今日
python src/main.py --date YYYY-MM-DD     # 处理指定日期
python src/main.py --backfill            # 检测并补齐缺失日期
python src/main.py --backfill --backfill-limit 3

python src/rebuild_html.py               # 基于已有 JSON 重建全部 HTML
python src/rescore_stage1.py             # 重新对所有 JSON 应用一级规则
python src/rescore_stage1.py --dry-run   # 仅统计
```

本地重建加密 bundle（PowerShell）：

```powershell
$env:ZOTERO_API_KEY = "..."
$env:ZOTERO_USER_ID = "..."
$env:SITE_PASSWORD  = "..."
$env:PDF_PROXY_URL  = "https://your-worker.workers.dev"
$env:WEBDAV_URL     = "https://mori.teracloud.jp/dav/zotero"
$env:WEBDAV_USER    = "..."
$env:WEBDAV_PASS    = "..."
python build_secrets.py
```

成功运行时日志将打印输出路径，并标注 `proxy embedded` / `(none)` 与 `webdav embedded` / `(none)` 状态。

本地预览站点：

```bash
python -m http.server 8000
```

---

## 调整过滤策略

一级关键词分级、权重、一级通过阈值、headline / 低分边界、翻译阈值集中在 [src/config.py](src/config.py)。修改后：

```bash
python src/rescore_stage1.py    # 对历史 JSON 应用新规则
python src/rebuild_html.py      # 全量重渲染 HTML
```

`rescore_stage1.py` 不调用 LLM，已有的二级评分保留。

---

## 文件结构

```
.
├── .github/workflows/daily_arxiv.yml   # 定时构建与部署
├── src/
│   ├── main.py                         # 抓取 + 过滤 + 渲染入口
│   ├── config.py                       # 一级分级、权重、阈值、topic 枚举
│   ├── scraper.py                      # arXiv API 客户端
│   ├── filter.py                       # 一级预筛 + 二级 LLM 评分
│   ├── html_generator.py               # Jinja2 渲染器
│   ├── search_index.py                  # 带体积上限的检索分片生成器
│   ├── rebuild_html.py                 # 基于 JSON 全量重建 HTML
│   └── rescore_stage1.py               # 对历史 JSON 重新应用一级规则
├── templates/paper_template.html       # 每日报告 Jinja2 模板
├── daily_json/                         # YYYY-MM-DD.json（论文 + 评分）
├── daily_html/                         # YYYY_MM_DD.html（渲染后的报告）
├── build_secrets.py                    # 加密凭据 → js/secrets.enc.js
├── js/
│   ├── crypto.js                       # PBKDF2 + AES-GCM bundle 解密
│   ├── zotero.js                       # Zotero Web API v3 客户端
│   ├── webdav.js                       # ZIP + .prop 构建器与 WebDAV PUT
│   ├── like.js                         # "Add to Zotero" 按钮逻辑
│   ├── translate.js                    # hjfy.top 跳转辅助
│   └── secrets.enc.js                  # 加密凭据（自动生成）
├── index.html                          # 密码门（个人模式入口）
├── personal.html                       # 已认证应用框架
├── guest.html                          # 公开只读框架
├── list.html                           # 历史报告索引
├── search.html                         # MiniSearch 全文检索
├── search_index/                       # 完整 manifest + 按月检索分片（自动生成）
├── search_index.json                   # 有界的旧客户端兼容索引
├── reports.json                        # 每日报告清单（自动生成）
├── requirements.txt
├── README.md / README_ZH.md
```

---

## 致谢

- 过滤流水线源自 [Arxiv_Daily_AIGC](https://github.com/onion-liu/arxiv_daily_aigc)。
- 中英对照阅读由 [hjfy.top](https://hjfy.top) 提供。
- WebDAV 集成遵循 Zotero 桌面客户端使用的文件存储 zip 格式约定。
