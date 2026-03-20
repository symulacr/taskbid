"""TaskBid — FastAPI Backend
Autonomous molbot-to-molbot task auction marketplace on Stacks
"""
import os
import sys

# Ensure backend directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

import database as db
from routes import router
from websocket_manager import manager
from x402_middleware import X402Middleware
from config import MOLBOT1_ADDRESS, MOLBOT2_ADDRESS, DEMO_MODE


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: initialize DB and seed demo data."""
    try:
        await db.init_db()
        if DEMO_MODE:
            await seed_demo_data()
    except Exception as e:
        # Log but don't crash — on Vercel cold starts the DB may not be ready instantly
        import logging
        logging.getLogger("taskbid").warning(f"Startup DB init failed (will retry on first request): {e}")
    yield


async def seed_demo_data():
    """Pre-register molbots for the demo."""
    existing1 = await db.get_molbot(MOLBOT1_ADDRESS)
    if not existing1:
        await db.register_molbot(MOLBOT1_ADDRESS, "content-generation", 1, "ContentBot")
    existing2 = await db.get_molbot(MOLBOT2_ADDRESS)
    if not existing2:
        await db.register_molbot(MOLBOT2_ADDRESS, "data-fetching", 1, "DataBot")


app = FastAPI(
    title="TaskBid API",
    description="Autonomous molbot-to-molbot task auction marketplace on Stacks",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow all origins for demo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# x402 Payment Required middleware
app.add_middleware(X402Middleware)

# API routes
app.include_router(router)


# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, receive any client messages
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# Health check
@app.get("/health")
async def health():
    return {"status": "ok", "service": "taskbid-api", "version": "1.0.0"}


# x402 facilitator mock endpoint
@app.post("/x402/facilitate")
async def x402_facilitate():
    """Mock x402 facilitator — verifies and settles payments.
    In production, this would be the x402 Stacks facilitator service.
    """
    return {
        "status": "settled",
        "network": "stacks-testnet",
        "txId": "0xdemo_settlement_tx",
    }


# Serve frontend static files when running locally (Vercel handles this via vercel.json)
if not os.environ.get("VERCEL"):
    frontend_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
    if os.path.isdir(frontend_path):
        app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
