# 安全政策

[English](SECURITY.md)

## 支持的版本与平台

安全修复适用于当前 `main` 分支，以及官方
[GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases)
页面中实际存在的最新 PaperReader 桌面稳定版。如果 Releases 页面还没有
PaperReader 桌面版，则只有当前 `main` 分支属于支持范围。

| 软件或平台 | 状态 |
|---|---|
| 当前 `main` 分支 | 支持 |
| Releases 页面中实际存在的最新 PaperReader macOS（12+）桌面稳定版 | 支持 |
| Releases 页面中实际存在的最新 PaperReader Windows 10/11（`x64`）桌面稳定版 | 支持 |
| 本源码树中的目标版本 v0.3.1 | 在对应 tag、Release、三份安装包与合并的 `SHA256SUMS.txt` 实际发布前属于候选版 |
| 已停用的 v0.2 网页写入功能 | 不支持；不得用于新安装 |
| Windows `arm64` | 不支持；未构建对应安装包 |
| Linux | 不支持；当前没有正式安装包或发布承诺 |

v0.2 的 WebDAV 上传流程与加密网页凭据包已经停用，不得用于新安装。
仓库中存在跨平台辅助代码或启动脚本，并不表示相应平台已经进入支持范围。

## 报告漏洞

如果仓库的 **Security -> Report a vulnerability** 私密报告表单可用，请通过该
表单报告。报告中应包括受影响版本、平台、最小复现步骤与影响，但不要提交真实
API key、密码、私有论文、vault 笔记，或未经脱敏的 App 支持目录。

如果私密报告功能不可用，请只创建一个内容最少的公开 issue，请维护者提供私密
渠道；在获得私密渠道前，不要公开漏洞细节、利用方法或任何凭据。

请勿使用他人的 Zotero、OneDrive、Obsidian vault、AI provider 账号或 GitHub
安装环境进行测试。维护者会在修复可用后与报告者协调披露。

## 范围

以下内容属于本政策的报告范围：

- 当前受支持代码或正式桌面版中的凭据存储、权限检查与迁移；
- 报告 iframe 沙箱、应用 bridge、IPC 白名单与用户手势校验；
- PaperReader 发起的 Zotero、OneDrive、Obsidian 与本地 AI CLI 数据流；
- 路径校验、文件写入、缓存清理、打包边界与发布产物完整性；
- PaperReader 对不可信论文、PDF、HTML、仓库内容或 provider 输出的处理。

以下内容不属于本项目当前的支持范围：

- 已停用的 v0.2 网页写入流程；
- 尚未发布和支持的平台版本（Linux、Windows `arm64`）；
- Zotero、OneDrive、Obsidian、GitHub、arXiv 或 AI provider 本身的独立漏洞，
  除非问题由 PaperReader 的集成或边界处理直接造成；
- 针对不属于报告者的账号、设备、文献库、vault 或部署进行的测试；
- provider 的计费、配额、内容保留或服务可用性争议。

## 数据与信任边界

