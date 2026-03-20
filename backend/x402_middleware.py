"""TaskBid x402 Mock Middleware — Demonstrates the x402 payment protocol flow"""
import json
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


# Routes that require x402 payment
PROTECTED_ROUTES = [
    "/api/tasks",
    "/api/bids",
    "/api/tasks/{task_id}/submit-work",
    "/api/tasks/{task_id}/confirm",
]


def is_protected(path: str) -> bool:
    """Check if a path matches any protected route pattern."""
    for pattern in PROTECTED_ROUTES:
        # Simple pattern matching: replace {task_id} with any number
        parts = pattern.split("{task_id}")
        if len(parts) == 2:
            prefix, suffix = parts
            if path.startswith(prefix) and path.endswith(suffix):
                middle = path[len(prefix):len(path) - len(suffix)] if suffix else path[len(prefix):]
                if middle.isdigit():
                    return True
        elif path == pattern:
            return True
    return False


def create_payment_requirements(path: str) -> dict:
    """Generate x402 payment requirements for a protected route."""
    return {
        "x402Version": 2,
        "accepts": [
            {
                "scheme": "exact",
                "network": "stacks-testnet",
                "maxAmountRequired": "1000",  # 0.001 USDCx micro-payment
                "resource": path,
                "description": "TaskBid x402 micropayment for molbot service access",
                "mimeType": "application/json",
                "payTo": "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
                "asset": {
                    "address": "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.mock-usdcx",
                    "symbol": "USDCx",
                    "decimals": 6,
                },
                "extra": {
                    "facilitatorUrl": "http://localhost:8000/x402/facilitate",
                    "name": "TaskBid x402 Stacks Facilitator",
                }
            }
        ],
    }


def validate_payment_signature(signature: str) -> bool:
    """Validate an x402 payment signature.

    In production, this would verify the payment with the x402 facilitator.
    For the demo, we accept any well-formed signature.
    """
    if not signature:
        return False
    # Accept format: x402-stacks-v2:{wallet}:{amount}:{nonce}:{sig}
    parts = signature.split(":")
    if len(parts) >= 4 and parts[0] == "x402-stacks-v2":
        return True
    # Also accept "demo" mode signatures
    if signature.startswith("x402-demo-"):
        return True
    return False


class X402Middleware(BaseHTTPMiddleware):
    """x402 Payment Required middleware.

    Implements the x402 protocol flow:
    1. Client requests a protected resource
    2. Server responds with 402 Payment Required + PAYMENT-REQUIRED header
    3. Client pays via x402 and retries with PAYMENT-SIGNATURE header
    4. Server verifies payment and grants access
    """

    async def dispatch(self, request: Request, call_next):
        if request.method != "POST":
            return await call_next(request)

        if not is_protected(request.url.path):
            return await call_next(request)

        # Check for payment signature
        payment_sig = request.headers.get("X-PAYMENT-SIGNATURE", "")

        if not payment_sig:
            # Return 402 Payment Required with payment requirements
            requirements = create_payment_requirements(request.url.path)
            return JSONResponse(
                status_code=402,
                content={
                    "error": "Payment Required",
                    "message": "This endpoint requires an x402 USDCx micropayment",
                    "paymentRequirements": requirements,
                },
                headers={
                    "X-PAYMENT-REQUIRED": json.dumps(requirements),
                },
            )

        # Validate payment
        if not validate_payment_signature(payment_sig):
            return JSONResponse(
                status_code=401,
                content={
                    "error": "Invalid Payment",
                    "message": "The x402 payment signature is invalid or expired",
                },
            )

        # Payment verified — proceed with request
        response = await call_next(request)
        response.headers["X-PAYMENT-STATUS"] = "settled"
        response.headers["X-PAYMENT-TX"] = f"0x{int(time.time()):x}{'0' * 48}"
        return response
