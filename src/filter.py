import os
import re
import random
import requests
import time
import json
import logging
from typing import Optional, Any

from config import (
    TIER0_KEYWORDS, TIER0_TOKENS,
    TIER1_KEYWORDS, TIER1_TOKENS,
    TIER2_KEYWORDS, TIER2_TOKENS,
    TIER3_KEYWORDS, TIER3_TOKENS,
    TIER0_WEIGHT, TIER1_WEIGHT, TIER2_WEIGHT, TIER3_WEIGHT,
    TIER0_CAP, TIER1_CAP, TIER2_CAP,
    TITLE_MULTIPLIER, CATEGORY_BONUS,
    STAGE1_PASS_THRESHOLD,
    TOPICS,
    TRANSLATION_MIN_SCORE,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# DeepSeek API configuration. The default sends the key only to DeepSeek's
# official API. Self-hosters may deliberately choose another OpenAI-compatible
# endpoint, but must opt in with DEEPSEEK_API_BASE and trust that operator with
# both the key and paper prompts.
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_API_BASE = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_API_URL = f"{DEEPSEEK_API_BASE}/chat/completions"
MODEL_NAME = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")


# ============================================================================
# Stage 1 — keyword prefilter
# ============================================================================
# Score-based: each tier contributes weighted hits (capped per tier), with
# title hits doubled. Tier 3 forces hard rejection. cs.RO / cs.AI add a
# category bonus.

# Collapse runs of whitespace, hyphens, and underscores into a single space so
# "sim-to-real", "sim_to_real", and "sim to real" all match the same pattern.
_NORMALIZE_RE = re.compile(r"[_\-\s]+")


def _normalize(text: str) -> str:
    if not text:
        return ""
    return _NORMALIZE_RE.sub(" ", text.lower()).strip()


def _phrase_to_pattern(norm: str) -> str:
    """Normalized keyword phrase → regex with light plural tolerance.

    - Words ending in consonant + ``y`` allow ``y`` or ``ies``
      (``policy`` → ``policy`` / ``policies``).
    - Words ending in ``s``, ``x``, ``z``, ``ch``, ``sh`` allow optional ``es``.
    - Everything else allows an optional trailing ``s``.

    Tokens (single words like ``vla``, ``slam``) keep strict matching to avoid
    false positives on look-alike words.
    """
    if len(norm) >= 2 and norm[-1] == "y" and norm[-2] not in "aeiou":
        stem = norm[:-1]
        return rf"\b{re.escape(stem)}(?:y|ies)\b"
    if norm.endswith(("s", "x", "z", "ch", "sh")):
        return rf"\b{re.escape(norm)}(?:es)?\b"
    return rf"\b{re.escape(norm)}s?\b"


def _build_pattern(keywords: tuple[str, ...], tokens: tuple[str, ...]) -> Optional[re.Pattern]:
    """Build a single combined regex matching any keyword or token.

    Multi-word phrases are normalized (so spacing/hyphenation is flexible) and
    given light plural tolerance via :func:`_phrase_to_pattern`. Tokens are
    matched strictly with ``\\b...\\b`` to avoid substring collisions like
    ``slam`` matching ``Islam``. Longer alternatives are listed first so that
    ``world action model`` wins over ``world model`` at the same position.
    """
    parts: list[str] = []
    for kw in keywords:
        norm = _normalize(kw)
        if norm:
            parts.append(_phrase_to_pattern(norm))
    for tok in tokens:
        norm = _normalize(tok)
        if norm:
            parts.append(rf"\b{re.escape(norm)}\b")
    if not parts:
        return None
    parts.sort(key=len, reverse=True)
    return re.compile("|".join(parts))


_TIER0_PATTERN = _build_pattern(TIER0_KEYWORDS, TIER0_TOKENS)
_TIER1_PATTERN = _build_pattern(TIER1_KEYWORDS, TIER1_TOKENS)
_TIER2_PATTERN = _build_pattern(TIER2_KEYWORDS, TIER2_TOKENS)
_TIER3_PATTERN = _build_pattern(TIER3_KEYWORDS, TIER3_TOKENS)


def _find_hits(pattern: Optional[re.Pattern], text: str) -> list[str]:
    if pattern is None or not text:
        return []
    return pattern.findall(text)


def _tier_subscore(title_hits: list[str], summary_hits: list[str], weight: int, cap: int) -> int:
    raw = (len(title_hits) * TITLE_MULTIPLIER + len(summary_hits)) * weight
    return int(min(raw, cap))


def compute_stage1_score(paper: dict) -> tuple[int, list[str], dict, bool]:
    """Score a single paper against the four keyword tiers + category bonuses.

    Returns ``(total_score, hit_terms, breakdown, has_tier3_hit)``.
    """
    title_norm = _normalize(paper.get("title", ""))
    summary_norm = _normalize(paper.get("summary", ""))
    categories = [str(c).lower() for c in paper.get("categories", [])]

    t0_title = _find_hits(_TIER0_PATTERN, title_norm)
    t0_sum = _find_hits(_TIER0_PATTERN, summary_norm)
    t1_title = _find_hits(_TIER1_PATTERN, title_norm)
    t1_sum = _find_hits(_TIER1_PATTERN, summary_norm)
    t2_title = _find_hits(_TIER2_PATTERN, title_norm)
    t2_sum = _find_hits(_TIER2_PATTERN, summary_norm)
    t3_hits = _find_hits(_TIER3_PATTERN, title_norm) + _find_hits(_TIER3_PATTERN, summary_norm)

    t0 = _tier_subscore(t0_title, t0_sum, TIER0_WEIGHT, TIER0_CAP)
    t1 = _tier_subscore(t1_title, t1_sum, TIER1_WEIGHT, TIER1_CAP)
    t2 = _tier_subscore(t2_title, t2_sum, TIER2_WEIGHT, TIER2_CAP)
    t3 = TIER3_WEIGHT * len(t3_hits) if t3_hits else 0
    cat_bonus = sum(CATEGORY_BONUS.get(cat, 0) for cat in categories)

    total = t0 + t1 + t2 + t3 + cat_bonus

    breakdown = {
        "tier0": t0,
        "tier1": t1,
        "tier2": t2,
        "tier3": t3,
        "category": cat_bonus,
    }

    hits_seen = set(t0_title + t0_sum + t1_title + t1_sum + t2_title + t2_sum + t3_hits)
    return total, sorted(hits_seen), breakdown, bool(t3_hits)


def prefilter_papers_by_keywords(papers: list) -> tuple[list, list]:
    """Stage-1 prefilter: keep papers with stage1 score >= threshold and no Tier-3 hits."""
    selected: list = []
    rejected: list = []

    for paper in papers:
        score, hits, breakdown, has_tier3 = compute_stage1_score(paper)
        paper["stage1_score"] = score
        paper["stage1_match_terms"] = hits[:15]
        paper["stage1_breakdown"] = breakdown

        if has_tier3:
            paper["stage1_selected"] = False
            paper["selected"] = False
            paper["stage1_reason"] = f"tier3 exclude hit: {hits[:5]}"
            paper["ai_processed"] = False
            rejected.append(paper)
        elif score >= STAGE1_PASS_THRESHOLD:
            paper["stage1_selected"] = True
            paper["selected"] = True
            paper["stage1_reason"] = (
                f"score={score} (t0={breakdown['tier0']}, t1={breakdown['tier1']}, "
                f"t2={breakdown['tier2']}, cat={breakdown['category']})"
            )
            selected.append(paper)
        else:
            paper["stage1_selected"] = False
            paper["selected"] = False
            paper["stage1_reason"] = f"score={score} below threshold {STAGE1_PASS_THRESHOLD}"
            paper["ai_processed"] = False
            rejected.append(paper)

    logging.info(
        "一级预筛完成：通过 %s 篇，未通过 %s 篇（含 tier3 拒）（总计 %s 篇）。",
        len(selected),
        len(rejected),
        len(papers),
    )
    return selected, rejected


# ============================================================================
# Response parsing helpers
# ============================================================================

def extract_json_from_response(text: str) -> Optional[Any]:
    """从 LLM 回复中提取 JSON 对象或数组。

    按优先级尝试三种策略：
    1. 直接解析整个文本
    2. 提取 ```json ... ``` 或 ``` ... ``` 代码块
    3. 查找最外层的 {...} 或 [...]
    """
    if not text or not text.strip():
        return None

    # 去掉思维链模型的 <think>...</think> 块
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

    if not text:
        return None

    # 策略 1：直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 策略 2：提取代码块
    fence_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', text, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 策略 3：查找最外层 { } 或 [ ]
    for open_char, close_char in [('{', '}'), ('[', ']')]:
        start = text.find(open_char)
        end = text.rfind(close_char)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass

    return None


def clean_translation(text: str) -> str:
    """清理翻译结果中可能的代码块标记、思维链和多余引号。"""
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
    if text.startswith('```'):
        parts = text.split('```')
        # 取代码块内容（跳过可能的语言标记行）
        if len(parts) >= 2:
            content = parts[1]
            if content.startswith(('text', 'markdown')):
                content = content.split('\n', 1)[1] if '\n' in content else content
            text = content
    text = text.strip('"').strip("'").strip()
    return text


# ============================================================================
# LLM API call with retries
# ============================================================================

def call_llm_api(
    prompt: str,
    max_tokens: int = 5,
    max_retries: int = 4,
    base_delay: float = 2.0,
    timeout: int = 60,
) -> Optional[str]:
    """调用 LLM API 并返回模型的响应，带重试和指数退避。

    Args:
        prompt (str): 发送给模型的提示。
        max_tokens (int): 限制模型响应的最大 token 数。
        max_retries (int): 最大重试次数（不含首次请求）。
        base_delay (float): 退避基础延迟秒数。
        timeout (int): 单次请求超时秒数。

    Returns:
        Optional[str]: 模型的响应文本，如果发生错误则返回 None。
    """
    if not DEEPSEEK_API_KEY:
        logging.error("未设置 DEEPSEEK_API_KEY 环境变量。无法调用 API。")
        return None

    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }

    data = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": max_tokens,
    }

    for attempt in range(max_retries + 1):
        try:
            response = requests.post(
                DEEPSEEK_API_URL, headers=headers, json=data, timeout=timeout
            )
            response.raise_for_status()

            result = response.json()
            ai_response = result['choices'][0]['message']['content'].strip()
            return ai_response

        except requests.exceptions.Timeout:
            logging.warning(f"API 请求超时 (尝试 {attempt + 1}/{max_retries + 1})")
        except requests.exceptions.ConnectionError:
            logging.warning(f"API 连接错误 (尝试 {attempt + 1}/{max_retries + 1})")
        except requests.exceptions.HTTPError as e:
            status_code = e.response.status_code if e.response is not None else 0
            if status_code == 429 or status_code >= 500:
                logging.warning(
                    f"API 返回 {status_code} (尝试 {attempt + 1}/{max_retries + 1})"
                )
            else:
                # 4xx 客户端错误（非 429）不重试
                logging.error(f"API 客户端错误 {status_code}，不重试: {e}")
                return None
        except (KeyError, IndexError) as e:
            logging.error(f"解析 API 响应结构出错: {e}")
            return None
        except Exception as e:
            logging.error(f"调用 API 时发生意外错误: {e}", exc_info=True)
            return None

        # 指数退避 + 随机抖动
        if attempt < max_retries:
            delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
            logging.info(f"等待 {delay:.1f}s 后重试...")
            time.sleep(delay)

    logging.error(f"API 调用在 {max_retries + 1} 次尝试后仍然失败。")
    return None


