# PaperReader v0.3.1 中文指南

[English](README.md) · [Windows 路线图](../docs/WINDOWS_ROADMAP_ZH.md) · [安全政策](../SECURITY_ZH.md)

PaperReader 是 Robotics Daily Papers 的桌面应用，可浏览论文日报、将论文保存到 Zotero，并通过本机 AI 命令行工具生成 Obsidian 精读笔记。公开网站提供只读报告；保存到 Zotero 和生成笔记的操作在桌面应用中完成。

v0.3.1 已在 [GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1) 发布：

| 平台 | 安装包 |
|---|---|
| macOS 12 及以上，Apple Silicon（M1 及更新） | `PaperReader-0.3.1-arm64.dmg` |
| macOS 12 及以上，Intel | `PaperReader-0.3.1-x64.dmg` |
| Windows 10 与 Windows 11，`x64` | `PaperReader-0.3.1-x64-Setup.exe` |

发布页还提供 `SHA256SUMS.txt` 校验清单。暂不提供 Windows `arm64` 或 Linux 安装包。

## 下载与安装

从上方发布页下载适合设备的安装包和 `SHA256SUMS.txt`。两份 macOS 安装包未签名、未经过 Apple 公证；Windows 安装包没有 Authenticode 签名。SHA-256 校验可发现下载损坏或文件不匹配，但不能替代代码签名，也不能在发布渠道失陷时证明文件来源。

### macOS

在终端中进入下载目录，按 Mac 架构运行对应命令：

