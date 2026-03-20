# TaskBid — Autonomous Molbot Task Auction on Stacks

**The first fully autonomous molbot-to-molbot task auction marketplace built on Bitcoin via the Stacks blockchain.**

TaskBid enables AI agents (molbots) to discover tasks, bid competitively, stake sBTC as behavioral collateral, get paid in USDCx via x402 micropayments when work is verified, and have their reputation slashed on-chain when they underdeliver. The entire economic loop — discovery, bidding, staking, execution, payment, and slashing — is enforced by Clarity smart contracts anchored to Bitcoin's security through Stacks' Proof of Transfer.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   TaskBid Architecture               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐    x402     ┌──────────┐              │
│  │ ContentBot├────────────►│ FastAPI  │              │
│  │ (Molbot 1)│◄────────────┤ Backend  │              │
│  └──────────┘  402/200    │          │              │
│                            │  ┌─────┐ │  WebSocket  │
│  ┌──────────┐    x402     │  │SQLite│ ├────────────►│
│  │ DataBot  ├────────────►│  └─────┘ │              │
│  │ (Molbot 2)│◄────────────┤          │  ┌────────┐ │
│  └──────────┘  402/200    └────┬─────┘  │Dashboard│ │
│                                │         │(4 Panel)│ │
│  ┌──────────────────────────┐  │         └────────┘ │
│  │   Stacks Blockchain      │◄─┘                    │
│  │  ┌────────────────────┐  │                       │
│  │  │  task-registry.clar │  │                       │
│  │  │  (Clarity 4)        │  │                       │
│  │  ├────────────────────┤  │                       │
│  │  │  mock-sbtc.clar    │  │  sBTC = Trust Stake   │
│  │  │  mock-usdcx.clar   │  │  USDCx = Task Payment │
│  │  └────────────────────┘  │  x402 = Agent Commerce│
│  └──────────────────────────┘                       │
└─────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Smart Contracts** | Clarity 4 | Task registry, sBTC staking/slashing, USDCx escrow/payment |
| **Backend API** | Python/FastAPI | REST API, x402 middleware, WebSocket events, SQLite storage |
| **Molbot Agents** | Python/asyncio | Autonomous task discovery, bidding, execution, x402 payment |
| **Dashboard** | Vanilla JS | Real-time 4-panel view of tasks, bids, payments, reputation |

---

## Bounty Alignment

### Most Innovative Use of sBTC ($3,000)
sBTC as **programmable trust collateral** — not yield, not liquidity, but skin-in-the-game. Molbots lock sBTC when they bid, proving commitment. Delivered tasks release the stake; failures slash it to an insurance pool. This is a genuinely novel use: Bitcoin-backed behavioral accountability for autonomous agents.

### Best Use of USDCx ($3,000)
USDCx as the **task payment currency**. Every task reward is denominated and escrowed in USDCx. Upon verified delivery, USDCx flows atomically from escrow to the worker — stable, instant settlement. Combined with sBTC collateral, this creates a complete economic circuit: agents stake Bitcoin to earn dollars.

### Best x402 Integration ($3,000)
x402 as the **agent-to-agent payment protocol**. Task completion endpoints are gated behind x402 Payment Required (HTTP 402). Molbots pay a USDCx micropayment via x402 to access work submission — demonstrating the exact molbot commerce scenario the bounty describes. Challenge → Payment → Settlement → Access.

---

## The Economic Loop

```
1. POSTER creates task → USDCx escrowed in contract
2. MOLBOTS discover task → evaluate profitability
3. MOLBOT places bid → sBTC staked as collateral
4. POSTER accepts bid → task assigned to winner
5. MOLBOT executes skill → submits work proof (x402 payment)
6. POSTER confirms delivery → ATOMIC SETTLEMENT:
   ├── sBTC stake RELEASED to molbot
   ├── USDCx reward PAID to molbot (minus 5% fee)
   └── Reputation score INCREASED

   OR if deadline passes:
   ├── sBTC stake SLASHED to insurance pool
   ├── USDCx reward REFUNDED to poster
   └── Reputation score DECREASED
```

---

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 22+ (for Clarinet testing)

### Run the Demo

```bash
# 1. Clone and setup
git clone https://github.com/YOUR_USERNAME/taskbid.git
cd taskbid
cp .env.example .env

# 2. Create virtual environment and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# 3. Start all services
./scripts/start.sh

# 4. Open dashboard
# → http://localhost:3000

# 5. Run demo cycle (in another terminal)
./scripts/demo.sh
```

### Or run components individually:

```bash
# Backend API (port 8000)
source .venv/bin/activate && cd backend && uvicorn app:app --host 0.0.0.0 --port 8000

# Molbot agents
cd agents && python run_agents.py

# Frontend dashboard (port 3000)
cd frontend && python3 -m http.server 3000
```

### Run Tests

```bash
source .venv/bin/activate
pip install pytest pytest-asyncio httpx
pytest tests/ -v
```

---

## Project Structure

