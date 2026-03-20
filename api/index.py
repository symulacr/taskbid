import sys
import os

# Resolve backend directory regardless of Vercel's working directory
_here = os.path.dirname(os.path.abspath(__file__))
_backend = os.path.join(_here, "..", "backend")
sys.path.insert(0, os.path.abspath(_backend))

# Load .env if present (local dev only; Vercel injects env vars directly)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_here, "..", ".env"))
except ImportError:
    pass

from app import app  # noqa: F401 — Vercel ASGI handler
