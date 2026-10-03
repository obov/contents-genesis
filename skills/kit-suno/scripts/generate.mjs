// Suno 웹(ego-browser)에서 Advanced 모드로 곡 1회 생성(결과 2곡) 후 메타데이터를 OUT에 JSON으로 기록.
// 다운로드는 하지 않음 (월 다운로드 수 제한 → 청취 후 선택한 곡만 download.mjs로 저장).
// 입력 env: PAGE(선택, 기본 p1), SPACE(선택, TaskSpace 번호), OUT(결과 JSON 절대 경로), SPEC(JSON: model, title, style, lyrics, settings)
// 검증(2026-10-01, Pro 플랜):
//   - Advanced 전환: button[role=tab] 텍스트 "Advanced" (2026-10-03 변경, 이전 aria-label="Advanced")
//   - 모델 버튼: 텍스트가 v6 / v6-wild / v6-mini인 버튼 → menuitemradio
//   - 스타일 textarea[maxlength=1000], 제목 input[placeholder="Song Title (Optional)"](Simple/Advanced 2개 중 보이는 것)
//   - 가사: contenteditable[aria-label="Lyrics editor"]. 비우면 인스트루멘털
//   - 새 곡: 목록 상단에 a[href^="/song/<id>"] 2개 추가. 완료 = 행에 m:ss 길이 표시
const fs = await import("node:fs/promises");
const SPEC = JSON.parse(process.env.SPEC);
const OUT = process.env.OUT;
const task = process.env.SPACE ? await taskSpace(Number(process.env.SPACE)) : await taskSpace("suno");
const page = task.page(process.env.PAGE || "p1");
const log = (...a) => console.log("[suno]", ...a);

async function credits() {
  await page.goto("https://suno.com/account");
  await page.waitForLoadState();
  await page.waitForFunction(() => /Credits Remaining/.test(document.body.innerText), undefined, { timeout: 20000 }).catch(() => {});
  return page.evaluate(() => {
    const m = document.body.innerText.match(/Credits Remaining\s*\n?\s*([\d,]+)/);
    const d = document.body.innerText.match(/Downloads Remaining\s*\n?\s*([\d,]+)/);
    return { credits: m ? Number(m[1].replace(/,/g, "")) : null, downloads: d ? Number(d[1].replace(/,/g, "")) : null };
  });
}

const markFields = () =>
  page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility({ visibilityProperty: true, opacityProperty: true }); };
    const mark = (el, name) => el && el.setAttribute("data-mg", name);
    document.querySelectorAll("[data-mg]").forEach((e) => e.removeAttribute("data-mg"));
    mark([...document.querySelectorAll('textarea[maxlength="1000"]')].find(vis), "style");
    mark([...document.querySelectorAll('input[placeholder="Song Title (Optional)"]')].find(vis), "title");
    mark([...document.querySelectorAll('[contenteditable=true][aria-label="Lyrics editor"]')].find(vis), "lyrics");
    mark([...document.querySelectorAll("button")].filter(vis).find((b) => /^v\d[\w.-]*$/i.test(b.innerText.trim())), "model");
    return [...document.querySelectorAll("[data-mg]")].map((e) => e.dataset.mg);
  });

const songIds = () =>
  page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="/song/"]')].map((a) => a.getAttribute("href").split("/")[2]))]);

const before = await credits();
log("before", before);

await page.goto("https://suno.com/create");
await page.waitForLoadState();
// Advanced 전환 버튼: 예전 button[aria-label="Advanced"] → 2026-10-03 button[role=tab] 텍스트 "Advanced". 둘 다 지원
const markAdvanced = () => {
  const b =
    document.querySelector('button[aria-label="Advanced"]') ||
    [...document.querySelectorAll('button[role="tab"], button')].find((e) => e.innerText.trim() === "Advanced");
  if (b) b.setAttribute("data-mg-advanced", "");
  return Boolean(b);
};
await page.waitForFunction(markAdvanced, undefined, { timeout: 30000 });
await page.waitForTimeout(2000);
if (/Log in/.test(await page.evaluate(() => document.body?.innerText.slice(0, 2000) ?? ""))) throw new Error("Suno 로그아웃 상태: 로그인 필요");
// 쿠키 동의 창(2026-10-03 확인)이 Create 버튼을 가림 → 선택 쿠키 거부로 닫음
const cookieBtn = 'button[aria-label="Deny all optional cookies"]';
if (await page.evaluate((sel) => Boolean(document.querySelector(sel)?.checkVisibility()), cookieBtn)) {
  await page.click(cookieBtn, { label: "Reject optional cookies" });
  await page.waitForTimeout(800);
}
await page.evaluate(markAdvanced);
await page.click("[data-mg-advanced]", { label: "Advanced mode" });
await page.waitForTimeout(800);

