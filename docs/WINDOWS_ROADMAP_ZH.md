# PaperReader Windows 路线图

[English](WINDOWS_ROADMAP.md)

PaperReader v0.3.1 首次提供 Windows 安装包。本文记录 Windows 已有实现、可查证的
验证依据，以及尚需完成的验收工作。

## 1. 已发布版本

[v0.3.1 Release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1)
包含面向 Windows 10/11（x64）的 `PaperReader-0.3.1-x64-Setup.exe`、两份 macOS
DMG 和一份合并的 `SHA256SUMS.txt`。

Windows 版本使用未签名的 NSIS 安装包，按用户安装，允许选择安装目录。升级时退出
App，再运行新版 Setup 安装包。安装器配置为卸载时保留 App 数据；升级和重装行为
仍需完成下方的验收检查。安装步骤见 [App 使用指南](../app/README_ZH.md)。

Windows arm64 和 Linux 暂无安装包。Authenticode 签名与新增架构列为后续工作。
安装前应校验文件，不要全局关闭 Windows 安全控制。`app/run-windows.bat` 是源码
开发辅助脚本，不是供用户下载的发布安装包。

## 2. v0.3.1 已实现内容

### Zotero 与 OneDrive

- [Zotero 配置检测](../app/zotero-profile.js)读取 Windows 的
  `%APPDATA%\Zotero\Zotero` 目录和已设置的链接附件基准目录。
- [OneDrive 根目录校验](../app/onedrive-root.js)包含 Windows 路径处理；App 会
  比较所选附件目录与 Zotero 中的设置。
- [同步状态检查](../app/onedrive-cloud-verify.js)通过 PowerShell 读取 Windows
  文件属性，包含轮询、取消和超时处理。当前 Windows 条件检查文件的重解析点
  属性，不会下载远端文件或直接验证其内容；不同 OneDrive 真实同步状态下的
  可靠性仍需实机验收。
- 共用的 PDF 保存流程会校验并暂存文件、等待平台状态检查、验证哈希，再创建或
  核对 Zotero 元数据。最多同时运行 4 个任务的保存队列及托管条目保护同样用于
  Windows。

### 精读与本地数据

- [环境检测](../app/env-probe.js)包含 Windows Python 查找，并向精读任务传入
  已验证的解释器路径。
- [Codex](../app/spawn-codex.js)、[Claude](../app/spawn-claude.js) 与
  [Trae](../app/spawn-trae.js) 适配器包含 Windows 可执行文件查找和进程处理。
  每个工具仍需使用可用的 CLI 和账号单独完成 Windows 端到端验证。
- 内置的[论文精读技能](../skills/paper-reading/SKILL.md)使用跨平台 Python 工具
  处理本地文件。日报浏览、搜索、缓存与 Obsidian 笔记状态由共用 App 模块处理。
- 设置保存在 Electron 对应平台的数据目录中。Zotero 凭据使用 Electron
  `safeStorage` 加密，不提供明文存储的备用方案。

### 打包与 CI

- [打包配置](../app/package.json)包含 Windows x64 NSIS 目标和
  `npm run dist:win` 命令。
- [Build PaperReader](../.github/workflows/build-app.yml) 包含原生
  `windows-latest` 任务，依次安装锁定依赖、审计依赖、运行 Node 和 Python
  测试、构建安装包、审计打包资源并生成校验和。
- [发布审计](../app/release-audit.js)处理两个平台的目录结构，扫描 Windows 和
  macOS 个人路径，并检查打包资源。
- 发布任务依赖两个平台构建成功；下载产物后，先验证安装包和三份安装包的合并
  校验清单，再创建 GitHub Release。

## 3. 验证依据与范围

v0.3.1 的发布资产和构建工作流提供了打包与上述自动化检查的依据。测试覆盖 Windows
配置路径、OneDrive 根目录和属性响应、解释器检测、进程适配器及发布审计。相关
测试包括：

- [Zotero 配置](../test/zotero-profile.test.js)、
  [OneDrive 根目录](../test/onedrive-root.test.js)和
  [OneDrive 状态检查](../test/onedrive-cloud-verify.test.js)；
- [环境检测](../test/env-probe.test.js)及
  [Codex](../test/spawn-codex.test.js)、[Claude](../test/spawn-claude.test.js)、
  [Trae](../test/spawn-trae.test.js) 进程适配器；
