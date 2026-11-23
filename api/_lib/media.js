import crypto from "node:crypto";
import { db } from "./db.js";
import { checkImage, checkFrames } from "./ai.js";

// כל התמונות באתר מאוחסנות אצלנו ומוגשות מהדומיין של האתר (/media/...),
// כך שהגולש לא מתחבר לאף שרת חיצוני. לפני שמירה, כל תמונה עוברת בדיקת AI.

const BUCKET = "media";
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

const newName = (ext) => `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;

/** מוריד תמונה מכתובת חיצונית (רק בצד השרת). */
export async function fetchImage(url) {
  if (!/^https:\/\//.test(url)) throw new Error("כתובת התמונה חייבת להתחיל ב-https://");
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`לא הצלחתי להוריד את התמונה (${r.status})`);
  const type = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!TYPES[type]) throw new Error("סוג קובץ לא נתמך. אפשר JPG, PNG, WEBP או GIF");
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, type };
}

/** ממיר תמונה שהועלתה מהמחשב (data URL) לקובץ. */
export function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m || !TYPES[m[1].toLowerCase()]) throw new Error("קובץ תמונה לא תקין");
  return { buffer: Buffer.from(m[2], "base64"), type: m[1].toLowerCase() };
}

/**
 * בודק את התמונה ושומר אותה אם אושרה.
 * @returns {{ approved: boolean, reason: string, url?: string }}
 */
export async function checkAndStore({ buffer, type }, want) {
  if (buffer.length > MAX_BYTES) throw new Error("התמונה גדולה מדי (עד 4MB)");
  const check = await checkImage({ base64: buffer.toString("base64"), mediaType: type, want });
  if (!check.approved) return check;

  const name = newName(TYPES[type]);
  const { error } = await db().storage.from(BUCKET).upload(name, buffer, { contentType: type, upsert: false });
  if (error) throw error;
  return { ...check, url: `/media/${name}` };
}

// ---------- סרטונים ----------
// הדפדפן של המנהל שולף פריימים מהסרטון ושולח אותם לבדיקה. רק אם כולם עברו,
// השרת נותן כתובת העלאה חד-פעמית, והסרטון עולה ישר לאחסון.

export async function checkVideoFrames(frameDataUrls) {
  if (!Array.isArray(frameDataUrls) || frameDataUrls.length < 3) throw new Error("לא התקבלו מספיק פריימים לבדיקה");
  if (frameDataUrls.length > 60) throw new Error("יותר מדי פריימים");
  const frames = frameDataUrls.map((d) => {
    const f = decodeDataUrl(d);
    return { base64: f.buffer.toString("base64"), mediaType: f.type, buffer: f.buffer };
  });
  const check = await checkFrames(frames);
  if (!check.approved) return check;

  // הפריים הראשון נשמר כתמונת תצוגה של הסרטון (הוא כבר נבדק יחד עם השאר)
  const poster = newName("jpg");
  const { error } = await db().storage.from(BUCKET).upload(poster, frames[0].buffer, { contentType: frames[0].mediaType });
  if (error) throw error;
  return { ...check, posterUrl: `/media/${poster}` };
}

export async function createVideoUpload(type) {
  const ext = VIDEO_TYPES[type];
  if (!ext) throw new Error("סוג סרטון לא נתמך. אפשר MP4, WEBM או MOV");
  const name = newName(ext);
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(name);
  if (error) throw error;
  return { name, uploadUrl: data.signedUrl };
}

export function isStoredName(name) {
  return /^[a-z0-9]+-[a-f0-9]{12}\.(jpg|png|webp|gif|mp4|webm|mov)$/i.test(name);
}
