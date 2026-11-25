"use client";

import { useCallback } from "react";
import { useSafeCommand, type SafeCommand, type SafeCommandFailure } from "@/components/common/useSafeCommand";

/** Ventas commands name their resource saleId; the shared hook calls it resourceId. */
export type SaleCommand = Omit<SafeCommand, "resourceId"> & { saleId: string };
export type CommandFailure = SafeCommandFailure;

/** Adapter over the shared safe-submission hook; same keys, fingerprints and behaviour as before. */
export function useSaleCommand() {
  const command = useSafeCommand();
  const { run: runSafe } = command;
  const run = useCallback((next: SaleCommand, onSuccess: (reply: unknown) => Promise<void> | void) => {
    const { saleId, ...rest } = next;
    return runSafe({ ...rest, resourceId: saleId }, onSuccess);
  }, [runSafe]);
  return { ...command, run };
}