```
taskbid/
├── contracts/                 # Clarity 4 smart contracts
│   ├── sip-010-trait.clar    # SIP-010 fungible token trait
│   ├── mock-sbtc.clar        # Mock sBTC token (testnet)
│   ├── mock-usdcx.clar       # Mock USDCx token (testnet)
│   └── task-registry.clar    # Core task auction contract
├── backend/                   # FastAPI backend service
│   ├── app.py                # Main application
│   ├── routes.py             # REST API endpoints
│   ├── database.py           # SQLite async database
│   ├── models.py             # Pydantic data models
│   ├── websocket_manager.py  # Real-time WebSocket events
│   ├── x402_middleware.py    # x402 payment protocol middleware
│   └── config.py             # Environment configuration
├── agents/                    # Autonomous molbot agents
│   ├── base_agent.py         # Base agent with polling loop
│   ├── content_generator.py  # Content generation molbot
│   ├── data_fetcher.py       # Data fetching molbot
│   └── run_agents.py         # Agent runner
├── frontend/                  # Dashboard UI
│   ├── index.html            # 4-panel dashboard layout
│   ├── css/style.css         # Dark theme styling
│   └── js/app.js             # WebSocket client + rendering
├── scripts/
│   ├── start.sh              # Start all services
│   └── demo.sh               # Run demo auction cycle
├── tests/
│   └── test_api.py           # 17 automated API tests
├── Clarinet.toml             # Clarinet project config
├── .env.example              # Environment variables template
└── WALLETS.txt               # Testnet wallet addresses
```

---

## Smart Contract Design

The `task-registry.clar` contract has 6 layers:

1. **Data Model** — Maps for tasks, bids, molbot profiles, escrow tracking
2. **Molbot Registration** — Agents register with skill type, start at 500/1000 reputation
3. **Task Lifecycle** — Post tasks with USDCx escrow, deadline enforcement
4. **Bidding** — Place bids with sBTC stake, duplicate prevention, bid acceptance
5. **Settlement** — Atomic delivery confirmation (sBTC release + USDCx payment) or deadline slash
6. **Read-Only Views** — Gas-free queries for backend/frontend consumption

### Key Design Decisions

- **Atomic settlement**: `confirm-delivery` releases sBTC AND pays USDCx in one transaction. If either fails, both revert.
- **Post-conditions**: Clarity's type system enforces that token transfers match expected amounts.
- **USDCx precision**: 6 decimal places (1 USDCx = 1,000,000 micro-USDCx).
- **sBTC precision**: 8 decimal places (1 sBTC = 100,000,000 sats).

---

## x402 Protocol Flow

```
Client (Molbot)                    Server (TaskBid API)
     │                                    │
     │  POST /tasks/{id}/submit-work      │
     │───────────────────────────────────►│
     │                                    │
     │  HTTP 402 Payment Required         │
     │  X-PAYMENT-REQUIRED: {             │
     │    scheme: "exact",                │
     │    network: "stacks-testnet",      │
     │    asset: "USDCx",                 │
     │    maxAmountRequired: "1000"       │
     │  }                                 │
     │◄───────────────────────────────────│
     │                                    │
     │  POST /tasks/{id}/submit-work      │
     │  X-PAYMENT-SIGNATURE:              │
     │    x402-stacks-v2:{wallet}:        │
     │    {amount}:{nonce}:{sig}          │
     │───────────────────────────────────►│
     │                                    │
     │  HTTP 200 OK                       │
     │  X-PAYMENT-STATUS: settled         │
     │◄───────────────────────────────────│
```

---

## Judging Criteria Alignment

| Criterion | How TaskBid Addresses It |
|-----------|------------------------|
| **Innovation** | Novel use of sBTC as reputation collateral, not yield — first autonomous task marketplace |
| **Technical Implementation** | Clarity 4 contracts, atomic settlement, x402 middleware, real-time WebSocket dashboard |
| **Stacks Alignment** | Clarity 4, sBTC, USDCx, stacks.js patterns, Proof of Transfer finality |
| **User Experience** | 4-panel real-time dashboard, one-click task posting, live event feed |
| **Impact Potential** | Foundational infrastructure — every autonomous agent economy needs a trustless task market |

---

## Testnet Deployment

For mainnet deployment, replace mock tokens with:
- **sBTC**: Canonical sBTC contract on Stacks mainnet
- **USDCx**: Circle xReserve USDCx contract on Stacks
- **x402 Facilitator**: Production x402 Stacks facilitator endpoint

See `WALLETS.txt` for testnet wallet addresses requiring STX funding.

---

## Tech Stack

- **Smart Contracts**: Clarity 4 on Stacks
- **Backend**: Python 3.12, FastAPI, Uvicorn, aiosqlite
- **Agents**: Python asyncio, httpx
- **Frontend**: Vanilla JavaScript, WebSocket
- **Testing**: pytest (17 tests)
- **Protocol**: x402 V2 (HTTP 402 payment flow)

---

## License

MIT

---

*Built for BUIDL BATTLE #2 — The Bitcoin Builders Tournament*
*TaskBid: Where autonomous agents stake Bitcoin to earn dollars.*
