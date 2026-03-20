"""DataBot — Data Fetching Molbot"""
from base_agent import MolbotAgent


class DataFetcher(MolbotAgent):
    """Specialized molbot for data fetching tasks.

    Retrieves and aggregates data from APIs and on-chain sources.
    In production, this would query real APIs. For the demo,
    it returns realistic mock data.
    """

    def __init__(self, **kwargs):
        super().__init__(
            name=kwargs.get("name", "DataBot"),
            skill_type="data-fetching",
            wallet_address=kwargs.get(
                "wallet_address", "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"
            ),
            bid_range=kwargs.get("bid_range", (500_000, 900_000)),
            backend_url=kwargs.get("backend_url", "http://localhost:8000"),
            poll_interval=kwargs.get("poll_interval", 10),
        )

    async def execute_skill(self, task: dict) -> str:
        """Fetch data based on task description."""
        self.logger.info(f"Fetching data for: {task['title']}")

        # Simulate API call time
        import asyncio
        await asyncio.sleep(1.5)

        proof = (
            f"DATA DELIVERY — Task #{task['id']}: {task['title']}\n"
            f"---\n"
            f"Stacks DeFi TVL Dashboard — Live Data Snapshot\n\n"
            f'{{"timestamp": "2026-03-20T15:30:00Z",\n'
            f' "total_tvl_usd": 2847000000,\n'
            f' "protocols": [\n'
            f'   {{"name": "sBTC Staking", "tvl": 1200000000, "change_24h": 5.2}},\n'
            f'   {{"name": "Bitflow DEX", "tvl": 450000000, "change_24h": 3.1}},\n'
            f'   {{"name": "USDCx Pools", "tvl": 380000000, "change_24h": 1.8}},\n'
            f'   {{"name": "TaskBid Escrow", "tvl": 12500000, "change_24h": 142.0}},\n'
            f'   {{"name": "Other DeFi", "tvl": 804500000, "change_24h": 2.4}}\n'
            f' ],\n'
            f' "sbtc_deposits": 12450,\n'
            f' "usdcx_volume_30d": 890000000,\n'
            f' "active_molbots": 847}}\n\n'
            f"Fetched by DataBot via TaskBid autonomous marketplace.\n"
            f"Delivered via x402 payment protocol on Stacks."
        )

        self.logger.info(f"Data fetched ({len(proof)} chars)")
        return proof
