import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { definePipeline } from "contents-genesis/production";

/**
 * {{id}} pipeline. Run: bun cg run production <operation> <ITEM>
 * Items live in workspace/stores/production/inputs/projects.json:
 *   { "<ITEM>": { "pipeline": "{{id}}", ...fields this pipeline reads } }
 */
export default definePipeline({
  id: "{{id}}",
  version: "0.1.0",

  // Optional. When present, `production adopt ITEM` pins these inputs and
  // item operations require adoption (override per operation with `adopted`).
  // inputs: ({ inputs, item }) => ({
  //   text: readFileSync(resolve(inputs, String(item.script)), "utf8"),
  //   files: [String(item.script)],
  // }),

  // Optional. Populate ctx.stage before each operation.
  // prepare(ctx) {},

  operations: {
    build: {
      description: "Produce the {{id}} artifact for one item",
      async run(ctx) {
        const file = resolve(ctx.runDir, "{{id}}.txt");
        writeFileSync(
          file,
          `item ${ctx.selector}: ${JSON.stringify(ctx.item)}\n`,
        );
        // Use ctx.exec([...]) to run external tools; logs go to the run dir.
        return {
          artifacts: [{ file, kind: "document", media_type: "text/plain" }],
        };
      },
    },
  },
});
