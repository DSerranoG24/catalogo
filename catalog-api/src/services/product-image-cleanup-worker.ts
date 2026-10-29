import { prisma } from "../config/prisma";
import { assertProductImagePath } from "../repositories/product-image-cleanup.repository";
import type { ClosureStorage } from "./account-closure-worker";

export async function runProductImageCleanupBatch(storage: Pick<ClosureStorage, "remove">, database = prisma) {
  return database.$transaction(async tx => {
    const jobs = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM product_image_cleanup_tasks
      WHERE state = 'PENDING' AND "nextAttemptAt" <= CURRENT_TIMESTAMP
      ORDER BY "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1
    `;
    if (!jobs[0]) return false;
    const task = await tx.productImageCleanupTask.findUniqueOrThrow({ where: { id: jobs[0].id } });
    try {
      if (task.bucket !== "product-images") throw new Error("INVALID_CLEANUP_BUCKET");
      assertProductImagePath(task.path, task.catalogId);
      // Never remove an object still shared by a remaining image reference.
      if (await tx.productImage.findFirst({ where: { url: task.path }, select: { id: true } })) throw new Error("IMAGE_STILL_REFERENCED");
      await storage.remove([task.path]);
    } catch {
      const delay = Math.min(3600_000, 30_000 * 2 ** Math.min(task.attempts, 7));
      await tx.productImageCleanupTask.update({ where: { id: task.id }, data: {
        attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + delay),
      } });
      return false;
    }
    // Remote success followed by rollback leaves the task available for idempotent removal.
    await tx.productImageCleanupTask.delete({ where: { id: task.id } });
    return true;
  }, { timeout: 30000 });
}

export function startProductImageCleanupWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { closureStorage } = await import("./storage.service.js");
      // Bound work per tick; SKIP LOCKED coordinates other API instances.
      for (let count = 0; count < 10; count++) {
        if (!await runProductImageCleanupBatch(closureStorage)) break;
      }
    } catch { /* Persisted tasks remain available after outages and interrupted commits. */ }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 30000);
  timer.unref();
  return timer;
}
