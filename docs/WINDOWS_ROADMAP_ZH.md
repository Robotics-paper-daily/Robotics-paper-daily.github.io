# PaperReader Windows 路线图

[English version](WINDOWS_ROADMAP.md)

本文档记录 PaperReader 在发布并正式支持 Windows 版本之前必须完成的工程工作。
它是一份规划文档，不代表兼容性公告或发行承诺。

## 1. 当前支持边界

- PaperReader v0.3.0 是当前面向 macOS 12 或更高版本的发布目标。在对应 tag、
  GitHub Release、两份 DMG 与校验清单实际存在前，它仍是候选版。
- v0.3.0 目标没有 Windows 安装包、Windows GitHub Release 资产，也没有经过
  验证的 Windows 端到端流程。
- `app/run-windows.bat` 是供贡献者使用的实验性源码启动器，只会运行 `npm ci`
  和 `npm start`；它不是安装后的产品，也不能证明应用与 Windows 兼容。
- 除非后续版本明确说明，否则 Windows、Linux 与仅从源码运行均不属于 v0.3.0
  桌面端支持矩阵。
- 目前不承诺最低 Windows 版本、CPU 架构、安装器格式、预览版本或发布日期。
- 当前产品与本路线图只采用手动替换升级。任何不同的分发政策都需要另行设计与
  审查。

## 2. 当前可复用的底座

仓库已经包含一些有价值的跨平台基础，但每一项仍需经过 Windows CI 与真实机器
验证：

- Electron 外壳、沙箱化报告渲染、搜索、缓存与 Obsidian 笔记状态逻辑大体不依赖
  特定平台；
- Obsidian 检测已经包含 `%APPDATA%` 与 `%USERPROFILE%` 路径；
- Codex、Claude 与 Trae 适配器已经包含 Windows 原生可执行文件查找、
  `shell: false`、隐藏子进程与基于 `taskkill` 的取消逻辑；
- 设置使用 Electron 针对平台的 `userData` 目录，Zotero 凭据存储围绕 Electron
  `safeStorage` 设计；
- Zotero Web API 元数据与对账层本身不强依赖 macOS；
- 随 App 打包的 Python 工具已经在若干 Windows 控制台路径中强制输出 UTF-8，
  并应用了一组初步的 Windows 文件名限制；
- PDF 写入器已经具备校验、受限下载、哈希与分阶段文件提交，可作为 Windows
  实现的基础。

这些只是实现起点，不是已经受支持的 Windows 功能。

## 3. 核心阻塞项

### 3.1 Zotero 与 OneDrive 集成

- `zotero-profile.js` 目前只会在 macOS 的
  `~/Library/Application Support/Zotero` 布局中检测 Zotero。Windows profile
  检测必须使用有文档依据的 Windows 路径，安全解析当前 profile，并且可以在
  不读取开发者真实 profile 的情况下测试。
- `main.js` 目前只接受 macOS OneDrive File Provider 域内的链接附件根目录。
- `onedrive-cloud-verify.js` 依赖 `/usr/bin/fileproviderctl`，并且有意拒绝非
  macOS 平台。Windows 需要可信、受时限约束且失败时关闭写入的云端状态适配器；
  仅看到本地文件存在不能证明 OneDrive 已完成上传。
- 根目录比较必须正确处理盘符、大小写不敏感路径、junction、reparse point、
  符号链接以及多个个人版或企业版 OneDrive 根目录，同时不能让目录边界校验被绕过。
- 完整事务顺序必须保持为：校验配置、暂存并验证 PDF、确认可靠的云端状态、创建或
  对账 Zotero 元数据，并保留文档规定的重试与回滚行为。

### 3.2 Python 与论文精读运行时

- 环境检测目前假设存在 `python3` 命令。Windows 检测必须安全解析并持久化一个
  确切的 `python.exe`（或经验证的 Python launcher 结果），且该解释器能够导入
  受支持版本的 PyMuPDF。
