import asyncio
import logging
from app.services.analytics_service import analytics_service

logger = logging.getLogger(__name__)

async def run_periodic_updates():
    """Run periodic background updates for analytics snapshots."""
    # Wait for DB to be initialized
    await asyncio.sleep(10)
    
    while True:
        try:
            logger.info("Starting scheduled dashboard snapshot updates...")
            await analytics_service.update_all_dashboard_snapshots()
            logger.info("Scheduled updates completed.")
        except Exception as e:
            logger.error(f"Error in periodic update task: {e}")
        
        # Sleep for 30 minutes
        await asyncio.sleep(1800)
