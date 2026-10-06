import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Catalog } from "../../core/catalog.ts";
import { CHECKS } from "../../modules/adsense/src/checklist.ts";
import {
  recordEarnings,
  recordReadiness,
  status,
  upsertSite,
} from "../../modules/adsense/src/commands.ts";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "cg-adsense-"));
  roots.push(root);
  cpSync(resolve(import.meta.dir, "../../modules"), resolve(root, "modules"), {
    recursive: true,
    filter: (source) =>
      !source.includes("/node_modules") &&
      !source.includes("/collector") &&
      !source.includes("/renderers"),
  });
  const config = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../fixtures/project.json"), "utf8"),
  );
  config.modules.push("modules/adsense");
  writeFileSync(resolve(root, "project.json"), JSON.stringify(config));
  return new Catalog(root);
}
const URL = "https://example.blogspot.com";

test("site upsert keeps one record per url and tracks status revisions", () => {
  const c = setup();
  const a = upsertSite(c, URL, "blogger", "preparing");
  const b = upsertSite(c, URL, undefined, "rejected", "low value content");
  expect(b.id).toBe(a.id);
  expect(c.get(a.id)?.revision).toBe(2);
  expect(c.get(a.id)?.attributes).toMatchObject({
    platform: "blogger",
    status: "rejected",
    reason: "low value content",
  });
  upsertSite(c, URL, undefined, "approved");
  expect(c.get(a.id)?.attributes.reason).toBe("");
  expect(status(c)[0]).not.toHaveProperty("reason");
  expect(() => upsertSite(c, URL, undefined, "bogus")).toThrow("--status");
  expect(() => upsertSite(c, "https://new.example", undefined, "preparing")).toThrow(
    "--platform",
  );
});

test("readiness verdict is gated by required checks; status summarizes earnings", () => {
  const c = setup();
  upsertSite(c, URL, "blogger", "preparing");
  const pass = CHECKS.map((k) => ({ code: k.code, status: "pass" }));
  const failing = pass.map((k) =>
    k.code === "privacy_page" ? { ...k, status: "fail" } : k,
  );
  expect(recordReadiness(c, URL, failing)).toMatchObject({
    verdict: "not_ready",
    blocking: ["privacy_page"],
  });
  const optionalWarn = pass.map((k) =>
    k.code === "search_console" ? { ...k, status: "warn" } : k,
  );
  expect(recordReadiness(c, URL, optionalWarn).verdict).toBe("ready");
  recordEarnings(c, URL, [
    {
      period_start: "2026-11-01",
      period_end: "2026-11-30",
      currency: "USD",
      estimated_earnings: 12.5,
      source: "adsense-ui",
    },
    {
      period_start: "2026-12-01",
      period_end: "2026-12-31",
      currency: "USD",
      estimated_earnings: 20,
      source: "adsense-ui",
    },
  ]);
  const [summary] = status(c);
  expect(summary?.readiness?.verdict).toBe("ready");
  expect(summary?.earnings).toEqual({
    periods: 2,
    last_period_end: "2026-12-31",
    totals: { USD: 32.5 },
  });
  expect(() => recordReadiness(c, "https://missing.example", pass)).toThrow(
    "Unknown site",
  );
  expect(() =>
    recordEarnings(c, URL, [{ period_start: "2026-11-01", currency: "USD" }]),
  ).toThrow();
});
