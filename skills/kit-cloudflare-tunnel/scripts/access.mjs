#!/usr/bin/env node
// Cloudflare Access (Zero Trust) self-hosted 앱으로 호스트명 보호
// env: CLOUDFLARE_API_TOKEN (Account > Access: Apps and Policies > Edit), CLOUDFLARE_ACCOUNT_ID
//   ACCOUNT_ID 생략 시 /accounts 조회 (토큰에 Account Settings Read 필요. 없으면 0개 → 직접 지정)
// 사용:
//   node access.mjs list
//   node access.mjs protect <hostname> <email|@domain>[,...] [--session=24h] [--name=앱이름]
//   node access.mjs unprotect <hostname>
//   node access.mjs check <hostname>        (토큰 불필요. 미인증 요청이 Access 로그인으로 가는지 확인)
const API = "https://api.cloudflare.com/client/v4";
const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

async function api(method, path, body) {
  const token = process.env.CLOUDFLARE_API_TOKEN || die("CLOUDFLARE_API_TOKEN 없음");
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) die(`${method} ${path} → ${res.status} ${JSON.stringify(json.errors || json)}`);
  return json.result;
}

async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const accts = await api("GET", "/accounts");
  if (accts.length !== 1) die(`토큰으로 조회한 계정 ${accts.length}개 → CLOUDFLARE_ACCOUNT_ID 지정 (대시보드 URL dash.cloudflare.com/<id>, 또는 터널 토큰 base64 JSON의 a) ${accts.map((a) => `${a.name}=${a.id}`).join(", ")}`);
  return accts[0].id;
}

// "a@x.com" → email, "@x.com" → email_domain
const includeRule = (s) => (s.startsWith("@") ? { email_domain: { domain: s.slice(1) } } : { email: { email: s } });

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [cmd, hostname, who] = args.filter((a) => !a.startsWith("--"));

if (cmd === "check") {
  if (!hostname) die("check <hostname>");
  const res = await fetch(`https://${hostname}/`, { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  const protectedByAccess = /cloudflareaccess\.com/.test(loc) || res.headers.has("cf-access-domain");
  console.log(JSON.stringify({ hostname, status: res.status, location: loc || null, protected: protectedByAccess }));
  process.exit(protectedByAccess ? 0 : 2);
}

const acct = await accountId();
const apps = (await api("GET", `/accounts/${acct}/access/apps`)) || [];
const appFor = (h) => apps.find((a) => a.domain === h || (a.self_hosted_domains || []).includes(h));

switch (cmd) {
  case "list":
    for (const a of apps) console.log(JSON.stringify({ id: a.id, name: a.name, type: a.type, domain: a.domain, policies: (a.policies || []).map((p) => p.name) }));
    break;
  case "protect": {
    if (!hostname || !who) die("protect <hostname> <email|@domain>[,...]");
    const include = who.split(",").map((s) => s.trim()).filter(Boolean).map(includeRule);
    const policy = await api("POST", `/accounts/${acct}/access/policies`, {
      name: `allow ${hostname}`, decision: "allow", include, session_duration: opt.session || "24h",
    });
    const body = {
      name: opt.name || hostname, type: "self_hosted", domain: hostname,
      session_duration: opt.session || "24h", app_launcher_visible: false,
      policies: [{ id: policy.id, precedence: 1 }],
    };
    const existing = appFor(hostname);
    const app = existing
      ? await api("PUT", `/accounts/${acct}/access/apps/${existing.id}`, body)
      : await api("POST", `/accounts/${acct}/access/apps`, body);
    if (existing) for (const p of existing.policies || []) {
      // 이 스크립트가 만든 이전 정책만 정리 (다른 앱과 공유 중이면 API가 거부 → 무시)
      if (p.id !== policy.id && p.name === `allow ${hostname}`) await fetch(`${API}/accounts/${acct}/access/policies/${p.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
    }
    console.log(JSON.stringify({ action: existing ? "updated" : "created", app_id: app.id, hostname, allow: who, policy_id: policy.id, session: body.session_duration }));
    break;
  }
  case "unprotect": {
    const a = appFor(hostname) || die(`Access 앱 없음: ${hostname}`);
    await api("DELETE", `/accounts/${acct}/access/apps/${a.id}`);
    for (const p of a.policies || []) if (p.name === `allow ${hostname}`) await fetch(`${API}/accounts/${acct}/access/policies/${p.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
    console.log(JSON.stringify({ action: "deleted", app_id: a.id, hostname, warning: "호스트가 터널에 연결돼 있으면 이제 공개 상태" }));
    break;
  }
  default:
    die("명령: list | protect | unprotect | check");
}
