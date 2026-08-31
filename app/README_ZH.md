# PaperReader v0.3.0 中文指南

[English](README.md) · [Windows 路线图](../docs/WINDOWS_ROADMAP_ZH.md) ·
[安全政策](../SECURITY_ZH.md)

PaperReader 是 Robotics Daily Papers 的桌面配套应用。公开站点保持只读；所有需要
本地文件或本地凭据的操作都在这个 Electron App 中完成。

本源码树的目标版本是 v0.3.0。在 `v0.3.0` tag、官方 GitHub Release、以下两份
DMG 和 `SHA256SUMS.txt` **全部实际存在之前**，它只是候选版，不能描述为已经发布
的稳定版：

- `PaperReader-0.3.0-arm64.dmg`：Apple Silicon（M1 及更新）
- `PaperReader-0.3.0-x64.dmg`：Intel Mac

v0.3.0 只支持 macOS 12 或更高版本。Windows **已规划但尚未支持**，Linux 也未
受支持；两者都没有正式安装包。`run-windows.bat` 只是供贡献者实验性从源码启动
的脚本，不是发布资产，也不能证明 Windows 兼容性；后续工作见
[Windows 路线图](../docs/WINDOWS_ROADMAP_ZH.md)。

## App 的功能

- **Add to Zotero：**把经过校验的 arXiv PDF 写入 Zotero 配置在 OneDrive 中的
  Linked Attachment Base Directory，并创建对应的 `linked_file` 条目。
- **「帮我读」：**调用本机已经认证的 OpenAI Codex CLI（`codex`）、Claude
  Code CLI 或 TraeCode CLI，使用内置 `paper-reading` skill 生成结构化 Obsidian
  笔记。
- **已有笔记状态：**检测所选 vault 中的笔记，并直接打开已经存在的结果。
- **最新报告：**获取当前发布的报告 manifest 与页面；失败时回退到离线缓存或
  App 内置 snapshot。

Add to Zotero 与精读控件由 PaperReader 注入。它们不再作为浏览器功能维护，公开
网页也不会显示这些控件。

## 运行要求

- macOS 12 或更高版本；
- 已安装并正在运行的 Zotero 桌面端；
- 已登录并在本机同步的 OneDrive 桌面端；
- 一个包含 `.obsidian/` 的专用 Obsidian vault。PaperReader 会拒绝文件系统根
  目录、用户主目录及其祖先，也会拒绝 `Documents`、`Downloads`、`Library`、
  `.config`、`.local`、`.codex`、`.ssh` 等宽泛的主目录一级文件夹。专用的
  嵌套文件夹可以使用；Codex 还会拒绝与 PaperReader user data/cache、
  `$CODEX_HOME` 或 SSH 目录重叠的 vault；
- 至少一个已安装并完成登录的 provider：
  - [OpenAI Codex CLI（`codex`）](https://developers.openai.com/codex/cli/)：
    安装公开 CLI，并使用它自己的 ChatGPT 或受支持 API 认证；或
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started)：
    安装公开 `claude` CLI，并使用其订阅/OAuth 登录；或
  - TraeCode CLI：仅适用于已经独立获得受支持 `trae-cli` 或 `trae-agent` 与
    账号的用户。PaperReader 不分发或开通 TraeCode CLI；
- Finder 启动的 App 所使用的 login-shell `PATH` 中必须有 `python3` 和
  PyMuPDF（`fitz`）。一种隔离安装方式是：

  ```bash
  python3 -m venv "$HOME/.paperreader-python"
  "$HOME/.paperreader-python/bin/python3" -m pip install 'PyMuPDF>=1.24,<2'
  "$HOME/.paperreader-python/bin/python3" -c 'import fitz; print(fitz.VersionBind)'
  ```

  把 `$HOME/.paperreader-python/bin` 加入 login-shell `PATH`，重启 App，并在
  login shell 中验证 `python3 -c 'import fitz'`。从源码构建的用户也可使用
  [`../skills/paper-reading/requirements.txt`](../skills/paper-reading/requirements.txt)。

PaperReader 不收集或保存任何 AI provider 凭据。Codex 使用本机 `codex` CLI 已
管理的 ChatGPT/API 认证；沙箱任务命令被明确禁止访问 `$CODEX_HOME`。Claude 与
Trae 同样使用各自的本地 CLI 会话。用量、可用模型与配额取决于相应账号。

## 下载、校验与安装

