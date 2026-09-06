# PaperReader 稳定版发布检查清单

[English](RELEASE_CHECKLIST.md)

本清单适用于 v0.3.1 及之后的稳定版。自 v0.3.1 起，一次发布同时覆盖
**macOS 12+ 与 Windows 10/11（x64）**；Linux 仍不在范围内。tag 是发布触发器，
在所有阻塞项完成前不要
推送 tag。对应 tag、Release 与资产实际存在前，本源码树中的 v0.3.1 必须视为
候选版。

## 1. 范围与版本

- [ ] 目标 tag（`vX.Y.Z`）、App package、lockfile、窗口/About UI、文档、资产
  文件名与发布说明中的版本完全一致。
- [ ] 只有在所有门禁完成、即将由 tag 触发正式发布时，发布说明才把该版本描述为
  **稳定版**，而不是 early-access 版本。
- [ ] 本次 v0.3.1 发布范围明确为 macOS 12+（Apple Silicon 与 Intel）加
  Windows 10/11（x64）；不得声称 Linux 或 Windows arm64 已受支持。
- [ ] 仍未完成的 Windows 加固事项（真实机器验收矩阵、Authenticode 签名决策、
  Windows arm64 构建）继续记录在路线图待办中，不得被描述为已交付功能。
- [ ] `app/run-windows.bat` 只是源码开发辅助脚本，不是发布资产；受支持的
  Windows 入口是 Setup 安装包。
- [ ] commit 中没有无关的本地构建、缓存、凭据、vault 或用户文件。
- [ ] 网页被记录并渲染为只读；本地 Zotero 与 AI 操作仅在 App 中提供。
- [ ] 以下中英文文档配对存在、顶部互链，并对当前行为、版本、平台与发布状态表述
  一致：`README.md` / `README_ZH.md`、`app/README.md` /
  `app/README_ZH.md`、`RELEASES_NOTES.md` / `RELEASES_NOTES_ZH.md`、
  `SECURITY.md` / `SECURITY_ZH.md`、`RELEASE_CHECKLIST.md` /
  `RELEASE_CHECKLIST_ZH.md`、`CONTRIBUTING.md` / `CONTRIBUTING_ZH.md`。
- [ ] 第三方声明与所有上述文档保持一致；如仅提供英文法律/许可原文，中文入口应
  明确标注语言与权威版本，不能让读者误以为已有中文正文。

## 2. 隐私与源码审计

- [ ] 检查 `git status --short`、`git diff --stat` 与完整 staged diff。
- [ ] 运行仓库的 release/privacy audit 和 tracked-file secret scan。在人工分类前，
  所有匹配都视为未解决。
- [ ] 确认不存在真实 Zotero key/user ID、WebDAV 凭据、站点密码、OneDrive token、
  AI provider 凭据、个人主目录路径、vault 内容、私有论文文本或生产账号标识符。
- [ ] 确认生成的 App/站点 snapshot 不含已停用的 v0.2 网页 writer 代码或凭据
  bundle。
- [ ] 确认测试 fixture 使用明显的假值，不引用任何真实外部账号。
- [ ] 提醒 v0.2 用户撤销并轮换历史 Zotero/WebDAV 凭据。

## 3. 功能门禁

- [ ] 在 `app/` 中使用 `npm ci` 安装锁定依赖。
- [ ] 使用 `npm test` 运行完整 App 测试套件。
- [ ] 在干净环境中使用 `python3` 运行相关 Python 测试。
- [ ] 使用 `skills/paper-reading/requirements.txt` 声明的 PyMuPDF 支持范围验证
  `python3 -c 'import fitz'`。
- [ ] smoke-test App 重启与原位升级后的设置持久化。
- [ ] 在全新配置中确认 provider 发现顺序为 OpenAI Codex CLI（`codex`）、
  Claude Code、TraeCode；明确选择的 provider 不会被替换；未检测到 CLI 时仍以
  Codex 作为 onboarding fallback。
