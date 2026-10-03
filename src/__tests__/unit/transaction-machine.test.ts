/**
 * V2-FE-009 — Unit tests for the shared transaction state machine reducer.
 *
 * Coverage:
 *  - Full happy path (idle → preparing → signature-requested → submitted
 *      → confirming → safe → finalized)
 *  - User rejection at signature-requested
 *  - Revert path (confirming → reverted)
 *  - Drop path (submitted → dropped)
 *  - Wrong-network guard at PREPARE
 *  - Stale receipt guard at CONFIRM
 *  - Contradiction guard (reverted → MARK_SAFE must throw)
 *  - Synthetic success guard (idle → FINALIZE must throw)
 *  - RETRY from reverted / dropped → idle
 *  - RESET from any state → idle
 *  - Indexing path (safe → indexing → finalized)
 *  - Replaced path (submitted → replaced)
 */

import { transitionTxState } from "@/lib/transaction-machine/transaction-machine";
import {
  createIdleState,
  TransactionMachineError,
  OPTIMISM_CHAIN_IDS,
  type TransactionState,
} from "@/lib/transaction-machine/transaction-machine.types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OP_MAINNET = OPTIMISM_CHAIN_IDS[0]; // 10
const OP_SEPOLIA = OPTIMISM_CHAIN_IDS[1]; // 11155420
const HARDHAT = 31337;
const WRONG_CHAIN = 1; // Ethereum mainnet — not allowed

const MOCK_HASH_1 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const satisfies `0x${string}`;
const MOCK_HASH_2 =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const satisfies `0x${string}`;

function idle(): TransactionState {
  return createIdleState();
}

// ---------------------------------------------------------------------------
// Helper to drive through multiple transitions
// ---------------------------------------------------------------------------

function drive(
  states: Parameters<typeof transitionTxState>[1][],
  opts?: Parameters<typeof transitionTxState>[2],
): TransactionState {
  return states.reduce(
    (state, event) => transitionTxState(state, event, opts),
    idle(),
  );
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("Happy path — idle → finalized", () => {
  it("transitions idle → preparing on PREPARE with valid chain", () => {
    const next = transitionTxState(idle(), {
      type: "PREPARE",
      chainId: OP_MAINNET,
    });
    expect(next.status).toBe("preparing");
    expect(next.chainId).toBe(OP_MAINNET);
    expect(next.txHash).toBeNull();
  });

  it("transitions preparing → signature-requested on REQUEST_SIGNATURE", () => {
    const state = drive([{ type: "PREPARE", chainId: OP_MAINNET }]);
    const next = transitionTxState(state, { type: "REQUEST_SIGNATURE" });
    expect(next.status).toBe("signature-requested");
    expect(next.txHash).toBeNull();
  });

  it("transitions signature-requested → submitted on SUBMIT", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
    ]);
    const next = transitionTxState(state, {
      type: "SUBMIT",
      txHash: MOCK_HASH_1,
    });
    expect(next.status).toBe("submitted");
    expect(next.txHash).toBe(MOCK_HASH_1);
  });

  it("transitions submitted → confirming on CONFIRM", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
    ]);
    const next = transitionTxState(state, {
      type: "CONFIRM",
      blockNumber: BigInt(100),
      confirmations: 1,
      receiptChainId: OP_MAINNET,
    });
    expect(next.status).toBe("confirming");
    expect(next.txHash).toBe(MOCK_HASH_1);
    if (next.status === "confirming") {
      expect(next.blockNumber).toBe(BigInt(100));
      expect(next.confirmations).toBe(1);
    }
  });

  it("transitions confirming → safe on MARK_SAFE", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
    ]);
    const next = transitionTxState(state, { type: "MARK_SAFE" });
    expect(next.status).toBe("safe");
    expect(next.txHash).toBe(MOCK_HASH_1);
  });

  it("transitions safe → finalized on FINALIZE", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
      { type: "MARK_SAFE" },
    ]);
    const next = transitionTxState(state, { type: "FINALIZE" });
    expect(next.status).toBe("finalized");
    expect(next.txHash).toBe(MOCK_HASH_1);
    expect(next.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// User rejection
// ---------------------------------------------------------------------------

describe("User rejection path", () => {
  it("transitions signature-requested → idle on USER_REJECTED", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
    ]);
    const next = transitionTxState(state, { type: "USER_REJECTED" });
    expect(next.status).toBe("idle");
    expect(next.txHash).toBeNull();
  });

  it("transitions preparing → idle on USER_REJECTED", () => {
    const state = drive([{ type: "PREPARE", chainId: OP_MAINNET }]);
    const next = transitionTxState(state, { type: "USER_REJECTED" });
    expect(next.status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Revert path
// ---------------------------------------------------------------------------

describe("Revert path", () => {
  it("transitions confirming → reverted on REVERT", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
    ]);
    const next = transitionTxState(state, { type: "REVERT" });
    expect(next.status).toBe("reverted");
    expect(next.txHash).toBe(MOCK_HASH_1);
    if (next.status === "reverted") {
      expect(next.error).toBe("REVERT");
    }
  });

  it("reverted is a terminal state — does NOT transition to safe", () => {
    const reverted = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
      { type: "REVERT" },
    ]);
    expect(() => transitionTxState(reverted, { type: "MARK_SAFE" })).toThrow(
      TransactionMachineError,
    );
  });

  it("reverted allows RETRY → idle", () => {
    const reverted = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
      { type: "REVERT" },
    ]);
    const next = transitionTxState(reverted, { type: "RETRY" });
    expect(next.status).toBe("idle");
    expect(next.txHash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Drop path
// ---------------------------------------------------------------------------

describe("Drop path", () => {
  it("transitions submitted → dropped on DROP", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
    ]);
    const next = transitionTxState(state, { type: "DROP" });
    expect(next.status).toBe("dropped");
    if (next.status === "dropped") {
      expect(next.error).toBe("DROPPED");
    }
  });

  it("dropped allows RETRY → idle", () => {
    const dropped = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      { type: "DROP" },
    ]);
    const next = transitionTxState(dropped, { type: "RETRY" });
    expect(next.status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Replaced path
// ---------------------------------------------------------------------------

describe("Replaced path", () => {
  it("transitions submitted → replaced on REPLACE", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
    ]);
    const next = transitionTxState(state, {
      type: "REPLACE",
      replacedBy: MOCK_HASH_2,
    });
    expect(next.status).toBe("replaced");
    if (next.status === "replaced") {
      expect(next.replacedBy).toBe(MOCK_HASH_2);
    }
  });

  it("transitions confirming → replaced on REPLACE", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
    ]);
    const next = transitionTxState(state, {
      type: "REPLACE",
      replacedBy: MOCK_HASH_2,
    });
    expect(next.status).toBe("replaced");
  });
});