# ============================================================================
# Stage 2 — LLM rating prompt
# ============================================================================

RATE_PROMPT_TEMPLATE = """Do NOT include any thinking process, explanation, or analysis. Output ONLY the JSON object, nothing else.

# Role
You are an experienced AI researcher specialized in robotics, embodied AI, and autonomous driving. You evaluate papers strictly against the interests below.

# Core Research Interests (4 main lines)
1. **Vision-Language-Action (VLA) models** — generalist robot policies, robot foundation models, VLA pretraining or fine-tuning, manipulation/navigation policies driven by VLM/LLM.
2. **World Models / World Action Models** — generative or predictive world models for control, video world models, action-conditioned world models, sim-to-real via world models.
3. **Autonomous Driving** — end-to-end driving, driving foundation models, driving with LLM/VLM, closed-loop driving simulation, BEV/occupancy/trajectory prediction used in a driving stack.
4. **Embodied Intelligence** — manipulation (dexterous/bimanual/mobile), locomotion, humanoid/legged robots, navigation including VLN, embodied agents in 3D environments, sim-to-real transfer.

# What is NOT relevant (relevance_score 1-3)
- Pure 2D vision (segmentation, detection, generation) without robotic or driving application
- Pure NLP (translation, summarization, dialogue) without embodied or robotic use
- Generic LLM benchmarks, pretraining, or alignment with no robotic/driving angle
- Theoretical ML (optimization, generalization bounds) without a clear robotic connection
- Medical imaging, protein structure, drug discovery, genomics

# Paper to evaluate
Title: %s
Abstract: %s

# Output (JSON object only — no markdown, no extra text)
{
  "tldr": "<1-2 sentence English summary of the contribution>",
  "tldr_zh": "<1-2 sentence Chinese summary>",
  "topic": "<one of: VLA | WorldModel | AutonomousDriving | VLN | Manipulation | Locomotion | HumanoidEmbodied | RLRobot | Perception3D | Other>",
  "keywords": ["<3-5 short technical keywords>"],
  "relevance_score": <1-10 integer>,
  "novelty_claim_score": <1-10 integer>,
  "clarity_score": <1-10 integer>,
  "potential_impact_score": <1-10 integer>,
  "overall_priority_score": <1-10 integer>
}

# Scoring rules
- relevance_score:
    8-10 if the paper directly contributes to one of the 4 main lines above (uses real robots, embodied agents, or driving stacks).
    5-7 if related but tangential (e.g. a vision method that explicitly targets robotic perception).
    1-3 if there is no clear robotic / driving / embodied connection.
- overall_priority_score is dominated by relevance:
    relevance <= 3 forces overall <= 4.
    relevance >= 8 typically yields overall >= 6.
- topic: pick the single best fit from the enumeration. Use "Other" only if none clearly applies.
- keywords: short technical phrases lifted from the abstract (no full sentences).

# Calibration examples
Example A — high relevance:
  Title: "RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control"
  Abstract: "We present RT-2, a vision-language-action (VLA) model that co-fine-tunes on web data and robot trajectories to produce a generalist manipulation policy that can be deployed on real robots..."
  Output keys: {"topic": "VLA", "relevance_score": 10, "overall_priority_score": 10, ...}

Example B — low relevance:
  Title: "Improved BPE Tokenization for Multilingual Translation"
  Abstract: "We propose a new byte-pair-encoding tokenizer that improves multilingual translation BLEU on 50 languages..."
  Output keys: {"topic": "Other", "relevance_score": 1, "overall_priority_score": 2, ...}
"""


