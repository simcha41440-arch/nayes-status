// תצוגה מקדימה: מבזקים לדוגמה עם תמונות ארכיון אמיתיות (אחרי בדיקת צניעות), צילומי מסך של העיצוב. לא מתפרסם באתר.
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { checkImage } from "../api/_lib/ai.js";

const OUT = process.argv[2] || "preview";
await mkdir(`${OUT}/media`, { recursive: true });
const UA = { "User-Agent": "NayesStatusBot/1.0 (https://www.nayesstatus.com)" };
const strip = (h = "") => String(h).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const SAMPLES = [
  { q: '"יעקב אריה אלתר"', must: ["אלתר"], title: 'דוגמה: עדכון על כ"ק האדמו"ר מגור שליט"א', cat: "community" },
  { q: '"Yaakov Aryeh Alter"', must: ["Alter"], title: 'דוגמה: עדכון על כ"ק האדמו"ר מגור שליט"א (תמונה נוספת)', cat: "community" },
  { q: '"שאול אלתר"', must: ["אלתר"], title: 'דוגמה: עדכון על הגאון רבי שאול אלתר שליט"א', cat: "torah" },
  { q: '"הרב דב לנדו"', must: ["לנדו"], title: 'דוגמה: עדכון על הגאון רבי דב לנדו שליט"א', cat: "torah" },
  { q: '"Moshe Hillel Hirsch"', must: ["Hirsch"], title: 'דוגמה: עדכון על הגאון רבי משה הלל הירש שליט"א', cat: "torah" },
  { q: "Knesset plenum", must: [], title: "דוגמה: דיון בכנסת על חוק הגיוס", cat: "politics" },
  { q: "Bnei Brak street", must: [], title: "דוגמה: עדכון מבני ברק", cat: "local" },
  { q: "Jerusalem old city panorama", must: [], title: "דוגמה: תמונת גיבוי של ערוץ חדשות", cat: "general" },
];

const articles = [];
let n = 0;
for (const s of SAMPLES) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(s.q + " filetype:bitmap")}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1080`;
  const pages = Object.values((await (await fetch(api, { headers: UA })).json()).query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0]; const m = info?.extmetadata || {};
    if (!info || !/image\/(jpeg|png)/.test(info.mime || "")) continue;
    const lic = strip(m.LicenseShortName?.value);
    if (!/^(CC BY|CC0|Public domain|PD)/i.test(lic) || /NC|ND/.test(lic)) continue;
    const text = `${p.title} ${strip(m.ImageDescription?.value)} ${strip(m.ObjectName?.value)}`.toLowerCase();
    if (s.must.some((w) => !text.includes(w.toLowerCase()))) continue;
    const buf = Buffer.from(await (await fetch(info.thumburl || info.url, { headers: UA })).arrayBuffer());
    const type = /png/.test(info.mime) ? "image/png" : "image/jpeg";
    const chk = await checkImage({ base64: buf.toString("base64"), mediaType: type });
    console.log(`${s.title} | ${p.title} | ${chk.approved ? "✓ עבר" : "✗ נפסל: " + chk.reason}`);
    if (!chk.approved) continue;
    const name = `${++n}.${type === "image/png" ? "png" : "jpg"}`;
    await writeFile(`${OUT}/media/${name}`, buf);
    articles.push({
      slug: `demo-${n}`, title: s.title, summary: "זו דוגמה לעיצוב בלבד, לא ידיעה אמיתית. כך ייראה מבזק עם תמונת ארכיון.",
      category: s.cat, is_breaking: false, image_url: `/media/${name}`,
      image_credit: `צילום ארכיון: ${strip(m.Artist?.value).slice(0, 40) || "ויקישיתוף"} / ויקישיתוף (${lic})`,
      published_at: new Date(Date.now() - n * 600000).toISOString(), reactions: {}, views: 0,
    });
    break;
  }
}

const root = path.resolve("public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/json" };
const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, "http://x");
  const json = (o) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify(o)); };
  if (u.pathname === "/api/articles") return json(u.searchParams.get("slug") ? { article: articles.find((a) => a.slug === u.searchParams.get("slug")) } : { articles: u.searchParams.get("onthisday") ? [] : articles });
  if (u.pathname === "/api/ads") return json({ ads: [] });
  if (u.pathname === "/api/state") return json({ emergency: null, oref: [] });
  if (u.pathname === "/api/me") return json({ requireLogin: false });
  if (u.pathname.startsWith("/media/")) { r.setHeader("content-type", u.pathname.endsWith(".png") ? "image/png" : "image/jpeg"); return r.end(await readFile(`${OUT}${u.pathname}`)); }
  let f = path.join(root, u.pathname === "/" || u.pathname.startsWith("/article/") ? "index.html" : u.pathname);
  try { const b = await readFile(f); r.setHeader("content-type", types[path.extname(f)] || "application/octet-stream"); r.end(b); }
  catch { r.statusCode = 404; r.end(); }
}).listen(8899);

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 412, height: 880 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "he-IL", serviceWorkers: "block" })).newPage();
await p.goto("http://localhost:8899/"); await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/00-בית.png` });
for (const a of articles) {
  await p.goto(`http://localhost:8899/article/${a.slug}`); await p.waitForTimeout(1800);
  await p.screenshot({ path: `${OUT}/${a.slug}.png` });
}
await b.close(); server.close();
console.log(`נוצרו ${articles.length} דוגמאות`);
