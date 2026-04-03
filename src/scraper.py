import arxiv
import logging
import time
from datetime import date, timedelta, datetime, timezone
from typing import List, Dict, Optional, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def fetch_cv_papers(category: str = 'cs.CV', max_results: int = 2000, specified_date: Optional[date] = None) -> List[Dict[str, Any]]:
    """Fetches papers from the specified category submitted on arXiv for a given date.

    Args:
        category (str): The arXiv category (e.g., 'cs.CV', 'cs.AI').
        max_results (int): The maximum number of results to retrieve.
        specified_date (Optional[date]): The specific date to fetch papers for (UTC).
                                         Defaults to today UTC date.

    Returns:
        List[Dict[str, Any]]: A list of dictionaries, where each dictionary contains
                              the 'title', 'summary', 'url', 'published_date',
                              'updated_date', 'categories', and 'authors' of a paper.
                              Returns an empty list if an error occurs or no papers are found.
    """
    if specified_date is None:
        # Default to today (UTC)
        specified_date = datetime.now(timezone.utc).date()
        logging.info(f"No date specified, defaulting to {specified_date.strftime('%Y-%m-%d')} UTC.")
    else:
        logging.info(f"Fetching papers for specified date: {specified_date.strftime('%Y-%m-%d')} UTC.")
    
    # 将specified_date转为datetime
    specified_date = datetime.combine(specified_date, datetime.min.time())
    specified_date = specified_date - timedelta(hours=6) # 转换到arxiv时区

    # Format for arXiv API: YYYYMMDDHHMM
    start_time = specified_date - timedelta(days=1)
    start_time_str = start_time.strftime('%Y%m%d%H%M')
    end_time_str = specified_date.strftime('%Y%m%d%H%M')

    # Construct the search query
    query = f'cat:{category} AND submittedDate:[{start_time_str} TO {end_time_str}]'
    logging.info(f"Using arXiv query: {query}")

    # 增大 delay 和重试次数以应对 arXiv 429 限流
    client = arxiv.Client(
        page_size=100,
        delay_seconds=10.0,
        num_retries=8,
    )
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.SubmittedDate
    )

    papers: List[Dict[str, Any]] = []
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            results = client.results(search)
            count = 0
            for result in results:
                papers.append({
                    'title': result.title,
                    'summary': result.summary.strip(),
                    'url': result.entry_id,
                    'published_date': result.published,
                    'updated_date': result.updated,
                    'categories': result.categories,
                    'authors': [author.name for author in result.authors],
                })
                count += 1
            logging.info(f"Successfully fetched {count} papers submitted on {specified_date.strftime('%Y-%m-%d')} from {category}.")
            break  # 成功则跳出重试循环

        except arxiv.UnexpectedEmptyPageError as e:
            logging.warning(f"arXiv query returned an empty page (potentially no results for the date/query): {e}")
            break  # 空页面不需要重试
        except arxiv.HTTPError as e:
            wait = 30 * attempt  # 30s, 60s, 90s 递增等待
            logging.warning(f"HTTP error (attempt {attempt}/{max_attempts}): {e}")
            if attempt < max_attempts:
                logging.info(f"Waiting {wait}s before retrying...")
                time.sleep(wait)
                papers = []  # 清空部分结果，重新抓取
            else:
                logging.error(f"All {max_attempts} attempts failed for {category}. Skipping.")
        except Exception as e:
            logging.error(f"An unexpected error occurred during arXiv search: {e}", exc_info=True)
            break

    return papers

if __name__ == '__main__':
    logging.info("Starting arXiv paper fetching example...")
    # Example usage: Fetch papers for a specific date
    # Note: Using a future date like 2025 will likely return 0 results unless arXiv data exists for it.
    # Use a recent past date for better testing.
    # example_date = date.today() - timedelta(days=4) # Example: 4 days ago
    example_date = date(2025, 4, 26) # Or a specific past date known to have papers

    logging.info(f"Fetching papers for {example_date.strftime('%Y-%m-%d')}...")
    latest_papers = fetch_cv_papers(category='cs.CV', max_results=500, specified_date=example_date)

    if latest_papers:
        logging.info(f"--- Found {len(latest_papers)} Papers ---")
        for i, paper in enumerate(latest_papers):
            print(f"{i+1}. {paper['title']}. published_date: {paper['published_date']}.")
    else:
        print(f"No papers found for {example_date} or an error occurred.")