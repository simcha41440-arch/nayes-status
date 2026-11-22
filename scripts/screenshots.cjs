// צילומי מסך של האתר החי (רץ ב-GitHub Actions): node scripts/screenshots.cjs <תיקייה>
const { chromium } = require("playwright");
const SITE = process.env.SITE_URL || "https://www.nayesstatus.com";
const out = process.argv[2] || "shots";
require("fs").mkdirSync(out, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const phone = { viewport: { width: 412, height: 880 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "he-IL", timezoneId: "Asia/Jerusalem", serviceWorkers: "block" };
  const ctx = await b.newContext(phone);
  const p = await ctx.newPage();
  const shot = async (name, opts = {}) => { await p.waitForTimeout(opts.wait ?? 900); await p.screenshot({ path: `${out}/${name}.png`, ...opts.s }); console.log("✓", name); };
  const pauseViewer = () => p.evaluate(() => { const s = document.getElementById("stage"); s && s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 400 })); });

  // מסך הבית
  await p.goto(SITE + "/", { waitUntil: "networkidle" });
  await shot("01-בית", { wait: 1800 });
  await shot("02-בית-מלא", { s: { fullPage: true } });

  // מבזקים
  const list = (await (await p.request.get(SITE + "/api/articles?limit=40")).json()).articles || [];
  const news = list.filter((a) => !a.slug.startsWith("welcome")).slice(0, 10);
  let i = 0;
  for (const a of news) {
    i++;
    await p.goto(`${SITE}/article/${a.slug}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1600);
    await pauseViewer();
    await shot(`1${String(i).padStart(2, "0")}-מבזק-${i}`, { wait: 500 });
    if (i === 1 || (a.body && i === 2)) {
      await p.evaluate(() => document.getElementById("chev") && document.getElementById("chev").click());
      await shot(`1${String(i).padStart(2, "0")}b-מבזק-${i}-עוד-פרטים`, { wait: 700 });
    }
  }

  // כלים
  await p.goto(SITE + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.click('[data-tool="zmanim"]'); await shot("20-זמני-היום");
  await p.evaluate(() => document.querySelector("#tool-sheet").scrollTo(0, 9999)); await shot("21-זמני-היום-שבת");
  await p.click("#sheet-back");
  await p.click('[data-tool="oref"]'); await shot("22-פיקוד-העורף");
  await p.evaluate(() => document.querySelector("#tool-sheet").scrollTo(0, 9999)); await shot("23-פיקוד-העורף-טלפונים");
  await p.click("#sheet-back");
  await p.click('[data-tool="city"]'); await shot("24-בחירת-עיר");
  await p.keyboard.press("Escape").catch(() => {});
  await p.goto(SITE + "/", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  await p.click("#search-btn"); await p.fill("#search-input", "איראן"); await shot("25-חיפוש");
  await p.goto(SITE + "/", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  await p.click("#bell-btn"); await shot("26-פעמון");
  await p.goto(SITE + "/", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  await p.click("#menu-btn"); await shot("27-תפריט");

  // עמודים
  for (const [path, name] of [["/settings", "30-הגדרות"], ["/about", "31-אודות"], ["/admin", "32-כניסת-מנהל"], ["/send", "33-שלחו-לנו"]]) {
    await p.goto(SITE + path, { waitUntil: "networkidle" });
    await shot(name, { wait: 1200 });
    if (path !== "/admin" && path !== "/send") await shot(name + "-מלא", { s: { fullPage: true } });
  }

  // מחשב
  const desk = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "he-IL", timezoneId: "Asia/Jerusalem", serviceWorkers: "block" });
  const d = await desk.newPage();
  await d.goto(SITE + "/", { waitUntil: "networkidle" }); await d.waitForTimeout(1500);
  await d.screenshot({ path: `${out}/40-מחשב-בית.png` }); console.log("✓ desktop home");
  if (news[0]) {
    await d.goto(`${SITE}/article/${news[0].slug}`, { waitUntil: "networkidle" }); await d.waitForTimeout(1500);
    await d.screenshot({ path: `${out}/41-מחשב-מבזק.png` }); console.log("✓ desktop story");
  }
  await d.goto(SITE + "/", { waitUntil: "networkidle" }); await d.waitForTimeout(1200);
  await d.evaluate(() => window.scrollTo(0, 600)); await d.waitForTimeout(400);
  await d.screenshot({ path: `${out}/42-מחשב-ערוצים.png` });
  await d.evaluate(() => window.scrollTo(0, 0));
  await d.click('[data-tool="zmanim"]'); await d.waitForTimeout(700);
  await d.screenshot({ path: `${out}/43-מחשב-זמני-היום.png` });
  await d.goto(SITE + "/settings", { waitUntil: "networkidle" }); await d.waitForTimeout(1000);
  await d.screenshot({ path: `${out}/44-מחשב-הגדרות.png` });
  console.log("✓ desktop extra");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
