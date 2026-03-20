"""TaskBid Database — dual-mode: asyncpg (Supabase/Vercel) or aiosqlite (local)"""
import os
import time
from typing import Optional, List, Any, Dict
from models import TaskCreate, BidCreate

# ---------------------------------------------------------------------------
# Connection strategy:
#   DATABASE_URL starting with "postgresql" → asyncpg (Supabase)
#   otherwise                               → aiosqlite (local SQLite)
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "")
# sslmode handled per-connection for asyncpg compatibility
USE_POSTGRES = DATABASE_URL.startswith("postgresql") or DATABASE_URL.startswith("postgres")

if not USE_POSTGRES:
    import aiosqlite
    DB_PATH = "/tmp/taskbid.db" if os.environ.get("VERCEL") else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "taskbid.db"
    )

# Block height (in-memory mock — both modes)
_block_height = {"value": 100}


async def _get_block_height() -> int:
    return _block_height["value"]


async def _set_block_height(h: int):
    _block_height["value"] = h


# ---------------------------------------------------------------------------
# Unified query helpers
# ---------------------------------------------------------------------------

async def _pg_execute(sql: str, args: tuple = ()):
    """Execute a write query on Postgres."""
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL, ssl="require")
    try:
        await conn.execute(sql, *args)
    finally:
        await conn.close()


async def _pg_fetchone(sql: str, args: tuple = ()) -> Optional[Dict[str, Any]]:
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL, ssl="require")
    try:
        row = await conn.fetchrow(sql, *args)
        return dict(row) if row else None
    finally:
        await conn.close()


async def _pg_fetchall(sql: str, args: tuple = ()) -> List[Dict[str, Any]]:
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL, ssl="require")
    try:
        rows = await conn.fetch(sql, *args)
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def _pg_fetchval(sql: str, args: tuple = ()) -> Any:
    import asyncpg
    conn = await asyncpg.connect(DATABASE_URL, ssl="require")
    try:
        return await conn.fetchval(sql, *args)
    finally:
        await conn.close()


# Postgres uses $1 $2 ... placeholders; SQLite uses ?
# We store SQL with ? and convert at call time.
def _pg_sql(sql: str) -> str:
    """Replace ? placeholders with $1, $2, ... for asyncpg."""
    i = 0
    result = []
    for ch in sql:
        if ch == "?":
            i += 1
            result.append(f"${i}")
        else:
            result.append(ch)
    return "".join(result)


# ---------------------------------------------------------------------------
# init_db
# ---------------------------------------------------------------------------

