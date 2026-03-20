import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REWARD = 2_000_000;    // 2 USDCx (6 decimals)
const STAKE  = 100_000_000;  // 1 sBTC (8 decimals)

function mintTokens(simnet: any, deployer: string, poster: string, molbot: string) {
  simnet.callPublicFn("mock-sbtc",  "mint", [Cl.uint(STAKE * 10),  Cl.principal(poster)],  deployer);
  simnet.callPublicFn("mock-usdcx", "mint", [Cl.uint(REWARD * 10), Cl.principal(poster)],  deployer);
  simnet.callPublicFn("mock-sbtc",  "mint", [Cl.uint(STAKE * 10),  Cl.principal(molbot)],  deployer);
  simnet.callPublicFn("mock-usdcx", "mint", [Cl.uint(REWARD * 10), Cl.principal(molbot)],  deployer);
}

function postTask(simnet: any, poster: string, taskId: number) {
  const deadline = simnet.blockHeight + 100;
  return simnet.callPublicFn(
    "task-registry",
    "post-task",
    [
      Cl.stringAscii("Test analysis task"),
      Cl.stringAscii("Analyze Stacks DeFi TVL for Q1 2026"),
      Cl.stringAscii("content-generation"),
      Cl.uint(REWARD),
      Cl.uint(STAKE),
      Cl.uint(deadline),
    ],
    poster
  );
}

describe("task-registry: task posting", () => {
  it("poster can post a task and USDCx is escrowed", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer")!;
    const poster   = accounts.get("wallet_1")!;

    mintTokens(simnet, deployer, poster, poster);

    const { result } = postTask(simnet, poster, 1);
    expect(result).toBeOk(Cl.uint(1));

    const escrow = simnet.callReadOnlyFn("task-registry", "get-task-escrow", [Cl.uint(1)], deployer);
    expect(escrow.result).toBeUint(REWARD);

    // Verify task exists by checking the next-task-id incremented
    const nextId = simnet.callReadOnlyFn("task-registry", "get-next-task-id", [], deployer);
    expect(nextId.result).toBeUint(2); // started at 1, now at 2
  });

  it("rejects task with zero reward", () => {
    const accounts  = simnet.getAccounts();
    const poster    = accounts.get("wallet_1")!;
    const deadline  = simnet.blockHeight + 100;

    const { result } = simnet.callPublicFn(
      "task-registry",
      "post-task",
      [
        Cl.stringAscii("Bad task"),
        Cl.stringAscii("desc"),
        Cl.stringAscii("content-generation"),
        Cl.uint(0),
        Cl.uint(STAKE),
        Cl.uint(deadline),
      ],
      poster
    );
    expect(result).toBeErr(Cl.uint(110)); // ERR-INVALID-AMOUNT
  });
});

describe("task-registry: bidding with sBTC stake", () => {
  it("molbot can place a bid and sBTC is staked", () => {
    const accounts  = simnet.getAccounts();
    const deployer  = accounts.get("deployer")!;
    const poster    = accounts.get("wallet_1")!;
    const molbot    = accounts.get("wallet_2")!;

    mintTokens(simnet, deployer, poster, molbot);
    const { result: postResult } = postTask(simnet, poster, 1);
    expect(postResult).toBeOk(Cl.uint(1));

    const { result } = simnet.callPublicFn(
      "task-registry",
      "place-bid",
      [Cl.uint(1), Cl.uint(1_800_000)],
      molbot
    );
    expect(result).toBeOk(Cl.uint(1));

    const stake = simnet.callReadOnlyFn("task-registry", "get-bid-stake", [Cl.uint(1)], deployer);
    expect(stake.result).toBeUint(STAKE);
  });

  it("poster cannot bid on their own task", () => {
    const accounts  = simnet.getAccounts();
    const deployer  = accounts.get("deployer")!;
    const poster    = accounts.get("wallet_1")!;
    const molbot    = accounts.get("wallet_2")!;

    mintTokens(simnet, deployer, poster, molbot);
    postTask(simnet, poster, 1);

    const { result } = simnet.callPublicFn(
      "task-registry",
      "place-bid",
      [Cl.uint(1), Cl.uint(1_800_000)],
      poster
    );
    expect(result).toBeErr(Cl.uint(109)); // ERR-SELF-BID
  });

  it("duplicate bid is rejected", () => {
    const accounts  = simnet.getAccounts();
    const deployer  = accounts.get("deployer")!;
    const poster    = accounts.get("wallet_1")!;
    const molbot    = accounts.get("wallet_2")!;

    mintTokens(simnet, deployer, poster, molbot);
    postTask(simnet, poster, 1);

    simnet.callPublicFn("task-registry", "place-bid", [Cl.uint(1), Cl.uint(1_800_000)], molbot);
    const { result } = simnet.callPublicFn(
      "task-registry",
      "place-bid",
      [Cl.uint(1), Cl.uint(1_800_000)],
      molbot
    );
    expect(result).toBeErr(Cl.uint(104)); // ERR-ALREADY-BID
  });
});

