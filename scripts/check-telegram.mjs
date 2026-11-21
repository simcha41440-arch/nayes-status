// בדיקת ערוצי טלגרם: האם קיימים, מה שם הערוץ, כמה הודעות, מתי האחרונה, תמונות וסרטונים.
import { readFile } from "node:fs/promises";
import { readTelegram } from "../api/_lib/telegram.js";
const list = JSON.parse(await readFile(new URL("../pipeline/telegram-candidates.json", import.meta.url), "utf8"));
for (const c of list) {
  try {
    const { title, posts } = await readTelegram(c.channel);
    if (!posts.length) { console.log(`EMPTY | ${c.channel} | ${title}`); continue; }
    const photos = posts.reduce((n, p) => n + p.photos.length, 0);
    const videos = posts.reduce((n, p) => n + p.videos.length, 0);
    console.log(`OK | ${c.channel} | ${title} | ${posts.length} הודעות | אחרונה: ${posts[0].date} | תמונות: ${photos} | סרטונים: ${videos} | ${(posts[0].text || "").slice(0, 70).replace(/\n/g, " ")}`);
  } catch (e) {
    console.log(`FAIL | ${c.channel} | ${e.message}`);
  }
}
