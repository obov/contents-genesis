// 현재 채팅 화면의 마지막 생성 이미지를 저장 (generate-image 실패·시간 초과 후 복구용)
// 입력: SPACE, OUT(절대 경로 png)
const fs = await import("node:fs/promises");
const task = await taskSpace(Number(process.env.SPACE));
const page = task.page("p1");
const r = await page.evaluate(async () => {
  const im = [...document.querySelectorAll("main img")].filter((i) => /생성된 이미지/.test(i.alt) && i.naturalWidth > 0).pop();
  if (!im) return null;
  const b = await (await fetch(im.src)).blob();
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
if (!r) throw new Error("생성 이미지 없음");
await fs.writeFile(process.env.OUT, Buffer.from(r, "base64"));
console.log("saved", process.env.OUT);
