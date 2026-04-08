import argparse
import json
import logging
from pathlib import Path

from html_generator import generate_html_from_json


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JSON_DIR = PROJECT_ROOT / "daily_json"
DEFAULT_HTML_DIR = PROJECT_ROOT / "daily_html"
DEFAULT_TEMPLATE_DIR = PROJECT_ROOT / "templates"
DEFAULT_TEMPLATE_NAME = "paper_template.html"
DEFAULT_REPORTS_JSON = PROJECT_ROOT / "reports.json"


def expected_html_filenames(json_files: list[Path]) -> set[str]:
    expected = set()
    for json_path in json_files:
        expected.add(json_path.stem.replace("-", "_") + ".html")
    return expected


def update_reports_json(html_dir: Path, reports_json_path: Path) -> None:
    html_files = sorted([p.name for p in html_dir.glob("*.html")], reverse=True)
    with open(reports_json_path, "w", encoding="utf-8") as f:
        json.dump(html_files, f, indent=4, ensure_ascii=False)
    logging.info("reports.json 已更新，包含 %s 个报告。", len(html_files))


def rebuild_all_html(
    json_dir: Path,
    html_dir: Path,
    template_dir: Path,
    template_name: str,
    reports_json_path: Path,
    clean_stale: bool = False,
) -> None:
    if not json_dir.exists():
        raise FileNotFoundError(f"JSON 目录不存在: {json_dir}")

    json_files = sorted(json_dir.glob("*.json"))
    if not json_files:
        logging.warning("未找到任何 JSON 文件，跳过 HTML 重建。")
        return

    html_dir.mkdir(parents=True, exist_ok=True)

    total = len(json_files)
    logging.info("开始全量重建 HTML，总计 %s 个 JSON 文件。", total)
    for i, json_file in enumerate(json_files, start=1):
        logging.info("[%s/%s] 生成: %s", i, total, json_file.name)
        generate_html_from_json(
            json_file_path=str(json_file),
            template_dir=str(template_dir),
            template_name=template_name,
            output_dir=str(html_dir),
        )

    if clean_stale:
        expected = expected_html_filenames(json_files)
        stale_files = sorted([p for p in html_dir.glob("*.html") if p.name not in expected])
        for stale in stale_files:
            stale.unlink()
            logging.info("已删除无对应 JSON 的旧 HTML: %s", stale.name)
        logging.info("清理完成，共删除 %s 个旧 HTML。", len(stale_files))

    update_reports_json(html_dir, reports_json_path)
    logging.info("全量重建完成。")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="从 daily_json 全量重建 daily_html。")
    parser.add_argument("--json-dir", type=Path, default=DEFAULT_JSON_DIR, help="JSON 输入目录")
    parser.add_argument("--html-dir", type=Path, default=DEFAULT_HTML_DIR, help="HTML 输出目录")
    parser.add_argument("--template-dir", type=Path, default=DEFAULT_TEMPLATE_DIR, help="模板目录")
    parser.add_argument("--template-name", type=str, default=DEFAULT_TEMPLATE_NAME, help="模板文件名")
    parser.add_argument("--reports-json", type=Path, default=DEFAULT_REPORTS_JSON, help="reports.json 输出路径")
    parser.add_argument(
        "--clean-stale",
        action="store_true",
        help="删除 html-dir 下没有对应 JSON 的旧 HTML 文件",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    rebuild_all_html(
        json_dir=args.json_dir,
        html_dir=args.html_dir,
        template_dir=args.template_dir,
        template_name=args.template_name,
        reports_json_path=args.reports_json,
        clean_stale=args.clean_stale,
    )
