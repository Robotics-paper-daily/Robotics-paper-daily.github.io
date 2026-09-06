# PaperReader v0.3.1（macOS 与 Windows）

[English release notes](RELEASES_NOTES.md)

PaperReader v0.3.1 把桌面应用扩展到 Windows：本次发布同时提供两份 macOS DMG 和一份 Windows 10/11 x64 安装包，功能完全一致。Zotero 存入与本地 AI 辅助精读仍在 App 内完成；公开的 GitHub Pages 站点继续作为只读论文归档。

> **v0.2 用户需要执行的安全操作：**撤销并重新创建所有曾经放入已停用加密网页 bundle 的 Zotero API key 与 WebDAV 密码。v0.3.1 不使用该 bundle，但从当前源码树删除它无法撤销已经保留在早期 Git 历史中的凭据。

## 发布资产

本 App Release 包含三份安装包和一份合并的 checksum manifest：

- `PaperReader-0.3.1-arm64.dmg`：Apple Silicon Mac（macOS 12+）；
- `PaperReader-0.3.1-x64.dmg`：Intel Mac（macOS 12+）；
- `PaperReader-0.3.1-x64-Setup.exe`：Windows 10 与 Windows 11（x64），NSIS 按用户安装，可自选安装目录；
- `SHA256SUMS.txt`：覆盖以上三份安装包。

下载本 Release 附带的匹配安装包与 `SHA256SUMS.txt`。如果你是在仓库中阅读本文件，请前往[官方 Releases 页面](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases)。

打开安装包前先校验。macOS：

