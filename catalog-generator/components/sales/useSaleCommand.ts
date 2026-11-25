"use client";

import { useCallback, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { InventoryRetryKeys } from "@/lib/inventory-retry";
import { describeFailure, intentFingerprint, type Failure } from "@/lib/sales-ui.mjs";

export type SaleCommand = {
  /** Stable name of the user's intention, e.g. "confirm". */
  action: string;
  saleId: string;
  path: string;
  method: "POST" | "PATCH";
  /** Business content, without operationId/requestId. */
  body: Record<string, unknown>;
  /** PATCH /sales/:id does not accept requestId. */
  withRequestId: boolean;
  /** Text shown while the request is in flight. */
  label: string;
};
export type CommandFailure = Failure & { code?: string; command: SaleCommand };

/**
 * One operationId per user intention: double clicks and retries of the same intention reuse it,
 * every transmission gets a new requestId, and only one request runs at a time.
 */
export function useSaleCommand() {
  const keys = useRef(new InventoryRetryKeys());
  const inFlight = useRef(false);
  const last = useRef<{ command: SaleCommand; onSuccess: (reply: unknown) => Promise<void> | void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<CommandFailure | null>(null);

  const run = useCallback(async (command: SaleCommand, onSuccess: (reply: unknown) => Promise<void> | void) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(command.label); setFailure(null);
    last.current = { command, onSuccess };
    const fingerprint = intentFingerprint(command.action, command.saleId, command.body);
    const operationId = keys.current.keyFor(fingerprint);
    const body = { operationId, ...(command.withRequestId ? { requestId: crypto.randomUUID() } : {}), ...command.body };
    try {
      const reply = await apiRequest<unknown>(command.path, { method: command.method, body: JSON.stringify(body) });
      keys.current.complete(fingerprint);
      last.current = null;
      await onSuccess(reply);
      return true;
    } catch (error) {
      setFailure({ ...describeFailure(error), code: error instanceof ApiError ? error.code : undefined, command });
      return false;
    } finally {
      inFlight.current = false; setBusy(null);
    }
  }, []);

  /** Re-sends the failed intention: same operationId, new requestId. */
  const retry = useCallback(() => {
    const previous = last.current;
    return previous ? run(previous.command, previous.onSuccess) : Promise.resolve(false);
  }, [run]);

  const clearFailure = useCallback(() => setFailure(null), []);
  return { run, retry, busy, failure, clearFailure };
}
