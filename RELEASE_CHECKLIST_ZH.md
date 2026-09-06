# PaperReader 稳定版发布检查清单

[English](RELEASE_CHECKLIST.md)

本清单供每次发布使用。当前安装包覆盖 macOS 12+（Apple Silicon 和 Intel）与
Windows 10/11（x64）。v0.3.1 已发布；本清单是可复用模板，不代表该版本的验收
已经全部完成。

准备下一次发布时，记录测试的 commit、安装包校验和、操作系统与检查结果。完成
发布前检查后再推送 tag，触发发布；发布后继续完成下方的公开产物检查。

## 1. 范围与版本

- [ ] 目标 tag（`vX.Y.Z`）、App 包配置、依赖锁定文件、窗口和关于页面、文档、资产
  文件名与发布说明中的版本完全一致。
- [ ] 发布说明与版本的实际发布状态一致，并列出已知限制和待完成的验证。
- [ ] 平台和架构声明与已测试安装包一致。当前安装包覆盖 macOS 12+（Apple
  Silicon 和 Intel）与 Windows 10/11（x64）；Windows arm64 和 Linux 尚无
  已发布安装包。
- [ ] 记录 Windows 实机验收结果。未验证场景与后续工作，包括签名和 Windows
  arm64，继续保留在路线图中。
- [ ] `app/run-windows.bat` 只是源码开发辅助脚本，不是发布资产；受支持的
  Windows 入口是 Setup 安装包。
- [ ] commit 中没有无关的本地构建、缓存、凭据、笔记库或用户文件。
- [ ] 网页被记录并渲染为只读；本地 Zotero 与 AI 操作仅在 App 中提供。
- [ ] 以下中英文文档配对存在、顶部互链，并对当前行为、版本、平台与发布状态表述
  一致：`README.md` / `README_ZH.md`、`app/README.md` /
  `app/README_ZH.md`、`RELEASES_NOTES.md` / `RELEASES_NOTES_ZH.md`、
  `SECURITY.md` / `SECURITY_ZH.md`、`RELEASE_CHECKLIST.md` /
  `RELEASE_CHECKLIST_ZH.md`、`CONTRIBUTING.md` / `CONTRIBUTING_ZH.md`、
  `docs/WINDOWS_ROADMAP.md` / `docs/WINDOWS_ROADMAP_ZH.md`。
- [ ] 第三方声明与所有上述文档保持一致；如仅提供英文法律/许可原文，中文入口应
  明确标注语言与权威版本，不能让读者误以为已有中文正文。

## 2. 隐私与源码审计

- [ ] 检查 `git status --short`、`git diff --stat` 与完整暂存差异。
- [ ] 运行仓库的发布与隐私审计，并扫描已跟踪文件中的密钥。逐项人工核查匹配结果。
- [ ] 确认不存在真实 Zotero 密钥或用户 ID、WebDAV 凭据、站点密码、OneDrive
  令牌、AI 服务凭据、个人主目录路径、笔记库内容、私有论文文本或生产账号标识符。
- [ ] 确认生成的 App 与站点快照不含已停用的 v0.2 网页写入代码或凭据包。
- [ ] 确认测试数据使用明显的假值，不引用任何真实外部账号。
- [ ] 提醒 v0.2 用户撤销并轮换历史 Zotero/WebDAV 凭据。

## 3. 功能检查

- [ ] 在 `app/` 中使用 `npm ci` 安装锁定依赖。
- [ ] 使用 `npm test` 运行完整 App 测试套件。
- [ ] 在干净环境中使用 `python3` 运行相关 Python 测试。
- [ ] 使用 `skills/paper-reading/requirements.txt` 声明的 PyMuPDF 支持范围验证
  `python3 -c 'import fitz'`。
- [ ] 测试 App 重启与覆盖安装后是否保留设置。
- [ ] 在全新配置中确认 AI 工具检测顺序为 OpenAI Codex CLI（`codex`）、
  Claude Code、TraeCode；明确选择的工具不会被替换；未检测到 CLI 时仍引导用户
  配置 Codex。
