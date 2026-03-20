#!/bin/bash
# TaskBid — Start All Services
# Usage: ./scripts/start.sh

set -e

# Change to repo root regardless of where script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "========================================"
echo "  TaskBid — Autonomous Molbot Auction"
echo "  Starting all services..."
echo "========================================"

# Copy env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[+] Created .env from .env.example"
fi

# Create/activate venv at repo root
if [ ! -d .venv ]; then
  echo "[+] Creating virtual environment..."
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r backend/requirements.txt 2>/dev/null

# Start backend
echo "[1/3] Starting FastAPI backend..."
cd backend
uvicorn app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..
echo "  Backend PID: $BACKEND_PID"
sleep 2

# Start molbot agents
echo "[2/3] Starting molbot agents..."
cd agents
python3 run_agents.py &
AGENTS_PID=$!
cd ..
echo "  Agents PID: $AGENTS_PID"

# Start frontend (simple HTTP server)
echo "[3/3] Starting frontend dashboard..."
cd frontend
python3 -m http.server 3000 &
FRONTEND_PID=$!
cd ..
echo "  Frontend PID: $FRONTEND_PID"

echo ""
echo "========================================"
echo "  All services running!"
echo "  Dashboard:  http://localhost:3000"
echo "  API:        http://localhost:8000"
echo "  API Docs:   http://localhost:8000/docs"
echo "========================================"
echo ""
echo "Press Ctrl+C to stop all services"

# Trap SIGINT to kill all processes
trap "echo 'Stopping...'; kill $BACKEND_PID $AGENTS_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait
wait