- [ ] 验证 Zotero PDF/OneDrive 写入阶段固定最大并发为 **4**：超过 10 篇的突发
  请求会被完整接收，最多同时运行 4 篇，其余严格按 FIFO 排队；同一论文在 queued
  或 running 时请求会合并；任一任务失败后会释放 slot 并继续后续任务。该并发与
  可配置的 AI 精读并发不是同一个设置。
- [ ] smoke-test 一次点击 Add、全库 presence detection，以及模拟 Zotero late
  failure 后的安全重试。
- [ ] 确认新建 Zotero 父条目带 `paperreader-managed-v1`；如果缺少该 tag 或不在
  `Daily Paper` collection tree 中，repair/Remove 会 fail closed。
- [ ] 确认 Remove 不删除 OneDrive PDF。
- [ ] 确认卡片/搜索结果 Add 使用报告日期，手动 arXiv Add 使用首次发布日期。
- [ ] 确认 Zotero 元数据通过 Zotero Sync 出现，并且在配置到相同 OneDrive 链接
  基准目录的第二台 Mac 上可以打开 PDF。
- [ ] 通过 CLI 自身完成认证后 smoke-test Codex。确认 PaperReader 不请求也不保存
  ChatGPT/API 凭据；`codexModel` 为空时使用隔离任务的 Codex 默认模型；只有明确
  设置时才传递模型 override。
- [ ] 确认 Codex 使用 `codex exec --json --ephemeral` 和基于 `:workspace` 的命名
  权限配置启动；读取默认拒绝，只开放最小运行时、内置 skill、已探测 Python、
  `.obsidian` 之外的 vault 内容与 App cache；vault 内容与 App cache 是可写根，
  允许联网，系统临时目录被拒绝并重定向到 App cache，且没有交互授权。
- [ ] 确认 Codex 任务忽略用户 config/rules，把 vault 标记为 untrusted 以跳过
  项目 `.codex` 层，停用全局/vault `AGENTS.md` 发现、plugins、apps、hooks、
  skill discovery、login shells 与 shell snapshots；沙箱命令不能访问
  `$CODEX_HOME`、SSH 材料、PaperReader 设置、vault 的 `.obsidian` 配置/插件或
  无关主目录文件；Codex 自身的 `codex login` 认证仍可使用；生成 shell 的环境
  变量经过过滤。
- [ ] 确认 Codex readiness probe 使用随机且不存在的 output-schema 路径，在本机
  真实解析全部安全敏感 override；只接受精确的缺失文件错误，不创建文件，也不
  调用模型。未知配置字段必须导致 readiness 失败。
- [ ] 确认 vault 校验会拒绝文件系统根目录、用户主目录及其祖先、常见宽泛的主目录
  一级文件夹；Codex 还会拒绝与 PaperReader user data/cache、`$CODEX_HOME` 或
  SSH 重叠的路径，同时允许专用的嵌套 vault。
- [ ] 确认内置 skill 把论文/PDF/HTML/仓库文本视为不可信数据，并禁止读取凭据或
  无关本地文件。
- [ ] smoke-test Claude Code。只有在独立获得受支持 TraeCode CLI/账号时才测试
  TraeCode；不得声称存在公开 Trae 安装路径。
- [ ] 对 Codex、Claude 与 Trae，确认所传入的是内置 `paper-reading/SKILL.md` 的
  绝对解析路径，任务只写预期的 vault/cache 输出；确认精确探测到的 Python
  executable 通过 `$PAPERREADER_PYTHON` 传入，并能在 Codex 权限配置内 import
  PyMuPDF。
- [ ] 确认生成的笔记、PDF、图片、代码链接、已有笔记 action，以及已勾选/未勾选
  的阅读状态语义。
- [ ] 确认 `$PAPERREADER_CACHE_DIR` 是绝对路径、由 App 管理并位于 vault 外；清理
  不会穿越 symlink，也不会删除其他任务文件。
- [ ] 确认在任何精读任务启动前，环境探测会拒绝文件系统根目录或用户主目录 vault。

## 4. 构建与产物审计

