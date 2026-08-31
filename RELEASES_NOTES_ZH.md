# PaperReader v0.3.0 macOS 版

[English release notes](RELEASES_NOTES.md)

PaperReader v0.3.0 把 Zotero 存入和本地 AI 辅助精读迁移到桌面 App。公开的
GitHub Pages 站点继续作为只读论文归档。

> **v0.2 用户需要执行的安全操作：**撤销并重新创建所有曾经放入已停用加密网页
> bundle 的 Zotero API key 与 WebDAV 密码。v0.3.0 不使用该 bundle，但从当前
> 源码树删除它无法撤销已经保留在早期 Git 历史中的凭据。

## 发布资产

本 App Release 包含两份适用于 macOS 12 或更高版本的安装包，以及一份 checksum
manifest：

- `PaperReader-0.3.0-arm64.dmg`：Apple Silicon；
- `PaperReader-0.3.0-x64.dmg`：Intel Mac；
- `SHA256SUMS.txt`：覆盖以上两份 DMG。

下载本 Release 附带的匹配 DMG 与 `SHA256SUMS.txt`。如果你是在仓库中阅读本文件，
请前往[官方 Releases 页面](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases)。

打开安装包前先校验：

```bash
cd ~/Downloads
# Apple Silicon:
grep 'PaperReader-0.3.0-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
# Intel:
grep 'PaperReader-0.3.0-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

只运行与已下载架构对应的命令；结果必须显示 `OK`。

DMG 没有 Apple Developer ID 签名，也没有经过 Apple 公证。checksum 可以发现
文件损坏，但不能替代 Apple 签名；如果发布渠道本身失陷，它也不能证明文件来源。

v0.3.0 只支持 macOS。Windows 已规划，但不包含在本版本中，也不受本版本支持；
`app/run-windows.bat` 只是实验性源码开发启动器，不是产品或安装包。Linux 不受
支持。后续计划见 [Windows 路线图](docs/WINDOWS_ROADMAP_ZH.md)。

## 主要更新

### App 本地 Zotero 流程

- 用户连接自己的 24 字符 Zotero API key。PaperReader 验证个人文献库读写权限，
  取得数字 user ID，并用 Electron `safeStorage` 在本机加密两者；不允许明文回退。
- 分页只读扫描会识别整个个人文献库中的已有 arXiv 条目。仅表示已存在的匹配项
  不会被重复创建、修改，也不会作为可删除条目暴露给报告页面。
- 新建父条目带可见 Zotero tag `paperreader-managed-v1`。Repair 和 Remove 要求
  条目仍带该 tag，并且仍位于 `Daily Paper` collection tree 中。
- PDF 经过校验后写入 Zotero 配置在 OneDrive 中的 Linked Attachment Base
  Directory。PaperReader 检查当前 Zotero profile，确认 OneDrive 云端状态，重新
  计算已提交文件的 hash，然后才创建 `linked_file` metadata。
- PDF 下载、本地放置、OneDrive 确认和最终校验使用固定四槽 FIFO 队列。相同的
  排队中或运行中操作会合并；更大的突发请求会等待空闲槽位。该阶段前后的 Zotero
  API 调用使用各自独立的 timeout 与 reconciliation。
- 重试会对丢失的 API 响应做 reconciliation，而不是直接创建重复条目。Remove
  删除符合条件的受管 Zotero metadata，但有意保留 OneDrive 中已校验的 PDF。

### 本地精读与 Obsidian 笔记

- **「帮我读」**把论文交给本机已经安装并登录的 Codex 或 Claude CLI。Trae 只适用
  于已经独立获得受支持 `trae-cli` 或 `trae-agent` build 和账号的用户。
- 内置 `paper-reading` skill 把结构化结果写入 `<vault>/<date>/<title>/`。已有笔记
  可以从论文卡片打开；勾选笔记最后的 `- [ ] ✅ 已读` 后，卡片变为 **✓ 已读**。
- AI 精读并发默认值为 `10`，可配置范围为 `1` 到 `16`；它与固定四槽 Zotero PDF
  队列相互独立。
- Provider 发现、vault 扫描、cache 维护和历史搜索索引作为有界后台任务运行，减少
  对 Electron main process 的阻塞。
- 论文提取需要 `python3` 和 PyMuPDF（`fitz`）。源码支持的依赖范围记录在
  `skills/paper-reading/requirements.txt`。

### 产品与安全边界

- Add to Zotero 与 **「帮我读」**只在 PaperReader 中提供。公开站点继续提供浏览、
  搜索、日报与外部链接。
- 报告内容运行在受限 sandbox 中，只能调用类型化 App action。报告页面不能取得
  Zotero 凭据，也不能任意访问文件系统或网络。
- PaperReader 没有内置分析或遥测。功能所需流量仍会访问公开报告站、arXiv、
  Zotero、OneDrive/macOS File Provider 和所选 AI provider。
- Codex、Claude 与 Trae 是外部服务；其 CLI 可能依据各自条款发送论文、prompt 和
  生成上下文。PaperReader 不收集或保存这些服务的登录凭据。

## 安装与配置

1. 下载正确的 DMG，打开后把 PaperReader 拖入“应用程序”。
2. 首次启动时，在 Finder 中 Control-click/右键 PaperReader，选择**打开**并确认
   **打开**。不要全局关闭 Gatekeeper。
3. 安装并运行 Zotero 与 OneDrive。Zotero 登录与 API key 相同的个人文献库账号，
   开启 Zotero Sync，并完成一次同步。
4. 把 Zotero Linked Attachment Base Directory 设为 OneDrive 中的文件夹。
5. 创建具有个人文献库读写权限的 24 字符 Zotero API key，粘贴到 PaperReader
   Settings，并在验证通过后保存。
6. 确认检测到的 Zotero profile 与 OneDrive 附件目录。
7. 如需使用**「帮我读」**，请选择专用 Obsidian vault，以及已登录的 Codex/Claude
   CLI 或独立获得的 Trae CLI。不要选择文件系统根目录、用户主目录、宽泛的主目录
   一级文件夹，或与 PaperReader data、`$CODEX_HOME`、SSH 文件重叠的路径。
8. 确认 login-shell `python3 -c 'import fitz'` 成功。源码 checkout 可以从
   `skills/paper-reading/requirements.txt` 安装受支持的依赖范围。

完整步骤与排错见 [PaperReader 中文指南](app/README_ZH.md)。

## 从早期版本升级

- 退出 PaperReader，校验新 DMG，然后替换 `/Applications` 中的 App。不要删除
  `~/Library/Application Support/PaperReader/`；替换 App bundle 时，设置、站点
  cache 与加密 Zotero 凭据都会保留。
- 不导入 browser personal mode 凭据。请配置新的 App-local Zotero key，并轮换
  所有曾由 v0.2 使用的 key 或 WebDAV 密码。
- 只要 Zotero Linked Attachment Base Directory 仍解析到同一 OneDrive 文件夹，
  已有 linked attachment 就仍然有效。移动 OneDrive 存储或切换 Zotero profile
  后，需要重新确认目录。

## 已知限制

- 只分发完整 DMG。App 需要手动替换，不提供增量分发资产。
- DMG 未签名且未公证，因此首次启动必须通过 Finder 明确选择**打开**。
- v0.3.0 没有受支持的 Windows 或 Linux 安装包，也没有经过验证的端到端流程。
- Add PDF 时，OneDrive 必须已经安装、登录且状态健康；Zotero 必须暴露可读取的
  当前 profile，并已配置 Linked Attachment Base Directory。
- AI provider 的可用性与配额取决于用户本地 provider 账号。
- 较晚发生的 Zotero API 失败可能在 OneDrive 中留下已校验 PDF。对同一论文重试
  是安全的；移除受管 Zotero 条目不会删除该文件。

完整安全与隐私模型见[中文安全说明](SECURITY_ZH.md)。
