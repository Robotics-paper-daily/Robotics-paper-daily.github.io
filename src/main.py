import os
import json
import time
import logging
import argparse
import tempfile
from datetime import date, datetime, timedelta

# 确保 src 目录在 Python 路径中，以便导入其他模块
# 这通常在运行脚本时自动处理，或者可以通过设置 PYTHONPATH
# 或者更好的方式是使用相对导入（如果结构允许）或将项目作为包安装
from scraper import fetch_cv_papers
from filter import (
    prefilter_papers_by_keywords,
    filter_and_rate_papers,
    translate_summaries,
)
from html_generator import generate_html_from_json
from config import TRANSLATION_MIN_SCORE
from search_index import generate_search_index

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# 定义项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 定义默认目录
DEFAULT_JSON_DIR = os.path.join(PROJECT_ROOT, 'daily_json')
DEFAULT_HTML_DIR = os.path.join(PROJECT_ROOT, 'daily_html')
DEFAULT_TEMPLATE_DIR = os.path.join(PROJECT_ROOT, 'templates')
DEFAULT_TEMPLATE_NAME = 'paper_template.html' # 确保此模板存在
DEFAULT_SEARCH_INDEX_DIR = os.path.join(PROJECT_ROOT, 'search_index')

# 设定最早抓取日期（上限日期），早于此日期的文章将不会自动抓取
EARLIEST_DATE = date(2026, 1, 1)  # 可以根据需要修改这个日期


def find_missing_dates(json_dir: str, earliest: date, latest: date) -> list:
    """扫描 json_dir，返回 earliest 到 latest 之间缺失 JSON 文件的日期列表。"""
    existing = set()
    if os.path.isdir(json_dir):
        for f in os.listdir(json_dir):
            if f.endswith('.json'):
                try:
                    existing.add(datetime.strptime(f.replace('.json', ''), '%Y-%m-%d').date())
                except ValueError:
                    continue
    missing = []
    current = earliest
    while current <= latest:
        if current not in existing:
            missing.append(current)
        current += timedelta(days=1)
    return missing


def _load_report(json_filepath: str) -> list[dict]:
    with open(json_filepath, 'r', encoding='utf-8') as f:
        papers = json.load(f)
    if not isinstance(papers, list) or not all(isinstance(paper, dict) for paper in papers):
        raise ValueError(f"日报 JSON 必须是论文对象数组: {json_filepath}")
    return papers


def report_needs_ai_repair(json_filepath: str) -> bool:
    """Return True when a report selected papers but rated none of them."""
    if not os.path.exists(json_filepath):
        return False
    try:
        papers = _load_report(json_filepath)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        logging.error("无法验证已有日报 %s: %s", json_filepath, e)
        return True

    selected = [paper for paper in papers if paper.get('stage1_selected') is True]
    return bool(selected) and not any(
        paper.get('ai_processed') is True
        and 'overall_priority_score' in paper
        for paper in selected
    )


def find_failed_ai_dates(json_dir: str, earliest: date, latest: date) -> list:
    """Find existing reports whose entire Stage-2 rating phase failed."""
    failed = []
    current = earliest
    while current <= latest:
        filepath = os.path.join(json_dir, f"{current.isoformat()}.json")
        if report_needs_ai_repair(filepath):
            failed.append(current)
        current += timedelta(days=1)
    return failed


def _safe_score(paper: dict) -> float:
    try:
        value = paper.get("overall_priority_score", 0)
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _rate_and_combine(stage1_selected_papers: list, stage1_rejected_papers: list) -> list:
    if stage1_selected_papers:
        scored_selected_papers = filter_and_rate_papers(stage1_selected_papers)
    else:
        logging.warning("一级预筛后没有论文通过，本次将跳过打分与翻译。")
        scored_selected_papers = []

    logging.info(
        f"步骤 2.2: 翻译论文摘要为中文（仅 overall_priority_score >= {TRANSLATION_MIN_SCORE}）..."
    )
    scored_selected_papers = translate_summaries(
        scored_selected_papers,
        target_language="中文",
        min_overall_score=TRANSLATION_MIN_SCORE,
    )

    scored_selected_papers.sort(key=_safe_score, reverse=True)
    stage1_rejected_papers.sort(key=lambda x: x.get("title", ""))
    filtered_papers = scored_selected_papers + stage1_rejected_papers
    logging.info(
        "多级过滤完成：一级通过 %s 篇（进入打分），一级未通过 %s 篇（不打分，总计输出 %s 篇）。",
        len(scored_selected_papers),
        len(stage1_rejected_papers),
        len(filtered_papers),
    )
    return filtered_papers


def _repair_failed_ai_report(json_filepath: str) -> list:
    papers = _load_report(json_filepath)
    selected = [paper for paper in papers if paper.get('stage1_selected') is True]
    rejected = [paper for paper in papers if paper.get('stage1_selected') is not True]
    if not selected:
        raise ValueError(f"日报没有可重新评分的一级筛选论文: {json_filepath}")

    generated_fields = (
        'tldr', 'tldr_zh', 'topic', 'keywords', 'relevance_score',
        'novelty_claim_score', 'clarity_score', 'potential_impact_score',
        'overall_priority_score', 'summary_zh',
    )
    for paper in selected:
        for field in generated_fields:
            paper.pop(field, None)
        paper['ai_processed'] = False

    logging.info("复用已有抓取与一级筛选结果，重新评分 %s 篇论文。", len(selected))
    return _rate_and_combine(selected, rejected)