只有当官方 `v0.3.0` tag、Release、两份 DMG 与 `SHA256SUMS.txt` 均已实际存在时，
才按稳定版执行以下步骤；此前请把本源码树视为候选版：

1. 打开[官方 Releases 页面](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases)，
   确认 v0.3.0 Release 与上述三项资产真实存在，再下载与 Mac 架构匹配的 DMG
   和 `SHA256SUMS.txt`。
2. 在 Terminal 中运行 `cd ~/Downloads`，然后校验已下载的架构：
   - Apple Silicon：`grep 'PaperReader-0.3.0-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -`
   - Intel：`grep 'PaperReader-0.3.0-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -`
   对应 DMG 必须显示 `OK`。
3. 打开 DMG，把 PaperReader 拖入“应用程序”。
4. 在 Finder 中打开“应用程序”，按住 Control 点击或右键 PaperReader，选择
   **打开**，再确认**打开**。

这些候选 DMG 没有 Apple Developer ID 签名，也没有经过 Apple 公证。右键
**打开**只为这个 App 创建首次启动例外，不需要也不应全局关闭 Gatekeeper。
SHA-256 可以发现下载损坏，但不能替代签名或公证，也不能在发布渠道失陷时证明
产物来源。

### 手动升级且不重置设置

退出 PaperReader，下载并校验新版 DMG，把新版 App 拖入“应用程序”并替换旧版。
新版会继续使用 `~/Library/Application Support/PaperReader/` 下的设置、报告缓存
与加密 Zotero 凭据。移动 OneDrive 目录或切换 Zotero profile 后，仍需重新确认
附件路径。

## 首次配置

### 1. 准备 Zotero 与 OneDrive

1. Zotero 桌面端登录的必须是 API key 所属的**同一个 Zotero 个人文献库账号**。
   开启 Zotero Sync，并先手动成功同步一次。
2. 启动 OneDrive，等待同步可用。
3. 启动 Zotero。
4. 在 Zotero 打开 **Settings -> Advanced -> Files and Folders**。
5. 把 **Linked Attachment Base Directory** 设为 OneDrive 中的文件夹，例如
   `OneDrive/Zotero-Attachments`。

使用专用、扁平的附件目录。PaperReader 会拒绝当前 macOS OneDrive container
之外的位置，也会拒绝与 Zotero 当前 profile 解析结果不同的路径。

### 2. 创建并保存 Zotero key

