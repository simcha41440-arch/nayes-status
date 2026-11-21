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
import { readFile } from "node:fs/promises";
import Parser from "rss-parser";
import { db, makeSlug } from "../api/_lib/db.js";
import { writeArticle } from "../api/_lib/ai.js";
import { fetchImage, checkAndStore } from "../api/_lib/media.js";
import { checkFrames } from "../api/_lib/ai.js";
import { readTelegram } from "../api/_lib/telegram.js";
import { db as storageDb } from "../api/_lib/db.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 15);
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

async function main() {
  // עד שמגדירים את המפתחות ב-GitHub, הסריקה פשוט מדלגת (בלי שגיאות ובלי מיילים על כישלון).
  const missing = ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`הסריקה מדלגת: חסרים ${missing.join(", ")} בהגדרות (Settings > Secrets and variables > Actions).`);
    return;
  }
  const sources = await loadSources();
  if (!sources.length) {
    console.log("אין מקורות פעילים ב-sources.json. הוסף מקור וסמן enabled: true.");
    return;
  }

  const fresh = await filterNew(await collectItems(sources));
  const batch = fresh.slice(0, MAX_PER_RUN);
  console.log(`נמצאו ${fresh.length} ידיעות חדשות, מעבד ${batch.length}.`);

  // כותרות שכבר פורסמו, כדי שהעורך לא יפרסם את אותו אירוע פעמיים
  const since12 = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const { data: recentRows } = await db().from("articles").select("title").eq("status", "published")
    .gte("published_at", since12).order("published_at", { ascending: false }).limit(60);
  const recentTitles = (recentRows || []).map((r) => r.title);

  let accepted = 0;
  let rejected = 0;
  const newTitles = [];

  for (const item of batch) {
    let art;
    try {
      art = await writeArticle({ text: item.text, sourceName: item.source.name, sourceUrl: item.link, recentTitles });
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
    // אין תמונה מהמקור: תמונה (ולמבזקים חשובים גם סרטון) ממאגר חופשי, אחרי בדיקה
    if (PIXABAY_KEY && art.image_query) {
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
    if (PEXELS_KEY && art.image_query && !imageUrl) {
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
