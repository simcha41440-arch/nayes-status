// הצינור האוטומטי של נייעס.
// רץ כל כמה דקות (GitHub Actions), ובכל ריצה:
//   1. קורא את המקורות שב-sources.json (פידים של RSS)
//   2. מדלג על ידיעות שכבר טופלו
//   3. שולח כל ידיעה חדשה ל"עורך" ה-AI, שכותב אותה מחדש או פוסל אותה
//   4. שומר כ"ממתינה לאישור" ושולח לך התראה בטלגרם
//   (אם AUTO_PUBLISH=true, ידיעות בלי הערות לעורך מתפרסמות מיד)
//
// הרצה ידנית:  npm run pipeline

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import Parser from "rss-parser";
import { db, makeSlug } from "../api/_lib/db.js";
import { writeArticle, prefilter, rephraseWithout, checkFrontPage } from "../api/_lib/ai.js";
import { fetchImage, checkAndStore } from "../api/_lib/media.js";
import { checkFrames } from "../api/_lib/ai.js";
import { readTelegram } from "../api/_lib/telegram.js";
import { db as storageDb } from "../api/_lib/db.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import "../public/zmanim.js"; // מגדיר את globalThis.Zmanim (שבתות וימים טובים)

const run = promisify(execFile);

const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 8);        // כמה ידיעות העורך הראשי כותב בכל ריצה
const PREFILTER_BATCH = Number(process.env.PREFILTER_BATCH || 40); // כמה ידיעות נבדקות בסינון הזול בכל ריצה
// באילו ערוצים מותר לשים תמונת אילוסטרציה ממאגר חופשי (כשאין תמונה רשמית מהמקור)
const STOCK_CATEGORIES = new Set((process.env.STOCK_CATEGORIES || "economy,consumer").split(",").map((s) => s.trim()));
const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS || 12);
const AUTO_PUBLISH = process.env.AUTO_PUBLISH === "true";
// רף איכות: מבזק עם ציון חשיבות נמוך מזה לא נכנס בכלל (ברירת מחדל 6 מתוך 10).
const MIN_SCORE = Number(process.env.MIN_SCORE || 6);
// קול בסרטונים אוטומטיים. אפשר לכבות בלי לגעת בקוד: AUTO_VIDEO_SOUND=false
const AUTO_VIDEO_SOUND = process.env.AUTO_VIDEO_SOUND !== "false";
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

const parser = new Parser({
  timeout: 15000,
  customFields: { item: [["media:content", "mediaContent", { keepArray: true }], ["media:thumbnail", "mediaThumb"]] },
});

