#!/bin/bash
# TaskBid — Deploy Clarity contracts to Stacks testnet
# Prerequisites:
#   - Clarinet installed (https://docs.hiro.so/clarinet/getting-started)
#   - DEPLOYER_MNEMONIC set in .env (24-word seed for testnet wallet)
#   - Testnet STX funded via https://explorer.hiro.so/sandbox/faucet?chain=testnet
#
# Usage: ./scripts/deploy.sh [testnet|devnet]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

NETWORK="${1:-devnet}"

# Load env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "========================================"
echo "  TaskBid — Contract Deployment"
echo "  Network: $NETWORK"
echo "========================================"

# Check Clarinet is installed
if ! command -v clarinet &>/dev/null; then
  echo ""
  echo "ERROR: clarinet not found. Install it first:"
  echo "  curl -L clarinet.sh | sh"
  echo "  # or: https://docs.hiro.so/clarinet/getting-started"
  exit 1
fi

echo ""
echo "[1/3] Checking contracts..."
clarinet check
echo "  All contracts OK"

if [ "$NETWORK" = "devnet" ]; then
  echo ""
  echo "[2/3] Starting Clarinet devnet..."
  echo "  Run contract tests first:"
  clarinet test
  echo ""
  echo "[3/3] Devnet deployment complete."
  echo "  Contracts available at devnet principal."
  echo "  Run: clarinet console to interact."

elif [ "$NETWORK" = "testnet" ]; then
  echo ""
  echo "[2/3] Deploying to Stacks testnet..."
  echo "  Deployer: $DEPLOYER_ADDRESS"
  echo ""

  # Deploy in dependency order
  for CONTRACT in sip-010-trait mock-sbtc mock-usdcx task-registry; do
    echo "  Deploying $CONTRACT..."
    clarinet deploy --network testnet contracts/${CONTRACT}.clar \
      2>&1 | tail -3
    sleep 3
  done

  echo ""
  echo "[3/3] Minting test tokens to demo addresses..."
  echo "  (Run the following in clarinet console after deployment)"
  cat <<'EOF'

-- Mint sBTC to molbots and poster (run in clarinet console):
(contract-call? .mock-sbtc mint u500000000 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5)
(contract-call? .mock-sbtc mint u500000000 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG)
(contract-call? .mock-sbtc mint u500000000 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC)

-- Mint USDCx to poster:
(contract-call? .mock-usdcx mint u100000000 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC)

EOF

  echo "  Verify deployment at:"
  echo "  https://explorer.hiro.so/address/$DEPLOYER_ADDRESS?chain=testnet"

else
  echo "Unknown network: $NETWORK. Use 'devnet' or 'testnet'."
  exit 1
fi

echo ""
echo "========================================"
echo "  Deployment complete!"
echo "========================================"
