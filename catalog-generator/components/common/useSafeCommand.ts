"use client";

import { useCallback, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { InventoryRetryKeys } from "@/lib/inventory-retry";
import { describeFailure, intentFingerprint, type Failure } from "@/lib/sales-ui.mjs";

export type SafeCommand = {
  /** Stable name of the user's intention, e.g. "confirm" or "void". */
  action: string;
  /** Resource the intention applies to ("new" when it creates one). */
  resourceId: string;
  path: string;
  method: "POST" | "PATCH";
  /** Business content, without operationId/requestId. */
  body: Record<string, unknown>;
  /** Endpoints whose schema has no requestId (PATCH /sales/:id) send none. */
  withRequestId: boolean;
  /** Text shown while the request is in flight. */
  label: string;
};
export type SafeCommandFailure = Failure & { code?: string; command: SafeCommand };
export type FailureDescriber = (error: unknown) => Failure;

/**
 * Safe submissions shared by Ventas and Gastos: one operationId per user intention (double clicks
 * and "Reintentar" reuse it), a new requestId on every transmission, and one request at a time.
 */
export function useSafeCommand(describe: FailureDescriber = describeFailure) {
  const keys = useRef(new InventoryRetryKeys());
  const inFlight = useRef(false);
  const last = useRef<{ command: SafeCommand; onSuccess: (reply: unknown) => Promise<void> | void } | null>(null);
  const describer = useRef(describe);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<SafeCommandFailure | null>(null);

  const run = useCallback(async (command: SafeCommand, onSuccess: (reply: unknown) => Promise<void> | void) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(command.label); setFailure(null);
    last.current = { command, onSuccess };
    const fingerprint = intentFingerprint(command.action, command.resourceId, command.body);
    const operationId = keys.current.keyFor(fingerprint);
    const body = { operationId, ...(command.withRequestId ? { requestId: crypto.randomUUID() } : {}), ...command.body };
    try {
      const reply = await apiRequest<unknown>(command.path, { method: command.method, body: JSON.stringify(body) });
      keys.current.complete(fingerprint);
      last.current = null;
      await onSuccess(reply);
      return true;
    } catch (error) {
      setFailure({ ...describer.current(error), code: error instanceof ApiError ? error.code : undefined, command });
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
