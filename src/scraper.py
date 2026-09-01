import arxiv
import logging
import time
from datetime import date, timedelta, datetime, timezone
from typing import List, Dict, Optional, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class ArxivFetchError(RuntimeError):
    """The arXiv client failed, as distinct from a valid empty result set."""


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
                              Returns an empty list only when the query succeeds
                              and no papers are found.

    Raises:
        ArxivFetchError: The arXiv client failed after bounded retries.
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

    max_attempts = 3
    required_empty_confirmations = 3
    consecutive_empty_results = 0
    for attempt in range(1, max_attempts + 1):
        papers: List[Dict[str, Any]] = []
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
            if papers:
                logging.info(f"Successfully fetched {count} papers submitted on {specified_date.strftime('%Y-%m-%d')} from {category}.")
                return papers
            consecutive_empty_results += 1
            if consecutive_empty_results == required_empty_confirmations:
                logging.info(
                    "Confirmed an empty arXiv result for %s after %s consecutive responses.",
                    category,
                    required_empty_confirmations,
                )
                return []
            logging.warning(
                "arXiv returned an empty first page; confirming it is not transient "
                f"(confirmation {consecutive_empty_results}/"
                f"{required_empty_confirmations}, attempt {attempt}/{max_attempts})."
            )

        except arxiv.UnexpectedEmptyPageError as e:
            consecutive_empty_results = 0
            logging.warning(
                "arXiv returned an unexpected empty page "
                f"(attempt {attempt}/{max_attempts}): {e}"
            )
        except arxiv.HTTPError as e:
            consecutive_empty_results = 0
            logging.warning(f"HTTP error (attempt {attempt}/{max_attempts}): {e}")
        except Exception as e:
            raise ArxivFetchError(
                f"Unexpected arXiv client failure for {category}: {type(e).__name__}"
            ) from e

        if attempt < max_attempts:
            wait = 30 * attempt  # 30s, then 60s before the final attempt
            logging.info(f"Waiting {wait}s before retrying...")
            time.sleep(wait)

    raise ArxivFetchError(
        f"arXiv fetch failed after {max_attempts} attempts for {category}."
    )

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