### macOS

- [ ] 在受支持的 macOS runner 上构建未签名的 `arm64` 与 `x64` DMG（CI 的
  `build-macos` job 或 `npm run dist:mac`）。
- [ ] 在匹配架构的干净 Mac、干净 VM 或干净用户 profile 上安装每一份 DMG。
- [ ] 确认首次启动使用 Finder 的 Control-click/右键 **打开**流程，不需要全局关闭
  Gatekeeper。
- [ ] 确认打包资源包含 `paper-reading` skill、scripts、references、requirements
  声明、icons 与最小只读站点 snapshot。
- [ ] 针对 unpacked App 与两份 DMG 运行 release artifact audit。

### Windows

- [ ] 通过 CI 的 `windows-latest` job，或在 Windows x64 本机使用
  `npm run dist:win`，构建未签名的 Windows x64 NSIS 安装包。
- [ ] 使用 `Get-FileHash`（PowerShell）或 `sha256sum -c`（Git Bash）核对合并
  `SHA256SUMS.txt` 中 `PaperReader-<version>-x64-Setup.exe` 那一行与最终产物
  一致。
- [ ] 在干净的 Windows 10 与 Windows 11（x64）上做全新安装 smoke test：只对
  已校验文件执行 SmartScreen **更多信息** → **仍要运行**，按用户安装且可
  自选目录，完成首次启动、一次带云端确认的 Add to Zotero 和一次「帮我读」。
- [ ] 手动升级 smoke test：在旧版之上运行新的 Setup 安装包，确认
  `%APPDATA%\PaperReader` 下的设置、缓存与加密凭据仍然可用。
- [ ] 针对解包后的 Windows App 与 Setup 安装包运行 release artifact audit。

### 发布资产

- [ ] 确认合并的 `SHA256SUMS.txt` 由最终且不可再修改的安装包生成，并能对三份
  安装包全部验证通过。
- [ ] 确认上传资产只包含两份架构正确的 DMG、一份 Windows x64 Setup 安装包与
  合并的 `SHA256SUMS.txt`——即只上传三份安装包加 `SHA256SUMS.txt`，没有本地
  重复或过期 package。GitHub 自动生成的 source archives 可以单独存在。
- [ ] 确认没有 `.msi`、便携版压缩包、增量分发清单、额外的 `.yml` 元数据或
  feed 文件、ZIP 补丁资产或 `run-windows.bat` 被作为发布资产上传。

## 5. 发布与发布后检查

- [ ] 确认 release workflow 创建稳定 GitHub Release，且未设置 early-access flag。
- [ ] 仅在 release commit 已审查并授权后创建和推送 annotated release tag；该 tag
  可按维护者政策选择 Git 签名。
- [ ] 确认 GitHub Release 标题、发布说明、平台/架构标签、未签名警告（DMG 未
  公证 / Setup 无 Authenticode 签名）、checksum 指令、手动升级说明与链接均
  正确。
- [ ] 确认对应 tag、GitHub Release、三份安装包与合并的 `SHA256SUMS.txt` 均已
  实际存在，然后才把文档中的候选状态改为已发布稳定版。
- [ ] 重新下载全部已发布资产，并独立验证 checksum。
- [ ] 测试公开 Release 页面，并分别从已发布 DMG 和 Setup 安装包完成一次干净
  安装。
- [ ] 用新 DMG（macOS）或新 Setup 安装包（Windows）替换已安装的旧版，确认 App
  设置、cache 与加密凭据仍可使用。
- [ ] 确认公开网页仍只暴露只读功能。
- [ ] 记录发现的 regression，并通过安全渠道处理安全问题；如果审计发现真实 secret，
  立即轮换该凭据。
- [ ] 将仍未完成的 Windows 加固事项（真实机器验收矩阵、Authenticode 签名
  决策、Windows arm64）与未来的 Linux 工作继续保留在独立
  [Windows 路线图](docs/WINDOWS_ROADMAP_ZH.md)中；待办事项不改变本次 Release
  的平台支持声明。
