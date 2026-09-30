import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Catalog, draft, relationDraft } from "../../core/catalog.ts";
import type { Draft } from "../../core/model.ts";
import { followupStatus } from "../../modules/followups/src/status.ts";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "cg-followup-"));
  roots.push(root);
  cpSync(resolve(import.meta.dir, "../../modules"), resolve(root, "modules"), {
    recursive: true,
    filter: (source) =>
      !source.includes("/node_modules") &&
      !source.includes("/collector") &&
      !source.includes("/renderers"),
  });
  cpSync(
    resolve(import.meta.dir, "../fixtures/project.json"),
    resolve(root, "project.json"),
  );
  return new Catalog(root);
}
const write = (c: Catalog, ...records: Draft[]) =>
  c.commit(
    records.map((record) => ({ record, expected_revision: 0 })),
    "process:test",
  );

test("many-to-many followups require evidence and published full answers; correction reopens only affected item", () => {
  const c = setup(),
    event = draft("followups", "followups.event", "event", {
      event_kind: "earnings",
      timing: {},
    }),
    other = draft("followups", "followups.event", "other event", {
      event_kind: "earnings",
      timing: {},
    });
  const items = [1, 2, 3].map((i) =>
    draft("followups", "followups.checkpoint", "item " + i, {
      question: "Q" + i,
    }),
  );
  const evidence = draft("sources", "sources.document", "official result", {
    source_kind: "official",
  });
  const published = draft("publication", "publication.item", "answer A", {
    platform: "youtube",
    external_id: "fixture-a",
    status: "published",
    published_at: "2026-10-02T00:00:00Z",
    observed_at: "2026-10-02T00:00:00Z",
    uploaded_artifact_match: "unknown",
  });
  const scheduled = draft("publication", "publication.item", "answer B", {
    platform: "youtube",
    external_id: "fixture-b",
    status: "scheduled",
    observed_at: "2026-10-02T00:00:00Z",
    uploaded_artifact_match: "unknown",
  });
  write(
    c,
    event,
    other,
    ...items,
    evidence,
    published,
    scheduled,
    ...items.map((item) =>
      relationDraft(
        "followups",
        "followups.part_of",
        { id: item.id },
        { id: event.id },
      ),
    ),
    relationDraft(
      "followups",
      "followups.part_of",
      { id: items[0]!.id },
      { id: other.id },
    ),
  );
  const proofs = {
    evidence_refs: [{ id: evidence.id, revision: 1 }],
    assertion_state: "verified" as const,
  };
  const results = items.map((item, index) =>
    relationDraft(
      "followups",
      "followups.result",
      { id: evidence.id, revision: 1 },
      { id: item.id, revision: 1 },
      {
        ...proofs,
        scope: { result_status: index === 2 ? "not_disclosed" : "confirmed" },
      },
    ),
  );
  const answer = (publication: Draft, index: number, coverage: string) =>
    relationDraft(
      "followups",
      "followups.answers",
      { id: publication.id, revision: 1 },
      { id: items[index]!.id, revision: 1 },
      { ...proofs, scope: { coverage, explanation: "fixture explanation" } },
    );
  write(
    c,
    ...results,
    answer(published, 0, "full"),
    answer(published, 1, "partial"),
    answer(scheduled, 2, "full"),
  );
  expect(followupStatus(c, event.id).items.map((i) => i.explanation)).toEqual([
    "complete",
    "partial",
    "not_started",
  ]);
  expect(followupStatus(c, other.id).status).toBe("complete");
  expect(followupStatus(c, event.id).items[2]!.result).toBe("not_disclosed");
  c.commit(
    [
      {
        expected_revision: 1,
        record: {
          ...scheduled,
          attributes: {
            ...scheduled.attributes,
            status: "published",
            published_at: "2026-10-03T00:00:00Z",
          },
        },
      },
    ],
    "process:test",
  );
  const secondVideoAnswer = answer(scheduled, 1, "full");
  secondVideoAnswer.relation!.from.revision = 2;
  write(c, secondVideoAnswer, answer(published, 2, "full"));
  expect(followupStatus(c, event.id).items[1]!.answer_links).toHaveLength(2);
  expect(followupStatus(c, event.id).status).toBe("complete");
  c.commit(
    [
      {
        expected_revision: 1,
        record: {
          ...results[1]!,
          relation: { ...results[1]!.relation!, assertion_state: "disputed" },
        },
      },
    ],
    "process:correction",
  );
  expect(followupStatus(c, event.id).items.map((i) => i.explanation)).toEqual([
    "complete",
    "partial",
    "complete",
  ]);
  expect(followupStatus(c, event.id).status).toBe("partial");
  expect(c.get(results[1]!.id, 1)?.relation?.assertion_state).toBe("verified");
  c.commit(
    [
      {
        expected_revision: 1,
        record: { ...items[0]!, attributes: { question: "Changed scope" } },
      },
    ],
    "process:correction",
  );
  expect(followupStatus(c, other.id).status).toBe("waiting");
});

test("published answer with unknown exact publication time can complete a checkpoint", () => {
  const c = setup(),
    event = draft("followups", "followups.event", "event", {
      event_kind: "earnings",
      timing: {},
    }),
    item = draft("followups", "followups.checkpoint", "item", {
      question: "Q",
    }),
    evidence = draft("sources", "sources.document", "evidence", {
      source_kind: "official",
    }),
    publication = draft(
      "publication",
      "publication.item",
      "published",
      {
        platform: "youtube",
        external_id: "published-unknown-time",
        status: "published",
        published_at: null,
        observed_at: "2026-09-29T00:00:00Z",
        uploaded_artifact_match: "unknown",
      },
      { type_version: "1.1.0" },
    ),
    proof = {
      assertion_state: "verified" as const,
      evidence_refs: [{ id: evidence.id, revision: 1 }],
    };
  write(
    c,
    event,
    item,
    evidence,
    publication,
    relationDraft(
      "followups",
      "followups.part_of",
      { id: item.id },
      { id: event.id },
    ),
    relationDraft(
      "followups",
      "followups.result",
      { id: evidence.id, revision: 1 },
      { id: item.id, revision: 1 },
      { ...proof, scope: { result_status: "confirmed" } },
    ),
    relationDraft(
      "followups",
      "followups.answers",
      { id: publication.id, revision: 1 },
      { id: item.id, revision: 1 },
      {
        ...proof,
        scope: { coverage: "full", explanation: "verified answer" },
      },
    ),
  );
  expect(followupStatus(c, event.id).items[0]?.explanation).toBe("complete");
  expect(followupStatus(c, event.id).status).toBe("complete");
});
