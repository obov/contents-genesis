#!/usr/bin/env node
// Cloudflare named tunnel: 호스트명 → 로컬 서비스 연결
// 사용:
//   node tunnel.mjs list
//   node tunnel.mjs up <tunnel> <hostname> <service-url> [--overwrite-dns]
//   node tunnel.mjs remove <tunnel> <hostname>      (ingress에서만 제거, DNS 레코드는 유지)
//   node tunnel.mjs run <tunnel>                     (포그라운드 실행)
//   node tunnel.mjs config <tunnel>                  (설정 경로·내용 출력)
// 설정 파일: ~/.cloudflared/<tunnel>.yml (JSON 형식, YAML 상위집합이라 cloudflared가 그대로 읽음)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = process.env.CLOUDFLARED_DIR || join(homedir(), ".cloudflared");
const cf = (args) => execFileSync("cloudflared", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

const tunnels = () => JSON.parse(cf(["tunnel", "list", "-o", "json"]) || "[]");
const findTunnel = (name) => tunnels().find((t) => t.name === name || t.id === name);
const configPath = (name) => join(DIR, `${name}.yml`);

function readConfig(t) {
  const p = configPath(t.name);
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf8")); }
    catch { die(`${p}: JSON 형식 아님. 직접 작성한 YAML이면 수동 편집`); }
  }
  return { tunnel: t.id, "credentials-file": join(DIR, `${t.id}.json`), ingress: [] };
}

function writeConfig(t, cfg) {
  const rules = cfg.ingress.filter((r) => r.hostname);
  cfg.ingress = [...rules, { service: "http_status:404" }]; // catch-all은 항상 마지막
  writeFileSync(configPath(t.name), JSON.stringify(cfg, null, 2) + "\n");
  cf(["tunnel", "--config", configPath(t.name), "ingress", "validate"]);
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const [name, hostname, service] = rest.filter((a) => !a.startsWith("--"));

switch (cmd) {
  case "list": {
    for (const t of tunnels()) {
      const p = configPath(t.name);
      const hosts = existsSync(p) ? (() => { try { return JSON.parse(readFileSync(p, "utf8")).ingress.filter((r) => r.hostname).map((r) => `${r.hostname} -> ${r.service}`); } catch { return ["(config 파싱 불가)"]; } })() : [];
      console.log(JSON.stringify({ name: t.name, id: t.id, connections: t.connections.length, config: existsSync(p) ? p : null, hosts }));
    }
    break;
  }
  case "up": {
    if (!name || !hostname || !service) die("up <tunnel> <hostname> <service-url>");
    if (!/^(https?|tcp|ssh|rdp|unix|http_status):/.test(service)) die(`service-url 형식: http://localhost:3000 (받은 값: ${service})`);
    let t = findTunnel(name);
    if (!t) { cf(["tunnel", "create", name]); t = findTunnel(name); }
    if (!existsSync(join(DIR, `${t.id}.json`))) die(`자격 증명 ${t.id}.json 없음. 다른 기기에서 만든 터널 → 'cloudflared tunnel token' 또는 새 터널 사용`);
    const routeArgs = ["tunnel", "route", "dns", ...(flags.has("--overwrite-dns") ? ["--overwrite-dns"] : []), t.id, hostname];
    try { console.error(cf(routeArgs).trim()); }
    catch (e) { die(`DNS 라우팅 실패 (기존 레코드면 --overwrite-dns): ${String(e.stderr || e.message).trim()}`); }
    const cfg = readConfig(t);
    cfg.ingress = cfg.ingress.filter((r) => r.hostname !== hostname);
    cfg.ingress.unshift({ hostname, service });
    writeConfig(t, cfg);
    console.log(JSON.stringify({ tunnel: t.name, id: t.id, hostname, service, config: configPath(t.name), run: `cloudflared tunnel --config ${configPath(t.name)} run ${t.name}` }));
    break;
  }
  case "remove": {
    if (!name || !hostname) die("remove <tunnel> <hostname>");
    const t = findTunnel(name) || die(`터널 없음: ${name}`);
    const cfg = readConfig(t);
    const before = cfg.ingress.length;
    cfg.ingress = cfg.ingress.filter((r) => r.hostname !== hostname);
    if (cfg.ingress.length === before) die(`ingress에 ${hostname} 없음`);
    writeConfig(t, cfg);
    console.log(JSON.stringify({ tunnel: t.name, removed: hostname, note: "DNS CNAME은 대시보드/API에서 별도 삭제. 실행 중 터널은 재시작 필요" }));
    break;
  }
  case "run": {
    const t = findTunnel(name) || die(`터널 없음: ${name}`);
    if (!existsSync(configPath(t.name))) die(`설정 없음: ${configPath(t.name)}. 먼저 up`);
    spawn("cloudflared", ["tunnel", "--config", configPath(t.name), "run", t.name], { stdio: "inherit" }).on("exit", (c) => process.exit(c ?? 0));
    break;
  }
  case "config": {
    const t = findTunnel(name) || die(`터널 없음: ${name}`);
    console.log(configPath(t.name));
    console.log(JSON.stringify(readConfig(t), null, 2));
    break;
  }
  default:
    die("명령: list | up | remove | run | config");
}