// ---------------------------------------------------------------------------
// Wrong-network guard
// ---------------------------------------------------------------------------

describe("Wrong-network guard", () => {
  it("throws WRONG_NETWORK when PREPARE is called with an unsupported chain (production mode)", () => {
    expect(() =>
      transitionTxState(idle(), { type: "PREPARE", chainId: WRONG_CHAIN }),
    ).toThrow(TransactionMachineError);

    try {
      transitionTxState(idle(), { type: "PREPARE", chainId: WRONG_CHAIN });
    } catch (err) {
      expect(err).toBeInstanceOf(TransactionMachineError);
      expect((err as TransactionMachineError).reason).toBe("WRONG_NETWORK");
    }
  });

  it("accepts OP Mainnet (10)", () => {
    const next = transitionTxState(idle(), {
      type: "PREPARE",
      chainId: OP_MAINNET,
    });
    expect(next.status).toBe("preparing");
  });

  it("accepts OP Sepolia (11155420)", () => {
    const next = transitionTxState(idle(), {
      type: "PREPARE",
      chainId: OP_SEPOLIA,
    });
    expect(next.status).toBe("preparing");
  });

  it("rejects Hardhat (31337) in production mode (allowLocalDev = false)", () => {
    expect(() =>
      transitionTxState(
        idle(),
        { type: "PREPARE", chainId: HARDHAT },
        { allowLocalDev: false },
      ),
    ).toThrow(TransactionMachineError);
  });

  it("accepts Hardhat (31337) in dev mode (allowLocalDev = true)", () => {
    const next = transitionTxState(
      idle(),
      { type: "PREPARE", chainId: HARDHAT },
      { allowLocalDev: true },
    );
    expect(next.status).toBe("preparing");
  });
});

// ---------------------------------------------------------------------------
// Stale-receipt guard
// ---------------------------------------------------------------------------

describe("Stale receipt guard", () => {
  it("throws STALE_RECEIPT when receipt chainId ≠ submission chainId", () => {
    const state = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
    ]);

    expect(() =>
      transitionTxState(state, {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_SEPOLIA, // different chain!
      }),
    ).toThrow(TransactionMachineError);

    try {
      transitionTxState(state, {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_SEPOLIA,
      });
    } catch (err) {
      expect((err as TransactionMachineError).reason).toBe("STALE_RECEIPT");
    }
  });
});

// ---------------------------------------------------------------------------
// Contradiction / synthetic-success guards
// ---------------------------------------------------------------------------

