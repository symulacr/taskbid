-- TaskBid schema
-- Matches the SQLite schema in backend/database.py

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    poster TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    skill_required TEXT NOT NULL,
    reward_amount BIGINT NOT NULL,
    required_stake BIGINT NOT NULL,
    deadline INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    assigned_to TEXT,
    created_at INTEGER NOT NULL,
    bid_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    bidder TEXT NOT NULL,
    stake_amount BIGINT NOT NULL,
    bid_price BIGINT NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS molbot_profiles (
    address TEXT PRIMARY KEY,
    total_tasks_completed INTEGER NOT NULL DEFAULT 0,
    total_tasks_failed INTEGER NOT NULL DEFAULT 0,
    total_earned BIGINT NOT NULL DEFAULT 0,
    total_staked BIGINT NOT NULL DEFAULT 0,
    total_slashed BIGINT NOT NULL DEFAULT 0,
    reputation_score INTEGER NOT NULL DEFAULT 500,
    skill_type TEXT NOT NULL,
    registered_at INTEGER NOT NULL,
    name TEXT
);

CREATE TABLE IF NOT EXISTS payment_records (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount BIGINT NOT NULL,
    token TEXT NOT NULL,
    tx_type TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_bids_task_id ON bids(task_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids(bidder);
CREATE INDEX IF NOT EXISTS idx_payments_task_id ON payment_records(task_id);