```bash
cd ~/Downloads
# Apple Silicon:
grep 'PaperReader-0.3.1-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
# Intel:
grep 'PaperReader-0.3.1-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

Windows（PowerShell）：

```powershell
cd "$env:USERPROFILE\Downloads"
Get-FileHash .\PaperReader-0.3.1-x64-Setup.exe -Algorithm SHA256
# 将输出的哈希与 SHA256SUMS.txt 中 PaperReader-0.3.1-x64-Setup.exe 那一行对比。
```

或在 Git Bash 中：

```bash
grep 'PaperReader-0.3.1-x64-Setup.exe$' SHA256SUMS.txt | sha256sum -c -
```

只运行与已下载文件对应的命令；结果必须显示 `OK`（或哈希与清单完全一致）。

三份安装包都未签名。checksum 可以发现文件损坏，但不能替代 Apple 公证或 Windows Authenticode 签名；如果发布渠道本身失陷，它也不能证明文件来源。

v0.3.1 支持 macOS 12+（`arm64`、`x64`）与 Windows 10/11（`x64`）。Windows arm64 未构建，Linux 仍不受支持。`app/run-windows.bat` 仍只是实验性的源码开发启动脚本，不是产品或安装包；受支持的 Windows 入口是正式 Setup 安装包。Windows 实现记录与后续加固清单见 [Windows 路线图](docs/WINDOWS_ROADMAP_ZH.md)。

## v0.3.1 新增内容

### Windows 10/11（x64）支持

- PaperReader 现在可在 Windows 10 与 Windows 11（x64）上运行，功能与 macOS 完全一致：**Add to Zotero**（OneDrive 链接附件）、**「帮我读」**本地 AI 深度精读（Codex/Claude/Trae CLI）、Obsidian 笔记、已读状态检测与在线报告获取。
- Zotero profile 检测读取 `%APPDATA%\Zotero\Zotero`（`profiles.ini` 与 `prefs.js`），与 macOS 上的 `~/Library/Application Support/Zotero` 相对应。
- OneDrive 链接附件根目录必须位于当前登录账号的 OneDrive 同步文件夹内；PaperReader 通过每用户的 `OneDrive` / `OneDriveConsumer` / `OneDriveCommercial` 环境变量发现根目录，并对解析后的真实路径做大小写不敏感比较。
- 云端上传确认改为轮询文件的 NTFS cloud-files placeholder 属性——即 OneDrive 同步引擎在文件上传完成、进入同步状态后设置的 reparse-point 状态——以替代 macOS 的 `fileproviderctl`，并保持 fail-closed：云端未确认就不写 Zotero metadata。必须开启 OneDrive Files On-Demand（当前 OneDrive 默认开启）。
- Windows 上的 Python 检测依次尝试 `py -3`、`python`、`python3`，持久化解析出的确切 `python.exe`，并自动拒绝 Microsoft Store 的 python stub。
- Provider 直接以 `shell: false` 启动原生可执行文件（`codex.exe`、`claude.exe`、`trae-cli.exe` / `trae-agent.exe`）；取消时用 `taskkill` 结束整个进程树。
- App 数据位于 `%APPDATA%\PaperReader\`：`config.json`、经 Electron `safeStorage`（由 Windows DPAPI 支持）加密的 `zotero-credentials.secure.json`、`site-cache/` 与 `paper-cache/`。手动升级会保留这些数据；卸载同样保留这些按用户存储的数据。
- 内置 `paper-reading` skill 与 shell 无关：POSIX 示例均配有 PowerShell 等价写法（`$env:VAR`、`Copy-Item`、`Get-ChildItem`）。

### macOS 与共享改动

- macOS 功能与 v0.3.0 相同；mac DMG 仍未签名、未公证。
- 图片修复（figure repair）改用探测到的 Python 解释器，不再假设 `PATH` 上存在 `python3`。
- Python 检测更加健壮，并新增可选设置项 **Python 3 解释器 / Python 3 interpreter**，允许指定具体解释器；所选解释器必须能导入 PyMuPDF（`fitz`）。

### 构建与发布流水线

- CI 在 `macos-latest` 构建 macOS DMG，在 `windows-latest` 构建 Windows 安装包：锁定的 `npm ci`、依赖审计、Node 与 Python 测试、electron-builder NSIS 打包、打包后隐私审计与各 job 独立 checksum。tag 触发的发布会上传三份安装包和合并后的 `SHA256SUMS.txt`。
- 分发方式保持手动的「下载—校验—替换」流程；App 不会自行获取或安装新版本。

## 安装与配置

1. 按上文校验安装包后安装。macOS：打开 DMG，把 PaperReader 拖入“应用程序”。Windows：运行 `PaperReader-0.3.1-x64-Setup.exe`（NSIS 按用户安装，可自选安装目录）。
2. 未签名版本的首次启动：macOS 在 Finder 中按住 Control 点击或右键 PaperReader，选择**打开**并确认**打开**，不要全局关闭 Gatekeeper；Windows 若出现 Microsoft Defender SmartScreen 提示，先确认 SHA-256 校验通过，再只对这一个文件选择**更多信息** → **仍要运行**，不要全局削弱 SmartScreen 或其他系统安全设置。
3. 安装并运行 Zotero 与 OneDrive。Zotero 登录与 API key 相同的个人文献库账号，开启 Zotero Sync，并完成一次同步。
4. 把 Zotero Linked Attachment Base Directory 设为 OneDrive 中的文件夹。Windows 上该文件夹必须位于当前登录账号的 OneDrive 同步文件夹内，并保持 Files On-Demand 开启（默认即开启）。
5. 创建具有个人文献库读写权限的 24 字符 Zotero API key，粘贴到 PaperReader Settings，并在验证通过后保存。
6. 确认检测到的 Zotero profile 与 OneDrive 附件目录。
7. 如需使用**「帮我读」**，请选择专用 Obsidian vault，以及已登录的 Codex/Claude CLI 或独立获得的 Trae CLI。不要选择文件系统根目录、用户主目录、宽泛的主目录一级文件夹，或与 PaperReader data、`$CODEX_HOME`、SSH 文件重叠的路径。
8. 准备带 PyMuPDF 的 Python 3。macOS：确认 login-shell 中 `python3 -c 'import fitz'` 成功。Windows：从 python.org 安装 Python 3（自带 `py` launcher），然后执行例如 `py -3 -m venv %USERPROFILE%\.paperreader-python` 与 `%USERPROFILE%\.paperreader-python\Scripts\python.exe -m pip install "PyMuPDF>=1.24,<2"`，再在 PaperReader Settings 中选择该 `python.exe`（或确保 `py -3 -c "import fitz"` 可用）。

完整步骤与排错见 [PaperReader 中文指南](app/README_ZH.md)。

## 从 v0.3.0 升级

- 两个平台的升级都是手动的「下载—校验—替换」流程；设置、报告缓存与加密 Zotero 凭据都会保留。
- macOS：退出 PaperReader，校验新 DMG，替换 `/Applications` 中的 App；不要删除 `~/Library/Application Support/PaperReader/`。
- Windows：v0.3.0 没有 Windows 版本，因此 v0.3.1 在 Windows 上是全新安装。之后的 Windows 升级只需在旧版之上运行更新的 Setup 安装包，`%APPDATA%\PaperReader\` 会保留。
- 只要 Zotero Linked Attachment Base Directory 仍解析到同一 OneDrive 文件夹，已有 linked attachment 就仍然有效。移动 OneDrive 存储或切换 Zotero profile 后，需要重新确认目录。
- 不导入 browser personal mode 凭据。请轮换所有曾由 v0.2 使用的 key 或 WebDAV 密码。

## 已知限制

- 三份安装包都未签名：DMG 未经过 Apple 公证，Windows 安装包没有 Authenticode 签名。
- 因此首次启动需要一步针对单个文件的明确操作：macOS 在 Finder 中右键选择**打开**；Windows 在 SHA-256 校验通过后，对 SmartScreen 提示选择**更多信息** → **仍要运行**。绝不要全局关闭 Gatekeeper、SmartScreen 或其他系统安全机制。
- Windows 只构建 x64；Windows arm64 未构建。
- Linux 仍不受支持；它是下一个计划中的平台目标，但不承诺日期。
- Windows 上必须保持 OneDrive Files On-Demand 开启；没有同步引擎的 placeholder 状态，云端确认无法成功。
- Windows 卸载会保留 `%APPDATA%\PaperReader` 中的按用户数据；如需彻底清理，可手动删除该目录。
- 较晚发生的 Zotero API 失败可能在 OneDrive 中留下已校验 PDF。对同一论文重试是安全的；移除受管 Zotero 条目不会删除该文件。
- AI provider 的可用性与配额取决于用户本地 provider 账号。

完整安全与隐私模型见[中文安全说明](SECURITY_ZH.md)。
