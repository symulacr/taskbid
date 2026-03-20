"""TaskBid Pydantic Models"""
from pydantic import BaseModel, Field
from typing import Optional
from enum import IntEnum


class TaskStatus(IntEnum):
    OPEN = 0
    ASSIGNED = 1
    SUBMITTED = 2
    COMPLETED = 3
    EXPIRED = 4
    CANCELLED = 5


class BidStatus(IntEnum):
    PENDING = 0
    ACCEPTED = 1
    REJECTED = 2


class TaskCreate(BaseModel):
    title: str = Field(max_length=64)
    description: str = Field(max_length=256)
    skill_required: str = Field(max_length=32)
    reward_amount: int = Field(gt=0)
    required_stake: int = Field(gt=0)
    deadline_blocks: int = Field(gt=0)
    poster: str = Field(max_length=128)


class BidCreate(BaseModel):
    task_id: int
    bidder: str = Field(max_length=128)
    bid_price: int = Field(gt=0)
    stake_amount: Optional[int] = None


class WorkSubmit(BaseModel):
    worker: str = Field(max_length=128)
    proof: str = Field(max_length=4096)


class MolbotRegister(BaseModel):
    address: str = Field(max_length=128)
    skill_type: str = Field(max_length=32)
    name: Optional[str] = Field(default=None, max_length=64)


class AcceptBid(BaseModel):
    bid_id: int


class Task(BaseModel):
    id: int
    poster: str
    title: str
    description: str
    skill_required: str
    reward_amount: int
    required_stake: int
    deadline: int
    status: int
    assigned_to: Optional[str] = None
    created_at: int
    bid_count: int


class Bid(BaseModel):
    id: int
    task_id: int
    bidder: str
    stake_amount: int
    bid_price: int
    status: int
    created_at: int


class MolbotProfile(BaseModel):
    address: str
    total_tasks_completed: int
    total_tasks_failed: int
    total_earned: int
    total_staked: int
    total_slashed: int
    reputation_score: int
    skill_type: str
    registered_at: int
    name: Optional[str] = None


class PaymentRecord(BaseModel):
    id: int
    task_id: int
    from_address: str
    to_address: str
    amount: int
    token: str  # "sBTC" or "USDCx"
    tx_type: str  # "escrow", "reward", "slash", "release"
    timestamp: str
