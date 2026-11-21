// בדיקת מקורות: לכל פיד מנסים לקרוא, וסופרים ידיעות, תאריך אחרון ותמונות/סרטונים.
import { readFile } from "node:fs/promises";
import Parser from "rss-parser";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; NayesStatusBot/1.0)" },
  customFields: { item: [["media:content", "mediaContent", { keepArray: true }], ["media:thumbnail", "mediaThumb"]] },
});
const list = JSON.parse(await readFile(new URL("../pipeline/candidates.json", import.meta.url), "utf8"));

for (const s of list) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(s.url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; NayesStatusBot/1.0)" } });
    const xml = await r.text();
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const feed = await parser.parseString(xml);
    const items = feed.items || [];
    const latest = items.map((i) => Date.parse(i.isoDate || "")).filter(Boolean).sort((a, b) => b - a)[0];
    const img = items.filter((i) => (i.enclosure && /image/.test(i.enclosure.type || "")) || i.mediaContent || i.mediaThumb || /<img/i.test(i.content || i["content:encoded"] || "")).length;
    const vid = items.filter((i) => (i.enclosure && /video/.test(i.enclosure.type || ""))).length;
    console.log(`OK | ${s.name} | ${items.length} ידיעות | אחרונה: ${latest ? new Date(latest).toISOString() : "?"} | תמונות: ${img} | סרטונים: ${vid} | דוגמה: ${(items[0]?.title || "").slice(0, 60)}`);
  } catch (e) {
    console.log(`FAIL | ${s.name} | ${String(e.message).slice(0, 120)}`);
  }
}