- `skills/paper-reading/SKILL.md` 当前包含 `test`、`$VAR` 与 `cp` 等 POSIX
  shell 语法。工作流必须改为与 shell 无关，或由 App 自己的可信编排完成，而不是
  要求 provider 翻译命令。
- Codex、Claude 与 Trae 的可执行文件检测、登录检查、参数处理、流式输出、取消、
  超时与进程树清理必须在 Windows 上实际执行，不能根据 macOS 单测推断。
- 在声明 Windows 支持 Codex 前，必须用 Windows 路径语法和真实 Windows Codex
  sandbox 验证权限 profile 与受保护的运行时路径。

### 3.3 Windows 文件系统行为

- 笔记、附件、缓存与临时文件名必须拒绝保留设备名、非法字符、结尾的点或空格，
  以及不安全的替代路径形式。
- 必须定义并测试嵌套 Obsidian 笔记、附件、下载的源码文件与打包资源的路径长度行为。
- 必须在 NTFS 与 OneDrive 同步目录上测试原子替换、重命名、文件锁、刷盘、清理、
  重试和写入中断行为。
- Unicode、非 ASCII 账户名、网络不可用状态，以及文件被 Zotero、OneDrive、
  杀毒软件或索引程序占用的情况，都需要显式测试。

### 3.4 打包与应用生命周期

- 只有在确定支持的 Windows 与 CPU 矩阵后，才添加明确的 electron-builder `win`
  配置、Windows 图标资源、产物命名与 `dist:win` 脚本。
- 选择并测试安装器格式与安装范围、快捷方式、开始菜单集成、安装位置、修复或重复
  安装行为，以及干净卸载。
- 定义手动升级行为，并验证替换或升级 App 后，预期保留的 `%APPDATA%` 设置、缓存
  与加密凭据仍然可用。卸载时是否保留或删除这些数据必须单独说明。
- 公开分发前必须决定并说明 Authenticode/代码签名与 SmartScreen 策略。无论产物
  是否签名，都必须提供校验和；文档不得建议用户全局关闭 Windows 安全控制。
- 平台能力检测必须隐藏或明确禁用不可用流程；Windows 用户不能进入仅适用于 macOS
  的 Zotero 配置后只得到笼统错误。

## 4. 分阶段实现

### 阶段 0：冻结契约

1. 根据 Electron、Zotero、OneDrive、Obsidian、Python 与 provider CLI 的支持
   组合，选择候选 Windows 版本与 CPU 矩阵。
2. 定义首个 Windows 版本的功能契约，并决定是否要求首发时覆盖全部 macOS 功能。
3. 添加平台能力接口，并让不支持的操作继续以失败时关闭的方式处理。
4. 在修改行为前，把当前仅适用于 macOS 的假设转为明确的平台测试。

### 阶段 1：平台存储适配器

1. 实现 Windows Zotero profile 检测并补充单元测试。
2. 在与 macOS 相同的窄接口后实现 Windows OneDrive 根目录校验与云端状态确认。
3. 在 Windows 上验证规范路径相等性与 PDF 事务行为。
4. 为离线同步、冲突、文件锁、取消、超时与重启添加故障注入测试。

### 阶段 2：精读运行时

1. 添加安全的 Windows Python 检测，并持久化经过验证的解释器路径。
2. 用与平台无关、由 App 持有的操作替换 POSIX 专用技能命令，或由代码选择有文档
   说明的 Windows 等价命令。
3. 在 Windows 上独立验证每个 provider 适配器。
4. 使用一次性 vault 验证并发精读、取消、watchdog、笔记创建、图片抽取、源码获取
   与缓存清理。

### 阶段 3：安装器与生命周期

1. 添加 Windows 打包配置、图标资产与可复现的产物名称，同时不改变手动更新的
   产品策略。
2. 测试全新安装、首次启动、重复安装、手动升级、适用时拒绝降级、卸载与卸载后重装。
3. 验证升级时保留预期本地数据，并确保安装器与日志中没有密钥。
4. 最终确定签名、校验和、下载与首次启动说明。

### 阶段 4：CI、安全与候选版本