// 모델
let marks = await markFields();
if (!marks.includes("model")) throw new Error("모델 버튼을 찾지 못함: " + marks);
const currentModel = await page.evaluate(() => document.querySelector('[data-mg="model"]').innerText.trim());
if (SPEC.model && currentModel !== SPEC.model) {
  await page.click('[data-mg="model"]', { label: "model menu" });
  await page.waitForTimeout(800);
  await page.click(`loc=role:menuitemradio[name="${SPEC.model}"]`, { label: "select model" }).catch(async () => {
    const ok = await page.evaluate((m) => { const e = [...document.querySelectorAll("[role=menuitemradio]")].find((x) => x.innerText.split("\n")[0].trim() === m); if (e) e.click(); return !!e; }, SPEC.model);
    if (!ok) throw new Error("모델 없음: " + SPEC.model);
  });
  await page.waitForTimeout(1200);
  // 플랜에서 막힌 모델은 업그레이드 창이 뜨고 선택이 바뀌지 않음 (결제 직후 세션 갱신 전에도 발생, 2026-10-01)
  if (await page.evaluate(() => !!document.querySelector(".modal-overlay"))) {
    await page.keyboard.press("Escape");
    throw new Error(`모델 ${SPEC.model} 사용 불가: 업그레이드 창 표시 (플랜 또는 로그인 세션 확인)`);
  }
}

// 가사: 기존 내용 지우고 입력 (빈 값 = 인스트루멘털)
marks = await markFields();
await page.click('[data-mg="lyrics"]', { label: "lyrics editor" });
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.press("Backspace");
const lyrics = String(SPEC.lyrics ?? "");
const lines = lyrics.split("\n");
for (let i = 0; i < lines.length; i++) {
  if (lines[i]) await page.keyboard.insertText(lines[i]);
  if (i < lines.length - 1) await page.keyboard.press("Enter");
}
await page.fill('[data-mg="style"]', String(SPEC.style ?? ""));
await page.fill('[data-mg="title"]', String(SPEC.title ?? ""));
await page.waitForTimeout(500);

// 고급 설정 (More Options): 버튼 그룹은 data-selected, 슬라이더는 role=slider aria-valuenow
// SPEC.settings 키: vocal_gender(Male|Female), duration(Auto|Custom), max_mode(Off|On), my_taste(Off|On),
//                  weirdness(0-100), style_influence(0-100), variety(0-4)
// 토글은 div[role=button][aria-expanded]. 접힌 상태에서도 슬라이더는 DOM에 숨겨져 존재
await page.evaluate(() => { const b = [...document.querySelectorAll('[role=button],button')].find((x) => x.innerText.trim() === "More Options"); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); });
await page.waitForSelector('[role=slider][aria-label="Weirdness"]', { timeout: 10000 });
const GROUPS = { vocal_gender: "Vocal Gender", duration: "Duration", max_mode: "Max Mode", my_taste: "Personalize" };
const SLIDERS = { weirdness: "Weirdness", style_influence: "Style Influence", variety: "Variety" };
const readSettings = () =>
  page.evaluate(({ GROUPS, SLIDERS }) => {
    const out = {};
    for (const [key, label] of Object.entries(GROUPS)) {
      const span = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === label && x.childElementCount === 0);
      const row = span?.parentElement?.parentElement;
      const sel = [...(row?.querySelectorAll("button[data-selected]") ?? [])].find((b) => b.dataset.selected === "true");
      out[key] = sel ? sel.innerText.trim() : null;
    }
    for (const [key, label] of Object.entries(SLIDERS)) {
      const el = document.querySelector(`[role=slider][aria-label="${label}"]`);
      out[key] = el ? Number(el.getAttribute("aria-valuenow")) : null;
      if (el?.getAttribute("aria-valuetext")) out[key + "_label"] = el.getAttribute("aria-valuetext");
    }
    return out;
  }, { GROUPS, SLIDERS });
