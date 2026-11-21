import crypto from "node:crypto";

// כניסה ללוח הבקרה בשני שלבים:
// 1. "הפרופיל שלי": פעם אחת בכל מכשיר, קישור שנשלח למייל של בעל האתר (CONTACT_EMAIL) מאשר שזה הוא.
//    הדפדפן מקבל "אסימון פרופיל" חתום לשנה, ומאז רואה את כפתור הניהול.
// 2. סיסמה (ADMIN_PASSWORD). בלי אסימון פרופיל תקף, הסיסמה לבדה לא מספיקה.

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("חסר ADMIN_PASSWORD");
  return s;
}

export function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function checkPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  return safeEqual(password, expected);
}

// מזהה המכשיר נשמר בדפדפן של המנהל. בשרת נשמר רק "טביעה" שלו.
export function deviceHash(deviceId) {
  if (!deviceId || String(deviceId).length < 32) return null;
  return sign(`device:${deviceId}`).slice(0, 32);
}

// האסימון קשור למכשיר: בלי מזהה המכשיר הנכון הוא לא שווה כלום.
export function issueToken(dh) {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${dh}.${sign(`${exp}|${dh}`)}`;
}

export function verifyToken(token, deviceId) {
  if (!token || typeof token !== "string") return null;
  const [exp, dh, sig] = token.split(".");
  if (!exp || !dh || !sig) return null;
  if (!safeEqual(sig, sign(`${exp}|${dh}`))) return null;
  if (Number(exp) < Date.now()) return null;
  if (deviceHash(deviceId) !== dh) return null;
  return dh;
}

export function tokenFromRequest(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function deviceFromRequest(req) {
  return String(req.headers["x-device"] || "");
}

// ---------- קוד חד-פעמי למייל ----------

export function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function hashCode(code) {
  return sign(`code:${code}`);
}

export function codeMatches(code, hash) {
  return Boolean(code && hash) && safeEqual(hashCode(String(code).trim()), hash);
}

// אישור חתום לזמן מוגבל (למשל: "הסרטון הזה נבדק ואושר").
export function signApproval(value, minutes = 20) {
  const exp = String(Date.now() + minutes * 60000);
  return `${exp}.${sign(`ok:${value}:${exp}`)}`;
}

export function checkApproval(value, token) {
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(`ok:${value}:${exp}`));
}

// ---------- אסימון פרופיל (שנה) ----------
const PROFILE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function issueProfile() {
  const exp = String(Date.now() + PROFILE_TTL_MS);
  const nonce = crypto.randomBytes(12).toString("hex");
  return `${exp}.${nonce}.${sign(`profile|${exp}|${nonce}`)}`;
}

export function checkProfile(t) {
  const [exp, nonce, sig] = String(t || "").split(".");
  if (!exp || !nonce || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(`profile|${exp}|${nonce}`));
}

// ---------- התחברות משתמשים (Google דרך Supabase) ----------
// אחרי התחברות אחת המשתמש מקבל אסימון חתום לשנתיים, ולא צריך להתחבר שוב.
const USER_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;

export function issueUserSession(uid) {
  const exp = String(Date.now() + USER_TTL_MS);
  return `${exp}.${uid}.${sign(`user|${exp}|${uid}`)}`;
}

export function checkUserSession(t) {
  const [exp, uid, sig] = String(t || "").split(".");
  if (!exp || !uid || !sig || Number(exp) < Date.now()) return null;
  return safeEqual(sig, sign(`user|${exp}|${uid}`)) ? uid : null;
}
