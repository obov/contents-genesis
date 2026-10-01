// YouTube Studio 업로드 (ego-browser). SKILL.md 절차 구현. PAGE(선택, 기본 p1): 사용할 페이지 라벨
// 입력 env: SPACE, OUT(결과 JSON), SHOT(결과 화면 png), FILE(mp4 절대 경로), CHANNEL_ID(UC…),
//          TITLE, DESCRIPTION, VISIBILITY(private|unlisted|public), MADE_FOR_KIDS("1"이면 아동용)
// 결과: { video_id, video_url, visibility, uploaded_at, channel_check, processing }
const fs = await import("node:fs/promises");
const E = process.env;
const task = E.SPACE ? await taskSpace(Number(E.SPACE)) : await taskSpace("youtube upload");
const pages = await task.pages();
const page = pages.find((p) => p.label === (E.PAGE || "p1")) ?? (await task.newPage());
const log = (...a) => console.log("[yt]", ...a);
const fail = async (msg) => {
  await page.screenshot({ path: E.SHOT.replace(/\.png$/, "-error.png") }).catch(() => {});
  throw new Error(msg);
};

// 0. 대상 채널 대조: Studio 리다이렉트 URL의 채널 ID
await page.goto("https://studio.youtube.com/");
await page.waitForLoadState();
await page.waitForFunction(() => /\/channel\/UC[\w-]{22}/.test(location.href) || /accounts\.google\.com/.test(location.href), undefined, { timeout: 30000 }).catch(() => {});
const url0 = await page.url();
const current = (url0.match(/\/channel\/(UC[\w-]{22})/) || [])[1] ?? null;
const channelName = await page.evaluate(() => document.querySelector("#entity-name")?.innerText?.trim() ?? null);
const channel_check = { expected: E.CHANNEL_ID, observed: current, observed_name: channelName, checked_at: new Date().toISOString() };
log("channel", channel_check);
if (current !== E.CHANNEL_ID) {
  await task.handOff();
  throw new Error(`채널 불일치: 현재 ${current ?? "확인 불가"}(${channelName}) ≠ 대상 ${E.CHANNEL_ID}. 브라우저를 넘김 → 계정·채널 전환 후 재실행`);
}

// 1. 업로드 창 → 파일
await page.goto(`https://studio.youtube.com/channel/${E.CHANNEL_ID}/videos/upload`);
await page.waitForLoadState();
await page.waitForSelector('button[aria-label="동영상 업로드"], input[name="Filedata"]', { timeout: 30000, state: "attached" });
if (!(await page.evaluate(() => !!document.querySelector('input[name="Filedata"]')))) {
  await page.click('button[aria-label="동영상 업로드"]', { label: "open upload dialog" });
}
await page.waitForSelector('input[name="Filedata"]', { state: "attached", timeout: 20000 });
await page.setInputFiles('input[name="Filedata"]', [E.FILE]);
log("file set", E.FILE);

// 세부정보 화면 대기
await page.waitForSelector("#title-textarea #textbox", { timeout: 60000 }).catch(() => fail("세부정보 화면이 열리지 않음"));
await page.waitForTimeout(2000);

// 영상 ID: 업로드 직후 표시되는 링크
const readLink = () => page.evaluate(() => {
  const a = [...document.querySelectorAll("ytcp-uploads-dialog a")].find((x) => /youtu\.be\/|youtube\.com\/(watch|shorts)/.test(x.href));
  return a?.href ?? null;
});
let link = null;
for (let i = 0; i < 30 && !link; i++) { link = await readLink(); if (!link) await page.waitForTimeout(2000); }
if (!link) await fail("영상 링크를 찾지 못함");
const video_id = (link.match(/youtu\.be\/([\w-]{11})/) || link.match(/(?:v=|shorts\/)([\w-]{11})/) || [])[1];
log("video", video_id, link);

