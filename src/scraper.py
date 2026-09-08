import arxiv
import logging
import random
import time
import requests
from datetime import date, timedelta, datetime, timezone
from email.utils import parsedate_to_datetime
from typing import List, Dict, Optional, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class ArxivFetchError(RuntimeError):
    """The arXiv client failed, as distinct from a valid empty result set."""


def _retry_after_seconds(value: Optional[str], now: Optional[datetime] = None) -> float:
    if not value:
        return 0.0
    try:
        return max(0.0, float(int(value)))
    except (ValueError, OverflowError):
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, (retry_at - (now or datetime.now(timezone.utc))).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return 0.0


class _ArxivSession(requests.Session):
    """Retry complete page requests without restarting arxiv's pagination."""

    MAX_ATTEMPTS = 5
    RETRY_BUDGET_SECONDS = 15 * 60
    CONNECT_TIMEOUT = 10
    READ_TIMEOUT = 90
    RETRY_STATUSES = {408, 429, 500, 502, 503, 504}

    def request(self, method, url, **kwargs):
        if method.upper() != "GET":
            return super().request(method, url, **kwargs)

        deadline = time.monotonic() + self.RETRY_BUDGET_SECONDS
        last_error = None
        last_reason = "no response"
        stop_reason = "retry limit reached"
        attempts_made = 0
        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                stop_reason = "retry budget exhausted"
                break
            kwargs["timeout"] = (
                min(self.CONNECT_TIMEOUT, remaining),
                min(self.READ_TIMEOUT, remaining),
            )
            # requests reads the body here too, so body timeouts are retried.
            kwargs["stream"] = False
            attempts_made = attempt
            started = time.monotonic()
            retry_after = 0.0
            try:
                response = super().request(method, url, **kwargs)
            except (requests.Timeout, requests.ConnectionError) as error:
                last_error = error
                last_reason = type(error).__name__
                logging.warning(
                    "arXiv transport error %s (request %s/%s, %.1fs).",
                    last_reason, attempt, self.MAX_ATTEMPTS, time.monotonic() - started,
                )
            else:
                if response.status_code not in self.RETRY_STATUSES:
                    logging.info(
                        "arXiv HTTP %s (request %s/%s, %.1fs, cache=%r).",
                        response.status_code, attempt, self.MAX_ATTEMPTS,
                        time.monotonic() - started, response.headers.get("X-Cache"),
                    )
                    return response
                last_reason = f"HTTP {response.status_code}"
                last_error = requests.HTTPError(last_reason, response=response)
                retry_after = _retry_after_seconds(response.headers.get("Retry-After"))
                logging.warning(
                    "arXiv %s (request %s/%s, %.1fs, retry_after=%r, "
                    "content_type=%r, cache=%r, body=%r).",
                    last_reason, attempt, self.MAX_ATTEMPTS,
                    time.monotonic() - started, response.headers.get("Retry-After"),
                    response.headers.get("Content-Type"), response.headers.get("X-Cache"),
                    response.content[:200].decode("utf-8", errors="replace"),
                )
                response.close()

            if attempt == self.MAX_ATTEMPTS:
                break
            backoff = min(60 * 2 ** (attempt - 1), 300) + random.uniform(0, 10)
            wait = max(backoff, retry_after)
            if wait >= deadline - time.monotonic():
                stop_reason = f"required cooldown {wait:.1f}s exceeds remaining retry budget"
                break
            logging.info("Waiting %.1fs before retrying the same arXiv page...", wait)
            time.sleep(wait)

        raise ArxivFetchError(
            f"arXiv request failed after {attempts_made} attempts: "
            f"{last_reason}; {stop_reason}. Try again later."
        ) from last_error


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

    # HTTP recovery belongs to the session, not a second client retry loop.
    client = arxiv.Client(
        page_size=100,
        delay_seconds=10.0,
        num_retries=0,
    )
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.SubmittedDate
    )

    # arxiv 4.0.1 has no public session/timeout argument; keep parsing in arxiv.
    client._session.close()
    with _ArxivSession() as session:
        client._session = session
        max_attempts = 3
        required_empty_confirmations = 3
        consecutive_empty_results = 0
        for attempt in range(1, max_attempts + 1):
            papers: List[Dict[str, Any]] = []
            try:
                results = client.results(search)
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
                if papers:
                    logging.info(f"Successfully fetched {len(papers)} papers submitted on {specified_date.strftime('%Y-%m-%d')} from {category}.")
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
            except ArxivFetchError:
                raise
            except arxiv.HTTPError as e:
                raise ArxivFetchError(f"arXiv HTTP request failed for {category}: {e}") from e
            except Exception as e:
                raise ArxivFetchError(
                    f"Unexpected arXiv client failure for {category}: {type(e).__name__}"
                ) from e

            if attempt < max_attempts:
                wait = 30 * attempt
                logging.info(f"Waiting {wait}s before confirming arXiv results...")
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
