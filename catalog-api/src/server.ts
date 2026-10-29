import "dotenv/config";
import app from "./app";
import { startAccountClosureWorker } from "./services/account-closure-worker";
import { startProductImageCleanupWorker } from "./services/product-image-cleanup-worker";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  startAccountClosureWorker();
  startProductImageCleanupWorker();
  console.log(`Catalog API ejecutándose en http://localhost:${PORT}`);
});