- [ ] 验证 Zotero PDF/OneDrive 写入阶段固定最大并发为 **4**：超过 10 篇的突发
  请求会被完整接收，最多同时运行 4 篇，其余按提交顺序排队；操作键相同的重复
  请求共用正在排队或运行的任务；任务完成或失败后继续处理下一项。该限制与
  AI 精读并发设置相互独立。
- [ ] 测试一键添加、全库重复检测，以及 Zotero 写入后期出错时的安全重试。
- [ ] 确认新建 Zotero 父条目带 `paperreader-managed-v1`；如果缺少该 tag 或不在
  `Daily Paper` 收藏夹及其子收藏夹中，修复和移除操作会被拒绝。
- [ ] 确认移除操作不删除 OneDrive PDF。
- [ ] 确认从卡片或搜索结果添加时使用报告日期，手动添加 arXiv 论文时使用首次发布日期。
- [ ] 确认 Zotero 元数据通过 Zotero Sync 出现，并能在第二台受支持设备上打开
  PDF。测试应包含一组 macOS 与 Windows 设备，各设备的链接附件基准目录分别
  指向对应的 OneDrive 文件夹。
- [ ] 通过 CLI 自身完成认证后测试 Codex。确认 PaperReader 不请求也不保存
  ChatGPT/API 凭据；`codexModel` 为空时使用隔离任务的 Codex 默认模型；只有明确
  设置时才传递模型覆盖参数。
- [ ] 确认 Codex 使用 `codex exec --json --ephemeral` 和基于 `:workspace` 的命名
  权限配置启动；读取默认拒绝，只开放必需运行时、内置技能、已验证的 Python、
  `.obsidian` 之外的笔记库内容与 App 缓存。笔记库内容与 App 缓存可写；允许
  联网，系统临时目录被拒绝并重定向到 App 缓存，任务不需要交互授权。
- [ ] 确认 Codex 任务忽略用户配置和规则，将笔记库标记为不可信以跳过项目
  `.codex` 配置；停用全局和笔记库中的 `AGENTS.md` 搜索、插件、应用连接、钩子、
  技能发现、登录 shell 与 shell 快照。沙箱命令不能访问 `$CODEX_HOME`、SSH
  材料、PaperReader 设置、笔记库的 `.obsidian` 配置和插件，或
  无关主目录文件；Codex 自身的 `codex login` 认证仍可使用；生成 shell 的环境
  变量经过过滤。
- [ ] 确认 Codex 启动前检测使用随机且不存在的 `output-schema` 路径，在本机
  解析全部安全敏感配置；只接受该路径对应的缺失文件错误，不创建文件，也不
  调用模型。未知配置字段必须导致检测失败。
- [ ] 确认笔记库校验会拒绝文件系统根目录、用户主目录及其祖先，以及范围过大的
  常见主目录一级文件夹。Codex 还会拒绝与 PaperReader 用户数据或缓存、
  `$CODEX_HOME` 或 SSH 重叠的路径，同时允许专用的嵌套笔记库。
- [ ] 确认内置技能把论文、PDF、HTML 和仓库文本视为不可信数据，并禁止读取凭据或
  无关本地文件。
- [ ] 测试 Claude Code。只有在独立获得受支持 TraeCode CLI 和账号时才测试
  TraeCode；不得声称存在公开 Trae 安装路径。
- [ ] 对 Codex、Claude 与 Trae，确认所传入的是内置 `paper-reading/SKILL.md` 的
  绝对解析路径，任务只写预期的笔记库和缓存文件。确认实际验证的 Python
  可执行文件通过 `$PAPERREADER_PYTHON` 传入，并能在 Codex 权限配置内导入 PyMuPDF。
- [ ] 确认生成的笔记、PDF、图片、代码链接、打开已有笔记操作，以及已勾选/未勾选
  的阅读状态语义。
- [ ] 确认 `$PAPERREADER_CACHE_DIR` 是绝对路径、由 App 管理并位于笔记库外；清理
  不会穿越符号链接，也不会删除其他任务文件。
