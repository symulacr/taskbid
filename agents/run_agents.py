"""TaskBid Molbot Agent Runner — Starts both agents concurrently"""
import asyncio
import signal
import sys
import os

# Add agents directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from content_generator import ContentGenerator
from data_fetcher import DataFetcher

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "10"))


async def main():
    print("=" * 50)
    print("  TaskBid Molbot Agent Runtime")
    print("  Starting autonomous agents...")
    print("=" * 50)
    print()

    # Create agents
    content_bot = ContentGenerator(
        backend_url=BACKEND_URL,
        poll_interval=POLL_INTERVAL,
    )
    data_bot = DataFetcher(
        backend_url=BACKEND_URL,
        poll_interval=POLL_INTERVAL,
    )

    # Handle graceful shutdown
    def shutdown(sig, frame):
        print("\nShutting down agents...")
        content_bot.stop()
        data_bot.stop()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Run both agents concurrently
    try:
        await asyncio.gather(
            content_bot.run(),
            data_bot.run(),
        )
    except Exception as e:
        print(f"Agent runtime error: {e}")
    finally:
        print("All agents stopped.")


if __name__ == "__main__":
    asyncio.run(main())
