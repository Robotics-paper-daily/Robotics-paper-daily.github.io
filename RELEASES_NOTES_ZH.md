# v0.3.1

[English release notes](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/main/RELEASES_NOTES.md)

PaperReader v0.3.1 新增 Windows 10/11 x64 安装包，并继续提供 macOS 版本。

## 本版变化

- Windows 版支持将论文和 OneDrive 链接 PDF 存入 Zotero，使用 Codex、Claude 或 Trae 精读论文，生成 Obsidian 笔记、检测已读状态，以及获取最新日报。
- 支持在 Windows 上检测 Zotero 配置、OneDrive 目录、Python 和已安装的 AI 命令行工具。
- 新增可选的 Python 3 解释器设置，可指定安装了 PyMuPDF 的 Python。两个平台的图片修复均使用选定的解释器。

## 下载

从 [v0.3.1 Release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1) 下载适合系统的安装包和 `SHA256SUMS.txt`：

- `PaperReader-0.3.1-arm64.dmg`：Apple Silicon Mac，macOS 12 或更高版本。
- `PaperReader-0.3.1-x64.dmg`：Intel Mac，macOS 12 或更高版本。
- `PaperReader-0.3.1-x64-Setup.exe`：Windows 10/11 x64，按用户安装，可选择安装目录。
- `SHA256SUMS.txt`：以上三份安装包的 SHA-256 校验值。

打开安装包前，请使用 `SHA256SUMS.txt` 核对下载文件。三份安装包均未签名，macOS 版本也未经过 Apple 公证，因此系统可能阻止首次启动。校验值可以发现文件损坏，但不能替代代码签名。校验命令、首次启动步骤和配置方法见[安装指南](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/main/app/README_ZH.md)。

## 升级

新版本需要手动安装。macOS 用户请退出 PaperReader，校验新版本后替换 `/Applications` 中的 App。设置、报告缓存与加密 Zotero 凭据保存在 `~/Library/Application Support/PaperReader/`，升级时请保留该目录。

v0.3.0 没有 Windows 安装包，因此 Windows 用户从 v0.3.1 开始安装。Windows 版用户数据位于 `%APPDATA%\PaperReader\`，卸载时会保留。

移动 OneDrive 文件夹或切换 Zotero 配置后，请先在 PaperReader 设置中检查链接附件目录，再继续保存论文。

> **v0.2 用户请注意：**撤销并重新创建所有曾存入旧版加密网页凭据包的 Zotero API key 和 WebDAV 密码。这些凭据可能仍保留在早期 Git 历史中，升级不会使它们失效。

## 使用限制

- 暂不支持 Windows arm64 和 Linux。
- Windows 的链接附件目录必须位于当前登录账号的 OneDrive 文件夹内，并开启“文件随选”（Files On-Demand）。PaperReader 通过本机同步状态检查后，才会写入 Zotero 元数据。
- 如果 PDF 复制完成后 Zotero 存入失败，文件可能留在 OneDrive 中；解决错误后可重试。移除受管 Zotero 条目不会删除其链接 PDF。
- AI 精读需要单独安装并登录相应的命令行工具，以及安装了 PyMuPDF 的 Python 3。服务可用性和用量限制取决于你的 AI 服务账号。

凭据存储、AI 权限和数据处理方式见[安全说明](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/main/SECURITY_ZH.md)。
