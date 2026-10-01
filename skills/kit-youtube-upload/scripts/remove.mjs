// YouTube Studio에서 영상 영구 삭제 (ego-browser). 되돌릴 수 없음 → 사용자 요청 시에만 실행.
// 입력 env: SPACE, OUT, SHOT, CHANNEL_ID, VIDEO_ID, TITLE(대조용), PAGE(선택, 기본 p1)
const fs = await import("node:fs/promises");
const E = process.env;
const task = await taskSpace(Number(E.SPACE));
const pages = await task.pages();
const page = pages.find((p) => p.label === (E.PAGE || "p1")) ?? (await task.newPage());
const log = (...a) => console.log("[yt]", ...a);

await page.goto("https://studio.youtube.com/");
await page.waitForFunction(() => /\/channel\/UC[\w-]{22}/.test(location.href), undefined, { timeout: 30000 }).catch(() => {});
const current = ((await page.url()).match(/\/channel\/(UC[\w-]{22})/) || [])[1] ?? null;
if (current !== E.CHANNEL_ID) throw new Error(`채널 불일치: ${current} ≠ ${E.CHANNEL_ID}`);

await page.goto(`https://studio.youtube.com/video/${E.VIDEO_ID}/edit`);
await page.waitForSelector("#title-textarea #textbox", { timeout: 30000 });
await page.waitForTimeout(1500);
const title = await page.evaluate(() => document.querySelector("#title-textarea #textbox")?.innerText.trim());
if (E.TITLE && title !== E.TITLE.trim()) throw new Error(`제목 불일치: ${title}`);

// 상단 옵션(⋮) 버튼: aria-label="옵션"이 여러 개 → 보이는 것 중 화면 상단 오른쪽
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button[aria-label="옵션"], ytcp-button#overflow-menu-button, #overflow-menu-button')]
    .filter((x) => x.checkVisibility() && x.getBoundingClientRect().width > 0)
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
  b?.setAttribute("data-mg", "options");
});
await page.click('[data-mg="options"]', { label: "options menu" });
await page.waitForTimeout(800);
await page.evaluate(() => [...document.querySelectorAll("tp-yt-paper-item")].find((e) => e.checkVisibility() && e.innerText.trim() === "삭제")?.click());
await page.waitForTimeout(1500);
const dialog = await page.evaluate(() => {
  const d = [...document.querySelectorAll("tp-yt-paper-dialog, ytcp-dialog")].find((x) => x.checkVisibility() && /삭제/.test(x.innerText));
  if (!d) return null;
  d.setAttribute("data-mg", "delete-dialog");
  return d.innerText.trim().slice(0, 400);
});
if (!dialog) throw new Error("삭제 확인 창 없음");
log("dialog", dialog.replace(/\n/g, " | "));
// 영구 삭제 동의 체크박스 → 영구 삭제 버튼
await page.evaluate(() => { const c = document.querySelector('[data-mg="delete-dialog"] ytcp-checkbox-lit, [data-mg="delete-dialog"] #checkbox, [data-mg="delete-dialog"] [role=checkbox]'); c?.click(); });
await page.waitForTimeout(600);
const btn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-mg="delete-dialog"] ytcp-button, [data-mg="delete-dialog"] button')].find((x) => /영구.*삭제|^삭제$/.test(x.innerText.trim()) && x.checkVisibility());
  if (!b) return null;
  b.setAttribute("data-mg", "delete-confirm");
  return { text: b.innerText.trim(), disabled: b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true" };
});
if (!btn || btn.disabled) throw new Error("영구 삭제 버튼 비활성: " + JSON.stringify(btn));
await page.click('[data-mg="delete-confirm"]', { label: "delete permanently" });
await page.waitForTimeout(4000);
await page.goto(`https://studio.youtube.com/video/${E.VIDEO_ID}/edit`);
await page.waitForTimeout(5000);
const gone = await page.evaluate(() => !document.querySelector("#title-textarea #textbox") || /찾을 수 없|삭제|not found|doesn't exist/i.test(document.body.innerText.slice(0, 2000)));
await page.screenshot({ path: E.SHOT });
if (!gone) throw new Error("삭제 후에도 편집 화면이 열림 (화면 확인 필요)");
const result = { video_id: E.VIDEO_ID, removed_at: new Date().toISOString(), channel: current, dialog };
await fs.writeFile(E.OUT, JSON.stringify(result, null, 2));
log("removed", JSON.stringify(result));