- [ ] 确认在任何精读任务启动前，环境检测会拒绝把文件系统根目录或用户主目录作为笔记库。

## 4. 构建与产物审计

### macOS

- [ ] 在受支持的 macOS runner 上构建未签名的 `arm64` 与 `x64` DMG（CI 的
  `build-macos` job 或 `npm run dist:mac`）。
- [ ] 在匹配架构的干净 Mac、干净虚拟机或干净用户环境中安装每一份 DMG。
- [ ] 按 [App 使用指南](app/README_ZH.md)验证首次启动：尝试打开后，若 macOS
  拦截已校验的 App，在“系统设置 > 隐私与安全性”中选择“仍要打开”。不要全局
  关闭 Gatekeeper。
- [ ] 确认打包资源包含 `paper-reading` 技能、脚本、参考文件、依赖声明、图标
  与最小只读站点快照。
- [ ] 针对解包后的 App 与两份 DMG 运行发布产物审计。

### Windows

- [ ] 通过 CI 的 `windows-latest` job，或在 Windows x64 本机使用
  `npm run dist:win`，构建未签名的 Windows x64 NSIS 安装包。
- [ ] 使用 `Get-FileHash`（PowerShell）或 `sha256sum -c`（Git Bash）核对合并
  `SHA256SUMS.txt` 中 `PaperReader-<version>-x64-Setup.exe` 那一行与最终产物
  一致。
- [ ] 在干净的 Windows 10 与 Windows 11（x64）上测试全新安装：只对
  已校验文件执行 SmartScreen **更多信息** → **仍要运行**，按用户安装且可
  自选目录，完成首次启动、一次 Zotero 添加和一次「帮我读」。添加时检查本机
  同步状态，并人工确认文件已在云端可用。
- [ ] 测试手动升级：在旧版之上运行新的 Setup 安装包，确认
  `%APPDATA%\PaperReader` 下的设置、缓存与加密凭据仍然可用。
- [ ] 针对解包后的 Windows App 与 Setup 安装包运行发布产物审计。

### 发布资产

- [ ] 确认合并的 `SHA256SUMS.txt` 由最终且不可再修改的安装包生成，并能对三份
  安装包全部验证通过。
- [ ] 确认上传资产只包含两份架构正确的 DMG、一份 Windows x64 Setup 安装包与
  合并的 `SHA256SUMS.txt`，没有重复或过期安装包。GitHub 自动生成的源码归档
  可以单独存在。
- [ ] 确认没有 `.msi`、便携版压缩包、增量分发清单、额外的 `.yml` 元数据或
  feed 文件、ZIP 补丁资产或 `run-windows.bat` 被作为发布资产上传。

## 5. 发布与发布后检查

- [ ] 确认发布工作流创建正式 GitHub Release，且未标记为预发布版本。
- [ ] 仅在发布 commit 已审查并授权后创建和推送带注释的版本 tag；该 tag
  可按维护者政策选择 Git 签名。
- [ ] 确认 GitHub Release 标题、发布说明、平台/架构标签、未签名警告（DMG 未
  公证 / Setup 无 Authenticode 签名）、校验和指令、手动升级说明与链接均
  正确。
- [ ] 确认对应 tag、GitHub Release、三份安装包与合并的 `SHA256SUMS.txt` 均已
  公开可用，再更新文档的发布状态和下载链接。
- [ ] 重新下载全部已发布资产，并独立验证校验和。
- [ ] 测试公开 Release 页面，并分别从已发布 DMG 和 Setup 安装包完成一次干净
  安装。
- [ ] 用新 DMG（macOS）或新 Setup 安装包（Windows）替换已安装的旧版，确认 App
  设置、缓存与加密凭据仍可使用。
- [ ] 确认公开网页仍只暴露只读功能。
- [ ] 记录发现的回归问题，并通过安全渠道处理安全问题；如果审计发现真实密钥，
  立即轮换该凭据。
- [ ] 在 [Windows 路线图](docs/WINDOWS_ROADMAP_ZH.md)中更新验收依据、未解决故障
  和后续工作。测试发现限制时，相应调整兼容性声明或发布说明。