// 2. 제목·설명 (contenteditable): 전체 선택 후 입력, 전체 문자열 재확인
async function setBox(sel, text, label) {
  await page.click(sel, { label });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press("Shift+Enter");
  }
  await page.waitForTimeout(500);
  const got = await page.evaluate((s) => document.querySelector(s)?.innerText ?? "", sel);
  if (got.trim() !== String(text).trim()) await fail(`${label} 입력 불일치: ${JSON.stringify(got)}`);
}
await setBox("#title-textarea #textbox", E.TITLE, "title");
if (E.DESCRIPTION) await setBox("#description-textarea #textbox", E.DESCRIPTION, "description");

// 시청자층
const kids = E.MADE_FOR_KIDS === "1" ? "VIDEO_MADE_FOR_KIDS_MFK" : "VIDEO_MADE_FOR_KIDS_NOT_MFK";
await page.click(`tp-yt-paper-radio-button[name="${kids}"]`, { label: "audience" });
await page.waitForTimeout(500);
const kidsOk = await page.evaluate((n) => document.querySelector(`tp-yt-paper-radio-button[name="${n}"]`)?.hasAttribute("checked") || document.querySelector(`tp-yt-paper-radio-button[name="${n}"]`)?.getAttribute("aria-checked") === "true", kids);
if (!kidsOk) await fail("시청자층 설정 실패");

// 변경·합성 콘텐츠 질문: 화면에 있으면 '아니요' (실사형 합성 아님: 추상 커버 + 음원)
const altered = await page.evaluate(() => {
  const r = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_HAS_ALTERED_CONTENT_NO"]');
  if (r) { r.scrollIntoView(); r.click(); return true; }
  return false;
});
log("altered content question", altered ? "answered no" : "not shown");

// 3. 다음 → 공개 상태 화면
for (let i = 0; i < 3; i++) {
  await page.click("#next-button", { label: "next" });
  await page.waitForTimeout(1500);
}
const VIS = { private: "PRIVATE", unlisted: "UNLISTED", public: "PUBLIC" }[E.VISIBILITY || "private"];
await page.waitForSelector(`tp-yt-paper-radio-button[name="${VIS}"]`, { timeout: 20000 }).catch(() => fail("공개 상태 화면 아님"));
await page.click(`tp-yt-paper-radio-button[name="${VIS}"]`, { label: "visibility" });
await page.waitForTimeout(800);
const visOk = await page.evaluate((n) => { const r = document.querySelector(`tp-yt-paper-radio-button[name="${n}"]`); return r?.hasAttribute("checked") || r?.getAttribute("aria-checked") === "true"; }, VIS);
if (!visOk) await fail("공개 상태 선택 실패");

// 처리·검사 상태 (완료 판정 아님, 기록용)
const processing = await page.evaluate(() => document.querySelector("ytcp-uploads-dialog .progress-label, ytcp-video-upload-progress")?.innerText?.trim() ?? null);
log("processing", processing);

// 저장
await page.click("#done-button", { label: "save" });
await page.waitForTimeout(3000);
// 저장 후 확인 창(게시/저장됨) 또는 업로드 창 닫힘
await page.waitForFunction(() => {
  const d = document.querySelector("ytcp-uploads-dialog");
  const t = document.body.innerText;
  return !d || !d.hasAttribute("opened") || /동영상 (게시됨|저장됨|예약됨)|비공개로 저장|Video (published|saved)/.test(t);
}, undefined, { timeout: 60000 }).catch(() => fail("저장 확인 화면 없음"));
await page.screenshot({ path: E.SHOT });
const confirmText = await page.evaluate(() => [...document.querySelectorAll("ytcp-prechecks-warning-dialog, ytcp-video-share-dialog, tp-yt-paper-dialog[opened]")].map((d) => d.innerText.trim()).join("\n").slice(0, 400));
log("confirm", confirmText.replace(/\n/g, " | "));
await page.evaluate(() => document.querySelector("ytcp-video-share-dialog #close-button, tp-yt-paper-dialog[opened] #close-button")?.click());

const result = {
  video_id,
  video_url: `https://youtu.be/${video_id}`,
  studio_url: `https://studio.youtube.com/video/${video_id}/edit`,
  visibility: E.VISIBILITY || "private",
  uploaded_at: new Date().toISOString(),
  channel_check,
  processing,
  confirm_text: confirmText,
};
await fs.writeFile(E.OUT, JSON.stringify(result, null, 2));
log("done", JSON.stringify(result));