def _write_json_atomic(filepath: str, payload) -> None:
    output_dir = os.path.dirname(filepath) or '.'
    os.makedirs(output_dir, exist_ok=True)
    temp_filepath = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w',
            encoding='utf-8',
            dir=output_dir,
            prefix=f".{os.path.basename(filepath)}.",
            suffix='.tmp',
            delete=False,
        ) as f:
            temp_filepath = f.name
            json.dump(payload, f, indent=4, ensure_ascii=False)
        os.replace(temp_filepath, filepath)
    finally:
        if temp_filepath and os.path.exists(temp_filepath):
            os.remove(temp_filepath)


def _write_report(json_filepath: str, papers: list) -> None:
    for paper in papers:
        if isinstance(paper.get('published_date'), datetime):
            paper['published_date'] = paper['published_date'].isoformat()
        if isinstance(paper.get('updated_date'), datetime):
            paper['updated_date'] = paper['updated_date'].isoformat()
    _write_json_atomic(json_filepath, papers)


def main(target_date: date):
    """主执行流程：抓取、过滤、保存、生成HTML。"""
    logging.info(f"开始处理日期: {target_date.isoformat()}")

    # --- 确定 JSON 文件路径 ---
    json_filename = f"{target_date.isoformat()}.json"
    json_filepath = os.path.join(DEFAULT_JSON_DIR, json_filename)
    logging.info(f"目标 JSON 文件路径: {json_filepath}")

    # --- 检查 JSON 文件是否存在且 AI 阶段完整 ---
    needs_ai_repair = report_needs_ai_repair(json_filepath)
    if os.path.exists(json_filepath) and not needs_ai_repair:
        logging.info(f"找到已存在的 JSON 文件: {json_filepath}。跳过抓取和过滤步骤。")
        # 不需要加载数据，generate_html_from_json 会直接读取文件
    else:
        if needs_ai_repair:
            logging.warning("已有日报的 AI 评分为 0/N，开始修复: %s", json_filepath)
            filtered_papers = _repair_failed_ai_report(json_filepath)
        else:
            logging.info(f"未找到 JSON 文件: {json_filepath}。执行抓取和过滤。")
            # --- 1. 抓取论文 --- #
            logging.info("步骤 1: 抓取 ArXiv 机器人学相关论文 (cs.RO, cs.AI, cs.CV, cs.LG)...")
            categories = ['cs.RO', 'cs.AI', 'cs.CV', 'cs.LG']
            raw_papers = []
            seen_urls = set()

            for category in categories:
                logging.info(f"正在抓取 {category} 类别的论文...")
                papers = fetch_cv_papers(category=category, specified_date=target_date)
                for paper in papers:
                    if paper.get('url') not in seen_urls:
                        raw_papers.append(paper)
                        seen_urls.add(paper.get('url'))
                logging.info(f"{category} 类别抓取到 {len(papers)} 篇论文，去重后当前总计 {len(raw_papers)} 篇。")
                if category != categories[-1]:
                    time.sleep(30)

            if not raw_papers:
                logging.info(
                    "%s 的四个 arXiv 查询均成功但没有论文，将生成空日报。",
                    target_date.isoformat(),
                )
            else:
                logging.info(f"总共抓取到 {len(raw_papers)} 篇原始论文（已去重）。")

            # --- 2. 多级过滤：一级关键词预筛 + 二级 AI 打分 --- #
            logging.info("步骤 2: 一级关键词预筛（不调用 LLM）...")
            stage1_selected_papers, stage1_rejected_papers = prefilter_papers_by_keywords(raw_papers)
            logging.info("步骤 2.1: 对一级预筛通过的论文执行 AI 打分...")
            filtered_papers = _rate_and_combine(
                stage1_selected_papers,
                stage1_rejected_papers,
            )

        # --- 3. 保存为 JSON --- #
        logging.info("步骤 3: 将过滤后的论文保存为 JSON 文件...")
        _write_report(json_filepath, filtered_papers)
        logging.info(f"过滤后的论文已保存到: {json_filepath}")

    # --- 4. 生成 HTML (无论 JSON 是新建还是已存在) --- #
    logging.info("步骤 4: 从 JSON 文件生成 HTML 报告...")
    # 再次检查 JSON 文件是否实际存在（以防万一）
    if not os.path.exists(json_filepath):
        raise FileNotFoundError(f"无法找到 JSON 文件 '{json_filepath}' 来生成 HTML。")

    generate_html_from_json(
        json_file_path=json_filepath,
        template_dir=DEFAULT_TEMPLATE_DIR,
        template_name=DEFAULT_TEMPLATE_NAME,
        output_dir=DEFAULT_HTML_DIR
    )
    expected_html = os.path.join(
        DEFAULT_HTML_DIR,
        f"{target_date.strftime('%Y_%m_%d')}.html",
    )
    if not os.path.isfile(expected_html):
        raise RuntimeError(f"HTML 生成器未创建预期报告: {expected_html}")
    logging.info(f"HTML 报告已生成在: {DEFAULT_HTML_DIR}")

    # --- 5. 更新 reports.json --- #
    logging.info("步骤 5: 更新根目录下的 reports.json 文件...")
    if not os.path.isdir(DEFAULT_HTML_DIR):
        raise RuntimeError(f"HTML 目录不存在: {DEFAULT_HTML_DIR}")
    html_files = [f for f in os.listdir(DEFAULT_HTML_DIR) if f.endswith('.html')]
    html_files.sort(reverse=True)
    reports_json_path = os.path.join(PROJECT_ROOT, 'reports.json')
    _write_json_atomic(reports_json_path, html_files)
    logging.info(f"reports.json 已更新，包含 {len(html_files)} 个报告。")

    logging.info(f"日期 {target_date.isoformat()} 的处理流程完成。")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='抓取、过滤并生成 arXiv 机器人学相关论文的每日报告。')
    parser.add_argument(
        '--date',
        type=str,
        help='指定基准日期 (YYYY-MM-DD)，将处理该日期前一天的文章。如果未指定，使用今天的日期作为基准。'
    )
    parser.add_argument(
        '--backfill',
        action='store_true',
        help='自动补全缺失日期，并修复 AI 评分全量失败的日报。'
    )
    parser.add_argument(
        '--backfill-limit',
        type=int,
        default=5,
        help='单次 backfill 最多补全的天数（默认 5），避免运行时间过长或触发限流。'
    )

    args = parser.parse_args()

    # 确保模板目录和文件存在，否则 HTML 生成会失败
    if not os.path.exists(DEFAULT_TEMPLATE_DIR) or not os.path.exists(os.path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_TEMPLATE_NAME)):
        logging.warning(f"模板目录 '{DEFAULT_TEMPLATE_DIR}' 或模板文件 '{DEFAULT_TEMPLATE_NAME}' 不存在。HTML 生成可能会失败。")

    # 确定基准日期
    if args.date:
        try:
            base_date = datetime.strptime(args.date, '%Y-%m-%d').date()
            logging.info(f"使用用户指定的基准日期: {base_date.isoformat()}")
        except ValueError:
            logging.error("日期格式无效，请使用 YYYY-MM-DD 格式。退出程序。")
            exit(1)
    else:
        base_date = date.today()
        logging.info(f"未指定日期，使用今天的日期作为基准: {base_date.isoformat()}")

    # 计算目标日期：基准日期的一天前
    target_date = base_date - timedelta(days=1)
    logging.info(f"将处理前一天的文章，目标日期: {target_date.isoformat()}")

    # 检查目标日期是否早于最早日期限制
    if target_date < EARLIEST_DATE:
        logging.warning(f"目标日期 {target_date.isoformat()} 早于设定的最早日期 {EARLIEST_DATE.isoformat()}，跳过抓取。")
        logging.info("如需抓取更早的日期，请修改 main.py 中的 EARLIEST_DATE 配置，或使用 --date 参数手动指定日期。")
        if not args.backfill:
            exit(0)
    else:
        # 先处理当天的目标日期
        main(target_date=target_date)

    # --- Backfill 模式：补全缺失日期 ---
    if args.backfill:
        latest_date = target_date if target_date >= EARLIEST_DATE else date.today() - timedelta(days=2)
        missing = find_missing_dates(DEFAULT_JSON_DIR, EARLIEST_DATE, latest_date)
        failed_ai = find_failed_ai_dates(DEFAULT_JSON_DIR, EARLIEST_DATE, latest_date)
        pending = sorted(set(missing + failed_ai))
        if not pending:
            logging.info("没有缺失或 AI 评分全失败的日期，无需补全。")
        else:
            limit = args.backfill_limit
            to_process = pending[:limit]
            logging.info(
                "发现 %s 个待处理日期（缺失 %s，AI 评分全失败 %s），本次处理 %s 个: %s",
                len(pending),
                len(missing),
                len(failed_ai),
                len(to_process),
                [d.isoformat() for d in to_process],
            )
            for i, d in enumerate(to_process):
                logging.info(f"--- Backfill [{i+1}/{len(to_process)}]: {d.isoformat()} ---")
                main(target_date=d)
                # 日期之间等待，避免限流
                if i < len(to_process) - 1:
                    logging.info("等待 30 秒后继续下一个日期...")
                    time.sleep(30)
            remaining = len(pending) - len(to_process)
            if remaining > 0:
                logging.info(f"还有 {remaining} 个待处理日期，下次运行 --backfill 将继续补全。")

    # --- 生成搜索索引 ---
    logging.info("生成分片搜索索引 search_index/（并更新旧客户端兼容索引）...")
    generate_search_index(
        DEFAULT_JSON_DIR,
        DEFAULT_SEARCH_INDEX_DIR,
        os.path.join(PROJECT_ROOT, 'search_index.json'),
    )
