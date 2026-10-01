// ChatGPT 웹(ego-browser)에서 이미지 1장 생성 후 저장. 현재 열린 대화에 이어서 보냄(인물·제품 일관성 유지).
// 입력: SPACE, OUT(절대 경로 png), PROMPT, FILES(JSON 배열, 선택: 첨부할 절대 경로), NEW_CHAT("1"이면 새 채팅)
// 검증(2026-09-30): 입력창은 contenteditable(ProseMirror) → 클릭 후 keyboard.insertText. 첨부는 input[type=file][accept="image/*"]에 setInputFiles.
//   전송 버튼 위치가 입력 길이에 따라 이동 → Enter 키로 전송. 생성 이미지는 alt "생성된 이미지 N"의 blob: → 페이지 안에서 fetch→base64로 저장.
//   완료 판정: 새 "생성된 이미지" 수 증가 + 중지 버튼 사라짐. 1장 약 1~2분.
const fs = await import("node:fs/promises");
const { OUT, PROMPT } = process.env;
const FILES = JSON.parse(process.env.FILES || "[]");
const task = await taskSpace(Number(process.env.SPACE));
const page = task.page("p1");
if (process.env.NEW_CHAT === "1" || !(await page.url()).startsWith("https://chatgpt.com")) {
  await page.goto("https://chatgpt.com/");
  await page.waitForLoadState();
  await page.waitForTimeout(3000);
}
// 긴 대화는 이전 이미지가 DOM에서 내려가 개수가 늘지 않음(최근 5개만 유지, 2026-10-01) → 개수 대신 "새 src 등장"으로 판정
const genSrcs = () => page.evaluate(() => [...document.querySelectorAll("main img")].filter((i) => /생성된 이미지/.test(i.alt) && i.naturalWidth > 0).map((i) => i.src));
const before = new Set(await genSrcs());
const newGen = async () => (await genSrcs()).filter((s) => !before.has(s));
if (FILES.length) {
  await page.setInputFiles('input[type=file][accept="image/*"]', FILES);
  await page.waitForTimeout(4000);
}
await page.click('[contenteditable="true"]#prompt-textarea, div.ProseMirror[contenteditable="true"]', { label: "입력창" }).catch(async () => {
  const box = await page.evaluate(() => { const e = document.querySelector('[contenteditable="true"]'); const r = e.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  await page.mouse.click(box.x, box.y, { label: "입력창" });
});
await page.keyboard.insertText(PROMPT);
await page.waitForTimeout(600);
await page.keyboard.press("Enter");
let done = false;
for (let i = 0; i < 120 && !done; i++) { // 16:9 시트 등 큰 이미지는 5분 넘게 걸림(2026-10-01) → 최대 10분
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => ({ stop: !!document.querySelector('button[data-testid="stop-button"], button[aria-label*="중지"]') }));
  if (!st.stop && (await newGen()).length) done = true;
}
if (!done) throw new Error("이미지 생성 대기 시간 초과 (화면 확인 필요: 거절·질문 응답일 수 있음)");
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const im = [...document.querySelectorAll("main img")].filter((i) => /생성된 이미지/.test(i.alt) && i.naturalWidth > 0).pop();
  const b = await (await fetch(im.src)).blob();
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { type: b.type, data: btoa(s), w: im.naturalWidth, h: im.naturalHeight };
});
await fs.writeFile(OUT, Buffer.from(r.data, "base64"));
console.log({ out: OUT, type: r.type, size: `${r.w}x${r.h}`, chat: await page.url() });
