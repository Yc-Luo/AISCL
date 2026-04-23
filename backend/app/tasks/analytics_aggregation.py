"""Background task for daily analytics aggregation."""

import asyncio
from datetime import date, datetime, timedelta

from app.services.analytics_service import analytics_service


async def daily_aggregation_task():
    """Run daily aggregation for yesterday's data."""
    target_date = (datetime.utcnow() - timedelta(days=1)).date()
    print(f"Running daily aggregation for {target_date}")
    
    try:
        count = await analytics_service.aggregate_daily_stats(target_date=target_date)
        print(f"Aggregation completed: {count} stats records created/updated")
    except Exception as e:
        print(f"Error in daily aggregation: {e}")


async def run_periodic_aggregation():
    """Run aggregation periodically (should be called by a scheduler like APScheduler or Celery)."""
    while True:
        await daily_aggregation_task()
        # Wait until next day at 2 AM UTC
        now = datetime.utcnow()
        next_run = (now + timedelta(days=1)).replace(hour=2, minute=0, second=0, microsecond=0)
        wait_seconds = (next_run - now).total_seconds()
        print(f"Next aggregation scheduled at {next_run} (in {wait_seconds/3600:.1f} hours)")
        await asyncio.sleep(wait_seconds)


if __name__ == "__main__":
    # For manual testing
    asyncio.run(daily_aggregation_task())

