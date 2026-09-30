import type { Catalog } from "contents-genesis/core";
import type { RecordData, Ref } from "contents-genesis/core";

// Completion follows evidence and actual publication, never a video count.
export function followupStatus(catalog: Catalog, eventId: string) {
  const snapshot = catalog.snapshot(),
    latest = [...snapshot.latest.values()];
  const event = snapshot.latest.get(eventId);
  if (event?.type !== "followups.event")
    throw new Error("Expected a followups.event ID");
  const links = latest.filter(
    (r) =>
      r.type === "core.relation" &&
      r.lifecycle === "active" &&
      r.relation?.assertion_state !== "disputed" &&
      r.relation?.assertion_state !== "proposed",
  );
  const checkpoints = latest.filter(
    (r) =>
      r.type === "followups.checkpoint" &&
      r.lifecycle === "active" &&
      links.some(
        (l) =>
          l.relation!.predicate === "followups.part_of" &&
          l.relation!.from.id === r.id &&
          l.relation!.to.id === eventId,
      ),
  );
  const resolve = (ref: Ref) =>
    snapshot.all.find((r) => r.id === ref.id && r.revision === ref.revision);
  const hasEvidence = (r: RecordData) =>
    r.relation!.assertion_state === "verified" &&
    r.relation!.evidence_refs.length > 0 &&
    r.relation!.evidence_refs.every((ref) => !!resolve(ref));
  const items = checkpoints.map((item) => {
    const matches = (r: RecordData) =>
      r.relation!.to.id === item.id &&
      r.relation!.to.revision === item.revision;
    const results = links.filter(
      (r) =>
        r.relation!.predicate === "followups.result" &&
        matches(r) &&
        hasEvidence(r),
    );
    const answers = links.filter((r) => {
      if (
        r.relation!.predicate !== "followups.answers" ||
        !matches(r) ||
        !hasEvidence(r)
      )
        return false;
      const publication = resolve(r.relation!.from);
      return publication?.attributes.status === "published";
    });
    const resultStates = [
      ...new Set(results.map((r) => r.relation!.scope.result_status)),
    ];
    const resultState =
      resultStates.length === 0
        ? "waiting"
        : resultStates.length === 1
          ? resultStates[0]
          : "conflicting";
    const complete =
      resultStates.length === 1 &&
      answers.some((r) => r.relation!.scope.coverage === "full");
    return {
      id: item.id,
      title: item.title,
      revision: item.revision,
      result: resultState,
      explanation: complete
        ? "complete"
        : answers.length
          ? "partial"
          : "not_started",
      result_links: results.map((r) => r.id),
      answer_links: answers.map((r) => r.id),
    };
  });
  return {
    id: event.id,
    title: event.title,
    status:
      items.length && items.every((i) => i.explanation === "complete")
        ? "complete"
        : items.some((i) => i.explanation !== "not_started")
          ? "partial"
          : "waiting",
    items,
  };
}
