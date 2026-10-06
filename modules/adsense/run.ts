import { resolve } from "node:path";
import { runAdsense } from "./src/commands.ts";

try {
  runAdsense(
    process.argv.slice(2),
    resolve(process.env.CG_PROJECT_ROOT ?? process.cwd()),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
