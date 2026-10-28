import { prisma } from "../config/prisma";

export type ClosureStorage = {
  list(prefix: string, offset: number): Promise<{ name: string; folder: boolean }[]>;
  remove(paths: string[]): Promise<void>;
};

export function assertOwnedStoragePath(path: string, catalogIds: string[]) {
  if (!catalogIds.some(id => path.startsWith(`${id}/`)) || path.split("/").some(part => !part || part === "." || part === "..") || path.includes("\\")) throw new Error("INVALID_CLEANUP_PATH");
}

export async function runAccountClosureBatch(storage: ClosureStorage, database = prisma) {
  let jobId: string | undefined;
  try {
    return await database.$transaction(async tx => {
      const jobs = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM account_closure_jobs
        WHERE phase <> 'COMPLETE' OR "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
        ORDER BY "updatedAt", id FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      if (!jobs[0]) return false;
      jobId = jobs[0].id;
      const job = await tx.accountClosureJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.phase === "COMPLETE") {
        // Reconcile late remote completions after an upload timeout or process crash.
        await tx.accountClosureJob.update({ where: { id: job.id }, data: {
          phase: "PENDING", scanQueue: job.catalogIds, scanOffset: 0, pendingPaths: [], attempts: { increment: 1 },
        } });
        return true;
      }
      if (job.phase === "PENDING") {
        const prefix = job.scanQueue[0];
        if (!prefix) {
          await tx.accountClosureJob.update({ where: { id: job.id }, data: { phase: "CLEANING", attempts: { increment: 1 } } });
          return true;
        }
        if (!job.catalogIds.some(id => prefix === id || prefix.startsWith(`${id}/`))) throw new Error("INVALID_CLEANUP_PREFIX");
        const entries = await storage.list(prefix, job.scanOffset);
        const folders: string[] = [];
        const paths: string[] = [];
        for (const entry of entries) {
          if (!entry.name || entry.name.includes("/") || entry.name.includes("\\") || entry.name === "." || entry.name === "..") throw new Error("INVALID_STORAGE_ENTRY");
          const path = `${prefix}/${entry.name}`;
          assertOwnedStoragePath(path, job.catalogIds);
          (entry.folder ? folders : paths).push(path);
        }
        await tx.accountClosureJob.update({ where: { id: job.id }, data: {
          scanQueue: [...(entries.length < 100 ? job.scanQueue.slice(1) : job.scanQueue), ...folders],
          scanOffset: entries.length < 100 ? 0 : job.scanOffset + 100,
          pendingPaths: [...new Set([...job.pendingPaths, ...paths])], attempts: { increment: 1 },
        } });
        return true;
      }
      const batch = job.pendingPaths.slice(0, 100);
      if (batch.length) {
        batch.forEach(path => assertOwnedStoragePath(path, job.catalogIds));
        await storage.remove(batch);
        // If the DB commit fails after Storage succeeds, retrying removal is safe.
        await tx.accountClosureJob.update({ where: { id: job.id }, data: { pendingPaths: job.pendingPaths.slice(batch.length), attempts: { increment: 1 } } });
        return true;
      }
      await tx.$executeRaw`SET LOCAL app.account_closure_worker = 'on'`;
      await tx.product.deleteMany({ where: { catalog: { userId: job.userId } } });
      await tx.category.deleteMany({ where: { catalog: { userId: job.userId } } });
      await tx.catalogBanner.deleteMany({ where: { catalog: { userId: job.userId } } });
      await tx.catalog.deleteMany({ where: { userId: job.userId, orders: { none: {} } } });
      await tx.catalog.updateMany({ where: { userId: job.userId }, data: {
        name: "Catálogo cerrado", description: null, logoUrl: null, nit: null, quotationTerms: null,
        whatsappPhone: null, whatsappMessage: null, phone: null, address: null, businessHours: null,
        email: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, mapUrl: null,
      } });
      await tx.user.update({ where: { id: job.userId }, data: {
        email: `${job.userId}@closed.invalid`, passwordHash: null, googleId: null, emailVerifiedAt: null, name: null, role: "USER",
      } });
      await tx.accountClosureJob.update({ where: { id: job.id }, data: { phase: "COMPLETE", attempts: { increment: 1 } } });
      return true;
    }, { timeout: 30000 });
  } catch {
    if (jobId) await database.accountClosureJob.updateMany({ where: { id: jobId, phase: { not: "COMPLETE" } }, data: { attempts: { increment: 1 } } });
    // No paths, identities or provider errors in logs. State remains durable for retry.
    return false;
  }
}

export function startAccountClosureWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { closureStorage } = await import("./storage.service.js");
      await runAccountClosureBatch(closureStorage);
    } catch { /* Database unavailable: the next tick retries the persisted queue. */ }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 30000);
  timer.unref();
  return timer;
}
