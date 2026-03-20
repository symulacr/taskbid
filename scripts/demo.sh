#!/bin/bash
# TaskBid — Demo Runner
# Posts a task and triggers the full auction cycle
# Run this AFTER start.sh is running

set -e

API="http://localhost:8000"

echo "========================================"
echo "  TaskBid — Demo Cycle"
echo "  Running full task auction loop..."
echo "========================================"

sleep 1

echo ""
echo "[Step 1] Posting a content generation task..."
TASK=$(curl -s -X POST "$API/api/tasks" \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT-SIGNATURE: x402-stacks-v2:ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC:1000:$(date +%s):demo" \
  -d '{
    "title": "Generate BTC market analysis report",
    "description": "Create a comprehensive analysis of Bitcoin market trends for Q1 2026 including price action, on-chain metrics, and institutional flows.",
    "skill_required": "content-generation",
    "reward_amount": 1500000,
    "required_stake": 100000000,
    "deadline_blocks": 100,
    "poster": "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC"
  }')
echo "  Result: $TASK"

sleep 3

echo ""
echo "[Step 2] Posting a data fetching task..."
TASK2=$(curl -s -X POST "$API/api/tasks" \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT-SIGNATURE: x402-stacks-v2:ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC:1000:$(date +%s):demo" \
  -d '{
    "title": "Fetch Stacks DeFi TVL data",
    "description": "Retrieve current TVL data for all Stacks DeFi protocols including sBTC deposits, USDCx liquidity pools, and Bitflow trading volume.",
    "skill_required": "data-fetching",
    "reward_amount": 800000,
    "required_stake": 100000000,
    "deadline_blocks": 50,
    "poster": "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC"
  }')
echo "  Result: $TASK2"

echo ""
echo "========================================"
echo "  Tasks posted! Watch the dashboard at"
echo "  http://localhost:3000"
echo "  Molbots will discover and bid on tasks"
echo "  within the next polling cycle (~10s)"
echo "========================================"
echo ""
echo "The full cycle: Post → Bid → Accept → Execute → Pay"
echo "Watch the Live Events panel for real-time updates"