describe("Contradiction and synthetic-success guards", () => {
  it("throws INVALID_TRANSITION on idle → FINALIZE (synthetic success)", () => {
    expect(() => transitionTxState(idle(), { type: "FINALIZE" })).toThrow(
      TransactionMachineError,
    );
  });

  it("throws INVALID_TRANSITION on idle → MARK_SAFE", () => {
    expect(() => transitionTxState(idle(), { type: "MARK_SAFE" })).toThrow(
      TransactionMachineError,
    );
  });

  it("throws INVALID_TRANSITION on idle → SUBMIT (no hash fabrication path)", () => {
    expect(() =>
      transitionTxState(idle(), { type: "SUBMIT", txHash: MOCK_HASH_1 }),
    ).toThrow(TransactionMachineError);
  });
});

// ---------------------------------------------------------------------------
// RESET from any state → idle
// ---------------------------------------------------------------------------

describe("RESET from any state", () => {
  const statesToTest: { label: string; state: TransactionState }[] = [
    {
      label: "preparing",
      state: drive([{ type: "PREPARE", chainId: OP_MAINNET }]),
    },
    {
      label: "signature-requested",
      state: drive([
        { type: "PREPARE", chainId: OP_MAINNET },
        { type: "REQUEST_SIGNATURE" },
      ]),
    },
    {
      label: "submitted",
      state: drive([
        { type: "PREPARE", chainId: OP_MAINNET },
        { type: "REQUEST_SIGNATURE" },
        { type: "SUBMIT", txHash: MOCK_HASH_1 },
      ]),
    },
    {
      label: "confirming",
      state: drive([
        { type: "PREPARE", chainId: OP_MAINNET },
        { type: "REQUEST_SIGNATURE" },
        { type: "SUBMIT", txHash: MOCK_HASH_1 },
        {
          type: "CONFIRM",
          blockNumber: BigInt(100),
          confirmations: 1,
          receiptChainId: OP_MAINNET,
        },
      ]),
    },
  ];

  statesToTest.forEach(({ label, state }) => {
    it(`resets from ${label} to idle`, () => {
      const next = transitionTxState(state, { type: "RESET" });
      expect(next.status).toBe("idle");
      expect(next.txHash).toBeNull();
      expect(next.error).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Indexing path
// ---------------------------------------------------------------------------

describe("Indexing path", () => {
  it("transitions safe → indexing → finalized", () => {
    const safe = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
      { type: "MARK_SAFE" },
    ]);
    expect(safe.status).toBe("safe");

    const indexing = transitionTxState(safe, { type: "INDEXING" });
    expect(indexing.status).toBe("indexing");

    const finalized = transitionTxState(indexing, { type: "FINALIZE" });
    expect(finalized.status).toBe("finalized");
    expect(finalized.txHash).toBe(MOCK_HASH_1);
  });
});

// ---------------------------------------------------------------------------
// Reorg path
// ---------------------------------------------------------------------------

describe("Reorg path", () => {
  it("transitions confirming → reorged on REORG", () => {
    const confirming = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
    ]);
    const reorged = transitionTxState(confirming, { type: "REORG" });
    expect(reorged.status).toBe("reorged");
    if (reorged.status === "reorged") {
      expect(reorged.txHash).toBe(MOCK_HASH_1);
      expect(reorged.error).toBe("REORG");
      expect(reorged.blockNumber).toBe(BigInt(100));
    }
  });

  it("transitions safe → reorged on REORG", () => {
    const safe = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
      { type: "MARK_SAFE" },
    ]);
    const reorged = transitionTxState(safe, { type: "REORG" });
    expect(reorged.status).toBe("reorged");
  });

  it("reorged is a terminal failure state and allows RETRY → idle", () => {
    const reorged = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
      { type: "REORG" },
    ]);
    expect(reorged.status).toBe("reorged");
    const next = transitionTxState(reorged, { type: "RETRY" });
    expect(next.status).toBe("idle");
    expect(next.txHash).toBeNull();
  });

  it("throws INVALID_TRANSITION on reorged → safe or finalized (no synthetic recovery)", () => {
    const reorged = drive([
      { type: "PREPARE", chainId: OP_MAINNET },
      { type: "REQUEST_SIGNATURE" },
      { type: "SUBMIT", txHash: MOCK_HASH_1 },
      {
        type: "CONFIRM",
        blockNumber: BigInt(100),
        confirmations: 1,
        receiptChainId: OP_MAINNET,
      },
      { type: "REORG" },
    ]);
    expect(() => transitionTxState(reorged, { type: "MARK_SAFE" })).toThrow(
      TransactionMachineError,
    );
    expect(() => transitionTxState(reorged, { type: "FINALIZE" })).toThrow(
      TransactionMachineError,
    );
  });
});
