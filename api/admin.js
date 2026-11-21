import { db, makeSlug } from "./_lib/db.js";
import {
  checkPassword, issueToken, verifyToken, tokenFromRequest, deviceFromRequest, deviceHash,
  newCode, hashCode, codeMatches, signApproval, checkApproval,
} from "./_lib/auth.js";
import { writeArticle } from "./_lib/ai.js";
import { fetchImage, decodeDataUrl, checkAndStore, checkVideoFrames, createVideoUpload, isStoredName } from "./_lib/media.js";
import { mailConfigured, mailOwner } from "./_lib/mailer.js";
import { CATEGORIES } from "./_lib/config.js";

// API של לוח הבקרה. כל הבקשות: POST עם { action, ... }.
//
// login     { password, deviceId, pairCode? } → { token } רק ממכשיר מורשה (הראשון נרשם אוטומטית)
// mailPairCode {}                            → שולח קוד לאישור מכשיר חדש למייל של בעל האתר (אם מכשיר אבד)
// devicesList {} / deviceRemove { id }       → המכשירים המורשים
// pairStart {}                               → קוד חד-פעמי לאישור מכשיר נוסף (מוצג במכשיר מורשה)
// checkVideo { frames }                      → בדיקת AI לפריימים מהסרטון; אם עבר: כתובת העלאה + אישור חתום
// attachVideo { id, name, approval, poster, sound } → שיוך הסרטון שהועלה לידיעה
// setVideoSound { id, sound }                → קול בסרטון (רק אחרי שהמנהל שמע ואישר)
// list      { status }                       → { articles }
// update    { id, fields }                   → עדכון שדות של ידיעה
// publish   { id }                           → פרסום
// reject    { id }                           → דחייה
// compose   { text, sourceName, sourceUrl }  → AI כותב ידיעה מהודעה שהדבקת (נשמרת כממתינה)
// setImage  { id, url | file }               → בדיקת AI לתמונה (קישור או קובץ), ושמירה אצלנו רק אם עברה
// uploadImage { url | file }                 → בדיקה ושמירה בלבד (למודעות), מחזיר { url }
// adsList   {}                               → כל המודעות + סטטיסטיקות
// adSave    { ad }                           → יצירה/עדכון מודעה (התמונה נבדקת ב-AI)
// adToggle  { id, active }                   → הפעלה/השהיה
// adDelete  { id }                           → מחיקה
// messagesList {}                            → פניות מטופס יצירת הקשר
// messageDone  { id, done }                  → סימון פנייה כמטופלת

const EDITABLE = new Set([
  "title", "summary", "impact", "body", "category", "city", "is_breaking",
]);