// כתובת התמונה של הידיעה מהפיד (אם יש): enclosure, media:content, media:thumbnail או התמונה הראשונה בתוכן.
function videoFromItem(it) {
  if (it.enclosure && /^video\//.test(it.enclosure.type || "") && it.enclosure.url) return { url: it.enclosure.url, type: it.enclosure.type };
  const mc = (it.mediaContent || []).find((m) => m && m.$ && m.$.url && (m.$.medium === "video" || /^video\//.test(m.$.type || "")));
  return mc ? { url: mc.$.url, type: mc.$.type || "video/mp4" } : null;
}

// סרטון אוטומטי: הורדה, שליפת פריימים לאורך כל הסרטון (ffmpeg), בדיקה, ורק אם הכל עבר: העלאה.
// קול: לפי AUTO_VIDEO_SOUND (ברירת מחדל: עם קול). הקול עצמו לא נבדק, רק התמונה.
async function processVideo(video) {
  const EXT = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
  const ext = EXT[video.type] || "mp4";
  const r = await fetch(video.url);
  if (!r.ok) throw new Error(`הורדה נכשלה (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) throw new Error("גדול מ-50MB");
  const dir = await mkdtemp(path.join(tmpdir(), "nayes-"));
  try {
    const file = path.join(dir, `in.${ext}`);
    await writeFile(file, buf);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const dur = parseFloat(stdout);
    if (!isFinite(dur) || dur <= 0) throw new Error("אורך לא ידוע");
    if (dur > 180) throw new Error("ארוך מ-3 דקות");
    const n = Math.max(8, Math.min(40, Math.ceil(dur / 1.5)));
    await run("ffmpeg", ["-v", "error", "-i", file, "-vf", `fps=${n / dur},scale='min(512,iw)':-2`, "-frames:v", String(n), "-q:v", "5", path.join(dir, "f%03d.jpg")]);
    const names = (await readdir(dir)).filter((f) => f.startsWith("f") && f.endsWith(".jpg")).sort();
    if (names.length < 3) throw new Error("לא נשלפו מספיק פריימים");
    const frames = [];
    for (const f of names) {
      const b = await (await import("node:fs/promises")).readFile(path.join(dir, f));
      frames.push({ base64: b.toString("base64"), mediaType: "image/jpeg", buffer: b });
    }
    const check = await checkFrames(frames);
    if (!check.approved) return { approved: false, reason: check.reason };
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
    const st = storageDb().storage.from("media");
    let e = (await st.upload(`${id}.jpg`, frames[0].buffer, { contentType: "image/jpeg" })).error;
    if (e) throw e;
    e = (await st.upload(`${id}.${ext}`, buf, { contentType: video.type || "video/mp4" })).error;
    if (e) throw e;
    return { approved: true, videoUrl: `/media/${id}.${ext}`, posterUrl: `/media/${id}.jpg` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------- Pexels: מאגר תמונות וסרטונים חופשי לשימוש (גם מסחרי, בלי צורך באישור) ----------
const PEXELS_KEY = process.env.PEXELS_API_KEY;
const VIDEO_MIN_SCORE = Number(process.env.VIDEO_MIN_SCORE || 8);

async function pexels(path) {
  const r = await fetch(`https://api.pexels.com${path}`, { headers: { Authorization: PEXELS_KEY } });
  if (!r.ok) throw new Error(`Pexels ${r.status}`);
  return r.json();
}

async function pexelsImage(query) {
  const data = await pexels(`/v1/search?query=${encodeURIComponent(query)}&per_page=6&orientation=portrait`);
  for (const ph of data.photos || []) {
    try {
      const stored = await checkAndStore(await fetchImage(ph.src.large || ph.src.medium));
      if (stored.approved) return { url: stored.url, credit: `צילום: ${ph.photographer} / Pexels` };
    } catch {}
  }
  return null;
}

async function pexelsVideo(query) {
  const data = await pexels(`/v1/videos/search?query=${encodeURIComponent(query)}&per_page=4&orientation=portrait&size=small`);
  for (const v of data.videos || []) {
    if (!v.duration || v.duration > 30) continue;
    const file = (v.video_files || [])
      .filter((f) => f.file_type === "video/mp4" && f.width && f.width <= 720)
      .sort((a, b) => b.width - a.width)[0];
    if (!file) continue;
    try {
      const res = await processVideo({ url: file.link, type: "video/mp4" });
      if (res.approved) return { ...res, credit: `וידאו: ${v.user?.name || "Pexels"} / Pexels` };
    } catch {}
  }
  return null;
}

// ---------- Pixabay: מאגר חופשי לשימוש (גם מסחרי, בלי צורך באישור). הקבצים נשמרים אצלנו. ----------
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;

async function pixabay(path, query) {
  const q = encodeURIComponent(String(query).slice(0, 90));
  const r = await fetch(`https://pixabay.com/api/${path}?key=${PIXABAY_KEY}&q=${q}&safesearch=true&per_page=6&lang=en`);
  if (!r.ok) throw new Error(`Pixabay ${r.status}`);
  return r.json();
}

async function pixabayImage(query) {
  const data = await pixabay("", `${query}`);
  for (const h of data.hits || []) {
    try {
      const stored = await checkAndStore(await fetchImage(h.largeImageURL || h.webformatURL));
      if (stored.approved) return { url: stored.url, credit: `צילום: ${h.user || "Pixabay"} / Pixabay` };
    } catch {}
  }
  return null;
}

async function pixabayVideo(query) {
  const data = await pixabay("videos/", query);
  for (const h of data.hits || []) {
    if (!h.duration || h.duration > 30) continue;
    const f = (h.videos && (h.videos.small || h.videos.tiny)) || null;
    if (!f || !f.url) continue;
    try {
      const res = await processVideo({ url: f.url, type: "video/mp4" });
      if (res.approved) return { ...res, credit: `וידאו: ${h.user || "Pixabay"} / Pixabay` };
    } catch {}
  }
  return null;
}

function imageFromItem(it) {
  if (it.enclosure && /^image\//.test(it.enclosure.type || "") && it.enclosure.url) return it.enclosure.url;
  const mc = (it.mediaContent || []).find((m) => m && m.$ && m.$.url && (!m.$.medium || m.$.medium === "image"));
  if (mc) return mc.$.url;
  if (it.mediaThumb && it.mediaThumb.$ && it.mediaThumb.$.url) return it.mediaThumb.$.url;
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(it["content:encoded"] || it.content || "");
  return m ? m[1] : null;
}

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);

const stripHtml = (s = "") =>
  s.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function loadSources() {
  const url = new URL("./sources.json", import.meta.url);
  const list = JSON.parse(await readFile(url, "utf8"));
  return list.filter((s) => s.enabled);
}

async function collectItems(sources) {
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  const items = [];
  for (const src of sources) {
    if (src.type === "telegram") {
      // ערוץ טלגרם רשמי: הודעה + תמונה/סרטון, עם קרדיט לגוף שפרסם
      try {
        const { posts } = await readTelegram(src.channel);
        for (const p of posts) {
          const when = p.date ? Date.parse(p.date) : Date.now();
          if (when < cutoff || !p.text || p.text.length < 25) continue;
          items.push({
            source: { ...src, name: src.name || src.credit },
            hash: hash(`tg|${p.id}`),
            link: p.link,
            image: src.media ? p.photos[0] || null : null,
            video: src.media && p.videos[0] ? { url: p.videos[0], type: "video/mp4" } : null,
            credit: src.credit || null,
            when,
            text: p.text.slice(0, 15000),
          });
        }
      } catch (err) {
        console.warn(`⚠ ערוץ טלגרם "${src.channel}" נכשל: ${err.message}`);
      }
      continue;
    }
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(src.url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; NayesStatusBot/1.0)" } });
      const xml = await res.text();
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feed = await parser.parseString(xml);
      for (const it of feed.items || []) {
        const when = it.isoDate ? Date.parse(it.isoDate) : Date.now();
        if (when < cutoff) continue;
        const link = it.link || it.guid || it.title;
        if (!link) continue;
        items.push({
          source: src,
          hash: hash(`${src.name}|${link}`),
          link: it.link || null,
          image: src.media || src.images ? imageFromItem(it) : null,
          video: src.media || src.images ? videoFromItem(it) : null,
          when,
          text: [it.title, stripHtml(it["content:encoded"] || it.content || it.contentSnippet || "")]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 15000),
        });
      }
    } catch (err) {
      console.warn(`⚠ מקור "${src.name}" נכשל: ${err.message}`);
    }
  }
  return items.sort((a, b) => b.when - a.when);
}

async function filterNew(items) {
  if (!items.length) return [];
  const hashes = items.map((i) => i.hash);
  const { data, error } = await db().from("articles").select("source_hash").in("source_hash", hashes);
  if (error) throw error;
  const seen = new Set((data || []).map((r) => r.source_hash));
  return items.filter((i) => !seen.has(i.hash));
}

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.warn("⚠ שליחת התראה לטלגרם נכשלה:", err.message);
  }
}

