import os
import re
import random
import requests
import time
import json
import logging
from typing import Optional, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# DeepSeek API 配置
# 在 GitHub Actions 中，DEEPSEEK_API_KEY 应设置为 Secret
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_API_URL = " https://models.sjtu.edu.cn/api/v1/chat/completions"
MODEL_NAME = "deepseek-chat"


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


def call_llm_api(
    prompt: str,
    max_tokens: int = 5,
    max_retries: int = 4,
    base_delay: float = 2.0,
    timeout: int = 60,
) -> Optional[str]:
    """调用 OpenRouter API 并返回模型的响应，带重试和指数退避。

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

RATE_PROMPT_TEMPLATE = """
Do NOT include any thinking process, explanation, or analysis. Output ONLY the JSON object, nothing else.

# Role Setting
You are an experienced researcher in the field of Artificial Intelligence, skilled at quickly evaluating the potential value of research papers. You must be strict and discriminating in your relevance scoring.

# Task
Score this paper across multiple dimensions (1-10 points).

# My Research Interests (be strict about these)
My core interests are: **Robotics** and **Embodied AI**. Specifically:
- Robot manipulation, grasping, locomotion, navigation, planning
- Reinforcement learning / imitation learning **applied to robot control**
- Vision-Language-Action (VLA) models for robotic tasks
- Vision-Language-Navigation (VLN) for embodied agents
- World models for robot control, sim-to-real transfer
- Large Language Models / Vision-Language Models **applied to robotics or embodied agents**
- Safety, sim-to-real, multi-modal perception **in a robotics context**

# What is NOT highly relevant (should get low relevance_score, e.g. 1-3):
- Pure computer vision (detection, segmentation, generation) without robotic application
- Pure NLP / dialogue / text generation without embodied or robotic context
- Theoretical ML (optimization, generalization bounds) without robotics connection
- Autonomous driving (unless explicitly about general robot learning)
- Medical imaging, protein folding, drug discovery
- General LLM/VLM benchmarks, pretraining, or alignment without robotics use

# Paper
Title: %s
Abstract: %s

# Output Format
Return ONLY a JSON object (no extra text):
{
  "tldr": "<1-2 sentence English summary>",
  "tldr_zh": "<1-2 sentence Chinese summary>",
  "relevance_score": <1-10>,
  "novelty_claim_score": <1-10>,
  "clarity_score": <1-10>,
  "potential_impact_score": <1-10>,
  "overall_priority_score": <1-10>
}

# Scoring Guidelines
- Relevance (1-10): How directly related is it to my robotics/embodied AI interests above? Be strict: a pure vision or pure NLP paper should score 1-3 even if it uses fancy models. Only score 7+ if the paper explicitly involves robots, embodied agents, or physical control.
- Novelty (1-10): Degree of innovation claimed in the abstract.
- Clarity (1-10): Is the abstract easy to understand and complete?
- Potential Impact (1-10): Importance of the problem and potential application value.
- Overall Priority (1-10): Weighted combination — relevance should dominate. A paper with relevance 2 should never get overall_priority above 4, regardless of other scores.
"""


def filter_and_rate_papers(papers: list) -> list:
    """逐篇评分论文。保留所有论文，通过 overall_priority_score 排序区分优先级。

    Args:
        papers: 包含论文信息的字典列表，每个字典应包含 'title' 和 'summary'。

    Returns:
        评分后的论文列表（保留全部）。API 失败的论文标记 ai_processed=False。
    """
    if not DEEPSEEK_API_KEY:
        logging.error("未设置 DEEPSEEK_API_KEY 环境变量。无法进行评分。")
        return papers

    logging.info(f"开始逐篇评分 {len(papers)} 篇论文...")

    for i, paper in enumerate(papers):
        title = paper.get('title', 'N/A')
        summary = paper.get('summary', 'N/A')

        prompt = RATE_PROMPT_TEMPLATE % (title, summary)
        ai_response = call_llm_api(prompt, max_tokens=300)

        if ai_response is None:
            logging.warning(f"论文 {i+1}/{len(papers)}: '{title[:50]}...' API 调用失败 (ai_processed=False)")
            paper['ai_processed'] = False
            continue

        parsed = extract_json_from_response(ai_response)

        if parsed is None or not isinstance(parsed, dict):
            logging.warning(f"论文 {i+1}/{len(papers)}: '{title[:50]}...' JSON 解析失败 (ai_processed=False)。原始回复: {ai_response[:300]}")
            paper['ai_processed'] = False
            continue

        for key in ('tldr', 'tldr_zh', 'relevance_score', 'novelty_claim_score',
                    'clarity_score', 'potential_impact_score', 'overall_priority_score'):
            if key in parsed:
                paper[key] = parsed[key]
        paper['ai_processed'] = True
        logging.info(f"论文 {i+1}/{len(papers)}: '{title[:50]}...' - overall={paper.get('overall_priority_score', 'N/A')}")

    rated_count = sum(1 for p in papers if p.get('ai_processed'))
    logging.info(f"评分完成，成功 {rated_count}/{len(papers)} 篇。")
    return papers


def translate_summaries(
    papers: list,
    target_language: str = "中文",
    min_overall_score: float = 6.0,
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
                'summary': 'This paper presents a novel deep reinforcement learning approach for training robots to perform complex manipulation tasks using vision and proprioception.'
            },
            {
                'title': 'Vision-Language Models for Robot Navigation',
                'summary': 'We propose a vision-language model that enables robots to understand natural language instructions and navigate in complex environments.'
            },
            {
                'title': 'World Models for Sim-to-Real Transfer in Robotics',
                'summary': 'A novel approach to learning world models that enable effective sim-to-real transfer for robotic control policies.'
            },
            {
                'title': 'Advances in Pure NLP Tokenization',
                'summary': 'We present a new tokenization method for natural language processing that improves efficiency on text-only benchmarks.'
            },
        ]
        logging.info("\n--- 开始测试 filter_and_rate_papers ---")
        filtered = filter_and_rate_papers(test_papers)

        logging.info("\n--- 过滤和评分后的论文 ---")
        for paper in filtered:
            logging.info(
                f"- {paper['title']}\t"
                f"score={paper.get('overall_priority_score', 'N/A')}\t"
                f"ai_processed={paper.get('ai_processed', 'N/A')}"
            )
        logging.info("--- 测试结束 ---")
    else:
        logging.warning("请设置 DEEPSEEK_API_KEY 环境变量以运行测试。")
