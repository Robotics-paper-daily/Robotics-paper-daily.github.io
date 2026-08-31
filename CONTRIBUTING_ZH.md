# 贡献指南

[English](CONTRIBUTING.md)

Robotics Daily Papers 同时包含生成式公开归档与 PaperReader 桌面应用。所有贡献都
必须保持既有信任边界：网页只读；本地凭据、文件写入、Zotero 操作和 AI CLI 执行
只发生在可信 App 进程中。

v0.3.0 是当前 macOS 发布目标；在官方 tag、Release、两份 DMG 与 checksum manifest
实际存在前，它仍是候选版。Windows 已规划但尚未支持；相关开发应遵循
[Windows 路线图](docs/WINDOWS_ROADMAP_ZH.md)，不能把 `app/run-windows.bat`
当作产品或兼容性结果。

## 创建 issue 前

- 先搜索已有 issue，并提供受影响的 commit/版本、操作系统、架构、最小复现、
  预期结果与实际结果。
- 从截图和日志中移除 Zotero key、WebDAV 密码、AI provider 凭据、OneDrive 数据、
  私有论文、vault 笔记、用户名与个人文件路径。
- 可能属于漏洞时，遵循[安全政策](SECURITY_ZH.md)，在可用时使用私密报告。
  不要在公开 issue 中写入利用细节或 secret。
- Provider 计费、配额、数据保留与服务可用性通常由 provider 负责；只有问题由
  PaperReader 集成直接造成时才属于本项目范围。

## 开发环境

发布工作流使用 Node.js 22，论文发布流水线使用 Python 3。当前受支持的桌面集成
验收和两架构 DMG 构建需要 macOS。

```bash
git clone <repository-url>
cd Robotics-paper-daily.github.io

python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 -m pip install -r skills/paper-reading/requirements.txt

cd app
npm ci
npm test
npm start
```

集成测试必须使用假账号与一次性目录。不要对他人的 Zotero 文献库、OneDrive
文件夹、vault 或 provider 账号运行测试。

## 修改边界

- **发布流水线：**源码位于 `src/`，策略与主题设置位于 `src/config.py`。
- **生成报告：**修改 generator/template 后运行
  `python3 src/rebuild_html.py --clean-stale`。不要手工修改 `daily_html/` 或
  `app/site/` 下的单个文件。
- **桌面应用：**可信编排放在 `app/main.js` 与职责明确的模块中；不可信报告只能
  使用窄化 bridge，不能获得 secret 或任意文件系统/网络权限。
- **Zotero 保存：**PDF 下载、本地提交、OneDrive 确认与重新哈希阶段使用固定
  4-slot FIFO 队列；相同 queued/running operation key 会合并，任何完成结果都会
  释放 slot。它与 AI 精读并发相互独立；后者默认 10，可配置范围为 1-16。
- **凭据：**必须使用 Electron `safeStorage`。不得新增明文 fallback、网页凭据
  bundle、WebDAV 上传路径或类似真实 secret 的测试 fixture。
- **Windows：**平台行为应置于窄化 adapter 后并补原生 Windows 测试。只启动了
  Electron 窗口或源码脚本，不能作为支持声明。

## 文档

面向用户的使用、安全、发布与维护文档均提供中英文配套。行为变化时，必须在同一
改动中更新对应文件：

- `README.md` / `README_ZH.md`；
- `app/README.md` / `app/README_ZH.md`；
- `RELEASES_NOTES.md` / `RELEASES_NOTES_ZH.md`；
- `SECURITY.md` / `SECURITY_ZH.md`；
- `RELEASE_CHECKLIST.md` / `RELEASE_CHECKLIST_ZH.md`；
- `CONTRIBUTING.md` / `CONTRIBUTING_ZH.md`；
- `docs/WINDOWS_ROADMAP.md` / `docs/WINDOWS_ROADMAP_ZH.md`。

第三方法律与归属文本以英文 `THIRD_PARTY_NOTICES.md` 为权威版本。两种语言中的
链接、版本状态、平台声明、命令、默认值与限制必须保持语义一致。

## 必需检查

日常修改运行相关检查；准备发布时运行全部检查：

```bash
# 仓库 Python 测试
python3 -m unittest discover -s test -p 'test_*.py'

# App 与文档契约测试
cd app
npm test

# 刷新打包站点 snapshot，并审计源码/打包输入
npm run audit:release

# 回到仓库根目录
git diff --check
```

修改发布流水线后，应重新生成报告，并检查代表性日报和搜索行为。修改 macOS App
后，还应测试一次干净的源码启动。发布候选版必须完成
[发布检查清单](RELEASE_CHECKLIST_ZH.md)、干净机器 DMG 安装与产物校验。

## Pull request 要求

- 保持改动聚焦，并说明用户可见行为与信任边界影响。
- 对共享逻辑、回归、IPC、路径、队列与失败恢复补充或更新测试。
- 写明已运行的检查，以及无法执行的平台专属检查。
- 不要提交依赖目录、本地构建输出、App support data、凭据、vault 内容或无关的
  生成文件变化。
- 在官方 tag、Release、架构匹配的产物与 checksum manifest 实际存在前，不得把
  候选版本改写为“已发布稳定版”。
