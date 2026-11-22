// הורדת התמונות והסרטונים של המבזקים האחרונים מהאתר החי לתיקייה: node scripts/export-media.mjs <תיקייה>
import { mkdir, writeFile } from "node:fs/promises";
const SITE = process.env.SITE_URL || "https://www.nayesstatus.com";
const out = process.argv[2] || "media";
await mkdir(out, { recursive: true });
const { articles = [] } = await (await fetch(`${SITE}/api/articles?limit=60`)).json();
const lines = [];
let n = 0;
for (const a of articles) {
  for (const [kind, url] of [["תמונה", a.image_url], ["סרטון", a.video_url]]) {
    if (!url) continue;
    const r = await fetch(url.startsWith("http") ? url : SITE + url);
    if (!r.ok) continue;
    const ext = (url.split(".").pop() || "bin").split("?")[0];
    const name = `${String(++n).padStart(2, "0")}-${kind}-${a.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 40)}.${ext}`;
    await writeFile(`${out}/${name}`, Buffer.from(await r.arrayBuffer()));
    lines.push(`${name}\n  ${a.title}\n  ${a.image_credit || ""}${a.video_sound ? " · עם קול" : ""}\n  ${a.published_at}`);
  }
}
await writeFile(`${out}/רשימה.txt`, lines.join("\n\n") || "אין תמונות או סרטונים במבזקים האחרונים.");
console.log(`נשמרו ${n} קבצים`);
