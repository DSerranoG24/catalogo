import "dotenv/config";
import app from "./app";
import { startAccountClosureWorker } from "./services/account-closure-worker";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  startAccountClosureWorker();
  console.log(`Catalog API ejecutándose en http://localhost:${PORT}`);
});