def _coerce_int(value: Any, default: int = 0) -> int:
    """Force a value into an integer, falling back to ``default`` on garbage input."""
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value.strip()))
        except (TypeError, ValueError):
            return default
    return default


def _coerce_topic(value: Any) -> str:
    if not isinstance(value, str):
        return "Other"
    candidate = value.strip()
    if candidate in TOPICS:
        return candidate
    # case-insensitive match against known topics
    lower_map = {t.lower(): t for t in TOPICS}
    return lower_map.get(candidate.lower(), "Other")


def _coerce_keywords(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(k).strip() for k in value if str(k).strip()][:5]
    if isinstance(value, str):
        # comma-separated fallback
        return [k.strip() for k in value.split(",") if k.strip()][:5]
    return []


def filter_and_rate_papers(papers: list) -> list:
    """Stage 2: send each (Stage-1-passing) paper to the LLM for full scoring.

    Adds tldr / tldr_zh / topic / keywords / 5 score fields. Papers that fail
    to parse are marked ``ai_processed=False`` and kept for downstream display.
    """
    if not DEEPSEEK_API_KEY:
        logging.error("未设置 DEEPSEEK_API_KEY 环境变量。无法进行评分。")
        return papers

    logging.info(f"开始逐篇评分 {len(papers)} 篇论文...")

    for i, paper in enumerate(papers):
        title = paper.get('title', 'N/A')
        summary = paper.get('summary', 'N/A')

        prompt = RATE_PROMPT_TEMPLATE % (title, summary)
        ai_response = call_llm_api(prompt, max_tokens=400)

        if ai_response is None:
            logging.warning(f"论文 {i+1}/{len(papers)}: '{title[:50]}...' API 调用失败 (ai_processed=False)")
            paper['ai_processed'] = False
            continue

        parsed = extract_json_from_response(ai_response)

        if parsed is None or not isinstance(parsed, dict):
            logging.warning(f"论文 {i+1}/{len(papers)}: '{title[:50]}...' JSON 解析失败 (ai_processed=False)。原始回复: {ai_response[:300]}")
            paper['ai_processed'] = False
            continue

        # String fields
        for key in ('tldr', 'tldr_zh'):
            if key in parsed and isinstance(parsed[key], str):
                paper[key] = parsed[key].strip()

        # Topic enum + keyword list with validation
        paper['topic'] = _coerce_topic(parsed.get('topic'))
        paper['keywords'] = _coerce_keywords(parsed.get('keywords'))

        # Score fields, coerced to ints
        for key in ('relevance_score', 'novelty_claim_score', 'clarity_score',
                    'potential_impact_score', 'overall_priority_score'):
            if key in parsed:
                paper[key] = _coerce_int(parsed[key], default=0)

        paper['ai_processed'] = True
        logging.info(
            f"论文 {i+1}/{len(papers)}: '{title[:50]}...' "
            f"-> topic={paper.get('topic')}, overall={paper.get('overall_priority_score', 'N/A')}"
        )

    rated_count = sum(1 for p in papers if p.get('ai_processed'))
    logging.info(f"评分完成，成功 {rated_count}/{len(papers)} 篇。")
    return papers


