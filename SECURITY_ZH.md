# 安全说明

[English](SECURITY.md)

## 支持的版本与平台

安全修复适用于当前 `main` 分支，以及官方 [GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases) 页面上的最新 PaperReader 桌面版，目前为 v0.3.1。

| 软件或平台 | 状态 |
|---|---|
| 当前 `main` 分支 | 支持 |
| PaperReader v0.3.1，macOS 12+（`arm64`、`x64`） | 已发布，支持 |
| PaperReader v0.3.1，Windows 10/11（`x64`） | 已发布，支持 |
| 更早的桌面版本 | 请升级到最新版本以获取修复 |
| 已停用的 v0.2 网页写入功能 | 不支持，请勿继续使用 |
| Windows `arm64` 与 Linux | 不支持，暂无正式安装包 |

v0.2 的 WebDAV 上传流程与加密网页凭据包已停用。使用过该版本的用户请阅读[凭据处理与迁移](#凭据处理与迁移)。

## 报告漏洞

如果仓库的 **Security > Report a vulnerability** 私密报告表单可用，请通过该表单报告。请提供受影响版本、平台、最小复现步骤和影响，不要包含真实 API key、密码、私有论文、笔记或未经脱敏的 App 数据文件。

如果私密报告功能不可用，请创建一个简短的公开 issue，请维护者提供私密渠道。不要在 issue 中公开利用方法或凭据。维护者会确认可复现的报告，并在修复可用后与报告者协调披露。

仅测试自己拥有或已获授权的账号、设备、文献库、笔记库和部署环境。

## 范围

本政策涵盖：

- 受支持代码和桌面版本中的凭据存储、权限检查与迁移。
- 报告 iframe 沙箱、App 与网页的通信、IPC 白名单和用户操作校验。
- PaperReader 发起的 Zotero、OneDrive、Obsidian 与本地 AI 命令行工具的数据流。
- 路径校验、文件写入、缓存清理、安装包内容和发布文件完整性。
- 对不可信论文、PDF、HTML、仓库内容和 AI 输出的处理。

本政策不涵盖已停用的 v0.2 网页写入功能、不支持的平台，以及完全发生在外部服务中的漏洞，但由 PaperReader 集成方式导致的问题除外。AI 服务的计费、配额、内容保留政策和可用性也不属于本项目的处理范围。

## 数据与信任边界

下表使用 macOS 路径。Windows 上对应的 PaperReader 文件位于 `%APPDATA%\PaperReader\`。

| 数据或操作 | 目标位置 | 处理方式 |
|---|---|---|
| 公开报告 | 项目 GitHub Pages 与本地缓存 | 作为不可信内容，在沙箱 iframe 中显示 |
| Zotero API key 与用户 ID | `~/Library/Application Support/PaperReader/zotero-credentials.secure.json` | 使用 Electron `safeStorage` 加密，macOS 由 Keychain 支持，Windows 由 DPAPI 支持；不以明文替代 |
| App 设置 | `~/Library/Application Support/PaperReader/config.json` | 保存在本机，可能包含私人文件路径 |
| 报告缓存 | `~/Library/Application Support/PaperReader/site-cache/` | 缓存在本机的公开报告数据 |
| 精读临时文件 | `~/Library/Application Support/PaperReader/paper-cache/` | 位于笔记库之外，通过 `$PAPERREADER_CACHE_DIR` 提供给 AI 命令行工具 |
| Zotero 元数据 | Zotero Web API 与 Zotero Sync | 需要个人文献库读写权限，凭据不传给报告 HTML |
| 链接 PDF | 用户选择的 OneDrive 文件夹 | 由 OneDrive 同步，与 Zotero 元数据同步相互独立 |
| 完成的笔记 | 用户选择的 Obsidian 笔记库 | 可能包含论文文本、图片、代码片段和私人批注 |
| AI 精读请求 | 所选 Codex、Claude Code 或 Trae 命令行工具 | 可能按照服务条款向服务商发送论文、提示词、上下文和诊断信息 |

公开网页只读，不接收 Zotero 凭据，不写 OneDrive 文件，不启动本地 AI 命令行工具，也不修改笔记库。

写入 Zotero 元数据前，PaperReader 会检查本机 OneDrive 状态。macOS 检查 File Provider 提供的上传和冲突状态；Windows 目前只检查文件的重解析点属性，不能据此证明上传已完成或云端副本无冲突。平台检查未通过时会停止存入。两个平台都不会下载或比对云端 PDF 副本，在另一台设备使用 PDF 前仍需确认 OneDrive 已完成同步。

## 本地 AI 权限与网络使用

PaperReader 将内置的 `paper-reading/SKILL.md` 传给所选 AI 命令行工具。精读任务可以在选定的笔记库中写入笔记和附件，并使用 App 的精读缓存。任务允许联网，AI 服务商可能接收到这些位置中的内容。请使用专门的笔记库，并了解相应服务的隐私、内容保留和计费条款。

Codex 适配器使用基于 `:workspace` 的命名权限配置，允许读取必要的运行时、内置 skill、选定的 Python/PyMuPDF 运行时、笔记库中 `.obsidian` 以外的内容以及 App 缓存。笔记库内容和缓存可写。该配置拒绝访问 `$CODEX_HOME` 中的 Codex 配置与凭据、SSH 文件、PaperReader 设置、`.obsidian` 和无关的主目录文件，临时文件则写入 App 缓存。Codex 本身仍通过 `codex login` 认证。

报告 Codex 已就绪前，适配器会检查已安装的 CLI 能否解析这些权限设置；这项本机检查不调用模型。精读任务跳过用户和项目配置、执行规则以及 `AGENTS.md` 发现，同时关闭插件、应用集成、钩子、skill 发现、登录 shell 和 shell 快照，并使用受限的 shell 环境。这些 beta 权限配置提供额外保护，但并不构成完整的操作系统安全边界。

Claude 和 Trae 使用各自跳过权限询问的非交互模式。它们不使用 Codex 的权限配置，因此不能假定两者具有相同的文件访问限制。

PaperReader 不接受文件系统根目录、用户主目录、其上级目录，以及 `Documents`、`Downloads`、`Library`、`.config`、`.local`、`.codex` 和 `.ssh` 等范围过大的主目录文件夹作为笔记库，可以选择其中专用的子文件夹。使用 Codex 时，笔记库还必须与 PaperReader 数据和缓存、`$CODEX_HOME` 以及用户 SSH 目录分离。

论文、PDF、项目页面、仓库、引用和元数据可能包含提示词注入。内置 skill 要求 AI 将这些内容视为数据，忽略其中的指令，不读取凭据或无关的本地文件。这些要求不能保证 AI 一定遵守，也不能保证阻止所有注入。如果任务的命令或输出与论文分析无关，请停止任务。

AI 命令行工具需要单独安装和登录。Codex 使用自己的 ChatGPT/API 认证，Claude 使用自己的订阅/OAuth 会话。Trae 需要用户自行取得受支持的 CLI 和账号。PaperReader 不收集或保存 AI 服务凭据。

PaperReader 没有内置的统计分析或遥测功能。实现各项功能仍会访问公开报告站、arXiv、Zotero、OneDrive 和所选 AI 服务。这些外部服务可能采用各自的日志和遥测政策。

## 凭据处理与迁移

- 不要将 Zotero key、WebDAV 密码、AI 凭据或 OneDrive token 放入源码、截图、日志、测试数据、issue 或发布文件。分享诊断信息前请隐去私人路径。
- Zotero key 应属于 Zotero 桌面端使用的同一个个人文献库账号，并只授予所需的文献库读写权限。
- 使用过 v0.2 的用户请撤销并重新创建所有曾存入旧网页凭据包的 Zotero key 和 WebDAV 密码。从当前版本删除文件不会清除 Git 历史，也不会撤销凭据。
- 在 PaperReader 中清除 key 会删除本地加密凭据文件。仅移除 App 会保留用户数据，便于后续安装或升级。
- 不要公开 App 数据目录。即使是加密文件和设置，也可能暴露用户名、路径、所选 AI 服务或文献库结构。

## 发布完整性

[v0.3.1 Release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1) 提供两份 macOS DMG、一份 Windows 安装包和 `SHA256SUMS.txt`。所有安装包均未签名：macOS 版本没有 Developer ID 签名，也未经过 Apple 公证；Windows 安装包没有 Authenticode 签名。

请从同一个官方 Release 下载安装包与校验清单，并按照[安装指南](app/README_ZH.md)完成校验。SHA-256 一致可以确认下载文件未损坏，但不能替代签名，也不能在发布账号或下载渠道失陷时证明来源可信。

macOS 或 Windows 可能阻止未签名应用。首次启动步骤取决于系统版本和安全策略，请参考安装指南，只对确认可信的下载文件设置例外。请保持 Gatekeeper、SmartScreen、Defender 及其他系统防护开启。

面向维护者的测试、凭据扫描、安装包审计和校验值检查见[发布检查清单](RELEASE_CHECKLIST_ZH.md)。
