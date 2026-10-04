import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repo = resolve(import.meta.dir, ".."),
  main = resolve(repo, "src/cli/main.ts"),
  roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function cg(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [main, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CG_ACTOR: "test", CLAUDECODE: "" },
  });
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}
const history = (root: string) =>
  readFileSync(resolve(root, ".cg/history.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

function init(...extra: string[]) {
  const root = mkdtempSync(resolve(tmpdir(), "cg-ctx-"));
  roots.push(root);
  const r = cg(root, "init", ".", "--id", "demo", "--no-install", ...extra);
  if (!r.ok) throw new Error(r.err);
  mkdirSync(resolve(root, "node_modules"), { recursive: true });
  symlinkSync(repo, resolve(root, "node_modules/contents-genesis"), "dir");
  return root;
}

test("init writes a baseline, the cg-context skill and the SessionStart hook", () => {
  const root = init("--no-renderer");
  const [baseline] = history(root);
  expect(baseline.source).toBe("baseline");
  expect(
    baseline.changes.filter(
      (c: { kind: string }) => c.kind === "module_present",
    ),
  ).toHaveLength(7);
  const settings = JSON.parse(
    readFileSync(resolve(root, ".claude/settings.json"), "utf8"),
  );
  expect(JSON.stringify(settings.hooks.SessionStart)).toContain(
    "cg context --brief",
  );
  expect(
    JSON.parse(readFileSync(resolve(root, "project.json"), "utf8")).skills,
  ).toContain("cg-context");
  // Installing twice does not duplicate the hook.
  expect(JSON.parse(cg(root, "context", "hook").out).already).toBe(true);
});

test("cg commands and direct edits are both tracked", () => {
  const root = init("--no-renderer");
  cg(root, "module", "remove", "experiments");
  cg(root, "module", "new", "scenes");
  cg(root, "pipeline", "new", "voice");

  // Direct edits outside cg: local module files + project.json option.
  appendFileSync(
    resolve(root, "modules/scenes/README.md"),
    "\nedited by hand\n",
  );
  const config = JSON.parse(
    readFileSync(resolve(root, "project.json"), "utf8"),
  );
  config.production.pipelines.voice.speaker = "jinwoo";
  writeFileSync(resolve(root, "project.json"), JSON.stringify(config, null, 2));
  cg(root, "doctor");

  const entries = history(root);
  const commands = entries.filter((e) => e.source === "cg");
  expect(commands.map((e) => e.command)).toEqual([
    "module remove experiments",
    "module new scenes",
    "pipeline new voice",
  ]);
  expect(commands[0].actor).toBe("test");
  expect(commands[0].changes[0]).toEqual({
    kind: "module_removed",
    target: "experiments (@cg/experiments)",
  });
  expect(commands[2].changes).toContainEqual({
    kind: "pipeline_added",
    target: "voice (./pipelines/voice)",
  });

  const external = entries.filter((e) => e.source === "external");
  expect(external).toHaveLength(1);
  expect(external[0].actor).toBe("unknown");
  expect(external[0].observed_by).toBe("test");
  expect(external[0].changes).toContainEqual({
    kind: "module_changed",
    target: "scenes (./modules/scenes)",
    detail: "files edited",
  });
  expect(external[0].changes).toContainEqual({
    kind: "pipeline_changed",
    target: "voice (./pipelines/voice)",
    detail: "options edited",
  });

  // No change → no new entry.
  const count = history(root).length;
  cg(root, "context", "--brief");
  expect(history(root).length).toBe(count);
});

test("context reports customizations, eject drift, pipelines and module details", () => {
  const root = init("--no-renderer");
  cg(root, "module", "eject", "production");
  writeFileSync(
    resolve(root, "modules/production/src/inputs.ts"),
    readFileSync(resolve(root, "modules/production/src/inputs.ts"), "utf8") +
      "\n// local tweak\n",
  );
  writeFileSync(resolve(root, "modules/production/NOTES.md"), "mine\n");
  cg(root, "pipeline", "new", "voice");

  const inv = JSON.parse(cg(root, "context", "--json").out);
  const production = inv.modules.find(
    (m: { id: string }) => m.id === "production",
  );
  expect(production.kind).toBe("ejected");
  expect(production.ejected.edited).toEqual(["src/inputs.ts"]);
  expect(production.ejected.added).toEqual(["NOTES.md"]);
  expect(production.ejected.upstream_changed).toBe(false);
  expect(inv.pipelines.map((p: { name: string }) => p.name)).toEqual(["voice"]);
  expect(inv.pipelines[0].operations).toHaveProperty("build");

  const brief = cg(root, "context", "--brief").out;
  expect(brief).toContain("production@1.1.0[ejected]");
  expect(brief).toContain("edited src/inputs.ts");
  expect(brief).toContain("voice*(./pipelines/voice: build)");
  expect(brief.split("\n").length).toBeLessThan(20);

  const full = cg(root, "context").out;
  expect(full).toContain("## Customizations");
  expect(full).toContain("`cg pipeline new voice`");

  const mod = cg(root, "context", "module", "production").out;
  expect(mod).toContain("`production.script@1.0.0` required: text");
  expect(mod).toContain("## Eject");
  expect(mod).toContain("module_changed production");

  const pipe = cg(root, "context", "pipeline", "voice").out;
  expect(pipe).toContain("`bun cg run production build ITEM`");

  expect(cg(root, "context", "module", "nope").ok).toBe(false);
});

test("context shows where a linked package module lives and its README", () => {
  const root = init("--no-renderer");
  const pkg = mkdtempSync(resolve(tmpdir(), "cg-pkg-"));
  roots.push(pkg);
  writeFileSync(
    resolve(pkg, "module.json"),
    JSON.stringify({
      manifest_version: "1.0.0",
      id: "demo",
      version: "0.1.0",
      requires_core: "1.x",
      types: [],
      relations: [],
    }),
  );
  writeFileSync(resolve(pkg, "README.md"), "# demo\n");
  symlinkSync(pkg, resolve(root, "node_modules/cg-demo"), "dir");
  const config = JSON.parse(
    readFileSync(resolve(root, "project.json"), "utf8"),
  );
  config.modules.push("cg-demo");
  writeFileSync(resolve(root, "project.json"), JSON.stringify(config));

  const demo = JSON.parse(cg(root, "context", "--json").out).modules.find(
    (m: { id: string }) => m.id === "demo",
  );
  expect(demo.shared).toBe(true);
  expect(demo.linked_to).toContain("cg-pkg-");
  expect(demo.docs).toBe("./node_modules/cg-demo/README.md");

  const mod = cg(root, "context", "module", "demo").out;
  expect(mod).toContain("- linked → ");
  expect(mod).toContain("shared with other projects");
  expect(mod).toContain("- docs: ./node_modules/cg-demo/README.md");

  // Builtins and plain local modules get no link line.
  expect(cg(root, "context", "module", "production").out).not.toContain(
    "linked →",
  );
});

test("context warns about unlinked skills and records of removed modules", () => {
  const root = init("--no-renderer");
  rmSync(resolve(root, ".agents/skills/cg-context"));
  const brief = cg(root, "context", "--brief").out;
  expect(brief).toContain("shared skill cg-context not linked");
});
