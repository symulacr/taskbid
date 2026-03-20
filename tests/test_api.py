"""TaskBid Backend Tests — Full lifecycle verification"""
import pytest
import httpx
import asyncio
import sys
import os

# Test against running server or use test client
BASE = "http://test"

pytestmark = pytest.mark.asyncio

class TestHealthCheck:
    async def test_health(self, async_client):
        r = await async_client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert data["service"] == "taskbid-api"


class TestMolbots:
    async def test_list_molbots(self, async_client):
        r = await async_client.get("/api/molbots")
        assert r.status_code == 200
        molbots = r.json()
        assert len(molbots) >= 2  # seeded

    async def test_register_molbot(self, async_client):
        r = await async_client.post("/api/molbots/register", json={
            "address": "ST_TEST_BOT_123",
            "skill_type": "testing",
            "name": "TestBot",
        })
        assert r.status_code == 200


class TestTaskLifecycle:
    """Test the full task lifecycle: post → bid → accept → submit → confirm"""
    task_id = None
    bid_id = None

    async def test_01_create_task(self, async_client):
        r = await async_client.post(
            "/api/tasks", 
            json={
                "title": "Test Task",
                "description": "Automated test task",
                "skill_required": "content-generation",
                "reward_amount": 2000000,  # $2.00
                "required_stake": 100000000,  # 1 sBTC
                "deadline_blocks": 100,
                "poster": "ST_POSTER_TEST",
            },
            headers={"X-PAYMENT-SIGNATURE": "x402-demo-sig"}
        )
        assert r.status_code == 200
        task = r.json()
        assert task["id"] >= 1
        assert task["status"] == 0  # OPEN
        assert task["reward_amount"] == 2000000
        TestTaskLifecycle.task_id = task["id"]

    async def test_02_list_tasks(self, async_client):
        r = await async_client.get("/api/tasks")
        assert r.status_code == 200
        tasks = r.json()
        assert len(tasks) >= 1

    async def test_03_place_bid(self, async_client):
        r = await async_client.post(
            "/api/bids", 
            json={
                "task_id": TestTaskLifecycle.task_id,
                "bidder": "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5",
                "bid_price": 1800000,
            },
            headers={"X-PAYMENT-SIGNATURE": "x402-demo-sig"}
        )
        assert r.status_code == 200
        bid = r.json()
        assert bid["status"] == 0  # PENDING
        TestTaskLifecycle.bid_id = bid["id"]

    async def test_04_duplicate_bid_rejected(self, async_client):
        r = await async_client.post(
            "/api/bids", 
            json={
                "task_id": TestTaskLifecycle.task_id,
                "bidder": "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5",
                "bid_price": 1900000,
            },
            headers={"X-PAYMENT-SIGNATURE": "x402-demo-sig"}
        )
        assert r.status_code == 400

    async def test_05_accept_bid(self, async_client):
        r = await async_client.post(
            f"/api/tasks/{TestTaskLifecycle.task_id}/accept-bid", 
            json={
                "bid_id": TestTaskLifecycle.bid_id,
            }
        )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "accepted"

    async def test_06_x402_payment_required(self, async_client):
        """Test that submit-work returns 402 without payment header"""
        r = await async_client.post(f"/api/tasks/{TestTaskLifecycle.task_id}/submit-work", json={
            "worker": "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5",
            "proof": "test proof",
        })
        assert r.status_code == 402
        data = r.json()
        assert "paymentRequirements" in data

    async def test_07_submit_work_with_x402(self, async_client):
        """Test that submit-work succeeds with x402 payment"""
        r = await async_client.post(
            f"/api/tasks/{TestTaskLifecycle.task_id}/submit-work",
            json={
                "worker": "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5",
                "proof": "Generated content proof data...",
            },
            headers={"X-PAYMENT-SIGNATURE": "x402-stacks-v2:ST1SJ3:1000:99999:aabbccdd"},
        )
        assert r.status_code == 200

    async def test_08_confirm_delivery(self, async_client):
        """Test atomic settlement: sBTC release + USDCx payment"""
        r = await async_client.post(
            f"/api/tasks/{TestTaskLifecycle.task_id}/confirm",
            headers={"X-PAYMENT-SIGNATURE": "x402-stacks-v2:ST_POSTER:1000:99999:aabbccdd"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "completed"
        assert data["reward_paid"] == 1900000  # 2000000 - 5% fee
        assert data["stake_released"] == 100000000

    async def test_09_payments_recorded(self, async_client):
        r = await async_client.get("/api/payments")
        assert r.status_code == 200
        payments = r.json()
        # Should have: escrow(USDCx), escrow(sBTC), release(sBTC), reward(USDCx)
        task_payments = [p for p in payments if p["task_id"] == TestTaskLifecycle.task_id]
        assert len(task_payments) >= 4

    async def test_10_stats_updated(self, async_client):
        r = await async_client.get("/api/stats")
        assert r.status_code == 200
        stats = r.json()
        assert stats["total_tasks"] >= 1
        assert stats["total_molbots"] >= 2


class TestX402Protocol:
    """Verify x402 protocol compliance"""

    async def test_402_response_headers(self, async_client):
        r = await async_client.post("/api/tasks/999/submit-work", json={
            "worker": "ST_TEST",
            "proof": "test",
        })
        assert r.status_code == 402
        assert "X-PAYMENT-REQUIRED" in r.headers

    async def test_invalid_payment_rejected(self, async_client):
        r = await async_client.post("/api/tasks/999/submit-work", json={
            "worker": "ST_TEST",
            "proof": "test",
        }, headers={"X-PAYMENT-SIGNATURE": "invalid-sig"})
        assert r.status_code == 401


class TestDiscovery:
    async def test_discover_all(self, async_client):
        r = await async_client.get("/api/discover")
        assert r.status_code == 200

    async def test_discover_by_skill(self, async_client):
        r = await async_client.get("/api/discover?skill_type=content-generation")
        assert r.status_code == 200
