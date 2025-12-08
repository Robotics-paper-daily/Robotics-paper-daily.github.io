import os
import json
import logging
import argparse
from datetime import date, datetime, timedelta

# 确保 src 目录在 Python 路径中，以便导入其他模块
# 这通常在运行脚本时自动处理，或者可以通过设置 PYTHONPATH
# 或者更好的方式是使用相对导入（如果结构允许）或将项目作为包安装
from scraper import fetch_cv_papers
from filter import filter_papers_by_topic, rate_papers, translate_summaries
from html_generator import generate_html_from_json

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# 定义项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 定义默认目录
DEFAULT_JSON_DIR = os.path.join(PROJECT_ROOT, 'daily_json')
DEFAULT_HTML_DIR = os.path.join(PROJECT_ROOT, 'daily_html')
DEFAULT_TEMPLATE_DIR = os.path.join(PROJECT_ROOT, 'templates')
DEFAULT_TEMPLATE_NAME = 'paper_template.html' # 确保此模板存在

# 设定最早抓取日期（上限日期），早于此日期的文章将不会自动抓取
# 格式：YYYY-MM-DD，例如：date(2024, 1, 1) 表示不抓取 2024年1月1日之前的文章
EARLIEST_DATE = date(2025, 11, 1)  # 可以根据需要修改这个日期

