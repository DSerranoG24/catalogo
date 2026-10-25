const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const testFiles = [
  "src/routes/product-list.routes.test.ts",
  "src/app.test.ts",
  "src/schemas/catalog.schema.test.ts",
  "src/schemas/order.schema.test.ts",
  "src/repositories/order-idempotency.test.ts",
  "src/services/order-calculation.test.ts",
  "src/services/product-pricing.test.ts",
  "src/schemas/product-review.test.ts",
  "src/schemas/product-review.schema.test.ts",
  "src/utils/image-validation.test.ts",
  "src/services/quotation-pdf.test.ts",
  "src/repositories/order-quotation.test.ts",
  "src/controllers/quotation.controller.test.ts",
  "src/schemas/quotation-fields.test.ts",
  "src/controllers/public-order-resilience.test.ts",
  "src/repositories/quotation-issue.test.ts",
  "src/services/product-import.test.ts",
  "src/routes/product-import.routes.test.ts",
  "src/repositories/catalog-write-lock.test.ts",
  "src/proxy-rate-limit.test.ts",
];

function isUserInfoSystemError(error) {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && error.code === "ERR_SYSTEM_ERROR"
    && "syscall" in error
    && error.syscall === "uv_os_get_passwd";
}

if (require.main !== module) {
  if (process.platform === "win32" && typeof process.geteuid !== "function") {
    process.geteuid = () => 1;
  }
} else {
  const env = { ...process.env };
  const needsWindowsFallback = process.platform === "win32" && typeof process.geteuid !== "function";

  if (needsWindowsFallback) {
    try {
      os.userInfo();
    } catch (error) {
      if (!isUserInfoSystemError(error)) throw error;

      const preloadPath = path.resolve(__filename).replaceAll(path.sep, "/");
      const preloadOption = `--require="${preloadPath}"`;
      env.NODE_OPTIONS = [env.NODE_OPTIONS, preloadOption].filter(Boolean).join(" ");
      process.stderr.write("[test] Workaround de Windows activado para uv_os_get_passwd en el directorio temporal de tsx.\n");
    }
  }

  const tsxCli = require.resolve("tsx/cli");
  const result = spawnSync(process.execPath, [tsxCli, "--test", ...testFiles, ...process.argv.slice(2)], {
    env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