// ---------- ויקישיתוף: תמונות אמיתיות ברישיון חופשי (כולל תמונות לע"מ) ----------
const WM_UA = { "User-Agent": "NayesStatusBot/1.0 (https://www.nayesstatus.com)" };
const stripTags = (h = "") => String(h).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function commonsImage(search, mustWords = []) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10`
    + `&gsrsearch=${encodeURIComponent(search + " filetype:bitmap")}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1080`;
  const r = await fetch(api, { headers: WM_UA });
  if (!r.ok) throw new Error(`Commons ${r.status}`);
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !/image\/(jpeg|png)/.test(info.mime || "")) continue;
    const meta = info.extmetadata || {};
    const license = stripTags(meta.LicenseShortName?.value || "");
    if (!/^(CC BY|CC0|Public domain|PD)/i.test(license) || /NC|ND/.test(license)) continue; // רק רישיון שמתיר שימוש
    const text = `${p.title} ${stripTags(meta.ImageDescription?.value || "")} ${stripTags(meta.ObjectName?.value || "")}`.toLowerCase();
    if (mustWords.some((w) => !text.includes(w.toLowerCase()))) continue; // לוודא שזה באמת האדם/המקום
    const imgRes = await fetch(info.thumburl || info.url, { headers: WM_UA });
    if (!imgRes.ok) continue;
    const type = (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0];
    const stored = await checkAndStore({ buffer: Buffer.from(await imgRes.arrayBuffer()), type });
    if (!stored.approved) continue;
    const gpo = /government press office|\bgpo\b/i.test(text);
    const artist = stripTags(meta.Artist?.value || "").slice(0, 60);
    // "צילום ארכיון": שלא ייראה כאילו התמונה צולמה באירוע שבידיעה
    return { url: stored.url, credit: gpo ? `צילום ארכיון: לע"מ (${license})` : `צילום ארכיון: ${artist || "ויקישיתוף"} / ויקישיתוף (${license})` };
  }
  return null;
}