for (const [key, want] of Object.entries(SPEC.settings ?? {})) {
  if (GROUPS[key]) {
    const ok = await page.evaluate(({ label, want }) => {
      const span = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === label && x.childElementCount === 0);
      const b = [...(span?.parentElement?.parentElement?.querySelectorAll("button[data-selected]") ?? [])].find((x) => x.innerText.trim() === want);
      if (b && b.dataset.selected !== "true") b.click();
      return !!b;
    }, { label: GROUPS[key], want: String(want) });
    if (!ok) throw new Error(`설정 ${key}=${want} 선택지 없음`);
  } else if (SLIDERS[key]) {
    const sel = `[role=slider][aria-label="${SLIDERS[key]}"]`;
    await page.focus(sel);
    for (let i = 0; i < 120; i++) {
      const now = await page.evaluate((q) => Number(document.querySelector(q).getAttribute("aria-valuenow")), sel);
      if (now === Number(want)) break;
      await page.keyboard.press(now < Number(want) ? "ArrowRight" : "ArrowLeft");
    }
  } else throw new Error("알 수 없는 설정: " + key);
  await page.waitForTimeout(300);
}
const settings = await readSettings();
for (const [key, want] of Object.entries(SPEC.settings ?? {}))
  if (String(settings[key]) !== String(want)) throw new Error(`설정 ${key} 적용 실패: ${settings[key]} != ${want}`);
const form = await page.evaluate(() => ({
  lyrics: document.querySelector('[data-mg="lyrics"]')?.innerText.trim() ?? "",
  style: document.querySelector('[data-mg="style"]')?.value ?? "",
  title: document.querySelector('[data-mg="title"]')?.value ?? "",
  model: document.querySelector('[data-mg="model"]')?.innerText.trim(),
}));
form.settings = settings;
log("form", { ...form, lyrics: form.lyrics.slice(0, 40) });
if (form.model !== (SPEC.model ?? form.model)) throw new Error(`모델 불일치: ${form.model}`);
if (form.style.trim() !== String(SPEC.style ?? "").trim()) throw new Error("스타일 입력 불일치");
if (form.title.trim() !== String(SPEC.title ?? "").trim()) throw new Error("제목 입력 불일치");

// 생성
const existing = new Set(await songIds());
const requestedAt = new Date().toISOString();
await page.click('button[aria-label="Create song"]', { label: "Create song" });
log("create clicked");

let fresh = [];
const deadline = Date.now() + 8 * 60 * 1000;
let rows = [];
while (Date.now() < deadline) {
  await page.waitForTimeout(5000);
  fresh = (await songIds()).filter((id) => !existing.has(id));
  if (fresh.length >= 2) {
    rows = await page.evaluate((ids) => ids.map((id) => {
      const a = document.querySelector(`a[href="/song/${id}"]`);
      const row = a?.closest('[role=group]') ?? a?.parentElement?.parentElement?.parentElement;
      const txt = row?.innerText ?? "";
      const dur = txt.match(/\b(\d{1,2}:\d{2})\b/);
      const img = row?.querySelector("img")?.src ?? null;
      const badge = [...(row?.querySelectorAll("span") ?? [])].map((s) => s.innerText.trim()).find((t) => /^v\d/i.test(t)) ?? null;
      return { external_id: id, title: a?.innerText.trim(), duration: dur ? dur[1] : null, image_url: img, model_badge: badge, url: `https://suno.com/song/${id}` };
    }), fresh.slice(0, 2));
    if (rows.every((r) => r.duration)) break;
  }
}
if (fresh.length < 2) throw new Error("새 곡이 나타나지 않음 (화면 확인 필요)");
if (!rows.every((r) => r.duration)) throw new Error("생성 완료 대기 시간 초과: " + JSON.stringify(rows));

const after = await credits();
const toSec = (d) => { const [m, s] = d.split(":").map(Number); return m * 60 + s; };
const result = {
  space: task.spaceId,
  requested_at: requestedAt,
  form,
  credits_before: before.credits,
  credits_after: after.credits,
  credits_used: before.credits != null && after.credits != null ? before.credits - after.credits : null,
  downloads_remaining: after.downloads,
  outputs: rows.map((r) => ({ ...r, duration_sec: toSec(r.duration) })),
};
await fs.writeFile(OUT, JSON.stringify(result, null, 2));
log("done", JSON.stringify(result.outputs));