1. 为每个候选发布架构添加原生 `windows-latest` CI。
2. 在 Windows 上运行源码测试、打包 App 审计、安装器校验与 smoke test，而不是交叉
   编译后假设兼容。
3. 只有全部自动化门槛通过后，才发布明确标记的 prerelease。
4. 在宣布 Windows 稳定版前，完成干净 VM 与真实机器验收。

## 5. CI 与安全门槛

Windows 候选版本必须满足以下全部条件：

- 锁定依赖安装、依赖审计、Node 测试与 Python 测试在原生 Windows CI 上通过；
- provider、路径、进程、凭据、PDF 存储、Zotero 与 OneDrive 适配器具有 Windows
  专用单元测试与集成测试；
- 打包资源包含必需技能、许可证、第三方说明与只读站点快照，且不包含配置、凭据、
  token、私有 vault 数据或开发者专属路径；
- 把 `app/release-audit.js` 从当前“恰好两个打包后的 `app.asar`”假设重构为明确的
  按平台/架构产物清单；
- `test/release-audit.test.js` 不再断言 `dist:win` 必须不存在，同时继续拒绝未声明
  产物与过期更新 feed；
- 源码与安装包扫描除现有 macOS 用户路径检查外，还能检测
  `C:\\Users\\<name>\\...` 等 Windows 个人路径；
- 安装器内容与解包后的 `app.asar` 通过与 macOS 安装包相同的密钥、隐私与 allowlist
  审计；
- CI 从准确的发布产物生成校验和，并在产物传递后重新验证；
- 任一平台构建、审计或校验和验证失败时，发布任务都不能上传不完整或版本混杂的资产。

## 6. 安装与真实机器验收门槛

对于最终列为支持的每一个操作系统版本与架构，都要在干净 VM 和至少一台有代表性的
真实机器上测试：

- 安装器下载、校验和验证、首次启动、快捷方式或开始菜单启动、正常退出、再次启动，
  以及空闲时无崩溃；
- 从上一个受支持 Windows 版本手动升级，并按预期保留设置、缓存、vault 选择与仍可
  使用的加密 Zotero 凭据；
- 卸载与重装行为，包括明确检查哪些本地数据仍然保留；
- 在线与离线报告加载、搜索、导航、沙箱边界与外部链接路由；
- Zotero key 验证、当前 profile 检测、OneDrive 根目录匹配、并发添加 PDF、重复
  对账、取消、重试、移除与跨设备链接附件访问；
- OneDrive 仅在线、本机可用、同步中、冲突、暂停、退出登录与离线状态，并确保云端
  确认前绝不报告 Zotero 元数据成功；
- Obsidian vault 检测、已读状态、打开笔记、手动修改已读状态，以及对宽泛或敏感
  vault 路径的保护；
- 每一个对外宣称支持的 provider，包括登录检测、一次完整精读、并发精读、取消、
  超时、额度或错误展示、输出解析与缓存清理；
- 非 ASCII Windows 用户名与路径、长路径、文件锁、杀毒扫描、睡眠唤醒、网络中断，
  以及有任务运行时重启应用。

会修改 Zotero、OneDrive、Obsidian 或 provider 账号的测试必须使用维护者控制的
fixture 与一次性数据，不能使用贡献者个人文献库或 vault。

## 7. 稳定版发布门槛

只有在以下全部条件满足后，才能把 Windows 标记为受支持：

1. 明确记录受支持的 Windows 版本、CPU 架构、功能、安装器格式、签名状态与手动
   升级策略；
2. 每个宣称支持的配置都通过原生 CI、打包审计、干净 VM 测试与真实机器端到端测试；
3. 中英文安装、使用、排障、隐私、安全、版本说明与校验和说明保持同步；
4. GitHub Release 只包含已声明且版本匹配的产物与经过验证的校验和清单；
5. 维护者已经完成更新后的发布检查清单，同时覆盖现有 macOS 渠道与新增 Windows
   渠道。

在此之前，仓库文本与 issue 回复必须使用 **Windows 已规划，但尚不支持也未发布**，
不得在没有对应已测试产物时使用“兼容”“预览版可用”或给出发布日期。
