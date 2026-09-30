import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Catalog, draft } from "../core/catalog.ts";

const main = resolve(import.meta.dir, "../src/cli/main.ts"),
  roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function cg(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [main, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}
const json = (r: { out: string }) => JSON.parse(r.out);
const project = (root: string) =>
  JSON.parse(readFileSync(resolve(root, "project.json"), "utf8"));

function init(...extra: string[]) {
  const root = mkdtempSync(resolve(tmpdir(), "cg-cli-"));
  roots.push(root);
  const r = cg(root, "init", ".", "--id", "demo", "--no-install", ...extra);
  if (!r.ok) throw new Error(r.err);
  return root;
}

test("init writes default builtin modules, templates and an empty workspace", () => {
  const root = init("--skills", "kit-browser-automation");
  const config = project(root);
  expect(config.id).toBe("demo");
  expect(config.modules).toContain("@cg/production");
  expect(config.modules.every((s: string) => s.startsWith("@cg/"))).toBe(true);
  expect(existsSync(resolve(root, "renderer/src/Root.tsx"))).toBe(true);
  expect(existsSync(resolve(root, "workspace/records/commits"))).toBe(true);
  expect(
    lstatSync(
      resolve(root, ".agents/skills/kit-browser-automation"),
    ).isSymbolicLink(),
  ).toBe(true);
  expect(lstatSync(resolve(root, ".claude/skills")).isSymbolicLink()).toBe(
    true,
  );
  expect(cg(root, "init", ".", "--no-install").ok).toBe(false);
});

test("init --modules pulls in required builtin dependencies", () => {
  const root = init("--modules", "publication", "--no-renderer");
  expect(project(root).modules).toEqual([
    "@cg/sources",
    "@cg/research",
    "@cg/production",
    "@cg/publication",
  ]);
  expect(existsSync(resolve(root, "renderer"))).toBe(false);
});

test("remove refuses dependents unless --cascade; add restores with dependencies", () => {
  const root = init("--no-renderer");
  const refused = cg(root, "module", "remove", "analytics");
  expect(refused.ok).toBe(false);
  expect(refused.err).toContain("experiments");

  const cascade = json(cg(root, "module", "remove", "analytics", "--cascade"));
  expect(cascade.removed.sort()).toEqual(["@cg/analytics", "@cg/experiments"]);
  expect(project(root).modules).not.toContain("@cg/analytics");

  const added = json(cg(root, "module", "add", "experiments"));
  expect(added[0].added).toEqual(["@cg/analytics", "@cg/experiments"]);
  expect(cg(root, "doctor").ok).toBe(true);
});

test("records of removed modules stay readable and validate again after re-adding", () => {
  const root = init("--no-renderer");
  const catalog = new Catalog(root),
    source = draft("sources", "sources.document", "doc", {
      source_kind: "official",
    });
  catalog.commit([{ expected_revision: 0, record: source }], "process:test");
  cg(root, "module", "remove", "sources", "--cascade");
  expect(project(root).modules).toEqual([]);
  const doctor = json(cg(root, "doctor"));
  expect(doctor.records).toBe(1);
  expect(doctor.unknown_types).toEqual([source.id]);
  cg(root, "module", "add", "sources");
  expect(json(cg(root, "doctor")).unknown_types).toEqual([]);
});

test("new scaffolds a local module that accepts records", () => {
  const root = init("--no-renderer");
  expect(cg(root, "module", "new", "scenes").ok).toBe(true);
  expect(project(root).modules).toContain("./modules/scenes");
  const catalog = new Catalog(root);
  catalog.commit(
    [
      {
        expected_revision: 0,
        record: draft("scenes", "scenes.item", "x", { summary: "ok" }),
      },
    ],
    "process:test",
  );
  expect(() =>
    catalog.commit(
      [
        {
          expected_revision: 0,
          record: draft("scenes", "scenes.item", "y", {}),
        },
      ],
      "process:test",
    ),
  ).toThrow();
  expect(cg(root, "module", "new", "production").ok).toBe(false);
  expect(cg(root, "module", "new", "Bad-Name").ok).toBe(false);
});

test("eject copies a builtin module locally and keeps the module set valid", () => {
  const root = init("--no-renderer");
  const r = json(cg(root, "module", "eject", "production"));
  expect(r.to).toBe("./modules/production");
  expect(project(root).modules).toContain("./modules/production");
  expect(project(root).modules).not.toContain("@cg/production");
  expect(existsSync(resolve(root, "modules/production/EJECTED.json"))).toBe(
    true,
  );
  const list = json(cg(root, "module", "list"));
  expect(
    list.installed.find((m: { id: string }) => m.id === "production").kind,
  ).toBe("local");
  expect(cg(root, "module", "eject", "production").ok).toBe(false);
});

test("invalid additions leave project.json unchanged", () => {
  const root = init("--no-renderer");
  const before = readFileSync(resolve(root, "project.json"), "utf8");
  expect(cg(root, "module", "add", "./nowhere").ok).toBe(false);
  cg(root, "module", "new", "broken");
  writeFileSync(
    resolve(root, "modules/broken/module.json"),
    JSON.stringify({
      manifest_version: "1.0.0",
      id: "broken",
      version: "0.1.0",
      requires_core: "9.x",
      types: [],
      relations: [],
    }),
  );
  const config = project(root);
  config.modules = config.modules.filter(
    (s: string) => s !== "./modules/broken",
  );
  writeFileSync(resolve(root, "project.json"), JSON.stringify(config));
  const snapshot = readFileSync(resolve(root, "project.json"), "utf8");
  expect(cg(root, "module", "add", "./modules/broken").ok).toBe(false);
  expect(readFileSync(resolve(root, "project.json"), "utf8")).toBe(snapshot);
  expect(before.length).toBeGreaterThan(0);
});

test("skills link, list and unlink without touching project-owned skills", () => {
  const root = init("--no-renderer");
  expect(cg(root, "skill", "add", "kit-chatgpt-image").ok).toBe(true);
  expect(project(root).skills).toEqual(["kit-chatgpt-image"]);
  const list = json(cg(root, "skill", "list"));
  expect(list.shared[0]).toEqual({ name: "kit-chatgpt-image", linked: true });
  expect(cg(root, "skill", "remove", "kit-chatgpt-image").ok).toBe(true);
  expect(existsSync(resolve(root, ".agents/skills/kit-chatgpt-image"))).toBe(
    false,
  );
  expect(cg(root, "skill", "add", "no-such-skill").ok).toBe(false);
});