async def init_db():
    if USE_POSTGRES:
        return  # Schema managed via Supabase migrations
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                poster TEXT NOT NULL, title TEXT NOT NULL,
                description TEXT NOT NULL, skill_required TEXT NOT NULL,
                reward_amount INTEGER NOT NULL, required_stake INTEGER NOT NULL,
                deadline INTEGER NOT NULL, status INTEGER NOT NULL DEFAULT 0,
                assigned_to TEXT, created_at INTEGER NOT NULL,
                bid_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS bids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL, bidder TEXT NOT NULL,
                stake_amount INTEGER NOT NULL, bid_price INTEGER NOT NULL,
                status INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );
            CREATE TABLE IF NOT EXISTS molbot_profiles (
                address TEXT PRIMARY KEY,
                total_tasks_completed INTEGER NOT NULL DEFAULT 0,
                total_tasks_failed INTEGER NOT NULL DEFAULT 0,
                total_earned INTEGER NOT NULL DEFAULT 0,
                total_staked INTEGER NOT NULL DEFAULT 0,
                total_slashed INTEGER NOT NULL DEFAULT 0,
                reputation_score INTEGER NOT NULL DEFAULT 500,
                skill_type TEXT NOT NULL, registered_at INTEGER NOT NULL, name TEXT
            );
            CREATE TABLE IF NOT EXISTS payment_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL, from_address TEXT NOT NULL,
                to_address TEXT NOT NULL, amount INTEGER NOT NULL,
                token TEXT NOT NULL, tx_type TEXT NOT NULL, timestamp TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
            );
        """)
        await db.commit()
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Task CRUD
# ---------------------------------------------------------------------------

async def create_task(req: TaskCreate, current_block: int) -> int:
    """Create a task and return its ID."""
    deadline = current_block + req.deadline_blocks
    if USE_POSTGRES:
        sql = _pg_sql(
            "INSERT INTO tasks (poster,title,description,skill_required,reward_amount,"
            "required_stake,deadline,status,created_at,bid_count) "
            "VALUES (?,?,?,?,?,?,?,0,?,0) RETURNING id"
        )
        return await _pg_fetchval(sql, (req.poster, req.title, req.description,
            req.skill_required, req.reward_amount, req.required_stake, deadline, current_block))
    db = await aiosqlite.connect(DB_PATH)
    try:
        cur = await db.execute(
            "INSERT INTO tasks (poster,title,description,skill_required,reward_amount,"
            "required_stake,deadline,status,created_at,bid_count) VALUES (?,?,?,?,?,?,?,0,?,0)",
            (req.poster, req.title, req.description, req.skill_required,
             req.reward_amount, req.required_stake, deadline, current_block))
        tid = cur.lastrowid
        await db.commit()
        return tid
    finally:
        await db.close()


async def get_task(task_id: int) -> Optional[Dict[str, Any]]:
    if USE_POSTGRES:
        return await _pg_fetchone(_pg_sql("SELECT * FROM tasks WHERE id=?"), (task_id,))
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute("SELECT * FROM tasks WHERE id=?", (task_id,))
        row = await cur.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_all_tasks(status: Optional[int] = None) -> List[Dict[str, Any]]:
    if USE_POSTGRES:
        if status is not None:
            return await _pg_fetchall(_pg_sql("SELECT * FROM tasks WHERE status=? ORDER BY id DESC"), (status,))
        return await _pg_fetchall("SELECT * FROM tasks ORDER BY id DESC")
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        if status is not None:
            cur = await db.execute("SELECT * FROM tasks WHERE status=? ORDER BY id DESC", (status,))
        else:
            cur = await db.execute("SELECT * FROM tasks ORDER BY id DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def get_open_tasks(skill_type: Optional[str] = None) -> List[Dict[str, Any]]:
    if USE_POSTGRES:
        if skill_type:
            return await _pg_fetchall(
                _pg_sql("SELECT * FROM tasks WHERE status=0 AND skill_required=? ORDER BY reward_amount DESC"),
                (skill_type,))
        return await _pg_fetchall("SELECT * FROM tasks WHERE status=0 ORDER BY reward_amount DESC")
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        if skill_type:
            cur = await db.execute(
                "SELECT * FROM tasks WHERE status=0 AND skill_required=? ORDER BY reward_amount DESC",
                (skill_type,))
        else:
            cur = await db.execute("SELECT * FROM tasks WHERE status=0 ORDER BY reward_amount DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def update_task_status(task_id: int, status: int, assigned_to: str = None):
    if assigned_to:
        sql = "UPDATE tasks SET status=?, assigned_to=? WHERE id=?"
        args = (status, assigned_to, task_id)
    else:
        sql = "UPDATE tasks SET status=? WHERE id=?"
        args = (status, task_id)
    if USE_POSTGRES:
        await _pg_execute(_pg_sql(sql), args)
        return
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute(sql, args)
        await db.commit()
    finally:
        await db.close()


async def increment_bid_count(task_id: int):
    sql = "UPDATE tasks SET bid_count=bid_count+1 WHERE id=?"
    if USE_POSTGRES:
        await _pg_execute(_pg_sql(sql), (task_id,))
        return
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute(sql, (task_id,))
        await db.commit()
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Bid CRUD
# ---------------------------------------------------------------------------

async def create_bid(req: BidCreate, current_block: int) -> int:
    """Create a bid and return its ID."""
    if USE_POSTGRES:
        sql = _pg_sql(
            "INSERT INTO bids (task_id,bidder,stake_amount,bid_price,status,created_at) "
            "VALUES (?,?,?,?,0,?) RETURNING id"
        )
        return await _pg_fetchval(sql, (req.task_id, req.bidder, req.stake_amount, req.bid_price, current_block))
    db = await aiosqlite.connect(DB_PATH)
    try:
        cur = await db.execute(
            "INSERT INTO bids (task_id,bidder,stake_amount,bid_price,status,created_at) VALUES (?,?,?,?,0,?)",
            (req.task_id, req.bidder, req.stake_amount, req.bid_price, current_block))
        bid_id = cur.lastrowid
        await db.commit()
        return bid_id
    finally:
        await db.close()


async def get_bid(bid_id: int):
    if USE_POSTGRES:
        return await _pg_fetchone(_pg_sql("SELECT * FROM bids WHERE id=?"), (bid_id,))
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute("SELECT * FROM bids WHERE id=?", (bid_id,))
        row = await cur.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_all_bids(task_id: Optional[int] = None):
    if USE_POSTGRES:
        if task_id is not None:
            return await _pg_fetchall(_pg_sql("SELECT * FROM bids WHERE task_id=? ORDER BY id DESC"), (task_id,))
        return await _pg_fetchall("SELECT * FROM bids ORDER BY id DESC")
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        if task_id is not None:
            cur = await db.execute("SELECT * FROM bids WHERE task_id=? ORDER BY id DESC", (task_id,))
        else:
            cur = await db.execute("SELECT * FROM bids ORDER BY id DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def update_bid_status(bid_id: int, status: int):
    sql = "UPDATE bids SET status=? WHERE id=?"
    if USE_POSTGRES:
        await _pg_execute(_pg_sql(sql), (status, bid_id))
        return
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute(sql, (status, bid_id))
        await db.commit()
    finally:
        await db.close()


async def check_existing_bid(task_id: int, bidder: str):
    if USE_POSTGRES:
        row = await _pg_fetchone(_pg_sql("SELECT id FROM bids WHERE task_id=? AND bidder=?"), (task_id, bidder))
        return row is not None
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute("SELECT id FROM bids WHERE task_id=? AND bidder=?", (task_id, bidder))
        return await cur.fetchone() is not None
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Molbot Profile CRUD
# ---------------------------------------------------------------------------

async def register_molbot(address, skill_type, current_block, name=None):
    if USE_POSTGRES:
        existing = await _pg_fetchone(_pg_sql("SELECT address FROM molbot_profiles WHERE address=?"), (address,))
        if existing:
            return
        await _pg_execute(
            _pg_sql("INSERT INTO molbot_profiles (address,total_tasks_completed,total_tasks_failed,"
                    "total_earned,total_staked,total_slashed,reputation_score,skill_type,registered_at,name) "
                    "VALUES (?,0,0,0,0,0,500,?,?,?) ON CONFLICT (address) DO NOTHING"),
            (address, skill_type, current_block, name))
        return
    db = await aiosqlite.connect(DB_PATH)
    try:
        cur = await db.execute("SELECT address FROM molbot_profiles WHERE address=?", (address,))
        if await cur.fetchone():
            return
        await db.execute(
            "INSERT INTO molbot_profiles (address,total_tasks_completed,total_tasks_failed,"
            "total_earned,total_staked,total_slashed,reputation_score,skill_type,registered_at,name) "
            "VALUES (?,0,0,0,0,0,500,?,?,?)",
            (address, skill_type, current_block, name))
        await db.commit()
    finally:
        await db.close()


async def get_molbot(address: str):
    if USE_POSTGRES:
        return await _pg_fetchone(_pg_sql("SELECT * FROM molbot_profiles WHERE address=?"), (address,))
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute("SELECT * FROM molbot_profiles WHERE address=?", (address,))
        row = await cur.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_all_molbots():
    if USE_POSTGRES:
        return await _pg_fetchall("SELECT * FROM molbot_profiles ORDER BY reputation_score DESC")
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute("SELECT * FROM molbot_profiles ORDER BY reputation_score DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def update_molbot_completion(address: str, earned: int):
    sql = ("UPDATE molbot_profiles SET total_tasks_completed=total_tasks_completed+1,"
           "total_earned=total_earned+?,reputation_score=LEAST(1000,reputation_score+50) WHERE address=?")
    if USE_POSTGRES:
        await _pg_execute(_pg_sql(sql), (earned, address))
        return
    # SQLite uses MIN not LEAST
    sqlite_sql = ("UPDATE molbot_profiles SET total_tasks_completed=total_tasks_completed+1,"
                  "total_earned=total_earned+?,reputation_score=MIN(1000,reputation_score+50) WHERE address=?")
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute(sqlite_sql, (earned, address))
        await db.commit()
    finally:
        await db.close()


async def update_molbot_failure(address: str, slashed: int):
    sql = ("UPDATE molbot_profiles SET total_tasks_failed=total_tasks_failed+1,"
           "total_slashed=total_slashed+?,reputation_score=GREATEST(0,reputation_score-100) WHERE address=?")
    if USE_POSTGRES:
        await _pg_execute(_pg_sql(sql), (slashed, address))
        return
    sqlite_sql = ("UPDATE molbot_profiles SET total_tasks_failed=total_tasks_failed+1,"
                  "total_slashed=total_slashed+?,reputation_score=MAX(0,reputation_score-100) WHERE address=?")
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute(sqlite_sql, (slashed, address))
        await db.commit()
    finally:
        await db.close()


async def update_molbot_staked(address: str, amount: int):
    sql = "UPDATE molbot_profiles SET total_staked=total_staked+? WHERE address=?"
    if USE_POSTGRES:
        await _pg_execute(_pg_sql(sql), (amount, address))
        return
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute(sql, (amount, address))
        await db.commit()
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Payment Records
# ---------------------------------------------------------------------------

async def create_payment(task_id: int, from_addr: str, to_addr: str,
                         amount: int, token: str, tx_type: str) -> int:
    """Create a payment record and return its ID."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    if USE_POSTGRES:
        sql = _pg_sql(
            "INSERT INTO payment_records (task_id,from_address,to_address,amount,token,tx_type,timestamp) "
            "VALUES (?,?,?,?,?,?,?) RETURNING id"
        )
        return await _pg_fetchval(sql, (task_id, from_addr, to_addr, amount, token, tx_type, ts))
    db = await aiosqlite.connect(DB_PATH)
    try:
        cur = await db.execute(
            "INSERT INTO payment_records (task_id,from_address,to_address,amount,token,tx_type,timestamp) "
            "VALUES (?,?,?,?,?,?,?)",
            (task_id, from_addr, to_addr, amount, token, tx_type, ts))
        pid = cur.lastrowid
        await db.commit()
        return pid
    finally:
        await db.close()


