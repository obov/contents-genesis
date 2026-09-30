import { resolve } from "node:path";
import { runProduction } from "./src/runner.ts";

// Modules may live in node_modules; the project is the caller's working directory.
await runProduction(
  process.argv.slice(2),
  resolve(process.env.CG_PROJECT_ROOT ?? process.cwd()),
);