1. 打开 [Zotero key 创建页](https://www.zotero.org/settings/keys/new)。
2. 为个人文献库创建一个 24 个字符的私有 key。
3. 开启个人文献库读取和写入权限。
4. 在 PaperReader -> **Settings** 中粘贴 key，选择 **Verify and securely
   save**（或 **Save all settings**）。

PaperReader 会调用 Zotero current-key endpoint，验证所需权限，并自动取得数字
user ID。用户只需要输入 API key。

key 与 user ID 使用 Electron `safeStorage` 加密；macOS 使用由 Keychain 支持的
系统存储能力。加密 envelope 以私有文件权限保存在 App user-data 目录。没有明文
回退：系统加密不可用时，PaperReader 会拒绝保存凭据。Settings 页面不会再次显示
已保存的 key。

如果已停用的 v0.2 网页 writer 曾经保存过 Zotero key 或 WebDAV 密码，请在配置
v0.3.0 前撤销并轮换这些凭据。从当前 checkout 删除旧 bundle 无法撤销已经进入
Git 历史的 secret。

保存 key 后，shell 还会对整个个人文献库做分页、只读的 presence index。App 会
从所有 collection 和受支持文献类型中提取明确的 arXiv ID。`Daily Paper` tree
之外的已有条目会显示为 **In Zotero**，但报告拿不到它的真实 item key，也不会
获得 Remove 或 repair 权限。

v0.3.0 新建的父条目带可见 Zotero tag `paperreader-managed-v1`。Repair 与 Remove
必须同时满足该 tag 仍存在，且条目仍属于 `Daily Paper` collection tree。无 tag
的旧条目或手动条目即使位于该 tree 中，也始终只是 presence-only。

### 3. 确认附件目录

PaperReader 会检测 Zotero 当前 profile 及其配置的 linked-file base directory。
如果目录未自动填入，请在 PaperReader Settings 中选择同一个 OneDrive 文件夹。
App 比较解析后的真实路径，而不是显示字符串，并会在每次写入前重新验证。

### 4. 配置 Obsidian 与 provider

1. 选择用于接收论文笔记的专用 Obsidian vault。不要选择文件系统/主目录根、宽泛的
   个人一级文件夹，或与 PaperReader user data/cache、`$CODEX_HOME`、SSH 重叠
   的路径。
2. 选择 **Codex**、**Claude** 或 **Trae**。
3. 接受自动检测到的 executable，或手动选择。
4. 如果尚未认证，在 provider 自己的 Terminal CLI 中完成登录。
5. 只在确有需要时调整模型与**精读并发**。

跨设备笔记只能选择一种同步方式：把整个 vault 放在 OneDrive 中，并在各设备打开
该同步文件夹；或者把 vault 放在 OneDrive 外并使用 Obsidian Sync。不要对同一
vault 同时运行两个同步器。Zotero linked-PDF 目录必须位于 vault 外，在另一台 Mac
编辑同一笔记前先等待同步完成。

全新配置的首次发现顺序为已安装的 Codex CLI、Claude、独立提供的 Trae CLI；如果
都未检测到，onboarding 仍停留在 Codex。已经明确选择的 provider 不会被覆盖。
`codexModel` 为空时，隔离任务使用 Codex 服务/内置默认模型，并且不会读取用户的
`config.toml`；填写后才对 PaperReader 任务应用明确模型。

`paper-reading` skill 随 App 安装在 `Resources/skills` 中，vault 不需要自己的
副本。PaperReader 会把内置 `paper-reading/SKILL.md` 解析为绝对路径，并把该精确
路径传给所选 CLI；旧的 vault-local skill 位置只作为兼容 fallback。

## Add to Zotero 的事务保证

Zotero 与 OneDrive 的同步职责不同。Zotero Web API 负责父条目、collection
membership、tag 与 linked-attachment metadata；OneDrive 只负责 PDF 字节。
Zotero 桌面端通过正常 Zotero Sync 取得 metadata，再按该设备的 Linked
Attachment Base Directory 解析 `attachments:<filename>.pdf`。因此，在 OneDrive
看到 PDF 并不代表 Zotero API 写入或桌面 metadata sync 已经完成。

一次真实用户点击即可开始保存，不会再显示第二个重复确认框。特权操作仍要求焦点
窗口中近期的真实鼠标或键盘手势。

每次保存时，PaperReader 会：

1. 规范化 arXiv ID，并取得 canonical metadata；
2. 检查 Zotero profile 与 OneDrive base directory 的精确真实路径；
3. 下载 PDF，校验响应、文件签名与大小；
4. 使用独占临时文件写入，再原子提交，并且不替换有冲突的现有文件；
5. 要求 macOS File Provider 确认 OneDrive 已上传且没有冲突；
6. 重新打开已提交 PDF 并计算哈希；
7. 创建或对账 Zotero 父条目与 `linked_file` 子条目，使用扁平的
   `attachments:<filename>.pdf` 路径。

日报卡片或搜索结果写入 `Daily Paper/<报告日期>`；手动输入的 arXiv 链接写入
`Daily Paper/<arXiv 首次发布日期>`。因此 collection 日期可能与点击 Add 的日期
不同。

本地文件和云端状态都确认前，metadata 不会被视为成功。OneDrive commit 之后的
Zotero API failure 可能在链接目录中保留一份已校验、可复用的 PDF。请保留该文件：
同一论文的重试使用确定性 identity 与 reconciliation，不会盲目重复上传或创建。
OneDrive 可能先于 Zotero 显示 PDF；请等待 App 最终成功，再运行 Zotero 桌面 Sync。

Zotero PDF/OneDrive materialization 阶段由独立的固定队列保护：**最大并发为 4**。
包括超过 10 篇在内的突发请求会全部进入内存队列，最多同时执行 4 篇，其余严格按
FIFO 启动；相同 operation key 在 queued 或 running 时会合并为同一个 Promise；
任务成功或失败都会释放 slot，并继续启动后续任务。这个值不是 Settings 中的
`concurrency`，用户不能用精读并发设置把 Zotero 写入提高到 10 或 16。该阶段前后
的 Zotero Web API 操作使用各自的 timeout、idempotency 与 reconciliation 控制。

**Remove** 只适用于仍带 `paperreader-managed-v1` tag 且仍在 `Daily Paper` tree
中的条目。它会删除 Zotero 父/子 metadata，但有意保留磁盘上的 OneDrive PDF。
无 tag 的旧条目、手动条目，以及已经移出 managed tree 的条目都是 presence-only，
不能由 PaperReader repair 或 Remove。

## 本地精读流程

```text
论文卡片「帮我读」
  -> 可信 App bridge -> 有界 JobQueue
  -> 所选本地 provider
      |- Codex: codex exec --json --ephemeral ...
      |- Claude: claude -p ... --output-format stream-json
      `- Trae: trae-cli / trae-agent exec --json ... -C <vault>
  -> 内置 paper-reading/SKILL.md 的精确解析路径
  -> 规范化进度事件
  -> <vault>/<date>/<title>/
```

结果通常包括 Markdown 笔记、下载的论文，以及 skill 生成的附件/代码。如果已经有
匹配文件夹，卡片显示**笔记**并直接打开，而不是启动新任务。只有在 Obsidian 中把
笔记最后的 `- [ ] ✅ 已读` 勾选为 `- [x]` 后，卡片才显示 **✓ 已读**。该 checkbox
是唯一阅读状态信号；只生成或打开笔记不会改变状态。

精读临时输入位于 vault 外、由 App 管理的
`~/Library/Application Support/PaperReader/paper-cache/`，以
`$PAPERREADER_CACHE_DIR` 传给 provider。完成的任务只删除自身中间文件；启动时
会清理遗留 scratch entry，但不会删除 cache root。完成后的笔记文件夹、原始 PDF、
抽取图片与可选代码是预期 vault 内容，会随 vault 同步。

## Settings 参考

所有 App 私有本地文件位于 `~/Library/Application Support/PaperReader/`：非敏感
设置在 `config.json`，加密 Zotero 数据在 `zotero-credentials.secure.json`，下载
的报告 cache 在 `site-cache/`，可丢弃精读 scratch 在 `paper-cache/`。Zotero/
OneDrive linked PDF 与所选 Obsidian vault 留在用户选择的路径。向公开 issue 附加
support directory 或 vault 前，必须检查并移除私有路径和内容。

| 设置 | 默认值 | 用途 |
|---|---|---|
| `provider` | `codex`；全新发现顺序为 `codex` -> `claude` -> `trae` | 本地精读 provider；保留用户明确选择 |
| `vaultPath` | 自动检测 | Obsidian 笔记目标 |
| `zoteroLinkedAttachmentRoot` | 自动检测/空 | 精确的 Zotero OneDrive linked-file base |
| `codexPath` | 自动检测 | `codex` executable override |
| `claudePath` | 自动检测 | `claude` executable override |
| `traePath` | 自动检测 | `trae-cli` / `trae-agent` override |
| `codexModel` | 空 | 可选 Codex 模型 override；为空时使用隔离任务的服务/内置默认值，不加载用户 `config.toml` |
| `codexReasoningEffort` | 空 | 可选 Codex reasoning override；为空时使用隔离任务的服务/内置默认值，不加载用户 `config.toml` |
| `model` | `sonnet` | Claude 模型 alias |
| `traeModel` | `gpt-5.4` | Trae 模型；Settings 可刷新在线模型列表 |
| `traeBackendVariant` | `max` | 可选 Trae backend variant |
| `traeReasoningEffort` | `ultra` | Trae reasoning effort |
| `concurrency` | `10` | **AI 精读**同时运行数，限制为 1-16；与固定为 4 的 Zotero 写入队列无关 |
| `maxBudgetUsd` | `0` | 可选 Claude 单次精读预算；0 表示停用限制 |
| `liveBase` | 项目 GitHub Pages URL | 最新报告来源；空表示只使用离线内容 |

在 Codex、Claude 与 Trae 之间切换时，各 provider 的设置都会保留。

## 安全边界

已发布的日报 HTML 是数据，不是 authority。PaperReader 通过 restrictive content
policy 把它放在 unique-origin sandbox 中。只有内置脚本能通过 shell 请求少量、
typed action；报告不能读取凭据、直接调用 Electron、选择文件系统目标，或发起
任意特权请求。

main process 还会检查 caller frame、action schema、当前报告 identity、窗口焦点与
近期真实用户手势。Zotero 凭据始终留在可信 App 层，绝不发送到 report iframe。

OpenAI Codex、Claude Code 与 TraeCode 是独立云端 provider。它们的 CLI 可能依据
自己的条款发送论文、prompt、生成上下文与 provider diagnostics。PaperReader 不
收集或保存它们的登录凭据。

Codex 适配器使用基于 `:workspace` 的命名权限配置运行
`codex exec --json --ephemeral`。读取默认拒绝，只开放 Codex 最小运行时、内置
skill、已探测 Python/PyMuPDF 运行时、所选 vault 中 `.obsidian` 之外的内容，以及
App cache；同一 vault 内容和 cache 可写。系统临时目录被拒绝并重定向到 cache；
允许联网，且停用交互授权。

在 App 报告 Codex 已就绪前，它会传入随机且明确不存在的 output schema 路径，
强制在本机真实解析所有安全敏感 override。只有精确的缺失文件错误会被接受；探针
不创建 schema 文件，也不调用模型。适配器忽略通用用户 config/rules，把 vault
标记为 untrusted 以跳过项目级 `.codex` config/hooks/rules，并停用全局/vault
`AGENTS.md` 发现、plugins、apps、hooks、skill discovery、login shells 与 shell
snapshots。生成的 shell 命令只获得核心环境，以及精确的 cache 与 Python 路径。

沙箱命令不能读取 `$CODEX_HOME`、SSH 材料、PaperReader 设置、无关主目录文件；
vault 的 `.obsidian` 配置和插件也不可读写。Codex 自身仍可通过 `codex login`
认证。权限 profile 是 beta 纵深防御，并不是完整 OS 安全边界。Claude 与 Trae
使用各 provider 的 non-interactive bypass 模式。只使用可信 vault 与账号。

论文/PDF/HTML/仓库内容属于不可信输入。内置 skill 会拒绝嵌入式指令，并禁止读取
凭据或无关本地文件；如果任务生成的命令或输出与论文分析无关，应立即停止。

PaperReader 没有内置分析或遥测。实现功能所需的流量仍会访问公开报告站、arXiv、
Zotero、macOS/OneDrive File Provider 与所选 AI provider。完整数据流和披露政策
见[中文安全政策](../SECURITY_ZH.md)。

## 从源码运行

受支持的 macOS 开发流程：

```bash
cd app
npm ci
npm test
npm start
```

`prestart` 会在 Electron 启动前刷新内置站点 snapshot。App 使用 Electron 43 与
electron-builder 26，由 `package-lock.json` 锁定。

`run-windows.bat` 只是实验性的 Windows 源码启动器。它不安装 Windows 产品、不
验证 Zotero/OneDrive 事务，也不表示 Windows 已受支持。不要把它打入 GitHub
Release；Windows 正式支持的全部阻塞项见
[Windows 路线图](../docs/WINDOWS_ROADMAP_ZH.md)。

## 构建与发布

在 macOS 上构建两个 Mac 架构：

```bash
cd app
npm run dist:mac
```

`Build PaperReader for macOS` GitHub Actions workflow 可以手动运行。匹配 `v*`
的 tag 还会执行稳定版发布流程：

1. 使用 `npm ci` 安装依赖；
2. 运行 `npm test`；
3. 构建未签名的 Apple Silicon（`arm64`）与 Intel（`x64`）DMG；
4. 生成 `SHA256SUMS.txt`；
5. 把两份安装包和 checksum manifest 发布到稳定 GitHub Release。

tag 推送前必须完成[中文发布检查清单](../RELEASE_CHECKLIST_ZH.md)或对应的
[英文清单](../RELEASE_CHECKLIST.md)。只有 tag、Release 和全部资产实际存在后，
文档才能把 v0.3.0 从候选版改为已发布稳定版。v0.3 只发布 Mac DMG，不得上传
`.exe`、`.msi`、Windows archive、`run-windows.bat` 或增量分发资产。

## 排错

- **API key 被拒绝：**创建具有个人文献库读写权限的 24 字符 key。只允许 group
  或只读访问都不够；确认 Zotero 桌面端登录的是同一账号。
- **目录不匹配：**重新打开 Zotero 当前 profile，确认 Linked Attachment Base
  Directory，并在 PaperReader 选择该精确 OneDrive 文件夹。alias/symlink 不能
  绕过真实路径比较。
- **无法确认云端状态：**确认 OneDrive 正在运行，文件夹位于当前 OneDrive
  container 中，且同步健康，然后重试。
- **OneDrive 有 PDF，但 Zotero 没有条目：**先等待 App 最终结果。成功后点击
  Zotero 桌面 Sync；卡片/搜索结果检查 `Daily Paper/<报告日期>`，手动 arXiv
  输入检查 `Daily Paper/<首次发布日期>`，并按 arXiv ID 搜索整个文献库。
  metadata sync 与 OneDrive sync 相互独立。
- **zotero.org 有条目，桌面端没有：**API 写入已成功，但桌面 Zotero metadata
  sync 尚未完成。运行 Sync 并检查同步错误。
- **另一台 Mac 有条目但打不开 PDF：**在该 Mac 上把 Linked Attachment Base
  Directory 指向同一 OneDrive 文件夹的本地副本，并等待 PDF 真正下载到本机，
  而不只是 cloud-only。
- **Add 在 PDF commit 后失败：**保持已校验 PDF 不变，对同一论文重试；
  reconciliation 可以复用它。
- **Remove 后 PDF 仍存在：**这是预期行为。Remove 只删除符合条件的 Zotero
  metadata，不删除 OneDrive 文件。
- **已有条目不能 Remove/repair：**无 `paperreader-managed-v1` 的旧条目/手动条目，
  或已经移出 `Daily Paper` tree 的条目都应如此；它们只是只读 presence match。
- **CLI 未找到：**在 Terminal 登录，并在 Settings 选择实际的 `codex`、`claude`、
  `trae-cli` 或 `trae-agent` executable。
- **Codex 未认证：**在 Terminal 运行 `codex` 并完成它自己的 ChatGPT/API 登录；
  不要把该凭据粘贴到 PaperReader。`codexModel` 留空时使用隔离任务的服务/内置
  默认模型；PaperReader 不加载用户 `config.toml`。
- **无法安装 Trae：**本版本不提供公开 TraeCode installer。除非已独立获得受支持
  Trae CLI 与账号，否则使用 Codex 或 Claude。
- **缺少 `fitz`：**确认 login-shell 中 `python3 -c 'import fitz'` 成功，把隔离环境
  的 `bin` 目录加入 login-shell `PATH`，并重启 PaperReader。
- **多设备 vault 冲突：**只使用 OneDrive 或 Obsidian Sync 其中之一；先让唯一
  canonical copy 完成同步，再在其他设备重新打开。
- **Provider 配额耗尽：**降低 AI 精读 `concurrency`，或切换模型/provider。
  Codex、Claude 与 Trae 的限制取决于各自 CLI 账号；这不会改变固定为 4 的 Zotero
  写入并发。
- **macOS 阻止首次启动：**从官方 Release 重新下载，验证 `SHA256SUMS.txt`，再在
  Finder 中 Control-click/右键 PaperReader，选择**打开**。不要全局关闭
  Gatekeeper。
- **Windows 无法完成 Zotero/OneDrive 流程：**Windows 尚未受支持；不要把
  `run-windows.bat` 当作安装包或兼容性保证。参阅
  [Windows 路线图](../docs/WINDOWS_ROADMAP_ZH.md)。

## 重要文件

| 文件 | 作用 |
|---|---|
| `main.js` | window lifecycle、加固报告服务、凭据、IPC、文件/云端编排 |
| `preload.js` | 窄化的 `window.paperBridge` API |
| `renderer.js` / `shell.html` | 可信 shell、导航、任务与 Zotero 控件 |
| `report-sandbox.js` / `report-gesture.js` | 报告 content policy 与真实用户手势门禁 |
| `zotero-credentials.js` / `zotero-key-verify.js` | 安全存储与 Zotero key 验证 |
| `zotero-profile.js` | 当前 profile 与 linked directory 检测 |
| `zotero-linked-store.js` | 已校验、原子的 linked-PDF 写入 |
| `zotero-pdf-queue.js` | 固定最大并发 4、FIFO、相同 key 合并的 Zotero PDF/OneDrive 队列 |
| `onedrive-cloud-verify.js` | macOS File Provider 云端确认 |
| `zotero-save.js` | 幂等 Zotero item/attachment reconciliation |
| `job-queue.js` | AI provider 路由、可配置精读并发、取消与 watchdog |
| `spawn-codex.js` / `spawn-claude.js` / `spawn-trae.js` | 本地 provider 适配器 |
| `skill-locator.js` | 内置 skill 查找与旧路径 fallback |
| `vault-scan.js` / `cache-clean.js` | 已有笔记检测与 cache 清理 |
| `sync-site.js` | 用于打包的最小只读报告 snapshot |
