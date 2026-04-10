# Robotics Arxiv Daily

This is an automated project designed to fetch the latest papers from robotics-related fields on arXiv daily, use AI (currently via OpenRouter API) to filter papers related to robotics, reinforcement learning, vision-language models, world models, large language models, vision-language-action, and vision-language-navigation, generate structured JSON data and aesthetically pleasing HTML pages, and finally automatically deploy the results to GitHub Pages via GitHub Actions.

## Features

1.  **Data Fetching**: Automatically fetches the latest papers from robotics-related fields (cs.RO, cs.AI, cs.CV, cs.LG) on arXiv daily, with built-in retry logic and exponential backoff to handle arXiv API rate limiting (HTTP 429).
2.  **Multi-Stage AI Filtering**: First runs a fast keyword/abstract prefilter, then applies LLM scoring and summary translation only to stage-1 selected papers, which significantly reduces daily runtime.
3.  **Data Storage**: Saves the filtered paper information (title, abstract, link, etc.) as date-named JSON files (stored in the `daily_json/` directory).
4.  **Web Page Generation**: Generates daily HTML reports based on the JSON data using a preset template (stored in the `daily_html/` directory) and updates the main entry page `index.html`.
5.  **Automated Deployment**: Implements the complete process of daily scheduled fetching, filtering, generation, and deployment to GitHub Pages via GitHub Actions.
6.  **Automatic Backfill**: Detects missing dates in the `daily_json/` directory and automatically backfills them, ensuring no gaps in the paper archive even if previous workflow runs failed.
7.  **Full-Text Paper Search**: Provides a client-side search page (`search.html`) powered by [MiniSearch](https://lucaong.github.io/minisearch/), allowing users to search across all papers by title, abstract, or author name with AND-matching for precise results.

## Tech Stack

*   **Backend/Script**: Python 3.x (`arxiv`, `requests`, `jinja2`)
*   **Frontend**: HTML5, TailwindCSS (CDN), JavaScript, Framer Motion (CDN)
*   **Automation**: GitHub Actions
*   **Deployment**: GitHub Pages

## Installation

1.  **Clone Repository**:
    ```bash
    git clone <your-repository-url>
    cd Robotics_paper_daily
    ```

2.  **Create and Activate Virtual Environment** (Recommended):
    ```bash
    python3 -m venv .venv
    source .venv/bin/activate  # macOS/Linux
    # Or .\\.venv\\Scripts\\activate # Windows
    ```

3.  **Install Dependencies**: All required Python libraries are listed in the `requirements.txt` file.
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configure API Key**: This project requires an OpenRouter API Key for AI filtering. Of course, you can also modify `src/filter.py` to call other LLM APIs. For security, do not hardcode the key in the code. Set it as an environment variable when running locally. In GitHub Actions, set it as a Secret named `OPENROUTER_API_KEY`.

## Usage

### Local Run

You can directly run the main script `main.py` to manually trigger a complete process (fetch, filter, generate).

```bash
# Ensure the OPENROUTER_API_KEY environment variable is set
export OPENROUTER_API_KEY='your_openrouter_api_key'

# Run the main script (processes today's papers by default)
python src/main.py

# (Optional) Run for a specific date
# python src/main.py --date YYYY-MM-DD

# (Optional) Enable automatic backfill of missing dates
python src/main.py --backfill

# (Optional) Limit the number of dates to backfill per run (default: 5)
python src/main.py --backfill --backfill-limit 3

# (Optional) Rebuild all HTML from existing daily_json (no re-fetch needed)
python src/rebuild_html.py
```

After successful execution:
*   The JSON data for the day will be saved in `daily_json/YYYY-MM-DD.json`.
*   The HTML report for the day will be saved in `daily_html/YYYY_MM_DD.html`.
*   The main entry page `index.html` will be updated to include the link to the latest report.
*   A search index `search_index.json` will be generated covering all papers across all dates.

You can open `index.html` directly in your browser to view the results.

### GitHub Actions Automation

The repository is configured with a GitHub Actions workflow (`.github/workflows/daily_arxiv.yml`).

*   **Scheduled Trigger**: The workflow is set to run automatically at a scheduled time daily by default.
*   **Manual Trigger**: You can also manually trigger this workflow from the Actions page of your GitHub repository.

The workflow automatically completes all steps and deploys the generated `index.html`, `daily_json/`, and `daily_html/` directory files to GitHub Pages.

## Viewing Deployment Results

The project is configured to display results via GitHub Pages. Please visit your GitHub Pages URL (usually `https://<your-username>.github.io/<repository-name>/`) to view the daily updated paper reports.

## File Structure

```
.
├── .github/workflows/daily_arxiv.yml  # GitHub Actions configuration file
├── src/                     # Python script directory
│   ├── main.py              # Main execution script
│   ├── rebuild_html.py      # Rebuild all HTML from existing JSON files
│   ├── scraper.py           # ArXiv scraper module
│   ├── filter.py            # OpenRouter filter module (robotics topics)
│   └── html_generator.py    # HTML generator module
├── templates/               # HTML template directory
│   └── paper_template.html
├── daily_json/              # Stores daily JSON results
├── daily_html/              # Stores daily HTML results
├── index.html               # GitHub Pages entry page
├── list.html                # Historical report list page
├── search.html              # Full-text paper search page (MiniSearch)
├── search_index.json        # Pre-built search index (auto-generated)
├── requirements.txt         # Python dependency list
├── README.md                # Project description file (This file)
├── README_ZH.md             # Project description file (Chinese)
└── TODO.md                  # Project TODO list
```

## Acknowledgements
- This project is based on the open-source project [Arxiv_Daily_AIGC](https://github.com/onion-liu/arxiv_daily_aigc). Thanks to the original author.
