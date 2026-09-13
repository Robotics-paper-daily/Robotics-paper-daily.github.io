import os
import json
import time
import logging
import argparse
import tempfile
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

# 确保 src 目录在 Python 路径中，以便导入其他模块
# 这通常在运行脚本时自动处理，或者可以通过设置 PYTHONPATH
# 或者更好的方式是使用相对导入（如果结构允许）或将项目作为包安装
from scraper import ArxivDeferred, build_query, fetch_cv_papers
from fetch_state import FetchState
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


def _report_paths(day):
    return [
        os.path.join(DEFAULT_JSON_DIR, f'{day.isoformat()}.json'),
        os.path.join(DEFAULT_HTML_DIR, f'{day:%Y_%m_%d}.html'),
        os.path.join(PROJECT_ROOT, 'reports.json'),
    ]


def _capture_files(paths):
    originals = {}
    for path in paths:
        if os.path.exists(path):
            with open(path, 'rb') as stream:
                originals[path] = stream.read()
        else:
            originals[path] = None
    return originals


def _restore_files(originals):
    for path, content in originals.items():
        if content is None:
            if os.path.exists(path):
                os.unlink(path)
        else:
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=os.path.dirname(path), delete=False) as stream:
                    temporary = stream.name
                    stream.write(content)
                os.replace(temporary, path)
            finally:
                if temporary and os.path.exists(temporary):
                    os.unlink(temporary)


@contextmanager
def _rollback_files_on_error(paths):
    originals = _capture_files(paths)
    try:
        yield
    except Exception:
        _restore_files(originals)
        raise


def _fetch_category(target_date: date, category: str, state: FetchState) -> list:
    query = build_query(category, target_date)
    cached = state.load_snapshot(target_date, category, query)
    if cached is not None:
        logging.info("复用完整抓取快照：%s / %s，%s 篇。", target_date, category, len(cached))
        return cached

    cooldown = state.cooldown()
    if cooldown:
        retry_at = datetime.fromisoformat(cooldown['next_retry_at'])
        state.defer(target_date, category, retry_at, cooldown['reason'])
        raise ArxivDeferred(cooldown['reason'], retry_at)
    try:
        papers = fetch_cv_papers(category=category, specified_date=target_date)
    except ArxivDeferred as error:
        state.defer(target_date, category, error.retry_at, str(error))
        raise
    state.save_snapshot(target_date, category, query, papers)
    if category != 'cs.LG':
        time.sleep(30)
    return papers


def main(target_date: date, *, fetch_state=None):
    # Keep an existing report intact if rendering/promotion/index-listing fails.
    with _rollback_files_on_error(_report_paths(target_date)):
        _generate_report(target_date, fetch_state=fetch_state)


def _generate_report(target_date: date, *, fetch_state=None):
    """主执行流程：抓取、过滤、保存、生成HTML。"""
    logging.info(f"开始处理日期: {target_date.isoformat()}")

    # --- 确定 JSON 文件路径 ---
    json_filename = f"{target_date.isoformat()}.json"
    json_filepath = os.path.join(DEFAULT_JSON_DIR, json_filename)
    logging.info(f"目标 JSON 文件路径: {json_filepath}")

    state = fetch_state if fetch_state is not None else FetchState(
        os.path.join(PROJECT_ROOT, '.arxiv-state')
    )
    filtered_papers = None
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
                papers = _fetch_category(target_date, category, state)
                for paper in papers:
                    if paper.get('url') not in seen_urls:
                        raw_papers.append(paper)
                        seen_urls.add(paper.get('url'))
                logging.info(f"{category} 类别抓取到 {len(papers)} 篇论文，去重后当前总计 {len(raw_papers)} 篇。")

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

    # Render before promoting either file: a render failure must not leave a
    # new formal JSON report that a later run mistakes for completed work.
    html_filename = f"{target_date.strftime('%Y_%m_%d')}.html"
    with tempfile.TemporaryDirectory(prefix='.arxiv-render-', dir=PROJECT_ROOT) as staging:
        staged_json = os.path.join(staging, json_filename)
        if filtered_papers is not None:
            _write_report(staged_json, filtered_papers)
            render_source = staged_json
        else:
            render_source = json_filepath
        generate_html_from_json(
            json_file_path=render_source,
            template_dir=DEFAULT_TEMPLATE_DIR,
            template_name=DEFAULT_TEMPLATE_NAME,
            output_dir=staging,
        )
        staged_html = os.path.join(staging, html_filename)
        if not os.path.isfile(staged_html):
            raise RuntimeError(f"HTML 生成器未创建预期报告: {html_filename}")
        os.makedirs(DEFAULT_JSON_DIR, exist_ok=True)
        os.makedirs(DEFAULT_HTML_DIR, exist_ok=True)
        if filtered_papers is not None:
            os.replace(staged_json, json_filepath)
        os.replace(staged_html, os.path.join(DEFAULT_HTML_DIR, html_filename))

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


