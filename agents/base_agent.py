"""TaskBid Molbot Base Agent — Autonomous task discovery, bidding, and execution"""
import asyncio
import logging
import random
import time
import httpx
from typing import Optional, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)


class MolbotAgent:
    """Base autonomous molbot agent.

    Polls for tasks, evaluates profitability, places bids,
    executes work, and submits proofs via x402 payments.
    """

    def __init__(
        self,
        name: str,
        skill_type: str,
        wallet_address: str,
        bid_range: Tuple[int, int],
        backend_url: str = "http://localhost:8000",
        poll_interval: int = 10,
    ):
        self.name = name
        self.skill_type = skill_type
        self.wallet_address = wallet_address
        self.bid_range = bid_range
        self.backend_url = backend_url
        self.poll_interval = poll_interval
        self.logger = logging.getLogger(name)
        self.active_task: Optional[dict] = None
        self.total_earned = 0
        self.tasks_completed = 0
        self._running = True

    # --------------------------------------------------------
    # API Communication
    # --------------------------------------------------------

    async def _api(self, method: str, path: str, json=None, headers=None):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(
                method,
                f"{self.backend_url}{path}",
                json=json,
                headers=headers or {},
            )
            if resp.status_code == 402:
                # x402 Payment Required — retry with payment
                self.logger.info("Received 402 Payment Required — making x402 payment...")
                payment_header = self._make_x402_payment()
                resp = await client.request(
                    method,
                    f"{self.backend_url}{path}",
                    json=json,
                    headers={**(headers or {}), **payment_header},
                )
            resp.raise_for_status()
            return resp.json()

    def _make_x402_payment(self) -> dict:
        """Create x402 payment signature header."""
        nonce = int(time.time() * 1000)
        sig = f"{random.getrandbits(256):064x}"
        return {
            "X-PAYMENT-SIGNATURE": f"x402-stacks-v2:{self.wallet_address}:1000:{nonce}:{sig}"
        }

    # --------------------------------------------------------
    # Registration
    # --------------------------------------------------------

    async def register(self):
        """Register this molbot with the backend."""
        try:
            result = await self._api("POST", "/api/molbots/register", json={
                "address": self.wallet_address,
                "skill_type": self.skill_type,
                "name": self.name,
            })
            self.logger.info(f"Registered as {self.skill_type} molbot")
            return result
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 422:
                self.logger.info("Already registered")
            else:
                raise

    # --------------------------------------------------------
    # Task Discovery
    # --------------------------------------------------------

    async def discover_tasks(self):
        """Find open tasks matching this molbot's skill type."""
        tasks = await self._api("GET", f"/api/discover?skill_type={self.skill_type}")
        if tasks:
            self.logger.info(f"Discovered {len(tasks)} open task(s) for {self.skill_type}")
        return tasks

    # --------------------------------------------------------
    # Bid Evaluation
    # --------------------------------------------------------

    def evaluate_task(self, task: dict) -> bool:
        """Decide if a task is worth bidding on.
        Simple heuristic: reward must exceed minimum bid range.
        """
        min_bid = self.bid_range[0]
        reward = task["reward_amount"]
        # Accept if reward is at least our minimum
        return reward >= min_bid

    def calculate_bid_price(self, task: dict) -> int:
        """Calculate bid price within our range."""
        min_bid, max_bid = self.bid_range
        reward = task["reward_amount"]
        # Bid competitively — slightly below reward
        bid = min(random.randint(min_bid, max_bid), reward)
        return bid

    # --------------------------------------------------------
    # Bidding
    # --------------------------------------------------------

    async def place_bid(self, task: dict):
        """Place a bid on a task with sBTC stake."""
        bid_price = self.calculate_bid_price(task)
        self.logger.info(
            f"Bidding on Task #{task['id']} \"{task['title']}\" "
            f"at ${bid_price / 1_000_000:.2f} USDCx "
            f"(stake: {task['required_stake'] / 100_000_000:.4f} sBTC)"
        )
        try:
            result = await self._api("POST", "/api/bids", json={
                "task_id": task["id"],
                "bidder": self.wallet_address,
                "bid_price": bid_price,
                "stake_amount": task["required_stake"],
            })
            self.logger.info(f"Bid #{result['id']} placed successfully")
            return result
        except httpx.HTTPStatusError as e:
            detail = e.response.json().get("detail", str(e))
            self.logger.warning(f"Bid failed: {detail}")
            return None

    # --------------------------------------------------------
    # Work Execution
    # --------------------------------------------------------

    async def execute_skill(self, task: dict) -> str:
        """Execute the molbot's skill. Override in subclass."""
        raise NotImplementedError

    async def submit_work(self, task_id: int, proof: str):
        """Submit work proof via x402-gated endpoint."""
        self.logger.info(f"Submitting work for Task #{task_id} via x402 payment...")
        result = await self._api("POST", f"/api/tasks/{task_id}/submit-work", json={
            "worker": self.wallet_address,
            "proof": proof,
        })
        self.logger.info(f"Work submitted for Task #{task_id}")
        return result

    # --------------------------------------------------------
    # Assignment Polling
    # --------------------------------------------------------

    async def check_assignments(self):
        """Check if any of our bids have been accepted."""
        bids = await self._api("GET", "/api/bids")
        my_accepted = [
            b for b in bids
            if b["bidder"] == self.wallet_address and b["status"] == 1
        ]
        for bid in my_accepted:
            task = await self._api("GET", f"/api/tasks/{bid['task_id']}")
            if task["status"] == 1:  # ASSIGNED
                return task
        return None

    # --------------------------------------------------------
    # Auto-Accept (Demo helper)
    # --------------------------------------------------------

    async def _safe_auto_complete(self, task_id: int, bid_id: int):
        """Wrapper for auto_accept_and_confirm with error handling."""
        try:
            await self.auto_accept_and_confirm(task_id, bid_id)
        except Exception as e:
            self.logger.error(f"Auto-complete failed for Task #{task_id}: {e}")

    async def auto_accept_and_confirm(self, task_id: int, bid_id: int):
        """In demo mode, simulate the poster accepting the bid and confirming delivery."""
        await asyncio.sleep(2)
        self.logger.info(f"[Demo] Poster accepting bid #{bid_id} for Task #{task_id}...")
        try:
            await self._api("POST", f"/api/tasks/{task_id}/accept-bid", json={
                "bid_id": bid_id,
            })
        except Exception as e:
            self.logger.warning(f"Accept bid failed: {e}")
            return

        # Execute skill
        await asyncio.sleep(1.5)
        task = await self._api("GET", f"/api/tasks/{task_id}")
        self.logger.info(f"Executing {self.skill_type} skill for Task #{task_id}...")
        proof = await self.execute_skill(task)

        # Submit work
        await asyncio.sleep(1)
        await self.submit_work(task_id, proof)

        # Poster confirms delivery
        await asyncio.sleep(2)
        self.logger.info(f"[Demo] Poster confirming delivery for Task #{task_id}...")
        result = await self._api("POST", f"/api/tasks/{task_id}/confirm")
        earned = result.get("reward_paid", 0)
        self.total_earned += earned
        self.tasks_completed += 1
        self.logger.info(
            f"Task #{task_id} COMPLETED! Earned ${earned / 1_000_000:.2f} USDCx, "
            f"sBTC stake released. Total earned: ${self.total_earned / 1_000_000:.2f}"
        )

    # --------------------------------------------------------
    # Main Loop
    # --------------------------------------------------------

    async def run(self):
        """Main polling loop."""
        self.logger.info(f"Starting {self.name} ({self.skill_type})...")
        self.logger.info(f"Wallet: {self.wallet_address}")
        self.logger.info(f"Bid range: ${self.bid_range[0]/1_000_000:.2f} - ${self.bid_range[1]/1_000_000:.2f}")

        await self.register()

        while self._running:
            try:
                # Discover tasks
                tasks = await self.discover_tasks()

                for task in tasks:
                    if self.evaluate_task(task):
                        bid = await self.place_bid(task)
                        if bid:
                            # In demo mode, auto-complete the cycle
                            asyncio.create_task(
                                self._safe_auto_complete(task["id"], bid["id"])
                            )
                        # Only bid on one task per cycle
                        break

            except Exception as e:
                self.logger.error(f"Error in polling loop: {e}")

            # Wait before next poll
            await asyncio.sleep(self.poll_interval)

    def stop(self):
        self._running = False
        self.logger.info(f"{self.name} stopping...")
