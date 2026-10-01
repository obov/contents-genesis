// Suno 크레딧·다운로드 잔량을 OUT에 JSON으로 기록. 입력 env: SPACE(선택), OUT
const fs = await import("node:fs/promises");
const task = process.env.SPACE ? await taskSpace(Number(process.env.SPACE)) : await taskSpace("suno");
const page = task.page(process.env.PAGE || "p1");
await page.goto("https://suno.com/account");
await page.waitForLoadState();
await page.waitForFunction(() => /Credits Remaining|Log in/.test(document.body.innerText), undefined, { timeout: 20000 });
const r = await page.evaluate(() => {
  const t = document.body.innerText;
  const num = (re) => { const m = t.match(re); return m ? Number(m[1].replace(/,/g, "")) : null; };
  return {
    logged_in: !/\bLog in\b/.test(t.slice(0, 3000)),
    credits: num(/Credits Remaining\s*\n?\s*([\d,]+)/),
    downloads: num(/Downloads Remaining\s*\n?\s*([\d,]+)/),
    next_billing: (t.match(/Next Billing Date\s*\n?\s*([^\n]+)/) || [])[1] ?? null,
  };
});
r.space = task.spaceId;
await fs.writeFile(process.env.OUT, JSON.stringify(r, null, 2));
console.log("[suno]", JSON.stringify(r));
