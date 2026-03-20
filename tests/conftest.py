import pytest
import os
import sys
import asyncio
from httpx import ASGITransport, AsyncClient

# Ensure backend directory is in path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app import app
import database as db

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(autouse=True)
async def db_cleanup():
    """Fresh database for each test if possible, or at least initialization."""
    # Trigger lifespan events manually for testing if needed
    from app import seed_demo_data
    await db.init_db()
    await seed_demo_data()
    yield

@pytest.fixture
async def async_client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
