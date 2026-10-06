import {
  Catalog,
  draft,
  readJson,
  relationDraft,
  type Draft,
  type RecordData,
} from "contents-genesis/core";
import { CHECKS, verdict } from "./checklist.ts";

const OWNER = "adsense",
  ALIAS = "adsense.site",
  ACTOR = "process:adsense",
  STATUSES = [
    "preparing",
    "submitted",
    "approved",
    "rejected",
    "limited",
    "disabled",
  ];

const USAGE = `cg run adsense <command>
  checklist                                  신청 준비 점검 항목 (code · 필수 여부 · 확인 방법)
  site <url> --platform P --status S [--reason TEXT]
                                             사이트 등록 · 상태 갱신 (status: ${STATUSES.join(" | ")})
  readiness <url> <file.json>                점검 결과 기록. file: { "checks": [{ "code", "status": pass|fail|warn|na, "note" }] }
  earnings <url> <file.json>                 수익 기록. file: 기간 객체 또는 배열 (period_start · period_end · currency · estimated_earnings · source ...)
  status [url]                               사이트별 상태 · 최근 점검 · 수익 합계`;

function flag(args: string[], name: string) {
  const i = args.indexOf("--" + name);
  return i < 0 ? undefined : args[i + 1];
}

function requireSite(catalog: Catalog, url: string) {
  const site = catalog.resolveAlias(ALIAS, url);
  if (!site || site.type !== "adsense.site")
    throw new Error(`Unknown site: ${url} (run: cg run adsense site ${url} ...)`);
  return site;
}

function write(catalog: Catalog, drafts: { record: Draft; expected_revision: number }[]) {
  return catalog.commit(drafts, process.env.CG_ACTOR ?? ACTOR);
}

export function upsertSite(
  catalog: Catalog,
  url: string,
  platform: string | undefined,
  status: string | undefined,
  reason?: string,
) {
  const old = catalog.resolveAlias(ALIAS, url);
  if (!status || !STATUSES.includes(status))
    throw new Error(`--status required: ${STATUSES.join(" | ")}`);
  const resolvedPlatform = platform ?? (old?.attributes.platform as string | undefined);
  if (!resolvedPlatform) throw new Error("--platform required for a new site");
  // Catalog merges attributes across revisions; "" clears a previous reason.
  const attributes = {
    url,
    platform: resolvedPlatform,
    status,
    status_at: new Date().toISOString(),
    reason: reason ?? "",
  };
  const record = old
    ? { ...draft(OWNER, "adsense.site", url, attributes), id: old.id, aliases: old.aliases }
    : draft(OWNER, "adsense.site", url, attributes, {
        aliases: [{ namespace: ALIAS, value: url }],
      });
  write(catalog, [{ record, expected_revision: old?.revision ?? 0 }]);
  return { id: record.id, url, platform: resolvedPlatform, status };
}

export function recordReadiness(
  catalog: Catalog,
  url: string,
  checks: { code: string; status: string; note?: string }[],
) {
  const site = requireSite(catalog, url);
  const known = new Set(CHECKS.map((c) => c.code));
  const unknown = checks.filter((c) => !known.has(c.code)).map((c) => c.code);
  const result = verdict(checks);
  const record = draft(OWNER, "adsense.readiness", `${url} readiness`, {
    checked_at: new Date().toISOString(),
    verdict: result.verdict,
    checks,
  });
  write(catalog, [
    { record, expected_revision: 0 },
    {
      record: relationDraft(
        OWNER,
        "adsense.assesses",
        { id: record.id, revision: 1 },
        { id: site.id, revision: site.revision },
      ),
      expected_revision: 0,
    },
  ]);
  return { id: record.id, ...result, ...(unknown.length ? { unknown_codes: unknown } : {}) };
}

export function recordEarnings(
  catalog: Catalog,
  url: string,
  periods: Record<string, unknown>[],
) {
  const site = requireSite(catalog, url);
  const mutations: { record: Draft; expected_revision: number }[] = [];
  for (const period of periods) {
    const record = draft(
      OWNER,
      "adsense.earnings",
      `${url} ${period.period_start} ~ ${period.period_end}`,
      period,
    );
    mutations.push(
      { record, expected_revision: 0 },
      {
        record: relationDraft(
          OWNER,
          "adsense.earned_on",
          { id: record.id, revision: 1 },
          { id: site.id, revision: site.revision },
        ),
        expected_revision: 0,
      },
    );
  }
  write(catalog, mutations);
  return { recorded: periods.length };
}

const linked = (records: RecordData[], predicate: string, siteId: string) =>
  new Set(
    records
      .filter(
        (r) =>
          r.lifecycle === "active" &&
          r.relation?.predicate === predicate &&
          r.relation.to.id === siteId,
      )
      .map((r) => r.relation!.from.id),
  );

export function status(catalog: Catalog, url?: string) {
  const records = [...catalog.snapshot().latest.values()];
  const sites = records.filter(
    (r) =>
      r.type === "adsense.site" &&
      r.lifecycle === "active" &&
      (!url || r.attributes.url === url),
  );
  return sites.map((site) => {
    const readinessIds = linked(records, "adsense.assesses", site.id),
      earningIds = linked(records, "adsense.earned_on", site.id);
    const latest = records
      .filter((r) => readinessIds.has(r.id))
      .sort((a, b) =>
        String(a.attributes.checked_at).localeCompare(String(b.attributes.checked_at)),
      )
      .at(-1);
    const earnings = records
      .filter((r) => earningIds.has(r.id) && r.lifecycle === "active")
      .map((r) => r.attributes)
      .sort((a, b) => String(a.period_end).localeCompare(String(b.period_end)));
    const totals: Record<string, number> = {};
    for (const e of earnings)
      totals[String(e.currency)] =
        (totals[String(e.currency)] ?? 0) + Number(e.estimated_earnings);
    return {
      url: site.attributes.url,
      platform: site.attributes.platform,
      status: site.attributes.status,
      status_at: site.attributes.status_at,
      ...(site.attributes.reason ? { reason: site.attributes.reason } : {}),
      readiness: latest
        ? {
            checked_at: latest.attributes.checked_at,
            verdict: latest.attributes.verdict,
            blocking: verdict(latest.attributes.checks as { code: string; status: string }[])
              .blocking,
          }
        : null,
      earnings: {
        periods: earnings.length,
        last_period_end: earnings.at(-1)?.period_end ?? null,
        totals,
      },
    };
  });
}

export function runAdsense(args: string[], root: string) {
  const [command, ...rest] = args;
  if (!command || command === "help") return console.log(USAGE);
  if (command === "checklist") return print(CHECKS);
  const catalog = new Catalog(root);
  const url = rest[0];
  const need = (value: string | undefined, label: string) => {
    if (!value) throw new Error(`${label} required\n\n${USAGE}`);
    return value;
  };
  switch (command) {
    case "site":
      return print(
        upsertSite(
          catalog,
          need(url, "url"),
          flag(rest, "platform"),
          flag(rest, "status"),
          flag(rest, "reason"),
        ),
      );
    case "readiness": {
      const file = readJson<{ checks: { code: string; status: string; note?: string }[] }>(
        need(rest[1], "file.json"),
      );
      return print(recordReadiness(catalog, need(url, "url"), file.checks));
    }
    case "earnings": {
      const file = readJson<Record<string, unknown> | Record<string, unknown>[]>(
        need(rest[1], "file.json"),
      );
      return print(
        recordEarnings(catalog, need(url, "url"), Array.isArray(file) ? file : [file]),
      );
    }
    case "status":
      return print(status(catalog, url));
    default:
      throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