# ============================================================================
# Stage 2.1 — translation (only for high-priority papers)
# ============================================================================

def translate_summaries(
    papers: list,
    target_language: str = "中文",
    min_overall_score: float = TRANSLATION_MIN_SCORE,
) -> list:
    """逐篇翻译论文摘要。仅翻译 overall_priority_score 达到阈值的论文。

    Args:
        papers: 包含论文信息的字典列表，每个字典应包含 'summary'。
        target_language: 目标语言，默认为"中文"。
        min_overall_score: 仅翻译 overall_priority_score >= 该值的论文。

    Returns:
        包含翻译摘要的字典列表，成功的论文包含 'summary_zh' 字段。
    """
    if not DEEPSEEK_API_KEY:
        logging.error("未设置 DEEPSEEK_API_KEY 环境变量。无法进行翻译。")
        return papers

    logging.info(
        f"开始翻译摘要（目标语言: {target_language}，仅 overall_priority_score >= {min_overall_score}）..."
    )

    eligible_count = 0
    translated_count = 0
    for i, paper in enumerate(papers):
        overall_score = paper.get('overall_priority_score')
        try:
            overall_score = float(overall_score) if overall_score is not None else None
        except (TypeError, ValueError):
            overall_score = None

        if overall_score is None or overall_score < min_overall_score:
            continue

        eligible_count += 1
        summary = paper.get('summary', '')
        if not summary or summary == 'N/A':
            continue

        translate_prompt = (
            f"请将以下英文论文摘要翻译成{target_language}。"
            "要求：保持专业术语的准确性，翻译流畅自然，保留原文的技术含义。"
            "只输出翻译结果，不要添加任何思考过程、解释或说明。"
            f"\n\n摘要：\n{summary}"
        )

        translated = call_llm_api(translate_prompt, max_tokens=500)

        if translated and translated.strip():
            paper['summary_zh'] = clean_translation(translated)
            translated_count += 1
            logging.info(f"论文 {i+1}/{len(papers)}: 摘要翻译完成")
        else:
            logging.warning(f"论文 {i+1}/{len(papers)}: 翻译失败，保留原文。")

    logging.info(
        f"摘要翻译完成，成功 {translated_count}/{eligible_count} 篇（符合阈值），总论文数 {len(papers)}。"
    )
    return papers