def main(target_date: date):
    """主执行流程：抓取、过滤、保存、生成HTML。"""
    logging.info(f"开始处理日期: {target_date.isoformat()}")

    # --- 确定 JSON 文件路径 ---
    json_filename = f"{target_date.isoformat()}.json"
    json_filepath = os.path.join(DEFAULT_JSON_DIR, json_filename)
    logging.info(f"目标 JSON 文件路径: {json_filepath}")

    # --- 检查 JSON 文件是否存在 ---
    if os.path.exists(json_filepath):
        logging.info(f"找到已存在的 JSON 文件: {json_filepath}。跳过抓取和过滤步骤。")
        # 不需要加载数据，generate_html_from_json 会直接读取文件
    else:
        logging.info(f"未找到 JSON 文件: {json_filepath}。执行抓取和过滤。")
        # --- 1. 抓取论文 --- #
        logging.info("步骤 1: 抓取 ArXiv 机器人学相关论文 (cs.RO, cs.AI, cs.CV, cs.LG)...")
        # 注意：fetch_cv_papers 内部默认使用 UTC 日期
        # 机器人学相关论文可能分布在多个类别，我们从多个类别抓取并合并结果
        categories = ['cs.RO', 'cs.AI', 'cs.CV', 'cs.LG']  # Robotics, AI, Computer Vision, Machine Learning
        raw_papers = []
        seen_urls = set()  # 用于去重，避免同一篇论文被多次添加
        
        for category in categories:
            logging.info(f"正在抓取 {category} 类别的论文...")
            papers = fetch_cv_papers(category=category, specified_date=target_date)
            for paper in papers:
                if paper.get('url') not in seen_urls:
                    raw_papers.append(paper)
                    seen_urls.add(paper.get('url'))
            logging.info(f"{category} 类别抓取到 {len(papers)} 篇论文，去重后当前总计 {len(raw_papers)} 篇。")
        
        if not raw_papers:
            logging.warning(f"在 {target_date.isoformat()} 未找到论文或抓取失败。")
            # 如果抓取失败且无 JSON 文件，则无法继续
            return
        logging.info(f"总共抓取到 {len(raw_papers)} 篇原始论文（已去重）。")

        # --- 2. 过滤论文、论文打分、翻译摘要 --- #
        logging.info("步骤 2: 使用 AI 过滤论文并打分 (主题: Robotics, RL, Vision-Language Models, World Models, LLMs, VLA, VLN)...")
        # 注意：filter_papers_by_topic 依赖 OPENROUTER_API_KEY 环境变量
        filtered_papers = filter_papers_by_topic(raw_papers, topic="robotics, reinforcement learning, vision-language models, world models, large language models, vision-language-action, or vision-language-navigation")
        filtered_papers = rate_papers(filtered_papers)
        # 翻译摘要
        logging.info("步骤 2.1: 翻译论文摘要为中文...")
        filtered_papers = translate_summaries(filtered_papers, target_language="中文")
        # 将filtered_papers按照overall_priority_score降序排序
        filtered_papers.sort(key=lambda x: x.get('overall_priority_score', 0), reverse=True)
        if not filtered_papers:
            logging.warning("没有论文通过过滤。将创建空的 JSON 文件。")
            # 创建一个空列表，以便后续保存为空 JSON
            filtered_papers = []
            # 即使没有过滤后的论文，也可能需要生成一个空的报告，或者在这里停止
            # 这里我们选择继续，生成一个可能为空的报告
        logging.info(f"过滤后剩余 {len(filtered_papers)} 篇论文。")

        # --- 3. 保存为 JSON --- #
        logging.info("步骤 3: 将过滤后的论文保存为 JSON 文件...")

        # --- 3.1 转换日期为字符串 --- #
        logging.info("步骤 3.1: 转换日期时间对象为 ISO 格式字符串以便 JSON 序列化...")
        for paper in filtered_papers:
            if isinstance(paper.get('published_date'), datetime):
                paper['published_date'] = paper['published_date'].isoformat()
            if isinstance(paper.get('updated_date'), datetime):
                paper['updated_date'] = paper['updated_date'].isoformat()

        os.makedirs(DEFAULT_JSON_DIR, exist_ok=True) # 确保目录存在
        try:
            with open(json_filepath, 'w', encoding='utf-8') as f:
                json.dump(filtered_papers, f, indent=4, ensure_ascii=False)
            logging.info(f"过滤后的论文已保存到: {json_filepath}")
        except IOError as e:
            logging.error(f"保存 JSON 文件失败: {e}")
            return # 保存失败则无法继续
        except Exception as e:
            logging.error(f"保存 JSON 时发生意外错误: {e}", exc_info=True)
            return

    # --- 4. 生成 HTML (无论 JSON 是新建还是已存在) --- #
    logging.info("步骤 4: 从 JSON 文件生成 HTML 报告...")
    # 再次检查 JSON 文件是否实际存在（以防万一）
    if not os.path.exists(json_filepath):
         logging.error(f"无法找到 JSON 文件 '{json_filepath}' 来生成 HTML。")
         return

    try:
        generate_html_from_json(
            json_file_path=json_filepath,
            template_dir=DEFAULT_TEMPLATE_DIR,
            template_name=DEFAULT_TEMPLATE_NAME,
            output_dir=DEFAULT_HTML_DIR
        )
        logging.info(f"HTML 报告已生成在: {DEFAULT_HTML_DIR}")

        # --- 5. 更新 reports.json --- #
        logging.info("步骤 5: 更新根目录下的 reports.json 文件...")
        reports_json_path = os.path.join(PROJECT_ROOT, 'reports.json')
        try:
            if os.path.exists(DEFAULT_HTML_DIR) and os.path.isdir(DEFAULT_HTML_DIR):
                html_files = [f for f in os.listdir(DEFAULT_HTML_DIR) if f.endswith('.html')]
                # 按文件名（日期）降序排序
                html_files.sort(reverse=True)
                with open(reports_json_path, 'w', encoding='utf-8') as f:
                    json.dump(html_files, f, indent=4, ensure_ascii=False)
                logging.info(f"reports.json 已更新，包含 {len(html_files)} 个报告。")
            else:
                logging.warning(f"HTML 目录 '{DEFAULT_HTML_DIR}' 不存在，无法生成 reports.json。")
                # 如果目录不存在，可以选择创建一个空的 reports.json
                with open(reports_json_path, 'w', encoding='utf-8') as f:
                    json.dump([], f, indent=4, ensure_ascii=False)
                logging.info("已创建空的 reports.json。")
        except Exception as e:
            logging.error(f"更新 reports.json 时发生错误: {e}", exc_info=True)

    except FileNotFoundError:
        logging.error(f"模板文件 '{DEFAULT_TEMPLATE_NAME}' 未在 '{DEFAULT_TEMPLATE_DIR}' 中找到。")
    except Exception as e:
        logging.error(f"生成 HTML 时发生意外错误: {e}", exc_info=True)

    logging.info(f"日期 {target_date.isoformat()} 的处理流程完成。")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='抓取、过滤并生成 arXiv 机器人学相关论文的每日报告。')
    parser.add_argument(
        '--date',
        type=str,
        help='指定基准日期 (YYYY-MM-DD)，将抓取该日期两天前的文章。如果未指定，使用今天的日期作为基准。'
    )

    args = parser.parse_args()

    # 确定基准日期
    if args.date:
        try:
            base_date = datetime.strptime(args.date, '%Y-%m-%d').date()
            logging.info(f"使用用户指定的基准日期: {base_date.isoformat()}")
        except ValueError:
            logging.error("日期格式无效，请使用 YYYY-MM-DD 格式。退出程序。")
            exit(1)
    else:
        # 如果未指定日期，使用今天的日期作为基准
        base_date = date.today()
        logging.info(f"未指定日期，使用今天的日期作为基准: {base_date.isoformat()}")

    # 计算目标日期：基准日期的两天前
    target_date = base_date - timedelta(days=2)
    logging.info(f"将抓取两天前的文章，目标日期: {target_date.isoformat()}")

    # 检查目标日期是否早于最早日期限制
    if target_date < EARLIEST_DATE:
        logging.warning(f"目标日期 {target_date.isoformat()} 早于设定的最早日期 {EARLIEST_DATE.isoformat()}，跳过抓取。")
        logging.info("如需抓取更早的日期，请修改 main.py 中的 EARLIEST_DATE 配置，或使用 --date 参数手动指定日期。")
        exit(0)

    # 确保模板目录和文件存在，否则 HTML 生成会失败
    if not os.path.exists(DEFAULT_TEMPLATE_DIR) or not os.path.exists(os.path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_TEMPLATE_NAME)):
        logging.warning(f"模板目录 '{DEFAULT_TEMPLATE_DIR}' 或模板文件 '{DEFAULT_TEMPLATE_NAME}' 不存在。HTML 生成可能会失败。")
        # 可以考虑在这里创建默认模板或退出

    # 只处理两天前的文章
    main(target_date=target_date)
