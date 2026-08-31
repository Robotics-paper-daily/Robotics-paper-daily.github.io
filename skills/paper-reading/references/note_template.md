# 笔记模板 (note_template)

This is the exact structure of the Obsidian note to produce. Fill every `{{...}}`
placeholder; delete the `<!-- hint -->` comments and any section that genuinely
does not apply (and say why it doesn't, e.g. "本文无消融实验"). Keep headings and
their order stable — consistency is what makes the vault searchable and lets
Bases/Properties build statistics across notes. The note MUST end with the
`- [ ] ✅ 已读` checkbox line (see the very bottom) and keep it as the last line —
PaperReader reads it as the **only** read-status signal. An existing matching
note makes the App show the 「笔记」 button; only a checked box (`- [x] ✅ 已读`)
makes it show 「已读」. The user ticks it in Obsidian after actually reading.

Language: 正文用中文；模型名、专业术语、指标名、benchmark 名保留英文
(e.g. cross-attention、flow-matching、success rate、CALVIN)。

Frontmatter uses JSON-style double-quoted strings and lists. Escape every
embedded backslash and double quote (`\` → `\\`, `"` → `\"`) before insertion;
never paste an unquoted author, URL, field, tag, topic, or method. Emit list
values as separate quoted elements, not one comma-separated scalar.

---

````markdown
---
title: "{{完整标题}}"
aliases: ["{{方法简称, 如 RT-2}}"]
authors: ["{{作者1}}", "{{作者2}}", "{{...}}"]
venue: "{{会议/期刊, 未知则 arXiv}}"
published: "{{YYYY-MM-DD, arxiv 首次提交日}}"
arxiv: "{{2401.12345}}"
url: "{{https://arxiv.org/abs/...}}"
code: "{{开源 repo url；没有则 none}}"
date_read: "{{今天 YYYY-MM-DD}}"
field: "{{主领域, 见 taxonomy.md, 单选}}"
topics: ["{{子方向标签1}}", "{{子方向标签2}}"]
methods: ["{{架构/模块/方法标签1}}", "{{方法标签2}}"]
tags: ["paper", "{{field}}", "{{其他标签}}"]
rating:                 # 留空, 读完你自己打 1-5
---

# {{完整标题}}

> [!abstract] TLDR
> {{偏长 TLDR：3-6 句。一口气讲清楚——这是什么任务/范式下的工作、核心做法
> 是什么、关键结果如何。比 abstract 更口语、更点题, 让你一眼想起这篇。}}

**领域定位**：{{一句话——属于哪个领域/子方向 + 什么范式。这句要能直接当 label
用, 与 frontmatter 的 field/topics 对应。}}

---

## 1. 故事 Story

### 领域与问题
- **所属领域**：{{}}
- **要解决的问题 / 痛点**：{{具体是什么困难, 为什么重要}}

### 前人怎么做
{{文中提到的已有路线 + 各自局限。若原文没有明确对比, 写"文中未明确展开",
不要凭空编造他人方法。}}

### 本文思路
- **核心 insight**：{{一句话点破关键想法}}
- **怎么做到的（高层）**：{{用 2-4 句串起整体思路, 细节留到第 2 节}}

### 贡献 Contributions
1. {{}}
2. {{}}
3. {{}}

---

## 2. 模型结构 Method & Architecture

> 目标：把方法"吃透"。范式是什么、每个部分怎么设计、为什么这么设计、用了哪些
> 架构/模块/技巧。覆盖正文 method 与附录里的算法/框架细节, 但**重新组织**成条理
> 清晰的图 + 表述, 不要照抄原文段落或公式堆砌。
> **代码对照**：若开源，**每个模块描述后紧跟它的代码实现**（短代码块 + `[[code/<flatname>|<original/path>]]`
> 跳转链接，点开在 vault 内 VSCode 编辑器打开；可选 GitHub 行链接做精确参考），结构与实现
> 对照着讲；未开源则在本节开头标一句「未开源（截至阅读日）」。

### 范式 Paradigm
- **输入 → 输出**：{{模态、形式, 如 (image, instruction) → action chunk}}
- **整体范式**：{{如 autoregressive VLA / diffusion policy / world-model rollout}}

### 总览 Pipeline
{{一张**骨架级**端到端数据流 Mermaid 图，裹进**默认折叠**的 callout（不霸占篇幅）。
只画主干：重复结构折叠成单节点（如 `Video DiT (28层)` 一个节点、`8层 bridge` 一条
标注边），目标 ≤ ~12 节点；细节交给下面嵌入的原文图。`flowchart TB`（纵向，自适应
宽度）；subgraph 分组；边标清传递物 (feature/token/action/loss)；classDef 给阶段上色。
节点标签内换行用 `<br/>`（**不要用 `\n`** —— Obsidian 的 mermaid 会把 `\n` 原样显示）。
**【语法硬规则，违反会导致"流程图乱码"=mermaid 解析报错】**：
(1) **凡是含非字母数字字符（括号 `()`、逗号、冒号、斜杠、数学符号、中文标点等）的文本，一律用双引号包起来** —— 节点标签 `X["..."]`、**subgraph 标题 `subgraph ID["..."]`（最易漏！）**、**带管道的边标签 `-->|"..."|`（含 `-.->|"..."|`）**。纯字母数字可不加引号，但拿不准就加。
(2) **不要用 mermaid 保留字做节点 ID 或 classDef 名**：`graph`/`end`/`subgraph`/`class`/`style`/`click`/`flowchart` 等都禁用（如需"graph"类请用 `grph`/`gr`）。
(3) 写完后自检：每个 `subgraph X[...]` 和每个 `|...|` 里若有 `(` 就必须是 `["..."]` / `|"..."|`。}}

> [!tip]- 总览 pipeline（点击展开）
> ```mermaid
> flowchart TB
>   classDef io fill:#ede9fe,stroke:#7c3aed;
>   classDef enc fill:#dbeafe,stroke:#2563eb;
>   classDef core fill:#dcfce7,stroke:#16a34a;
>   In["输入 (obs, instr)"]:::io --> Enc["编码器"]:::enc
>   Enc -- feature --> Core["核心模块 ({{如 DiT ×N}})"]:::core
>   Core -- action --> Out["输出 / 动作"]:::io
> ```

{{紧接着嵌入原文关键架构图作对照（细节看这张）——见 SKILL.md 的嵌入写法：}}
![[{{YYYY-MM-DD/<title>/attachments/<id>/figX.png}}]]
*Figure {{N}}（原文）：{{一句话说明这张图在讲什么}}。*

### 各部分设计 Components
{{每个关键模块一个小节。说清: 它做什么、用什么架构/方法、关键设计选择, 以及
（如果文中给了）为什么这么选。}}

#### {{模块1, 如 Vision-Language Backbone}}
- **作用**：{{}}
- **设计 / 架构**：{{用了什么 (如 SigLIP + LLaMA), 怎么接, 关键超参}}
- **为什么**：{{动机或权衡, 文中没说则略}}
- **代码**（若开源）：[[code/{{flatname}}|{{original/path}}]]（点开在 vault 内 VSCode 编辑器打开；可加 [GitHub]({{blob_url#Lxx}}) 行链接做精确参考）
  ```python
  {{该模块最关键的 1–3 行——loss / 核心模块 / head, 短而精, 不照搬整文件}}
  ```

#### {{模块2}}
- **作用**：{{}}
- **设计 / 架构**：{{}}
- **为什么**：{{}}

### 训练与推理 Training & Inference
- **训练目标 / loss**：{{文字描述 + 关键公式, 用 $$...$$ 写, 只保留点睛的式子}}
  $$ {{L = \dots}} $$
- **数据**：{{用了什么数据/规模/采样}}
- **推理流程**：{{部署时怎么跑, 有无特别的解码/采样/控制频率}}

---

## 3. 实验 Experiments

### 设置 Setup
- **任务 / Benchmark**：{{}}
- **指标 Metrics**：{{每个指标含义一句话, 越界的术语解释清}}
- **Baselines**：{{对比了谁}}

### 主要结果 Main Results
{{把论文的主结果表**完整转录**成 markdown 表：所有方法、所有指标、所有 benchmark,
数字与原文一致, 不要只挑几行。多张主表就分多张, 每张配一行小标题说明它在比什么。}}

| 方法 | {{指标1}} | {{指标2}} | {{...}} |
|---|---|---|---|
| **{{本文}}** | {{}} | {{}} | {{}} |
| {{baseline1}} | {{}} | {{}} | {{}} |
| {{baseline2}} | {{}} | {{}} | {{}} |

- **一句话结论**：{{这些数字整体说明了什么}}

### 消融实验 Ablations
{{两层都要：先**完整转录**每个消融表的原始数字（所有变体 × 所有指标, 与原文一致）,
再补一张分析表说明每个消融的设计意图与发现。数字存档 + 解读, 缺一不可。}}

**消融数据（原文转录）**
{{逐个消融表照实转录, 多张就分多张。}}

| 变体 / 设置 | {{指标1}} | {{指标2}} | {{...}} |
|---|---|---|---|
| **{{完整模型}}** | {{}} | {{}} | {{}} |
| {{去掉 X}} | {{}} | {{}} | {{}} |
| {{换成 Y}} | {{}} | {{}} | {{}} |

**消融解读**

| 消融对象 | 设计意图（验证什么） | 关键发现 |
|---|---|---|
| {{去掉 X}} | {{X 是否必要}} | {{掉了多少 / 说明 X 关键}} |
| {{}} | {{}} | {{}} |

### 附录补充 Appendix Highlights
{{附录里值得记的: 实现细节、关键超参、失败案例；附录里的**额外实验/消融表也照实
完整转录**（与正文同一标准, 数字不省）。没有则删本节。}}

---

## 4. 备注 Notes
- **亮点 / 启发**：{{对你研究有用的点}}
- **疑问 / 局限**：{{存疑处、未解决的问题、可能的改进}}
- **关联工作**：{{用 [[wikilink]] 链到 vault 里相关的笔记/方法}}

---
<!-- 阅读状态：你在 Obsidian 读完后勾上此框（保持为笔记的最后一行，别删）。PaperReader 据此把对应论文卡片标为「已读」。 -->
- [ ] ✅ 已读
````