async def get_all_payments():
    if USE_POSTGRES:
        return await _pg_fetchall("SELECT * FROM payment_records ORDER BY id DESC")
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute("SELECT * FROM payment_records ORDER BY id DESC")
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

async def get_stats() -> Dict[str, Any]:
    """Return system-wide statistics."""
    if USE_POSTGRES:
        total_tasks = (await _pg_fetchone("SELECT COUNT(*) AS cnt FROM tasks") or {}).get("cnt", 0)
        active_tasks = (await _pg_fetchone(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE status IN (0,1,2)") or {}).get("cnt", 0)
        total_volume = (await _pg_fetchone(
            "SELECT COALESCE(SUM(reward_amount),0) AS vol FROM tasks") or {}).get("vol", 0)
        total_staked = (await _pg_fetchone(
            "SELECT COALESCE(SUM(stake_amount),0) AS stk FROM bids WHERE status=1") or {}).get("stk", 0)
        total_molbots = (await _pg_fetchone(
            "SELECT COUNT(*) AS cnt FROM molbot_profiles") or {}).get("cnt", 0)
    else:
        db = await aiosqlite.connect(DB_PATH)
        db.row_factory = aiosqlite.Row
        try:
            total_tasks = (await (await db.execute("SELECT COUNT(*) AS cnt FROM tasks")).fetchone())["cnt"]
            active_tasks = (await (await db.execute(
                "SELECT COUNT(*) AS cnt FROM tasks WHERE status IN (0,1,2)")).fetchone())["cnt"]
            total_volume = (await (await db.execute(
                "SELECT COALESCE(SUM(reward_amount),0) AS vol FROM tasks")).fetchone())["vol"]
            total_staked = (await (await db.execute(
                "SELECT COALESCE(SUM(stake_amount),0) AS stk FROM bids WHERE status=1")).fetchone())["stk"]
            total_molbots = (await (await db.execute(
                "SELECT COUNT(*) AS cnt FROM molbot_profiles")).fetchone())["cnt"]
        finally:
            await db.close()

    return {
        "total_tasks": total_tasks,
        "active_tasks": active_tasks,
        "total_volume": total_volume,
        "total_staked": total_staked,
        "total_molbots": total_molbots,
        "current_block": await _get_block_height(),
    }
