"""TaskBid API Routes"""
from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional
from models import TaskCreate, BidCreate, WorkSubmit, MolbotRegister, AcceptBid
import database as db
from websocket_manager import manager

router = APIRouter(prefix="/api")


async def current_block():
    return await db._get_block_height()


async def advance_block():
    h = await db._get_block_height() + 1
    await db._set_block_height(h)
    return h


async def get_task_or_404(task_id: int):
    task = await db.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


def check_admin(request: Request):
    # Mock admin check — in production, verify admin role/address
    pass


# ============================================================
# Tasks
# ============================================================

@router.get("/tasks")
async def list_tasks(status: Optional[int] = None):
    return await db.get_all_tasks(status)


@router.get("/tasks/{task_id}")
async def get_task(task_id: int):
    return await get_task_or_404(task_id)


@router.post("/tasks")
async def create_task(req: TaskCreate):
    task_id = await db.create_task(
        req=req,
        current_block=await current_block(),
    )
    await advance_block()

    # Record USDCx escrow payment
    await db.create_payment(
        task_id=task_id,
        from_addr=req.poster,
        to_addr="contract:task-registry",
        amount=req.reward_amount,
        token="USDCx",
        tx_type="escrow",
    )

    task = await db.get_task(task_id)
    await manager.broadcast("task_created", {
        "task_id": task_id,
        "title": req.title,
        "reward_amount": req.reward_amount,
        "poster": req.poster,
        "skill_required": req.skill_required,
    })
    return task


# ============================================================
# Bids
# ============================================================

@router.get("/bids")
async def list_bids(task_id: Optional[int] = None):
    return await db.get_all_bids(task_id)


@router.post("/bids")
async def place_bid(req: BidCreate):
    task = await get_task_or_404(req.task_id)
    if task["status"] != 0:
        raise HTTPException(400, "Task is not open for bids")
    if req.bidder == task["poster"]:
        raise HTTPException(400, "Cannot bid on your own task")

    # Check for duplicate bid
    if await db.check_existing_bid(req.task_id, req.bidder):
        raise HTTPException(400, "Already bid on this task")

    if req.stake_amount is None:
        req.stake_amount = task["required_stake"]

    bid_id = await db.create_bid(
        req=req,
        current_block=await current_block(),
    )
    await db.increment_bid_count(req.task_id)
    await db.update_molbot_staked(req.bidder, req.stake_amount)
    await advance_block()

    # Record sBTC stake payment
    await db.create_payment(
        task_id=req.task_id,
        from_addr=req.bidder,
        to_addr="contract:task-registry",
        amount=req.stake_amount,
        token="sBTC",
        tx_type="escrow",
    )

    await manager.broadcast("bid_placed", {
        "bid_id": bid_id,
        "task_id": req.task_id,
        "bidder": req.bidder,
        "stake_amount": req.stake_amount,
        "bid_price": req.bid_price,
    })

    bid = await db.get_bid(bid_id)
    return bid


@router.post("/tasks/{task_id}/accept-bid")
async def accept_bid(task_id: int, req: AcceptBid):
    task = await get_task_or_404(task_id)
    if task["status"] != 0:
        raise HTTPException(400, "Task is not open")

    bid = await db.get_bid(req.bid_id)
    if not bid:
        raise HTTPException(404, "Bid not found")
    if bid["task_id"] != task_id:
        raise HTTPException(400, "Bid does not belong to this task")
    if bid["status"] != 0:
        raise HTTPException(400, "Bid is not pending")

    await db.update_task_status(task_id, 1, bid["bidder"])  # ASSIGNED
    await db.update_bid_status(req.bid_id, 1)  # ACCEPTED
    await advance_block()

    await manager.broadcast("bid_accepted", {
        "bid_id": req.bid_id,
        "task_id": task_id,
        "assigned_to": bid["bidder"],
    })

    return {"status": "accepted", "assigned_to": bid["bidder"]}


# ============================================================
# Work Submission & Delivery
# ============================================================

@router.post("/tasks/{task_id}/submit-work")
async def submit_work(task_id: int, req: WorkSubmit):
    """Submit work proof. Protected by x402 middleware."""
    task = await get_task_or_404(task_id)
    if task["status"] != 1:
        raise HTTPException(400, "Task is not assigned")
    if task["assigned_to"] != req.worker:
        raise HTTPException(403, "Not assigned to this task")

    await db.update_task_status(task_id, 2)  # SUBMITTED
    await advance_block()

    await manager.broadcast("work_submitted", {
        "task_id": task_id,
        "worker": req.worker,
        "proof": req.proof[:100],
    })

    return {"status": "submitted", "task_id": task_id}