- [发布审计](../test/release-audit.test.js)。

其中包含测试数据和模拟响应。这些测试不能证明真实 OneDrive 账号已上传文件，
也不能证明所有 Windows 配置下的 AI 精读、Windows 10/11 安装与升级都已通过。

仓库目前没有一份已完成的实机验收记录覆盖下方矩阵。每一项都需记录 commit、安装包
校验和、Windows 版本、依赖版本与测试日期后，才能标记完成。安装包已发布并不代表
这些检查已通过。

## 4. 待完成验收

在干净的 Windows 10 和 Windows 11 x64 虚拟机上执行以下矩阵，并为每种宣称支持
的配置至少使用一台有代表性的真实机器。测试应使用维护者控制的账号，以及可丢弃
的 Zotero、OneDrive 和 Obsidian 数据。

- [ ] 下载安装包、验证校验和，分别安装到默认目录与自选目录；测试快捷方式、
  开始菜单、退出、重新启动与空闲状态。
- [ ] 在上一 Windows 版本之上升级，确认设置、缓存、笔记库选择和加密 Zotero
  凭据仍可使用。测试重复安装、卸载及卸载后重装，记录保留的数据和降级限制。
- [ ] 测试在线与离线日报、搜索、导航、外部链接和报告沙箱。不可用的平台操作应
  明确禁用，或返回可据此处理的错误。
- [ ] 验证 Zotero 凭据与当前配置；测试个人版和企业版 OneDrive、多根目录、
  盘符大小写、目录联接、重解析点与符号链接，确保无法绕过目录边界校验。
- [ ] 一次提交超过 10 篇 PDF，确认最多同时运行 4 篇；测试重复条目核对、取消、
  超时、重试、托管条目移除，以及保存流程每个阶段的中断。
- [ ] 测试 OneDrive 仅在线、本机可用、上传中、冲突、暂停、退出登录与离线状态。
  将 Windows 属性检查结果与实际远端可用性比较，确保 PDF 尚无法从云端取得时，
  不会报告 Zotero 元数据已保存成功。
- [ ] 在第二台受支持设备上打开链接 PDF，包含一组 macOS 与 Windows 设备。
  各设备应使用对应的本地 OneDrive 附件基准目录。
- [ ] 测试 Obsidian 笔记库检测、打开已有笔记、手动修改阅读状态，以及拒绝宽泛或
  敏感笔记库路径的保护。
- [ ] 单独测试每个对外提供的 AI 工具：可执行文件与登录检测、一次完整精读、
  并发精读、取消、无响应检测、超时、配额和错误展示、输出解析、笔记、PDF、图片、
  源码获取与缓存清理。Trae 测试需要独立获得可用 CLI 和账号。
- [ ] 使用真实 Windows Codex 沙箱验证权限与受保护的运行时路径。确认选定的
  Python 解释器能使用 PyMuPDF，且任务无法读取凭据或无关本地文件。
- [ ] 测试非 ASCII 用户名与路径、长路径、Windows 保留名称、结尾的点或空格、
  文件锁、杀毒软件与索引程序干扰、睡眠唤醒、断网及任务运行时重启。
- [ ] 在 NTFS 与 OneDrive 文件夹中验证原子替换、重命名、刷盘、清理、重试和
  写入中断。清理范围不得超出当前任务文件。

## 5. 后续发布要求与计划

之后每次发布都需完成[发布检查清单](../RELEASE_CHECKLIST_ZH.md)，并更新此处的
验收记录。继续保留以下要求：

- 在原生 Windows CI 上运行锁定依赖安装、依赖审计、Node/Python 测试与平台集成
  测试。
- 审计解包和打包资源中的密钥、个人路径及私有数据，核对必需技能、许可证、第三方
  说明和只读站点快照；拒绝未声明产物与过期更新订阅文件。
- 从最终安装包生成校验和，在产物传递后重新验证；任一平台构建、审计或校验失败
  时停止发布。
- 对每种宣称支持的配置完成干净虚拟机和实机验收；如有失败或未测试项，应据实
  记录，不能直接标记完成。
- 保持中英文安装、使用、排障、安全、发布说明、校验和指令及兼容性声明一致。

后续工作包括评估 Authenticode 签名和 Windows arm64 构建。Linux 需要单独的平台
实现与验收计划。这些目标目前没有发布日期。
