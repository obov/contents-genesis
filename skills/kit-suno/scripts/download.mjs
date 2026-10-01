// 선택한 Suno 곡 1개를 mp3로 저장. 월 다운로드 수 1 차감.
// 입력 env: SPACE(선택), SUNO_ID, FILE(저장할 절대 경로 .mp3), OUT(결과 JSON 절대 경로)
// 미검증(2026-10-01): Pro 플랜 Download 메뉴 하위 형식(MP3/WAV/Video)·확인 창 구조. 첫 실행 후 갱신
const fs = await import("node:fs/promises");
const { SUNO_ID, FILE, OUT } = process.env;
const task = process.env.SPACE ? await taskSpace(Number(process.env.SPACE)) : await taskSpace("suno");
const page = task.page(process.env.PAGE || "p1");
const log = (...a) => console.log("[suno]", ...a);

await page.goto(`https://suno.com/song/${SUNO_ID}`);
await page.waitForLoadState();
await page.waitForTimeout(3000);
const menu = await page.evaluate(() => {
  const vis = (e) => e.checkVisibility() && e.getBoundingClientRect().width > 0;
  const b = [...document.querySelectorAll('button[aria-label="More options"],button[aria-label="More Options"]')].find(vis);
  if (b) b.setAttribute("data-mg", "more");
  return !!b;
});
if (!menu) throw new Error("곡 페이지에서 More options 버튼을 찾지 못함");
await page.click('[data-mg="more"]', { label: "song options" });
await page.waitForTimeout(800);

const dl = page.waitForEvent("download", { timeout: 60000 });
await page.click("loc=role:menuitem[name*='Download']", { label: "Download" });
await page.waitForTimeout(1200);
// 하위 메뉴(형식 선택)가 있으면 MP3 선택
const sub = await page.evaluate(() => [...document.querySelectorAll("[role=menuitem]")].map((e) => e.innerText.trim()).filter((t) => /mp3|wav|video/i.test(t)));
if (sub.length) {
  log("formats", sub);
  await page.click("loc=role:menuitem[name*='MP3']", { label: "MP3 Audio" });
  await page.waitForTimeout(1200);
}
const modal = await page.evaluate(() => document.querySelector(".modal-overlay, [role=dialog]")?.innerText.slice(0, 300) ?? null);
if (modal && /Out of Downloads/i.test(modal)) throw new Error("다운로드 잔량 없음");
if (modal) {
  log("dialog", modal.replace(/\n/g, " | "));
  // 다운로드 차감 확인 창: 'Download' 확인 버튼만 누름
  const ok = await page.evaluate(() => { const b = [...document.querySelectorAll(".modal-overlay button, [role=dialog] button")].find((x) => /^(download|confirm|continue)/i.test(x.innerText.trim())); if (b) { b.setAttribute("data-mg", "confirm"); return b.innerText.trim(); } return null; });
  if (ok) await page.click('[data-mg="confirm"]', { label: "confirm download" });
}
const d = await dl;
await d.saveAs(FILE);
const stat = await fs.stat(FILE);
log("saved", FILE, stat.size, d.suggestedFilename());

await page.goto("https://suno.com/account");
await page.waitForFunction(() => /Downloads Remaining/.test(document.body.innerText), undefined, { timeout: 20000 }).catch(() => {});
const remaining = await page.evaluate(() => { const m = document.body.innerText.match(/Downloads Remaining\s*\n?\s*([\d,]+)/); return m ? Number(m[1].replace(/,/g, "")) : null; });
await fs.writeFile(OUT, JSON.stringify({ suno_id: SUNO_ID, file: FILE, size: stat.size, suggested_filename: d.suggestedFilename(), downloads_remaining: remaining }, null, 2));