// הגבלה פשוטה על ניסיונות כניסה (לכל מופע של הפונקציה).
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, t: now };
  if (now - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  attempts.set(ip, rec);
  return rec.n > 10;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const { action } = body;

  try {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";

    if (action === "mailPairCode") {
      if (!mailConfigured()) return res.status(400).json({ error: "שליחת מייל עדיין לא הוגדרה" });
      if (tooManyAttempts(ip)) return res.status(429).json({ error: "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה." });
      const code = await createPairCode();
      if (!code) return res.status(429).json({ error: "קוד כבר נשלח. אפשר לבקש קוד חדש בעוד דקה." });
      await mailOwner({
        subject: `קוד לאישור מכשיר חדש בנייעס סטטוס: ${code}`,
        text: `קוד לאישור מכשיר חדש בלוח הבקרה של נייעס סטטוס: ${code}\n\nהקוד תקף ל-10 דקות.\nאם לא ביקשת, אפשר להתעלם מההודעה. בלי הסיסמה אי אפשר להיכנס.`,
      });
      return res.status(200).json({ sent: true });
    }

    if (action === "login") {
      if (tooManyAttempts(ip)) return res.status(429).json({ error: "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה." });
      if (!checkPassword(body.password)) return res.status(401).json({ error: "סיסמה שגויה" });
      const dh = deviceHash(body.deviceId);
      if (!dh) return res.status(400).json({ error: "מזהה מכשיר חסר" });

      const { data: known } = await db().from("trusted_devices").select("id").eq("device_hash", dh).maybeSingle();
      if (!known) {
        const { count } = await db().from("trusted_devices").select("id", { count: "exact", head: true });
        let allowed = count === 0; // המכשיר הראשון נרשם אוטומטית
        if (!allowed && body.pairCode) {
          const { data: rec } = await db().from("admin_codes").select("*").eq("id", 1).maybeSingle();
          if (rec && Date.parse(rec.expires_at) > Date.now() && rec.attempts < 5) {
            if (codeMatches(body.pairCode, rec.code_hash)) {
              allowed = true;
              await db().from("admin_codes").delete().eq("id", 1);
            } else {
              await db().from("admin_codes").update({ attempts: rec.attempts + 1 }).eq("id", 1);
            }
          }
        }
        if (!allowed) {
          return res.status(403).json({ needPair: true, error: "המכשיר הזה לא מורשה. צריך קוד לאישור מכשיר חדש." });
        }
        const label = String(req.headers["user-agent"] || "").slice(0, 160);
        const { error } = await db().from("trusted_devices").insert({ device_hash: dh, label });
        if (error) throw error;
      } else {
        await db().from("trusted_devices").update({ last_seen: new Date().toISOString() }).eq("id", known.id);
      }
      return res.status(200).json({ token: issueToken(dh) });
    }

    const dh = verifyToken(tokenFromRequest(req), deviceFromRequest(req));
    const { data: trusted } = dh
      ? await db().from("trusted_devices").select("id").eq("device_hash", dh).maybeSingle()
      : { data: null };
    if (!trusted) {
      res.status(401).json({ error: "נדרשת כניסה מחדש" });
      return;
    }

    switch (action) {
      case "list": {
        const status = ["pending", "published", "rejected"].includes(body.status)
          ? body.status
          : "pending";
        const { data, error } = await db()
          .from("articles")
          .select("*")
          .eq("status", status)
          .order(status === "published" ? "published_at" : "created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return res.status(200).json({ articles: data });
      }

      case "update": {
        const fields = {};
        for (const [k, v] of Object.entries(body.fields || {})) {
          if (!EDITABLE.has(k)) continue;
          if (k === "category" && !CATEGORIES[v]) continue;
          fields[k] = k === "is_breaking" ? Boolean(v) : String(v ?? "").trim() || null;
        }
        if (fields.title === null || fields.summary === null) {
          return res.status(400).json({ error: "כותרת וטקסט המבזק הם שדות חובה" });
        }
        const { error } = await db().from("articles").update(fields).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "publish": {
        const { error } = await db()
          .from("articles")
          .update({ status: "published", published_at: new Date().toISOString() })
          .eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "reject": {
        const { error } = await db().from("articles").update({ status: "rejected" }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "compose": {
        const text = String(body.text || "").trim();
        if (text.length < 20) {
          return res.status(400).json({ error: "הטקסט קצר מדי" });
        }
        const art = await writeArticle({
          text: text.slice(0, 20000),
          sourceName: body.sourceName,
          sourceUrl: body.sourceUrl,
        });
        if (!art.relevant) {
          return res.status(200).json({ rejected: true, reason: art.reject_reason });
        }
        const { data, error } = await db()
          .from("articles")
          .insert({
            slug: makeSlug(),
            title: art.title,
            summary: art.summary || null,
            impact: art.impact || null,
            body: art.body || null,
            score: art.score,
            category: art.category,
            city: art.city || null,
            is_breaking: art.is_breaking,
            ai_notes: art.ai_notes || null,
            source_name: body.sourceName || null,
            source_url: body.sourceUrl || null,
            status: "pending",
          })
          .select("*")
          .single();
        if (error) throw error;
        return res.status(200).json({ article: data });
      }

      case "setImage": {
        const url = String(body.url || "").trim();
        if (!url && !body.file) {
          const { error } = await db().from("articles").update({ image_url: null }).eq("id", body.id);
          if (error) throw error;
          return res.status(200).json({ ok: true, removed: true });
        }
        if (url.startsWith("/media/")) return res.status(200).json({ approved: true, url, reason: "התמונה כבר שמורה" });
        const stored = await checkAndStore(body.file ? decodeDataUrl(body.file) : await fetchImage(url));
        if (!stored.approved) {
          return res.status(200).json({ approved: false, reason: stored.reason });
        }
        const { error } = await db().from("articles").update({ image_url: stored.url }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ approved: true, url: stored.url, reason: stored.reason });
      }

      case "uploadImage": {
        const stored = await checkAndStore(body.file ? decodeDataUrl(body.file) : await fetchImage(String(body.url || "").trim()));
        return res.status(200).json(stored);
      }

      case "adsList": {
        const { data, error } = await db().from("ads").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json({ ads: data });
      }

      case "adSave": {
        const ad = body.ad || {};
        const row = {
          advertiser: clean(ad.advertiser),
          title: clean(ad.title),
          text: clean(ad.text),
          cta: clean(ad.cta),
          link: clean(ad.link),
          placement: ["top", "feed", "side"].includes(ad.placement) ? ad.placement : "feed",
          color: /^#[0-9a-f]{6}$/i.test(ad.color || "") ? ad.color : null,
          starts_at: ad.starts_at || null,
          ends_at: ad.ends_at || null,
        };
        if (!row.advertiser || !row.title) {
          return res.status(400).json({ error: "שם המפרסם וכותרת הם שדות חובה" });
        }
        if (row.link && !/^(https:\/\/|tel:|mailto:)/i.test(row.link)) {
          return res.status(400).json({ error: "הקישור חייב להתחיל ב-https://, tel: או mailto:" });
        }

        // תמונה של מודעה: רק קובץ שכבר נבדק ונשמר אצלנו (/media/...). קישור חיצוני נבדק ונשמר עכשיו.
        let image = clean(ad.image_url);
        if (image && !image.startsWith("/media/")) {
          const stored = await checkAndStore(await fetchImage(image));
          if (!stored.approved) {
            return res.status(200).json({ imageRejected: true, reason: stored.reason });
          }
          image = stored.url;
        }
        row.image_url = image;

        const q = ad.id
          ? db().from("ads").update(row).eq("id", ad.id).select("*").single()
          : db().from("ads").insert(row).select("*").single();
        const { data, error } = await q;
        if (error) throw error;
        return res.status(200).json({ ad: data });
      }

      case "adToggle": {
        const { error } = await db().from("ads").update({ active: Boolean(body.active) }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "adDelete": {
        const { error } = await db().from("ads").delete().eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "checkVideo": {
        const check = await checkVideoFrames(body.frames);
        if (!check.approved) return res.status(200).json({ approved: false, reason: check.reason });
        const upload = await createVideoUpload(String(body.type || ""));
        return res.status(200).json({
          approved: true, reason: check.reason, posterUrl: check.posterUrl,
          name: upload.name, uploadUrl: upload.uploadUrl,
          approval: signApproval(`${upload.name}|${check.posterUrl}`),
        });
      }

      case "attachVideo": {
        const name = String(body.name || "");
        const poster = String(body.poster || "");
        if (!isStoredName(name) || !checkApproval(`${name}|${poster}`, body.approval)) {
          return res.status(403).json({ error: "הסרטון לא אושר בבדיקה" });
        }
        const { error } = await db().from("articles")
          .update({ video_url: `/media/${name}`, image_url: poster || null, video_sound: Boolean(body.sound) }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true, url: `/media/${name}` });
      }

      case "setVideoSound": {
        const { error } = await db().from("articles").update({ video_sound: Boolean(body.sound) }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "removeVideo": {
        const { error } = await db().from("articles").update({ video_url: null, video_sound: false }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "devicesList": {
        const { data, error } = await db().from("trusted_devices").select("id,label,created_at,last_seen").order("created_at");
        if (error) throw error;
        return res.status(200).json({ devices: data, current: trusted.id });
      }

      case "deviceRemove": {
        if (body.id === trusted.id) return res.status(400).json({ error: "אי אפשר להסיר את המכשיר שאתה מחובר ממנו" });
        const { error } = await db().from("trusted_devices").delete().eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "pairStart": {
        const code = await createPairCode(true);
        return res.status(200).json({ code });
      }

      case "messagesList": {
        const { data, error } = await db().from("messages").select("*").order("created_at", { ascending: false }).limit(200);
        if (error) throw error;
        return res.status(200).json({ messages: data });
      }

      case "messageDone": {
        const { error } = await db().from("messages").update({ done: Boolean(body.done) }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: "פעולה לא מוכרת" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת: " + (err.message || "") });
  }
}

// קוד חד-פעמי לאישור מכשיר חדש (תקף 10 דקות). force: גם אם נוצר קוד לפני פחות מדקה.
async function createPairCode(force = false) {
  const { data: prev } = await db().from("admin_codes").select("created_at").eq("id", 1).maybeSingle();
  if (!force && prev && Date.now() - Date.parse(prev.created_at) < 60000) return null;
  const code = newCode();
  const { error } = await db().from("admin_codes").upsert({
    id: 1, code_hash: hashCode(code), attempts: 0,
    expires_at: new Date(Date.now() + 10 * 60000).toISOString(), created_at: new Date().toISOString(),
  });
  if (error) throw error;
  return code;
}

function clean(v) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 500) : null;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
