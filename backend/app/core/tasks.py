import asyncio
import logging
from app.core.config import settings
from app.services.analytics_service import analytics_service
from app.services.document_parse_service import document_parse_service

logger = logging.getLogger(__name__)


async def run_resource_parse_updates():
    """Retry pending resource parsing jobs after restarts."""
    await asyncio.sleep(20)
    while True:
        try:
            from app.repositories.resource import Resource

            resources = await Resource.find(
                {
                    "source_type": "library",
                    "parse_status": "pending",
                }
            ).limit(5).to_list()
            for resource in resources:
                if document_parse_service.can_parse_with_mineru(resource.mime_type, resource.filename):
                    await document_parse_service.process_resource(str(resource.id))
        except Exception as e:
            logger.error(f"Error in resource parse update task: {e}")
        await asyncio.sleep(60)

async def run_periodic_updates():
    """Run periodic background updates for analytics snapshots."""
    # Wait for DB to be initialized
    await asyncio.sleep(max(10, settings.BACKGROUND_DASHBOARD_INITIAL_DELAY_SECONDS))
    
    while True:
        try:
            logger.info("Starting scheduled dashboard snapshot updates...")
            await analytics_service.update_all_dashboard_snapshots()
            logger.info("Scheduled updates completed.")
        except Exception as e:
            logger.error(f"Error in periodic update task: {e}")
        
        await asyncio.sleep(max(300, settings.BACKGROUND_DASHBOARD_INTERVAL_SECONDS))