// אדם אחד או שניים ("A | B"). קודם מחפשים תמונה של שניהם יחד; אם אין, תמונה של החשוב מביניהם.
async function personImage(query) {
  const names = query.split("|").map((s) => s.trim()).filter(Boolean).slice(0, 2);
  const last = (n) => n.split(/\s+/).pop();
  if (names.length === 2) {
    const both = await commonsImage(`"${names[0]}" "${names[1]}"`, names.map(last));
    if (both) return { ...both, together: true };
  }
  const n = names[0];
  return (await commonsImage(`"${n}" "Government Press Office"`, [last(n)])) || (await commonsImage(`"${n}"`, [last(n)]));
}

// ---------- שערי העיתונים של הבוקר (רק מה שעובר את בדיקת הצניעות) ----------
const FRONT_PAGES = []; // ידיעות אחרונות הוסר לבקשת בעל האתר. העיתונים החרדיים יתווספו כשיימצא מקור אוטומטי.

async function frontPages(hm) {
  if (hm < 360 || hm >= 720) return; // רק בין 06:00 ל-12:00
  const { y, m, d } = globalThis.Zmanim.israelYMD(new Date());
  const ymd = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  for (const p of FRONT_PAGES) {
    const slug = `front-${ymd}-${p.key.replace(/_/g, "")}`;
    const { data: exists } = await db().from("articles").select("id").eq("slug", slug).maybeSingle();
    if (exists) continue;
    const url = `https://img.kiosko.net/${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/il/${p.key}.750.jpg`;
    const r = await fetch(url).catch(() => null);
    if (!r || !r.ok) continue; // השער של היום עוד לא עלה; ננסה בסבב הבא
    const buffer = Buffer.from(await r.arrayBuffer());
    const type = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    const check = await checkFrontPage({ base64: buffer.toString("base64"), mediaType: type });
    const title = `שער "${p.name}" הבוקר`;
    if (!check.approved) {
      console.log(`  ✗ שער "${p.name}": ${check.reason}`);
      await db().from("articles").insert({ slug, title, status: "rejected", source_name: p.name, ai_notes: `שער עיתון נפסל: ${check.reason}`.slice(0, 500) });
      continue;
    }
    const name = `front-${ymd}-${p.key}.jpg`;
    const { error } = await db().storage.from("media").upload(name, buffer, { contentType: type, upsert: true });
    if (error) { console.log(`  שער "${p.name}": ${error.message}`); continue; }
    await db().from("articles").insert({
      slug, title, status: "published", published_at: new Date().toISOString(),
      summary: check.headline ? `הכותרת הראשית: "${check.headline}"` : `כך נראה הבוקר השער של "${p.name}".`,
      category: "general", source_name: p.name, image_url: `/media/${name}`, image_credit: `שער "${p.name}"`,
    });
    console.log(`  ✓ שער "${p.name}" פורסם`);
  }
}