def _report_complete(day: date) -> bool:
    json_path = os.path.join(DEFAULT_JSON_DIR, f'{day.isoformat()}.json')
    html_path = os.path.join(DEFAULT_HTML_DIR, f'{day:%Y_%m_%d}.html')
    return (
        os.path.isfile(json_path) and os.path.isfile(html_path)
        and not report_needs_ai_repair(json_path)
    )


def run_pipeline(target_date: date, *, backfill=False, backfill_limit=5,
                 state_dir=None, result_file=None) -> dict:
    """Finish complete dates, persist deferred work, and expose a publish manifest."""
    result = {
        'schema_version': 1,
        'completed_dates': [],
        'deferred_dates': [],
        'failures': [],
        'publish_ready': False,
        'publish_paths': [],
        'exit_code': 0,
    }
    originals = {}
    try:
        if backfill_limit < 0:
            raise ValueError('backfill-limit must not be negative')
        state = FetchState(state_dir or os.path.join(PROJECT_ROOT, '.arxiv-state'))
        for day in state.pending_dates():
            if _report_complete(day):
                state.complete_date(day)
        historic = []
        if backfill:
            historic = [day for day in state.pending_dates()
                        if EARLIEST_DATE <= day <= target_date and day != target_date]
            missing = find_missing_dates(DEFAULT_JSON_DIR, EARLIEST_DATE, target_date)
            failed = find_failed_ai_dates(DEFAULT_JSON_DIR, EARLIEST_DATE, target_date)
            for day in sorted(set(missing + failed)):
                if day != target_date and day not in historic:
                    historic.append(day)
            historic = [day for day in historic if not _report_complete(day)][:backfill_limit]
        resumed = set(state.pending_dates())
        queue = [day for day in historic if day in resumed]
        if target_date >= EARLIEST_DATE:
            queue.append(target_date)
        queue.extend(day for day in historic if day not in resumed)

        for day in queue:
            if _report_complete(day):
                logging.info('日报 %s 已完整，跳过抓取、评分和渲染。', day)
                state.complete_date(day)
                continue
            try:
                for path, content in _capture_files(_report_paths(day)).items():
                    originals.setdefault(path, content)
                main(day, fetch_state=state)
            except ArxivDeferred as error:
                result['deferred_dates'].append({
                    'date': day.isoformat(), 'reason': str(error),
                    'next_retry_at': error.retry_at.isoformat(),
                })
                result['exit_code'] = 2
                logging.warning('抓取延后：%s；最早重试时间 %s。停止本轮 arXiv 请求。',
                                day, error.retry_at.isoformat())
                break
            except Exception as error:
                result['failures'].append({'date': day.isoformat(), 'reason': str(error)})
                result['exit_code'] = 1
                logging.exception('日期 %s 未完成；保存此前已完成的日报。', day)
                # Do not restart exhausted transport retries on another date.
                # Provider/configuration errors also stop further paid calls.
                break
            else:
                result['completed_dates'].append(day.isoformat())
                # Clear persisted pending work at the start of the next run,
                # after the checkout contains the complete published report.
                if day != queue[-1]:
                    logging.info('等待 30 秒后处理下一个日期。')
                    time.sleep(30)

        if result['completed_dates']:
            logging.info('为已完成日报更新搜索索引。')
            _generate_indexes()
            result['publish_paths'] = [
                path
                for day in result['completed_dates']
                for path in (f'daily_json/{day}.json', f"daily_html/{day.replace('-', '_')}.html")
            ] + ['reports.json', 'search_index.json', 'search_index']
            result['publish_ready'] = True
    except Exception as error:
        # An index failure must be retryable in a persistent local checkout too.
        # Raw snapshots survive; unpublishable formal reports return to baseline.
        _restore_files(originals)
        result['failures'].append({'date': None, 'reason': str(error)})
        result['exit_code'] = 1
        result['publish_ready'] = False
        result['publish_paths'] = []
        logging.exception('流水线未完成；此次不发布。')
    if result_file:
        _write_json_atomic(result_file, result)
    logging.info('运行结果：完成 %s，延后 %s，失败 %s，允许发布=%s。',
                 len(result['completed_dates']), len(result['deferred_dates']),
                 len(result['failures']), result['publish_ready'])
    return result


