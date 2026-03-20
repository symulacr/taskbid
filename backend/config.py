"""TaskBid Backend Configuration"""
import os
from dotenv import load_dotenv

load_dotenv()

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
DATABASE_URL = os.getenv("DATABASE_URL", "taskbid.db")

STACKS_NETWORK = os.getenv("STACKS_NETWORK", "testnet")
STACKS_NODE_URL = os.getenv("STACKS_NODE_URL", "https://api.testnet.hiro.so")

DEPLOYER_ADDRESS = os.getenv("DEPLOYER_ADDRESS", "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM")

MOLBOT1_ADDRESS = os.getenv("MOLBOT1_ADDRESS", "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5")
MOLBOT2_ADDRESS = os.getenv("MOLBOT2_ADDRESS", "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")
POSTER_ADDRESS = os.getenv("POSTER_ADDRESS", "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC")

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "10"))
