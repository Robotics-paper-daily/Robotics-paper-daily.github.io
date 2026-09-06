# Robotics Daily Papers

![封面](cover.png)

[English](README.md) · [在线站点](https://robotics-paper-daily.github.io/)

| 文档 | 中文 | English |
|---|---|---|
| 项目概览与快速开始 | 本文件 | [README.md](README.md) |
| PaperReader 用户与开发说明 | [app/README_ZH.md](app/README_ZH.md) | [app/README.md](app/README.md) |
| v0.3.1 版本说明 | [RELEASES_NOTES_ZH.md](RELEASES_NOTES_ZH.md) | [RELEASES_NOTES.md](RELEASES_NOTES.md) |
| 安全政策 | [SECURITY_ZH.md](SECURITY_ZH.md) | [SECURITY.md](SECURITY.md) |
| 贡献指南 | [CONTRIBUTING_ZH.md](CONTRIBUTING_ZH.md) | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 维护者发布检查清单 | [RELEASE_CHECKLIST_ZH.md](RELEASE_CHECKLIST_ZH.md) | [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) |
| Windows 路线图与验收记录 | [docs/WINDOWS_ROADMAP_ZH.md](docs/WINDOWS_ROADMAP_ZH.md) | [docs/WINDOWS_ROADMAP.md](docs/WINDOWS_ROADMAP.md) |

[第三方声明](THIRD_PARTY_NOTICES.md)以英文版本为准。

Robotics Daily Papers 是一个机器人学 arXiv 每日摘要项目。GitHub Actions
定时收集 `cs.RO`、`cs.AI`、`cs.CV` 与 `cs.LG` 的新投稿，先做关键词预筛，
再由 LLM 评分与分类，最终发布为可搜索的静态归档。

公开网页是**只读站点**：普通浏览器可以查看、搜索每日论文，
并打开论文或翻译链接；**Add to Zotero** 与 **「帮我读」** 只在 PaperReader
桌面应用中提供。网页不会接触本机 OneDrive 目录、本地凭据或 AI CLI。

## v0.3.1：macOS 与 Windows 版 PaperReader

PaperReader 是论文站的本地配套应用。它可以直接从论文卡片完成：

- 将经过校验的 arXiv PDF 写入 OneDrive 内的 Zotero 链接附件目录，
  并创建对应 Zotero 条目；
- 调用本机已登录的 OpenAI Codex CLI（`codex`）、Claude Code CLI 或
  TraeCode CLI 深读论文；
- 把结构化笔记写入 Obsidian vault、展示实时进度并打开已有笔记；
- 启动时获取最新公开报告，失败时回退到本地缓存或内置快照。

PaperReader v0.3.1 已发布，可从 [GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1) 下载。

| 平台 | v0.3.1 状态 |
|---|---|
| macOS 12+（`arm64`、`x64`） | 已提供 DMG；未签名、未公证 |
| Windows 10 与 Windows 11（`x64`） | 已提供 NSIS 安装包；未签名 |
| Windows `arm64` | 未构建 |
| Linux | 不支持；没有安装包或经过验证的端到端流程 |

Windows 版已包含 Zotero 保存、AI 精读和 Obsidian 笔记功能。部分实机检查仍待完成，
包括不同 OneDrive 同步状态的验证，详见 [Windows 路线图与验收记录](docs/WINDOWS_ROADMAP_ZH.md)。

## 安装 PaperReader

从 [v0.3.1 发布页](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1)
下载与设备匹配的安装包：

| 设备 | 安装包 |
|---|---|
| Apple Silicon Mac（M1/M2/M3/M4 及更新） | `PaperReader-0.3.1-arm64.dmg` |
| Intel Mac | `PaperReader-0.3.1-x64.dmg` |
| Windows 10/11 PC（`x64`） | `PaperReader-0.3.1-x64-Setup.exe` |

同时下载 `SHA256SUMS.txt`，打开安装包前先校验。macOS：

```bash
cd ~/Downloads
# Apple Silicon：
grep 'PaperReader-0.3.1-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
# Intel：
grep 'PaperReader-0.3.1-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

Windows（PowerShell）：

```powershell
cd "$env:USERPROFILE\Downloads"
Get-FileHash .\PaperReader-0.3.1-x64-Setup.exe -Algorithm SHA256
# 将输出哈希与 SHA256SUMS.txt 中 Setup.exe 那一行对比。
```

或在 Git Bash 中：

```bash
grep 'PaperReader-0.3.1-x64-Setup.exe$' SHA256SUMS.txt | sha256sum -c -
```

只运行与已下载文件对应的命令；必须显示 `OK`（或哈希与清单完全一致），不匹配时
请不要安装。校验和用于检查文件完整性，不能证明发布者身份。

macOS 打开 DMG 后，将 PaperReader 拖到“应用程序”；Windows 运行 Setup 安装包，
按安装向导完成安装。

安装包均未签名，macOS 应用也未经过 Apple 公证。如果首次启动时，macOS 提示无法
验证开发者或应用未公证，请先确认下载来源可信，再按
[Apple 官方说明](https://support.apple.com/zh-cn/102445)操作：尝试打开应用后，进入
**系统设置 → 隐私与安全性 → 仍要打开**，再确认**打开**。此流程不适用于恶意软件
或应用已损坏的警告。Windows SmartScreen 如果提示无法识别的应用，请先检查来源与
校验和，再仅对这个安装包选择**更多信息 → 仍要运行**。不要全局关闭系统安全防护。

### 前置条件

浏览报告只需在支持的平台上安装 PaperReader，获取新报告时需要联网。
以下依赖按需配置：

- **保存到 Zotero：**已安装并运行的 Zotero 桌面端，以及已登录、能在本机同步的
  OneDrive 桌面端。Windows 上需开启“文件随选”（Files On-Demand）。
- **精读到 Obsidian：**一个 Obsidian vault、带 PyMuPDF 的 Python 3，以及至少一个
  已安装并登录的精读服务 CLI：
  - [OpenAI Codex CLI（`codex`）](https://developers.openai.com/codex/cli/)：
    安装公开 CLI，并在 CLI 中使用 ChatGPT 或其支持的 API 认证方式登录；
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started)：安装公开 CLI，
    并用其订阅/OAuth 完成登录；
  - TraeCode CLI（`trae-cli` / `trae-agent`）：仅适用于已经获得
    受支持 CLI 与账号的用户；本项目不对外发布或开通 TraeCode CLI。

PDF 提取需要 PyMuPDF，建议安装在独立的 Python 环境中。macOS：

```bash
python3 -m venv "$HOME/.paperreader-python"
"$HOME/.paperreader-python/bin/python3" -m pip install 'PyMuPDF>=1.24,<2'
"$HOME/.paperreader-python/bin/python3" -c 'import fitz; print(fitz.VersionBind)'
```

请把 `$HOME/.paperreader-python/bin` 加入登录 shell 的 `PATH`，然后重启
PaperReader，以便从 Finder 启动时也能找到这个 `python3`。Windows：从
[python.org](https://www.python.org/downloads/) 安装 Python 3 及 `py` 启动器，
然后在 PowerShell 中运行：

```powershell
py -3 -m venv "$env:USERPROFILE\.paperreader-python"
& "$env:USERPROFILE\.paperreader-python\Scripts\python.exe" -m pip install "PyMuPDF>=1.24,<2"
```

再在 PaperReader 设置中选择该 `python.exe`（**Python 3 解释器**），或确保
`py -3 -c "import fitz"` 可用。Windows 检测会依次尝试 `py -3`、`python`、`python3`，
并跳过 Microsoft Store 的 Python 占位程序。从源码运行时也可使用
[`skills/paper-reading/requirements.txt`](skills/paper-reading/requirements.txt)。

### 手动升级且保留配置

退出 PaperReader，下载并校验新版安装包，然后替换旧版本：macOS 把新版 App 拖
到“应用程序”并替换旧副本；Windows 直接在旧版之上运行新的 Setup 安装包。
设置、报告缓存与加密的 Zotero 凭据仍保留在 macOS 的
`~/Library/Application Support/PaperReader/` 或 Windows 的
`%APPDATA%\PaperReader\` 中。如果移动 OneDrive 目录或切换 Zotero profile，
仍需重新确认路径。

如果使用过已停用的 v0.2 网页写入功能，请撤销并更换当时的 Zotero API key 和
WebDAV 密码。删除旧文件不能使已暴露的凭据失效。

### 首次配置

1. Zotero 桌面端登录的必须是 API key 所属的**同一个 Zotero 个人文献库账号**。
   开启 Zotero Sync 并先手动成功同步一次。启动 OneDrive，等待附件文件夹
   已在本机可用。
2. 在 Zotero 打开**设置 → 高级 → 文件和文件夹**，把
   **Linked Attachment Base Directory（链接附件基准目录）**设为 OneDrive
   内的文件夹，例如 `OneDrive/Zotero-Attachments`。
3. 在 [Zotero 官方 key 创建页](https://www.zotero.org/settings/keys/new)
   为自己的个人文献库创建一个**24 个字符的私有 API key**，
   开启文献库访问与写入权限。不要提交或分享这个 key。
4. 打开 PaperReader → **设置**，粘贴 key 并选择**验证并安全保存**（或
   **保存全部设置**）。
   PaperReader 会向 Zotero 验证 key，并自动填写用户 ID。
5. PaperReader 会检测 Zotero 当前 profile 与链接附件目录。如果界面要求
   手动选择目录，请选择 Zotero 中配置的同一个 OneDrive 文件夹；真实路径
   不一致时应用会拒绝保存。
6. 如需精读，选择专用的 Obsidian vault，例如 `~/Documents/PaperReadingDaily`，
   不要直接选择用户主目录或整个 `Documents`。`paper-reading` 技能已随应用打包，
   不需要复制到 vault。目录限制详见[安全政策](SECURITY_ZH.md)。
7. 选择 Codex、Claude 或 Trae，并确认自动检测到的 CLI 路径。开始精读前，
   先用相应服务的 CLI 完成本机登录。Codex 直接使用本机 `codex` CLI
   已有的 ChatGPT/API 登录；PaperReader 不会要求输入、收集或保存 ChatGPT
   登录信息或 OpenAI API key。开始任务前，确认前面配置的 Python 环境可以导入 `fitz`。
8. 如需跨设备同步笔记，只选一种方案：把**整个 Obsidian vault**
   放在 OneDrive 中并让每台设备打开该同步文件夹；或者把 vault 放在
   OneDrive 之外并使用 Obsidian Sync。同一个 vault 绝不叠加两个同步器。
   Zotero PDF 附件目录应与 Obsidian vault 分开。

步骤 1–5 用于配置 Zotero 保存，步骤 6–8 用于配置精读和笔记同步。

首次配置时，AI 工具的检测顺序为 Codex、Claude、Trae；三者都未检测
到时，引导界面默认选择 Codex。手动选择的工具不会被自动替换。
`codexModel` 留空时使用 Codex 隔离任务的默认模型，PaperReader
不会读取个人 `config.toml`；填写后才会为精读任务显式指定模型。

API key 与自动取得的 user ID 使用 Electron `safeStorage` 加密；macOS 走
Keychain 支持的系统安全存储，Windows 走 DPAPI 支持的系统安全存储。密文位于
App user-data 目录（macOS 为 `~/Library/Application Support/PaperReader/`，
Windows 为 `%APPDATA%\PaperReader\`）下的
`zotero-credentials.secure.json`，非敏感设置位于同目录的 `config.json`。
PaperReader 不会把 key 写入网页、报告视图、设置 JSON、日志或生成的笔记。

key 保存后，PaperReader 会分页、只读扫描个人文献库，并从不同文献类型与
集合中识别 arXiv ID。因此重装 App 后，库中已有论文会恢复为 **In Zotero**，
不再只认识 `Daily Paper` 集合。对于不属于 PaperReader 管理集合的旧条目，
App 只显示“已在库中”，不会重复创建、移动、补附件或删除原条目。
v0.3.0 及之后新建的父条目会带标签 `paperreader-managed-v1`；只有同时带该标签
且仍在 `Daily Paper` 集合树中的条目可由应用修复或移除。无标签的旧条目或
手动条目即使在该集合中，也始终只读。

### 加入 Zotero

Zotero 与 OneDrive 的职责不同：Zotero Web API 创建文献条目、集合与链接附件
元数据；OneDrive 只同步 PDF 文件。之后 Zotero 桌面端通过官方
Zotero Sync 取回元数据，并用本机 Linked Attachment Base Directory
解析 PDF 路径。

点击一次 **Add to Zotero** 即可，不再弹出第二个 PaperReader 确认框。随后
应用会：

1. 重新读取 Zotero 当前 profile，确认 PaperReader 与 Zotero 解析到同一个
   OneDrive 链接附件基准目录；
2. 下载标准 arXiv PDF，校验内容，并在不覆盖冲突文件的前提下写入目录；
3. 检查本机 OneDrive 同步状态，再次计算已保存文件的哈希；
4. 创建 Zotero 父条目及 `linked_file` 子附件，其路径为扁平的
   `attachments:<filename>.pdf`。

Zotero 的 PDF 下载、本地保存、OneDrive 检查和最终哈希校验使用固定队列，最多
同时处理 4 篇，其余按提交顺序排队。同一保存操作尚未结束时，重复请求会合并。
该限制独立于 AI 精读并发，也不限制所有 Zotero API 请求。排队本身不能避免网络或 API 错误。

macOS 的同步检查读取 File Provider 提供的上传和冲突状态。Windows 目前检查
本机文件的重解析点属性，不能据此证明上传已完成或云端副本无冲突。两个平台都不会
下载云端副本来逐字节比对。在另一台设备打开 PDF 前，仍需确认 OneDrive 已完成同步。

日报卡片和搜索结果会归入 `Daily Paper/<报告日期>`；手动输入的
arXiv 链接会归入 `Daily Paper/<arXiv 首次发布日期>`。因此集合日期可能
不是你点击 Add 的当天。

目录、PDF、同步状态检查或 Zotero API 请求失败时，应用会提示错误。
如果在保存 PDF 后失败，附件目录可能保留一份已校验文件，同一论文重试时可以复用。
OneDrive 文件可能比 Zotero 元数据更早出现；请先
等 App 报告最终成功，再在 Zotero 桌面端手动同步。**Remove** 只删除
PaperReader 管理的 Zotero 条目，不删除 OneDrive 中的 PDF。

### 精读到 Obsidian

点击 **「帮我读」** 后，PaperReader 调用所选的本地 CLI。OpenAI Codex
CLI（`codex`）使用它已有的 ChatGPT/API 登录，Claude 使用已登录的 `claude`
CLI 及其订阅/OAuth 会话，Trae 使用本机已登录的 `trae-cli` 或
`trae-agent`。PaperReader 不收集或保存 AI 服务凭据。应用内会显示进度，
结果默认写入：

```text
<vault>/<date>/<title>/
```

如果已经存在匹配笔记，论文卡片会显示**笔记**并直接打开，而不是重复
精读。只有在 Obsidian 勾选笔记最后的 `- [ ] ✅ 已读`（变为 `- [x]`）后，
卡片才显示 **✓ 已读**。精读中间文件位于 vault 之外、由 App 管理的
`$PAPERREADER_CACHE_DIR`，不会当作笔记同步。

CLI 可能会把论文内容、提示词与上下文发送给所选 AI 服务。精读任务可以读写所选
vault 并联网，不会逐步请求授权。Codex 使用受限的权限配置；Claude 与 Trae 使用
各自跳过权限确认的模式，不具备同样的限制。请使用不含敏感文件的专用 vault。
论文内容可能包含恶意指令，仅靠精读提示词无法保证任务不受其影响。
各服务的权限与数据处理方式详见[安全政策](SECURITY_ZH.md)。

PaperReader 本身没有内置分析或遥测，会按功能需要访问报告站、arXiv、Zotero、
OneDrive 与所选 AI 服务。

### 同步排障

- **OneDrive 有 PDF，Zotero 没条目**：等 Add 返回最终成功；确认 API key 与
  Zotero 桌面端是同一账号，点击 Zotero 同步，检查 `Daily Paper/<预期日期>`，
  并按 arXiv ID 搜索整个库。
- **zotero.org 有条目，桌面端没有**：Zotero 元数据同步尚未完成；它与
  OneDrive 文件同步互相独立。
- **另一台设备有条目但打不开 PDF**：该设备也要把 Linked Attachment Base
  Directory 指向同一 OneDrive 文件夹在它本机的路径，并等文件下载。
- **Add 写入 PDF 后失败**：保留已校验文件，直接对同一论文重试；期间
  不要改名或复制。
- **多端笔记冲突**：停止其中一个 vault 同步器，保留唯一主文件夹，等同步
  完成后再在各设备打开。
- **精读在解析前失败**：在登录 shell 运行 `python3 -c 'import fitz'`
  （Windows 运行 `py -3 -c "import fitz"`，或检查设置中选定的解释器），并确认
  所选 AI CLI 已安装、已登录。

更详细的错误排查见 [PaperReader 使用说明](app/README_ZH.md)。

## 网页功能

GitHub Pages 站点提供：

1. 每日数据摄取：arXiv 客户端内部重试后再使用有上限的 30/60 秒外层等待，
   DeepSeek 请求使用有上限的指数退避；
2. 四级关键词预筛与后续 DeepSeek 评分；
3. 主题标签、关键词与中英文 TLDR；
4. 按日期归档的 JSON 与 HTML；
5. 按月分片、大小受控的全文检索索引；
6. 缺失日期补全，以及 AI 评分阶段全量失败日报的自动修复；
7. 无需再次调用 LLM 的历史 Stage-1 重打分。

网页**不保存** Zotero 凭据，不写 PDF，不启动本地 CLI，也不修改 Obsidian
vault。相关控件只在 PaperReader 中出现，由桌面应用访问本机链接附件目录和
OneDrive 同步状态。

## 部署自己的只读站点

1. Fork 本仓库。
2. 在 **Settings → Pages** 中从 `main` 分支根目录 `/` 发布。
3. 在 **Settings → Secrets and variables → Actions** 中添加对应服务商签发的
   `DEEPSEEK_API_KEY`。
4. 为同一个服务商添加仓库变量 `DEEPSEEK_API_BASE` 和 `DEEPSEEK_MODEL`。
   使用 DeepSeek 官方服务时分别填写 `https://api.deepseek.com` 和
   `deepseek-v4-flash`；如果不设置，fork 默认使用这组官方配置。只有规范仓库
   `Robotics-paper-daily` 会保留原有的 SJTU 兼容网关与 `deepseek-chat` 配置。
5. 在 Actions 页手动运行一次 **Daily arXiv Paper Fetch and Filter**。

API endpoint 的运营方会收到密钥与论文 prompt。不要把一家服务商的密钥发往
另一家 endpoint。流水线不会在服务商之间自动回退：认证或配置错误会停止发布，
而不是生成 AI 评分为 0 的日报。

生成的站点位于 `https://<username>.github.io/<repository>/`。部署网页不需要
Zotero key、站点密码、OneDrive 凭据、WebDAV 服务或 Cloudflare Worker。

## 架构

### 每日发布流水线

```text
arXiv API
  → scraper.py
  → filter.py（关键词 Stage 1 → DeepSeek Stage 2）
  → daily_json/YYYY-MM-DD.json
  → html_generator.py
  → daily_html/YYYY_MM_DD.html
  → GitHub Pages
```

### PaperReader 本地流程

```text
只读公开报告
  → 沙箱化报告视图 + 应用内置 bridge
  ├─ Add to Zotero
  │    → 校验 OneDrive 目录 → 校验 PDF → 本机同步状态检查
  │    → Zotero Web API 父条目 + linked_file 元数据
  └─ 「帮我读」
       → 本地 Codex/Claude/Trae CLI → 内置 paper-reading 技能
       → 结构化 Obsidian 笔记 + 进度事件
```

远程报告 HTML 被视为不可信内容：它在独立来源沙箱与严格内容策略下运行，
凭据只留在可信应用层。特权请求经过窄化白名单与限定范围、限定时效的用户
手势校验；报告本身不能请求任意文件系统或网络访问。

## 本地开发

### 每日流水线与网页

请使用 Python 3.10 或更高版本。CI 固定为 Python 3.14；当前锁定的 `arxiv`
与 `requests` 版本不支持 Python 3.9。

```bash
git clone <repository-url>
cd Robotics-paper-daily.github.io
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt

export DEEPSEEK_API_KEY="..."
# 可选；本地运行默认使用 DeepSeek 官方 endpoint/model。
export DEEPSEEK_API_BASE="https://api.deepseek.com"
export DEEPSEEK_MODEL="deepseek-v4-flash"
python3 src/main.py
python3 src/main.py --date YYYY-MM-DD
python3 src/main.py --backfill --backfill-limit 3
python3 src/rescore_stage1.py --dry-run
python3 src/rebuild_html.py
```

用 `python3 -m http.server 8000` 可预览静态输出。

### PaperReader

```bash
cd app
npm ci
npm test
npm start
```

PaperReader v0.3.1 使用 Electron 43 与 electron-builder 26；
`app/package-lock.json` 提供锁定的可复现安装。

`app/run-windows.bat` 是源码开发辅助脚本，不是产品安装包。
Windows 日常使用请通过 Setup 安装包安装。

在 macOS 本机同时构建两个架构：

```bash
cd app
npm run dist:mac
```

在 Windows x64 本机构建 Windows 安装包：

```bash
cd app
npm run dist:win
```

推送匹配 `v*` 的语义化版本 tag 会在 macOS 与 Windows runner 上运行 CI：
安装锁定依赖，在两个平台上执行完整 app 测试，构建未签名的 `arm64` 与 `x64`
DMG 以及未签名的 Windows NSIS 安装包，审计打包产物，并把这三份安装包和
合并后的 `SHA256SUMS.txt` 发布到 GitHub Release。
完整发布流程见[发布检查清单](RELEASE_CHECKLIST_ZH.md)。

## 调整过滤策略

Stage-1 关键词层级、权重、阈值与主题配置集中在
[`src/config.py`](src/config.py)。修改后运行：

```bash
python3 src/rescore_stage1.py
python3 src/rebuild_html.py
```

历史 Stage-2 结果会保留；重打分不会调用 LLM。

## 仓库结构

```text
.
├── .github/workflows/
│   ├── daily_arxiv.yml          # 摄取、过滤、渲染与发布
│   └── build-app.yml            # 测试、Mac DMG、Windows 安装包与 GitHub Release
├── app/                         # PaperReader Electron 应用
├── docs/                        # 平台规划与工程记录
├── skills/paper-reading/        # 随 PaperReader 打包的技能
├── src/                         # 摄取、过滤、渲染与搜索
├── templates/                   # 每日报告模板
├── daily_json/                  # 结构化每日归档
├── daily_html/                  # 已渲染日报
├── search_index/                # 按月搜索分片
└── reports.json                 # 报告清单
```

## 许可证与致谢

项目采用 [MIT License](LICENSE)。过滤流水线衍生自
[Arxiv_Daily_AIGC](https://github.com/onion-liu/arxiv_daily_aigc)，中英对照阅读
链接使用 [hjfy.top](https://hjfy.top)。打包依赖与外部服务边界见
[第三方声明](THIRD_PARTY_NOTICES.md)。

开发环境、生成文件规则、必需检查与 pull request 要求见
[贡献指南](CONTRIBUTING_ZH.md)。可能的漏洞应按[安全政策](SECURITY_ZH.md)
私密报告，不要直接写入公开 issue。