def _generate_indexes():
    # Generate in isolation so an interrupted index build cannot expose a mix
    # of old and new shards. The publication manifest is enabled only at the end.
    with tempfile.TemporaryDirectory(prefix='.arxiv-render-', dir=PROJECT_ROOT) as staging:
        staged_dir = os.path.join(staging, 'search_index')
        staged_legacy = os.path.join(staging, 'search_index.json')
        generate_search_index(DEFAULT_JSON_DIR, staged_dir, staged_legacy)
        if not os.path.isfile(os.path.join(staged_dir, 'manifest.json')) or not os.path.isfile(staged_legacy):
            raise RuntimeError('搜索索引生成不完整。')
        os.makedirs(DEFAULT_SEARCH_INDEX_DIR, exist_ok=True)
        new_names = set(os.listdir(staged_dir))
        old_names = set(os.listdir(DEFAULT_SEARCH_INDEX_DIR))
        legacy_path = os.path.join(PROJECT_ROOT, 'search_index.json')
        paths = [os.path.join(DEFAULT_SEARCH_INDEX_DIR, name)
                 for name in new_names | old_names if name.endswith('.json')] + [legacy_path]
        with _rollback_files_on_error(paths):
            for name in sorted(new_names):
                os.replace(os.path.join(staged_dir, name), os.path.join(DEFAULT_SEARCH_INDEX_DIR, name))
            os.replace(staged_legacy, legacy_path)
            for name in old_names - new_names:
                if name.endswith('.json'):
                    os.unlink(os.path.join(DEFAULT_SEARCH_INDEX_DIR, name))


def cli(argv=None):
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

    parser.add_argument('--state-dir', default=os.path.join(PROJECT_ROOT, '.arxiv-state'),
                        help='跨运行抓取快照及冷却状态目录。')
    parser.add_argument('--result-file', help='输出本轮完成/延后状态及可发布文件清单。')
    args = parser.parse_args(argv)
    if args.backfill_limit < 0:
        parser.error('--backfill-limit 不能为负数。')

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
            return 1
    else:
        base_date = datetime.now(timezone.utc).date()
        logging.info(f"未指定日期，使用今天的日期作为基准: {base_date.isoformat()}")

    # 计算目标日期：基准日期的一天前
    target_date = base_date - timedelta(days=1)
    logging.info(f"将处理前一天的文章，目标日期: {target_date.isoformat()}")

    # 检查目标日期是否早于最早日期限制
    if target_date < EARLIEST_DATE:
        logging.warning(f"目标日期 {target_date.isoformat()} 早于设定的最早日期 {EARLIEST_DATE.isoformat()}，跳过抓取。")
        logging.info("如需抓取更早的日期，请修改 main.py 中的 EARLIEST_DATE 配置，或使用 --date 参数手动指定日期。")
        if not args.backfill:
            return 0
    result = run_pipeline(
        target_date, backfill=args.backfill, backfill_limit=args.backfill_limit,
        state_dir=args.state_dir, result_file=args.result_file,
    )
    return result['exit_code']


if __name__ == '__main__':
    raise SystemExit(cli())