describe("task-registry: full delivery lifecycle — atomic sBTC + USDCx settlement", () => {
  it("post -> bid -> accept -> submit -> confirm releases stake and pays USDCx reward", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer")!;
    const poster   = accounts.get("wallet_1")!;
    const molbot   = accounts.get("wallet_2")!;

    mintTokens(simnet, deployer, poster, molbot);
    const { result: postResult } = postTask(simnet, poster, 1);
    expect(postResult).toBeOk(Cl.uint(1));

    expect(simnet.callPublicFn("task-registry", "place-bid",
      [Cl.uint(1), Cl.uint(1_800_000)], molbot).result).toBeOk(Cl.uint(1));

    expect(simnet.callPublicFn("task-registry", "accept-bid",
      [Cl.uint(1)], poster).result).toBeOk(Cl.bool(true));

    expect(simnet.callPublicFn("task-registry", "submit-work",
      [Cl.uint(1), Cl.stringAscii("proof of work delivered")], molbot).result).toBeOk(Cl.bool(true));

    const { result } = simnet.callPublicFn("task-registry", "confirm-delivery",
      [Cl.uint(1)], poster);
    expect(result).toBeOk(Cl.bool(true));

    // Task should be COMPLETED (status = 3)
    const task = simnet.callReadOnlyFn("task-registry", "get-task", [Cl.uint(1)], deployer);
    const taskData = (task.result as any).value.data;
    expect(taskData.status).toBeUint(3);

    // Escrow cleared
    const escrow = simnet.callReadOnlyFn("task-registry", "get-task-escrow", [Cl.uint(1)], deployer);
    expect(escrow.result).toBeUint(0);
  });
});

describe("task-registry: slashing expired tasks", () => {
  it("stake goes to insurance pool when deadline passes without delivery", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer")!;
    const poster   = accounts.get("wallet_1")!;
    const molbot   = accounts.get("wallet_2")!;

    mintTokens(simnet, deployer, poster, molbot);

    // Post with short deadline (current block + 5)
    const deadline = simnet.blockHeight + 5;
    simnet.callPublicFn(
      "task-registry",
      "post-task",
      [
        Cl.stringAscii("Short deadline task"),
        Cl.stringAscii("desc"),
        Cl.stringAscii("data-fetching"),
        Cl.uint(REWARD),
        Cl.uint(STAKE),
        Cl.uint(deadline),
      ],
      poster
    );

    simnet.callPublicFn("task-registry", "place-bid", [Cl.uint(1), Cl.uint(REWARD)], molbot);
    simnet.callPublicFn("task-registry", "accept-bid", [Cl.uint(1)], poster);

    // Mine past the deadline
    simnet.mineEmptyBlocks(10);

    const { result } = simnet.callPublicFn("task-registry", "slash-expired", [Cl.uint(1)], deployer);
    expect(result).toBeOk(Cl.bool(true));

    // Insurance pool = slashed stake
    const pool = simnet.callReadOnlyFn("task-registry", "get-insurance-pool", [], deployer);
    expect(pool.result).toBeUint(STAKE);

    // Task should be EXPIRED (status = 4)
    const task = simnet.callReadOnlyFn("task-registry", "get-task", [Cl.uint(1)], deployer);
    const taskData = (task.result as any).value.data;
    expect(taskData.status).toBeUint(4);
  });
});