if __name__ == '__main__':
    if DEEPSEEK_API_KEY:
        test_papers = [
            {
                'title': 'Deep Reinforcement Learning for Robotic Manipulation',
                'summary': 'This paper presents a novel deep reinforcement learning approach for training robots to perform complex manipulation tasks using vision and proprioception.',
                'categories': ['cs.RO'],
            },
            {
                'title': 'Vision-Language-Action Models for Generalist Robot Policies',
                'summary': 'We propose a vision-language-action model that enables generalist manipulation across diverse tasks.',
                'categories': ['cs.RO', 'cs.LG'],
            },
            {
                'title': 'World Models for Sim-to-Real Transfer in Autonomous Driving',
                'summary': 'A novel world action model approach for closed-loop driving simulation and policy learning.',
                'categories': ['cs.LG'],
            },
            {
                'title': 'Advances in Pure NLP Tokenization',
                'summary': 'We present a new tokenization method for natural language processing that improves efficiency on text-only benchmarks via machine translation.',
                'categories': ['cs.CL'],
            },
        ]

        logging.info("\n--- 测试 Stage 1 prefilter ---")
        selected, rejected = prefilter_papers_by_keywords(test_papers)
        for p in selected + rejected:
            logging.info(
                f"  {p['title'][:50]}... -> score={p['stage1_score']}, "
                f"selected={p['stage1_selected']}, hits={p.get('stage1_match_terms')}"
            )

        logging.info("\n--- 测试 Stage 2 LLM rating ---")
        rated = filter_and_rate_papers(selected)
        for p in rated:
            logging.info(
                f"  {p['title'][:50]}... -> topic={p.get('topic')}, "
                f"overall={p.get('overall_priority_score')}, ai_processed={p.get('ai_processed')}"
            )
        logging.info("--- 测试结束 ---")
    else:
        logging.warning("请设置 DEEPSEEK_API_KEY 环境变量以运行测试。")
