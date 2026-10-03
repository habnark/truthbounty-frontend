"use client";

/**
 * V2-FE-009 — Shared Transaction State Machine
 * useTransactionMachine — React hook wrapping the pure reducer.
 *
 * Features:
 *  - Initializes from persisted localStorage state on mount (reload recovery)
 *  - Syncs to localStorage on every active state change
 *  - Clears persisted state when idle or after terminal success (finalized)
 *  - Typed `send(event)` validates the transition before applying
 *  - Safe retry: RETRY from reverted/dropped → idle
 *  - Callbacks: onFinalized, onReverted, onDropped fired exactly once per lifecycle
 */

import { useReducer, useEffect, useRef, useCallback } from "react";
import {
  type TransactionState,
  type TransactionEvent,
  type TransactionContext,
  TransactionMachineError,
  createIdleState,
} from "@/lib/transaction-machine/transaction-machine.types";
import { transitionTxState } from "@/lib/transaction-machine/transaction-machine";
import {
  persistTxState,
  hydrateTxState,
  clearTxState,
  createTxContext,
  updateTxContext,
} from "@/lib/transaction-machine/transaction-persistence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseTransactionMachineOptions {
  /** Stable, caller-assigned identifier for this transaction instance. Defaults to 'tx-default'. */
  id?: string;
  /** Human-readable label persisted with the context (for pending-tx lists). Defaults to 'Transaction'. */
  label?: string;
  /** Allow Hardhat chain ID 31337 during local development. Default: false. */
  allowLocalDev?: boolean;
  /** Called once when the transaction reaches the `finalized` state. */
  onFinalized?: (txHash: `0x${string}`) => void;
  /** Called once when the transaction reaches the `reverted` state. */
  onReverted?: (txHash: `0x${string}`) => void;
  /** Called once when the transaction is `dropped`. */
  onDropped?: () => void;
  /** Called once when a confirmed/safe transaction is reorged out. */
  onReorged?: (txHash: `0x${string}`) => void;
}

export interface UseTransactionMachineReturn {
  /** Current transaction state (discriminated union on `status`). */
  state: TransactionState;
  /** Send a typed event to advance the state machine. */
  send: (event: TransactionEvent) => void;
  /** The full persisted context (includes label, timestamps). */
  context: TransactionContext;
  /** Reset to idle and clear persisted state. */
  reset: () => void;
  /** Last transition error, if any (cleared on next successful transition). */
  lastError: TransactionMachineError | null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

interface ReducerState {
  context: TransactionContext;
  lastError: TransactionMachineError | null;
}

type ReducerAction =
  | { type: "TRANSITION"; event: TransactionEvent; allowLocalDev: boolean }
  | { type: "RESET"; id: string; label: string };

function reducer(state: ReducerState, action: ReducerAction): ReducerState {
  switch (action.type) {
    case "TRANSITION": {
      try {
        const nextTxState = transitionTxState(
          state.context.state,
          action.event,
          { allowLocalDev: action.allowLocalDev },
        );
        return {
          context: updateTxContext(state.context, nextTxState),
          lastError: null,
        };
      } catch (err) {
        const machineErr =
          err instanceof TransactionMachineError
            ? err
            : new TransactionMachineError("INVALID_TRANSITION", String(err));
        return { ...state, lastError: machineErr };
      }
    }
    case "RESET": {
      const freshCtx = createTxContext(action.id, action.label);
      return { context: freshCtx, lastError: null };
    }
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTransactionMachine(
  opts: UseTransactionMachineOptions = {},
): UseTransactionMachineReturn {
  const {
    id = "tx-default",
    label = "Transaction",
    allowLocalDev = false,
  } = opts;

  // Refs for callbacks — stable references, no need to restart effects
  const onFinalizedRef = useRef(opts.onFinalized);
  const onRevertedRef = useRef(opts.onReverted);
  const onDroppedRef = useRef(opts.onDropped);
  const onReorgedRef = useRef(opts.onReorged);
  useEffect(() => {
    onFinalizedRef.current = opts.onFinalized;
    onRevertedRef.current = opts.onReverted;
    onDroppedRef.current = opts.onDropped;
    onReorgedRef.current = opts.onReorged;
  }, [opts.onFinalized, opts.onReverted, opts.onDropped, opts.onReorged]);

  // Track whether terminal callbacks have fired for this lifecycle
  const callbackFiredRef = useRef<Set<string>>(new Set());

  // Initialize from persisted state or fresh context
  const [reducerState, dispatch] = useReducer(
    reducer,
    undefined,
    (): ReducerState => {
      const persisted = hydrateTxState(id);
      const context = persisted ?? createTxContext(id, label);
      return { context, lastError: null };
    },
  );

  const { context } = reducerState;
  const txState = context.state;

  // Sync to localStorage whenever state changes (clearing when idle)
  useEffect(() => {
    if (txState.status === "idle") {
      clearTxState(id);
    } else {
      persistTxState(context);
    }
  }, [context, txState.status, id]);

  // Fire terminal callbacks (each fires at most once per lifecycle)
  useEffect(() => {
    const status = txState.status;
    const callbackKey = `${status}:${txState.txHash ?? "no-hash"}`;

    if (callbackFiredRef.current.has(callbackKey)) return;

    if (status === "finalized" && txState.txHash) {
      callbackFiredRef.current.add(callbackKey);
      onFinalizedRef.current?.(txState.txHash);
      // Clear persisted state after finalization
      clearTxState(id);
    } else if (status === "reverted" && txState.txHash) {
      callbackFiredRef.current.add(callbackKey);
      onRevertedRef.current?.(txState.txHash);
    } else if (status === "dropped") {
      callbackFiredRef.current.add(callbackKey);
      onDroppedRef.current?.();
    } else if (status === "reorged" && txState.txHash) {
      callbackFiredRef.current.add(callbackKey);
      onReorgedRef.current?.(txState.txHash);
    }
  }, [txState, id]);

  const send = useCallback(
    (event: TransactionEvent) => {
      dispatch({ type: "TRANSITION", event, allowLocalDev });
    },
    [allowLocalDev],
  );

  const reset = useCallback(() => {
    clearTxState(id);
    callbackFiredRef.current.clear();
    dispatch({ type: "RESET", id, label });
  }, [id, label]);

  return {
    state: txState,
    send,
    context,
    reset,
    lastError: reducerState.lastError,
  };
}

// ---------------------------------------------------------------------------
// Re-export commonly needed types for convenience
// ---------------------------------------------------------------------------
export type {
  TransactionState,
  TransactionEvent,
  TransactionContext,
  TransactionMachineError,
};
export {
  isTerminalSuccess,
  isTerminalFailure,
} from "@/lib/transaction-machine/transaction-machine.types";