async function main() {
  // מתג השהיה: כשהקובץ pipeline/PAUSED קיים, אין עדכונים בכלל
  if (existsSync(new URL("./PAUSED", import.meta.url))) { console.log("החדשות מושהות."); return; }
  // עד שמגדירים את המפתחות ב-GitHub, הסריקה פשוט מדלגת (בלי שגיאות ובלי מיילים על כישלון).
  const missing = ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`הסריקה מדלגת: חסרים ${missing.join(", ")} בהגדרות (Settings > Secrets and variables > Actions).`);
    return;
  }
  // ניקוי: תמונות אילוסטרציה שעלו בעבר על נושאים שלא מתאים להם (פוליטיקה, אנשים וכו') יורדות, והמבזק נשאר כטקסט
  try {
    const { data: stale } = await db().from("articles").select("id,category")
      .or("image_credit.ilike.%/ Pixabay,image_credit.ilike.%/ Pexels").limit(500);
    const ids = (stale || []).filter((a) => !STOCK_CATEGORIES.has(a.category)).map((a) => a.id);
    if (ids.length) {
      await db().from("articles").update({ image_url: null, image_credit: null, video_url: null }).in("id", ids);
      console.log(`הוסרו תמונות אילוסטרציה מ-${ids.length} מבזקים שלא מתאימה להם תמונה כזו.`);
    }
  } catch (err) { console.log("ניקוי תמונות:", err.message); }

  // ניסוח: מבזקים מהימים האחרונים עם מילים כמו "צניעות" או "דתי" מנוסחים מחדש (עד 3 בכל ריצה)
  try {
    const BAD = /(^|[\s"'(״׳-])[בוהלמש]{0,2}(צניעות|צנוע\S*|דת|דתי\S*|חילוני\S*)(?=$|[\s.,:;!?"')״׳-])/;
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: rows } = await db().from("articles").select("id,title,summary,body").eq("status", "published").gte("published_at", since).limit(300);
    for (const a of (rows || []).filter((r) => BAD.test(`${r.title} ${r.summary || ""} ${r.body || ""}`)).slice(0, 3)) {
      const r = await rephraseWithout(a);
      if (r && r.title && !r.refused) {
        await db().from("articles").update({ title: r.title, summary: r.summary, body: r.body || null }).eq("id", a.id);
        console.log(`נוסח מחדש: "${a.title}" ← "${r.title}"`);
      }
    }
  } catch (err) { console.log("ניסוח מחדש:", err.message); }

  // תיקון כותרת לבקשת בעל האתר (חד-פעמי; אחרי שתוקן, לא משנה כלום)
  await db().from("articles").update({ title: "שמחת נישואי נכדת הגאון רבי שאול אלתר שליט\"א" })
    .eq("slug", "20261122-c4e3jv").like("title", "בשמחה רבה%").then(() => {}, () => {});

  // הודעת "פרסמו אצלנו" מהימים הראשונים יורדת מהאתר
  await db().from("articles").update({ status: "rejected" }).eq("slug", "welcome-5").eq("status", "published").then(() => {}, () => {});

  // לילה: עד 01:00 כרגיל. מ-01:00 עד 06:00 רק פעמיים (02:30 ו-04:30). ב-06:00 חוזרים, עם מה שהיה בלילה.
  const hm = (() => { const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number); return h * 60 + m; })();
  const NIGHT_SLOTS = [150, 270]; // 02:30, 04:30
  if (hm >= 60 && hm < 360 && !NIGHT_SLOTS.some((s) => hm >= s && hm < s + 15) && process.env.IGNORE_NIGHT !== "true") {
    console.log("לילה: אין סריקה עכשיו. הסריקות הבאות ב-02:30, 04:30 ומ-06:00 כרגיל.");
    return;
  }

  // שבת וימים טובים: אין עדכונים בכלל (וגם לא עולה כסף)
  const holy = globalThis.Zmanim.holyNow(new Date());
  if (holy && process.env.IGNORE_SHABBAT !== "true") {
    console.log(`${holy}: אין עדכונים. הסריקה תחזור במוצאי ${holy === "שבת" ? "שבת" : "החג"}.`);
    return;
  }
  await frontPages(hm).catch((err) => console.log("שערי עיתונים:", err.message));

  const sources = await loadSources();
  if (!sources.length) {
    console.log("אין מקורות פעילים ב-sources.json. הוסף מקור וסמן enabled: true.");
    return;
  }

  const fresh = await filterNew(await collectItems(sources));
  const candidates = fresh.slice(0, PREFILTER_BATCH);

  // כותרות שכבר פורסמו, כדי שהעורך לא יפרסם את אותו אירוע פעמיים
  const since12 = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const { data: recentRows } = await db().from("articles").select("title").eq("status", "published")
    .gte("published_at", since12).order("published_at", { ascending: false }).limit(60);
  const recentTitles = (recentRows || []).map((r) => r.title);

  // שלב 1: סינון זול של כל המועמדות בבת אחת (כולל כפילויות וידיעות שוליות בבירור)
  const verdicts = await prefilter(candidates.map((c) => ({ source: c.source.name, text: c.text })), recentTitles);
  const batch = [];
  for (let i = 0; i < candidates.length; i++) {
    if (verdicts[i].pass) { if (batch.length < MAX_PER_RUN) batch.push(candidates[i]); continue; }
    console.log(`  ✗ (סינון ראשוני) [${candidates[i].source.name}] ${verdicts[i].reason.slice(0, 120)}`);
    // נשמר כנפסל כדי לא לבדוק שוב
    await db().from("articles").insert({
      slug: makeSlug(), title: "(נפסל)", status: "rejected", source_name: candidates[i].source.name,
      source_url: candidates[i].link, source_hash: candidates[i].hash, ai_notes: `סינון ראשוני: ${verdicts[i].reason}`.slice(0, 500),
    });
  }
  console.log(`נמצאו ${fresh.length} ידיעות חדשות. ${candidates.length} נבדקו בסינון הזול, ${batch.length} עוברות לעורך הראשי.`);


  let accepted = 0;
  let rejected = 0;
  const newTitles = [];

  for (const item of batch) {
    let art;
    try {
      const ageHours = item.when ? (Date.now() - item.when) / 3600000 : null;
      art = await writeArticle({ text: item.text, sourceName: item.source.name, sourceUrl: item.link, recentTitles, ageHours, lowTrust: item.source.trust === "low" });
      // בלי פאדיחות: ידיעה ישנה (למשל מהלילה) לא מסומנת "דחוף"
      if (art.relevant && ageHours != null && ageHours > 3) art.is_breaking = false;
      // שירים חדשים: לא בימי ספירת העומר ובין המצרים
      if (art.relevant && (art.category === "music" || item.source.category === "music") && globalThis.Zmanim.noMusic(globalThis.Zmanim.israelYMD(new Date()))) {
        art = { relevant: false, reject_reason: "שירים חדשים: לא בימי ספירה ובין המצרים" };
      }
    } catch (err) {
      console.warn(`⚠ עיבוד נכשל (${item.link}): ${err.message}`);
      continue; // לא נשמר, ולכן ינוסה שוב בריצה הבאה
    }

    const base = {
      slug: makeSlug(),
      source_name: item.source.name,
      source_url: item.link,
      source_hash: item.hash,
    };

    if (art.relevant && art.score < MIN_SCORE) {
      art = { relevant: false, reject_reason: `ציון חשיבות נמוך (${art.score}/10): ${art.title}` };
    }

    if (!art.relevant) {
      console.log(`  ✗ [${item.source.name}] ${(art.reject_reason || "").slice(0, 140)}`);
      // שומרים גם ידיעות שנפסלו, כדי לא לשלם על עיבוד שלהן שוב.
      await db().from("articles").insert({
        ...base,
        title: "(נפסל)",
        status: "rejected",
        ai_notes: art.reject_reason || null,
      });
      rejected++;
      continue;
    }

    // תמונה אוטומטית: רק ממקורות שסומנו "images": true, ורק אם עברה בדיקה (בלי נשים וכו').
    let imageUrl = null;
    if (item.image && /^https:\/\//.test(item.image)) {
      try {
        const stored = await checkAndStore(await fetchImage(item.image));
        if (stored.approved) imageUrl = stored.url;
        else console.log(`  תמונה נפסלה: ${stored.reason}`);
      } catch (err) {
        console.log(`  תמונה לא נטענה: ${err.message}`);
      }
    }

    let videoUrl = null;
    if (item.video && /^https:\/\//.test(item.video.url)) {
      try {
        const v = await processVideo(item.video);
        if (v.approved) { videoUrl = v.videoUrl; imageUrl = imageUrl || v.posterUrl; }
        else console.log(`  סרטון נפסל: ${v.reason}`);
      } catch (err) {
        console.log(`  סרטון לא עובד: ${err.message}`);
      }
    }

    // קרדיט לתמונה/סרטון מהמקור עצמו (למשל "דובר צה"ל")
    let credit = (imageUrl || videoUrl) && item.credit ? `${videoUrl ? "תיעוד" : "צילום"}: ${item.credit}` : null;
    // אין תמונה מהמקור: תמונת אילוסטרציה ממאגר חופשי, רק בכלכלה וצרכנות (כסף, מוצרים, מחירים).
    // ידיעה על אנשים, פוליטיקה, רבנים, קהילה או ביטחון בלי תמונה רשמית: בלי תמונה בכלל (סטטוס טקסט).
    const wantStock = Boolean(art.image_query) && STOCK_CATEGORIES.has(art.category) && !imageUrl && !videoUrl;
    if (PIXABAY_KEY && wantStock) {
      if (!videoUrl && art.score >= VIDEO_MIN_SCORE) {
        try {
          const v = await pixabayVideo(art.image_query);
          if (v) { videoUrl = v.videoUrl; imageUrl = imageUrl || v.posterUrl; credit = v.credit; }
        } catch (err) { console.log(`  Pixabay וידאו: ${err.message}`); }
      }
      if (!imageUrl) {
        try {
          const im = await pixabayImage(art.image_query);
          if (im) { imageUrl = im.url; credit = credit || im.credit; }
        } catch (err) { console.log(`  Pixabay תמונה: ${err.message}`); }
      }
    }
    if (PEXELS_KEY && wantStock && !imageUrl) {
      if (!videoUrl && art.score >= VIDEO_MIN_SCORE) {
        try {
          const v = await pexelsVideo(art.image_query);
          if (v) { videoUrl = v.videoUrl; imageUrl = imageUrl || v.posterUrl; credit = v.credit; }
        } catch (err) { console.log(`  Pexels וידאו: ${err.message}`); }
      }
      if (!imageUrl) {
        try {
          const im = await pexelsImage(art.image_query);
          if (im) { imageUrl = im.url; credit = credit || im.credit; }
        } catch (err) { console.log(`  Pexels תמונה: ${err.message}`); }
      }
    }

    // אין תמונה: תמונת ארכיון אמיתית מוויקישיתוף, רק לנושא כללי (למשל חברי הכנסת החרדים בידיעה על חוק הגיוס) או למקום.
    if (!imageUrl && !videoUrl && art.topic_query) {
      try {
        const key = art.topic_query.split(/\s+/).sort((x, y) => y.length - x.length)[0];
        const im = await commonsImage(art.topic_query, [key]);
        if (im) { imageUrl = im.url; credit = im.credit; }
      } catch (err) { console.log(`  ויקישיתוף (נושא): ${err.message}`); }
    }
    if (!imageUrl && !videoUrl && art.place_query) {
      try {
        const words = art.place_query.split(/\s+/).filter((w) => w.length > 3 && !/^(israel|building|city)$/i.test(w)).slice(0, 1);
        const im = await commonsImage(art.place_query, words);
        if (im) { imageUrl = im.url; credit = im.credit; }
      } catch (err) { console.log(`  ויקישיתוף (מקום): ${err.message}`); }
    }

    // פרסום אוטומטי, חוץ ממקרים רציניים שהעורך סימן לבדיקה של אדם
    const publishNow = AUTO_PUBLISH && !art.needs_review;
    const row = {
      ...base,
      title: art.title,
      summary: art.summary || null,
      impact: art.impact || null,
      body: art.body || null,
      score: art.score,
      category: item.source.category || art.category,
      city: art.city || item.source.city || null,
      is_breaking: art.is_breaking,
      ai_notes: art.ai_notes || null,
      image_url: imageUrl,
      image_credit: credit,
      video_url: videoUrl,
      video_sound: Boolean(videoUrl) && AUTO_VIDEO_SOUND,
      status: publishNow ? "published" : "pending",
      published_at: publishNow ? new Date().toISOString() : null,
    };
    let { error } = await db().from("articles").insert(row);
    if (error && /image_credit|video_url|video_sound/.test(error.message || "")) {
      // עדכון במסד הנתונים עוד לא הורץ: שומרים בלי העמודות החדשות
      const { image_credit, video_url, video_sound, ...basic } = row;
      ({ error } = await db().from("articles").insert(basic));
    }
    if (error) {
      console.warn("⚠ שמירה נכשלה:", error.message);
      continue;
    }
    accepted++;
    console.log(`  ✓ [${item.source.name}] ${art.score}/10 ${publishNow ? "פורסם" : "ממתין"}: ${art.title}`);
    if (publishNow) recentTitles.unshift(art.title);
    newTitles.push(`${art.is_breaking ? "🔴 " : "• "}${art.title} (${art.score}/10)`);
  }

  console.log(`✓ ${accepted} ידיעות נכתבו, ${rejected} נפסלו.`);

  if (newTitles.length) {
    const head = AUTO_PUBLISH
      ? `נייעס סטטוס: ${newTitles.length} מבזקים חדשים`
      : `נייעס סטטוס: ${newTitles.length} מבזקים ממתינים לאישורך`;
    const link = SITE_URL ? `\n\n${SITE_URL}/admin` : "";
    await notifyTelegram(`${head}\n\n${newTitles.join("\n")}${link}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