@router.post("/tasks/{task_id}/confirm")
async def confirm_delivery(task_id: int):
    """Confirm delivery — atomic settlement: release sBTC + pay USDCx.
    Protected by x402 middleware."""
    task = await get_task_or_404(task_id)
    if task["status"] != 2:
        raise HTTPException(400, "Task work not submitted yet")

    worker = task["assigned_to"]
    reward = task["reward_amount"]
    fee = reward * 5 // 100  # 5% platform fee
    net_reward = reward - fee

    # Get the accepted bid for stake info
    bids = await db.get_all_bids(task_id)
    accepted_bid = next((b for b in bids if b["status"] == 1), None)
    stake_amount = accepted_bid["stake_amount"] if accepted_bid else task["required_stake"]

    # Update task to completed
    await db.update_task_status(task_id, 3)  # COMPLETED
    await db.update_molbot_completion(worker, net_reward)
    await advance_block()

    # Record atomic settlement payments
    # 1. sBTC stake release
    await db.create_payment(
        task_id=task_id,
        from_addr="contract:task-registry",
        to_addr=worker,
        amount=stake_amount,
        token="sBTC",
        tx_type="release",
    )
    # 2. USDCx reward payment
    await db.create_payment(
        task_id=task_id,
        from_addr="contract:task-registry",
        to_addr=worker,
        amount=net_reward,
        token="USDCx",
        tx_type="reward",
    )

    await manager.broadcast("delivery_confirmed", {
        "task_id": task_id,
        "worker": worker,
        "reward": net_reward,
        "stake_released": stake_amount,
        "fee": fee,
    })

    return {
        "status": "completed",
        "worker": worker,
        "reward_paid": net_reward,
        "stake_released": stake_amount,
        "platform_fee": fee,
    }


@router.post("/tasks/{task_id}/slash")
async def slash_expired(task_id: int):
    """Slash stake for expired task."""
    task = await get_task_or_404(task_id)
    if task["status"] not in (1, 2):
        raise HTTPException(400, "Task cannot be slashed in current state")

    # Deadline check: task must be past its deadline to slash
    if await current_block() <= task["deadline"]:
        raise HTTPException(400, "Task deadline has not passed yet")

    worker = task["assigned_to"]

    # Get stake amount
    bids = await db.get_all_bids(task_id)
    accepted_bid = next((b for b in bids if b["status"] == 1), None)
    stake_amount = accepted_bid["stake_amount"] if accepted_bid else task["required_stake"]

    # Slash
    await db.update_task_status(task_id, 4)  # EXPIRED
    await db.update_molbot_failure(worker, stake_amount)
    await advance_block()

    # Record slash payment
    await db.create_payment(
        task_id=task_id,
        from_addr=worker,
        to_addr="contract:insurance-pool",
        amount=stake_amount,
        token="sBTC",
        tx_type="slash",
    )
    # Refund USDCx to poster
    await db.create_payment(
        task_id=task_id,
        from_addr="contract:task-registry",
        to_addr=task["poster"],
        amount=task["reward_amount"],
        token="USDCx",
        tx_type="release",
    )

    await manager.broadcast("stake_slashed", {
        "task_id": task_id,
        "worker": worker,
        "slashed_amount": stake_amount,
    })

    return {"status": "slashed", "worker": worker, "slashed_amount": stake_amount}


# ============================================================
# Molbots
# ============================================================

@router.get("/molbots")
async def list_molbots():
    try:
        return await db.get_all_molbots()
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@router.get("/molbots/{address}")
async def get_molbot(address: str):
    molbot = await db.get_molbot(address)
    if not molbot:
        raise HTTPException(404, "Molbot not found")
    return molbot


@router.post("/molbots/register")
async def register_molbot(req: MolbotRegister):
    await db.register_molbot(req.address, req.skill_type, await current_block(), req.name)
    await advance_block()

    await manager.broadcast("molbot_registered", {
        "address": req.address,
        "skill_type": req.skill_type,
        "name": req.name,
    })

    return {"status": "registered", "address": req.address}


# ============================================================
# Discovery & Stats
# ============================================================

@router.get("/discover")
async def discover_tasks(skill_type: Optional[str] = None):
    """Task discovery endpoint for molbot agents."""
    return await db.get_open_tasks(skill_type)


@router.get("/payments")
async def list_payments(request: Request):
    check_admin(request)
    return await db.get_all_payments()


@router.get("/stats")
async def get_stats(request: Request):
    check_admin(request)
    return await db.get_stats()