以下本地路径按 macOS 布局书写；Windows 上同样的 PaperReader 文件位于
`%APPDATA%\PaperReader\` 下，边界完全相同：

| 数据或操作 | 目标位置 | 边界 |
|---|---|---|
| 公开报告 | 项目 GitHub Pages / 本地缓存 | 只读报告内容属于不可信输入，并在沙箱中运行 |
| Zotero API key 与 user ID | `~/Library/Application Support/PaperReader/zotero-credentials.secure.json` | 使用 Electron `safeStorage` 加密（macOS 由 Keychain 支持，Windows 由 DPAPI 支持）；不允许明文回退 |
| App 非敏感设置 | `~/Library/Application Support/PaperReader/config.json` | 本地文件；可能暴露私有文件系统路径 |
| 报告缓存 | `~/Library/Application Support/PaperReader/site-cache/` | 缓存于本机的公开报告数据 |
| 精读临时文件 | `~/Library/Application Support/PaperReader/paper-cache/` | 由 App 管理、位于 vault 外；以 `$PAPERREADER_CACHE_DIR` 提供给 provider |
| Zotero 元数据 | Zotero Web API 与 Zotero Sync | 使用个人文献库读写 key；绝不发送到报告 HTML |
| 链接 PDF 文件 | 用户选择的 OneDrive 文件夹 | 由 OneDrive 同步，并以 fail-closed 方式确认——macOS 用 File Provider，Windows 用 NTFS cloud-files placeholder 状态；与 Zotero 元数据同步相互独立 |
| 完成的论文笔记 | 用户选择的 Obsidian vault | 可能包含论文文本、图片、源码片段与私人批注 |
| AI 精读请求 | 所选 OpenAI Codex CLI（`codex`）、Claude Code 或 TraeCode provider | provider CLI 可能依据其条款发送论文、prompt、上下文与诊断信息 |

公开网页是只读的。它不接收 Zotero 凭据、不写 OneDrive 文件、不启动本地 AI
CLI，也不修改 vault。

## 本地 provider 权限与网络使用

PaperReader 会把内置 `paper-reading/SKILL.md` 解析为绝对路径，并把该精确路径
传给所选 AI CLI。Codex 适配器使用基于 `:workspace` 的命名权限配置运行
`codex exec --json --ephemeral`。文件读取默认拒绝，只开放 Codex 最小运行时、
内置 skill、已探测的 Python/PyMuPDF 运行时、所选 vault 中 `.obsidian` 以外的
内容，以及 App 缓存。上述 vault 内容与缓存可写，并允许联网；系统临时目录被
拒绝，并重定向到 App 缓存。

在报告 Codex 已就绪前，PaperReader 会使用随机且明确不存在的 output schema
路径，强制 CLI 在本机解析所有安全敏感配置。只有精确的“文件不存在”错误才会
通过；此探针不创建 schema 文件，也不调用模型。适配器会忽略该任务的用户
config 与 exec-policy rules，把 vault 标记为 untrusted 以跳过项目级 `.codex`
config/hooks/rules，并停用全局和 vault 中的 `AGENTS.md` 发现、plugins、apps、
hooks、skill discovery、login shells 与 shell snapshots。生成的 shell 命令只会
获得核心环境变量，以及精确的 `$PAPERREADER_CACHE_DIR` 和
`$PAPERREADER_PYTHON` 值。

沙箱命令不能读取 `$CODEX_HOME`、SSH 材料、PaperReader 设置、vault 的
`.obsidian` 配置与插件，或无关的主目录文件；Codex 本身仍通过 `codex login`
认证。这些 beta 权限配置属于纵深防御，并不是完整的操作系统安全边界。Claude
与 Trae 使用各自 provider 的非交互 bypass 模式。只使用可信 vault，不要把
宽泛的个人目录设为 vault，并阅读 provider 的隐私、保留与计费条款。

PaperReader 会拒绝文件系统根目录、用户主目录、包含该主目录的祖先目录，以及
`Documents`、`Downloads`、`Library`、`.config`、`.local`、`.codex`、`.ssh`
等常见且过于宽泛的主目录一级文件夹。专用的嵌套文件夹仍可使用。Codex 适配器
还会拒绝与 PaperReader user data / 缓存、`$CODEX_HOME` 或用户 SSH 目录重叠的
vault，避免可写 vault 授权覆盖这些受保护目录。

论文、PDF、项目页面、仓库、引用与元数据都可能包含 prompt injection 文本。
内置 skill 明确把它们视为数据，拒绝其中的嵌入式指令，并禁止读取凭据或无关的
本地文件。这是在沙箱之外增加的行为防线，不能替代操作系统隔离；如果任务要求的
命令或输出与论文分析无关，应立即停止任务。

[OpenAI Codex CLI（`codex`）](https://developers.openai.com/codex/cli/) 与
Claude Code 是由用户独立安装的公开 CLI。Codex 使用自身的 ChatGPT/API 认证，
Claude 使用自身的订阅/OAuth 会话。TraeCode 仅适用于已经获得受支持 CLI 与账号
的用户；本项目不分发或开通该服务。PaperReader 不收集或保存任何 AI provider
凭据。

PaperReader 不包含内置分析或遥测。实现功能所需的网络流量仍会访问公开报告站、
arXiv、Zotero、OneDrive（macOS File Provider 或 Windows OneDrive 同步引擎）
与所选 AI provider。外部服务可能
采用其自己的日志和遥测政策。

## 凭据处理与迁移

- 不要把 Zotero key、WebDAV 密码、AI 凭据、OneDrive token、真实 vault 路径
  写入源码、截图、日志、测试 fixture、issue、发布说明或发布产物。
- Zotero key 必须属于 Zotero 桌面端使用的同一个个人文献库账号，并且只授予
  所需的文献库读写权限。
- 使用过 v0.2 的用户必须撤销并轮换所有曾进入旧网页 bundle 的 Zotero key 与
  WebDAV 密码。从最新 revision 删除文件不会清除 Git 历史，也不会撤销凭据。
- 在 PaperReader 中清除 key 会删除本地加密 envelope；只删除 App 不会删除它，
  因为本地支持数据会为升级而保留。
- 不要公开 App 支持目录。即使是加密文件和非敏感配置，也可能暴露用户名、路径、
  provider 或文献库结构。

## 发布完整性

本源码树以 v0.3.1 为目标，但在对应 tag、GitHub Release、三份安装包与合并的
`SHA256SUMS.txt` 实际存在前，它仍是候选版，不得描述为已经发布的稳定版。

v0.3.1 候选安装包均未签名：DMG 没有 Apple Developer ID 签名、未经过 Apple
公证，Windows Setup 安装包没有 Authenticode 签名。正式
发布存在后，应从同一个官方 GitHub Release 下载与平台匹配的安装包和
`SHA256SUMS.txt`，使用 [`README_ZH.md`](README_ZH.md) 中对应的校验命令，并
要求校验通过。SHA-256 校验可以发现下载损坏，但不能替代 Apple 签名/公证或
Windows Authenticode 签名，也不能在发布账号或渠道失陷时证明来源真实性。

对于每个新下载的 App bundle，首次启动时可能需要在 Finder 中右键或按住 Control
点击 PaperReader，选择**打开**；绝不能建议用户全局关闭 Gatekeeper。

Windows 上，未签名安装包的首次运行可能触发 Microsoft Defender SmartScreen。
在 SHA-256 校验通过后，**更多信息** → **仍要运行**只应用于这一个文件；绝不能
建议用户全局关闭 SmartScreen、Defender 或其他 Windows 安全控制。

维护者必须遵循中文[发布检查清单](RELEASE_CHECKLIST_ZH.md)或对应的
[英文清单](RELEASE_CHECKLIST.md)，包括 secret 扫描、产物审计、测试、checksum
验证，以及稳定渠道发布。