```bash
cd ~/Downloads
# Apple Silicon
grep 'PaperReader-0.3.1-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
# Intel
grep 'PaperReader-0.3.1-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

校验显示 `OK` 后，打开 DMG，把 PaperReader 拖入“应用程序”。如果 macOS 因开发者身份未验证或应用未公证而阻止首次启动，请按[排错](#排错)中的步骤为 PaperReader 单独授权。

### Windows

在 PowerShell 中进入下载目录，计算安装包哈希：

```powershell
Set-Location "$env:USERPROFILE\Downloads"
Get-FileHash .\PaperReader-0.3.1-x64-Setup.exe -Algorithm SHA256
```

将输出与 `SHA256SUMS.txt` 中对应文件的哈希比较。一致后运行 Setup 安装包，选择安装目录。安装仅针对当前用户。如果 Microsoft Defender SmartScreen 提示风险，且你信任已下载的文件，可选择**更多信息 → 仍要运行**。受组织管理的设备可能不提供这些选项。

### 升级与卸载

PaperReader 不会下载或安装新的应用版本。升级时先退出应用，下载并校验新版安装包；macOS 在“应用程序”中替换旧副本，Windows 运行新版 Setup 安装包即可。

设置、报告缓存和加密 Zotero 凭据保存在 macOS `~/Library/Application Support/PaperReader/` 或 Windows `%APPDATA%\PaperReader\`。替换应用后会继续使用这些文件。Windows 卸载也会保留该目录；只有需要清空本机数据时才另行删除。Obsidian 笔记库和 OneDrive PDF 仍保留在你选择的位置。

## 运行要求

浏览日报只需安装 PaperReader。使用 **Add to Zotero** 时，需要安装 Zotero 桌面端和 OneDrive，登录两者并保持运行。Windows 还需保持 OneDrive“文件随选”（Files On-Demand）开启。

使用**帮我读**前，需要准备：

- 一个包含 `.obsidian/` 的专用 Obsidian 笔记库。请使用专门存放论文笔记的文件夹，不要选择用户主目录或整个 `Documents`、`Downloads` 目录。笔记库不能与 PaperReader 设置或缓存重叠；使用 Codex 时，还不能与 `$CODEX_HOME` 或 SSH 目录重叠。
- 至少一个已安装并登录的 AI 命令行工具：[OpenAI Codex CLI（`codex`）](https://developers.openai.com/codex/cli/)、[Claude Code（`claude`）](https://docs.anthropic.com/en/docs/claude-code/getting-started)，或已独立获得的 TraeCode CLI（`trae-cli` / `trae-agent`）。PaperReader 不分发 TraeCode CLI，也不提供账号。
- 安装了 PyMuPDF（`fitz`）的 Python 3，用于提取 PDF 内容。

应用使用所选命令行工具已有的登录状态，不收集或保存 AI 服务凭据。可用模型、用量限制和费用取决于相应账号。

### macOS 配置 Python

创建独立环境：

```bash
python3 -m venv "$HOME/.paperreader-python"
"$HOME/.paperreader-python/bin/python3" -m pip install 'PyMuPDF>=1.24,<2'
"$HOME/.paperreader-python/bin/python3" -c 'import fitz; print(fitz.VersionBind)'
```

在 PaperReader 设置的 **Python 3 解释器**中选择这个环境的 `python3`。也可以把 `$HOME/.paperreader-python/bin` 加入登录 shell 的 `PATH`，重启 PaperReader 后使用自动探测。

### Windows 配置 Python

从 [python.org](https://www.python.org/downloads/) 安装 Python 3 及其 `py` 启动器，然后在 PowerShell 中运行：

```powershell
py -3 -m venv "$env:USERPROFILE\.paperreader-python"
& "$env:USERPROFILE\.paperreader-python\Scripts\python.exe" -m pip install "PyMuPDF>=1.24,<2"
& "$env:USERPROFILE\.paperreader-python\Scripts\python.exe" -c "import fitz; print(fitz.VersionBind)"
```

在 PaperReader 设置的 **Python 3 解释器**中选择该 `python.exe`。留空时，应用依次尝试 `py -3`、`python` 和 `python3`，排除 Microsoft Store 的启动占位程序，并确认所选解释器能够导入 PyMuPDF。

## 首次配置

PaperReader 当前使用中文界面，以下步骤采用界面中的实际标签。

### Zotero 与 OneDrive

1. 在 Zotero 桌面端登录准备供 PaperReader 使用的个人文献库账号，开启 Zotero 同步，并先手动成功同步一次。
2. 启动 OneDrive，等待登录和同步就绪。
3. 在 Zotero 的**设置 → 高级 → 文件和文件夹**中，把**链接附件基准目录**（Linked Attachment Base Directory）设为 OneDrive 中的专用文件夹，例如 `OneDrive/Zotero-Attachments`。
4. 打开 [Zotero 密钥创建页](https://www.zotero.org/settings/keys/new)，创建一个 24 字符的私有 API key，开启个人文献库读取和写入权限。
5. 打开 PaperReader 设置，在 **Zotero API Key** 中粘贴密钥，点击**验证并安全保存**或**保存全部设置**。应用会从密钥取得用户 ID，无需另行填写。
6. 检查 **Zotero 链接附件基准目录**。如果没有自动填入，请选择与 Zotero 中配置相同的 OneDrive 文件夹。

附件目录必须位于当前 OneDrive 账号的本地同步范围内，并与 Zotero 当前配置一致。PaperReader 会在写入前解析链接或别名，检查实际路径。移动文件夹或切换 Zotero 配置后，请重新确认路径。

Zotero 凭据通过系统安全存储能力加密：macOS 使用 Keychain，Windows 使用 DPAPI。系统加密不可用时，应用会拒绝保存密钥。设置页不会再次显示已保存的密钥；输入框留空会保留原值。

如果使用过已停用的 v0.2 网页集成，请先撤销曾在其中保存的 Zotero key 或 WebDAV 密码，再配置新的凭据。

### Obsidian 与 AI 精读

1. 在 **Obsidian 笔记库路径**中选择存放论文笔记的笔记库。
2. 在**本地 AI CLI**中选择 **Codex**、**Claude** 或 **Trae**。应用会检测已安装的工具；检测失败时可手动选择可执行文件。
3. 在所选工具自己的终端界面完成登录。
4. 按前文选择 Python 解释器，点击**重新检测**。
5. 所需检查通过后，点击**保存全部设置**。

首次配置时，应用优先检测 Codex，其次为 Claude、Trae；不会覆盖你已经选定的服务。`paper-reading` 技能随应用内置，无需另行放入笔记库。

跨设备同步笔记时，可把笔记库放在 OneDrive 中，也可将其放在 OneDrive 外并使用 Obsidian Sync。同一笔记库只使用一种同步方式。Zotero 的 PDF 附件目录应位于笔记库之外，在另一台设备编辑同一笔记前先等待同步完成。

## 保存论文到 Zotero

在论文卡片或搜索结果中点击 **Add to Zotero**，也可以手动输入 arXiv 链接。PaperReader 会下载并校验 PDF、检查本机 OneDrive 文件状态，然后创建 Zotero 条目和链接附件。Zotero 同步文献记录，OneDrive 同步 PDF 文件。请等待 PaperReader 显示最终成功，再同步 Zotero 桌面端查看新条目。

Windows 当前只检查本机文件的重解析点属性，不能据此证明 PDF 已完成上传、云端没有冲突或可在另一台设备使用。跨设备访问前，请在 OneDrive 中确认同步完成；后续实机验证见 [Windows 路线图](../docs/WINDOWS_ROADMAP_ZH.md)。

Zotero 的 PDF 下载与 OneDrive 文件状态检查队列固定最多并发 **4** 篇。更多论文按提交顺序排队（先进先出），一次提交超过 10 篇也会进入队列。同一论文操作在排队或执行期间重复提交时会合并。该队列与 AI 精读并发独立。

日报卡片和搜索结果保存到 `Daily Paper/<报告日期>`；手动输入的 arXiv 链接保存到 `Daily Paper/<arXiv 首次发布日期>`，该日期可能与点击保存的日期不同。

如果 PDF 已写入 OneDrive 文件夹，但后续保存失败，请保留文件并重试同一论文。PaperReader 可复用已校验的 PDF，并检查已有 Zotero 条目。在 OneDrive 中看到 PDF 并不代表整个保存流程已经成功。

PaperReader 会检查个人文献库中已有的 arXiv 论文。找到已有条目时，不同视图会显示 **In Zotero**、**已在库中**或**已在 Zotero**，不会重复创建。只有带 `paperreader-managed-v1` 标签且仍属于 `Daily Paper` 分类树的条目，才能由 PaperReader 修复或移除。没有该标签的旧条目或手动创建的条目，即使位于该分类树中，也只会被识别为已存在。

移除符合条件的条目会删除 Zotero 文献记录和链接附件记录，保留 OneDrive 中的 PDF。

## 精读论文与打开笔记

点击论文卡片上的**帮我读**启动 AI 精读，应用会显示任务进度。结果保存在 `<笔记库>/<日期>/<标题>/`，通常包括 Markdown 笔记、原始 PDF 和提取的图片。论文提供开源实现时，任务还会下载相关源码。

如果已有匹配的笔记，卡片显示**笔记**并直接打开。在 Obsidian 中勾选笔记末尾的 `- [ ] ✅ 已读`，使其变成 `- [x]` 后，卡片才会显示 **✓ 已读**。仅生成或打开笔记不会改变阅读状态。

提取过程中的临时文件存放在笔记库之外的 PaperReader `paper-cache/` 目录中，任务结束后清理。生成的笔记、PDF、图片和下载的源码保留在笔记库中，并随笔记库同步。

## 设置说明

AI 精读并发默认 `10`，可设为 1-16，与固定的 Zotero PDF 队列独立。账号触发用量限制，或任务经常等待服务容量时，可以降低精读并发。

| 设置 | 默认值 | 含义 |
|---|---|---|
| `provider` | Codex；首次配置时检测已安装工具 | 精读所用 AI 服务 |
| `vaultPath` | 尽可能自动检测 | Obsidian 笔记保存位置 |
| `zoteroLinkedAttachmentRoot` | 尽可能自动检测 | Zotero 中配置的 OneDrive 附件目录 |
| `codexPath`、`claudePath`、`traePath` | 自动检测 | 可手动指定的命令行工具路径 |
| `pythonPath` | 自动检测 | 已安装 PyMuPDF 的 Python 解释器 |
| `codexModel` | 空 | 使用隔离任务的默认模型；填写模型名称可明确指定 |
| `codexReasoningEffort` | 空 | 使用隔离任务的默认推理强度 |
| `model` | `sonnet` | Claude 模型别名 |
| `maxBudgetUsd` | `0` | Claude 单次精读预算，单位为美元；`0` 表示不限 |
| `traeModel` | `gpt-5.4` | Trae 模型，可在设置中刷新可用列表 |
| `traeBackendVariant` | `max` | Trae 上下文档位 |
| `traeReasoningEffort` | `ultra` | Trae 推理强度 |
| `concurrency` | `10` | 同时运行的 AI 精读数，范围 1-16 |
| `liveBase` | 项目 GitHub Pages 地址 | 日报数据源；留空时使用离线内容 |

切换 AI 服务时，各服务的设置都会保留。Codex 任务不加载个人 `config.toml`；需要指定模型或推理强度时，请在 PaperReader 中设置。

## 隐私与权限

AI 精读会通过所选命令行工具，把论文内容、提示和生成的上下文发送给相应 AI 服务。诊断数据和账号用量也受该服务自身条款约束。PaperReader 不收集 AI 登录凭据，不内置分析或遥测。获取日报和保存文献时会连接报告网站、arXiv、Zotero 和 OneDrive。

Codex 任务可读取必要运行时、内置技能、Python 环境、所选笔记库中除 `.obsidian` 外的内容，以及应用精读缓存；可写入允许的笔记库内容和缓存，并可联网。任务命令不能读取 `$CODEX_HOME`、SSH 文件、PaperReader 设置或无关的用户目录文件；`.obsidian` 设置和插件既不可读也不可写。Codex 自身仍使用已有的命令行登录状态。这套权限配置仍处于 beta 阶段，是额外保护措施，不构成完整的操作系统安全边界。

Claude 和 Trae 使用各自跳过权限询问的非交互模式，不具备与 Codex 相同的文件访问限制。请使用专用笔记库，并只在可信的命令行账号下运行任务。

日报页面不能访问 Zotero 凭据或直接写入本机文件。论文、PDF、网页和关联仓库仍是不可信输入；如果精读任务执行的命令或输出与论文分析无关，请停止任务。实现细节和漏洞报告方式见[安全政策](../SECURITY_ZH.md)。

## 排错

- **API key 被拒绝：**使用具有个人文献库读写权限的 24 字符密钥。只有群组权限或只读权限都不够；确认 Zotero 桌面端登录的是同一账号。
- **附件目录不匹配：**检查当前 Zotero 配置，在 PaperReader 中选择相同的 OneDrive 文件夹。快捷方式或符号链接不能绕过检查。
- **OneDrive 文件状态检查失败：**检查 OneDrive 是否运行、已登录并同步所选目录。Windows 上保持“文件随选”开启，恢复同步后重试。
- **OneDrive 有 PDF，但 Zotero 没有条目：**先等待应用的最终结果。成功后同步 Zotero 桌面端，并按 arXiv ID 搜索。卡片和搜索结果位于 `Daily Paper/<报告日期>`，手动输入的 arXiv 链接位于 `Daily Paper/<首次发布日期>`。
- **zotero.org 有条目，桌面端没有：**运行 Zotero 同步，检查是否有同步错误。
- **另一台设备打不开链接 PDF：**把该设备的 Zotero 链接附件基准目录设为同一 OneDrive 文件夹的本地副本，并等待 PDF 下载完成。
- **保存失败后留下 PDF：**保留文件并重试同一论文。移除 Zotero 条目也会保留 OneDrive PDF。
- **已有条目不能修复或移除：**检查它是否带 `paperreader-managed-v1` 标签且仍在 `Daily Paper` 中。其他条目在 PaperReader 中只读。
- **找不到命令行工具或尚未登录：**在终端安装并登录所选工具，再在设置中选择其可执行文件。Trae 需要另行获得工具和账号。
- **缺少 `fitz`：**按前文配置 Python，并选择该环境的解释器，再点击**重新检测**。
- **多设备笔记冲突：**同一笔记库只使用一种同步服务，等待最新副本同步完成后再在其他设备打开。
- **AI 配额耗尽：**降低 **AI 精读并发数**、更换模型或切换已配置的服务。这不会改变 Zotero 固定为 4 的 PDF 队列。
- **macOS 提示开发者身份未验证或应用未公证：**确认信任官方安装包并尝试打开后，进入**系统设置 → 隐私与安全性 → 仍要打开 → 打开**。较旧的 macOS 在**系统偏好设置 → 安全性与隐私**中操作，详见 [Apple 官方说明](https://support.apple.com/zh-cn/102445)。这些步骤不适用于文件损坏或恶意软件警告；不要全局关闭 Gatekeeper。
- **Windows 出现 SmartScreen 提示：**校验安装包，确认信任该文件后，可使用**更多信息 → 仍要运行**。受组织管理的设备可能不允许此操作。不要全局关闭 SmartScreen 或 Defender。

反馈问题前，请检查日志和截图中的隐私信息。应用数据目录中包括 `config.json`、加密的 `zotero-credentials.secure.json`、`site-cache/` 报告缓存和 `paper-cache/` 临时文件；不要直接将整个目录或笔记库附在公开 issue 中。

## 开发

macOS 和 Windows 均可从源码运行：

```bash
cd app
npm ci
npm test
npm start
```

应用使用 Electron 43 和 electron-builder 26，版本由 `package-lock.json` 锁定。`prestart` 会刷新内置报告快照。`run-windows.bat` 是源码开发辅助脚本，不是产品安装包；日常使用请安装 Windows Setup 安装包。

在 macOS 上用 `npm run dist:mac` 构建 Mac 安装包，在 Windows x64 上用 `npm run dist:win` 构建 Windows 安装包。`Build PaperReader` 工作流负责测试、构建、产物检查和校验清单生成；`v*` 标签还会将三份安装包与合并的 `SHA256SUMS.txt` 发布到 GitHub Releases。维护者操作见[发布检查清单](../RELEASE_CHECKLIST_ZH.md)，Windows 实现和后续工作见 [Windows 路线图](../docs/WINDOWS_ROADMAP_ZH.md)。

| 文件 | 作用 |
|---|---|
| `main.js`、`preload.js` | 应用生命周期、本机操作和报告通信接口 |
| `renderer.js`、`shell.html` | 导航、精读任务和 Zotero 控件 |
| `report-sandbox.js`、`report-gesture.js` | 报告隔离与用户操作校验 |
| `zotero-credentials.js`、`zotero-key-verify.js` | 凭据加密和密钥验证 |
| `zotero-profile.js` | Zotero 配置与附件目录检测 |
| `zotero-linked-store.js`、`onedrive-cloud-verify.js` | PDF 校验、本地保存和 OneDrive 文件状态检查 |
| `zotero-pdf-queue.js`、`zotero-save.js` | PDF 队列与 Zotero 条目处理 |
| `job-queue.js`、`spawn-codex.js`、`spawn-claude.js`、`spawn-trae.js` | AI 任务调度与命令行适配 |
| `skill-locator.js`、`vault-scan.js`、`cache-clean.js` | 内置技能、笔记检测和临时文件清理 |
| `sync-site.js` | 内置报告快照 |
