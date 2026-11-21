import { db } from "./_lib/db.js";
import { issueUserSession, checkUserSession } from "./_lib/auth.js";
import { mailOwner } from "./_lib/mailer.js";

// משתמשים: התחברות עם Google, כניסות, פעמון הודעות, והודעות למנהל.
// GET  /api/me?config=1                 → { supabaseUrl, requireLogin }
// POST { action: "exchange", accessToken }  → אחרי Google: { session, user }
// POST { action: "me" }                  → פרטי המשתמש + מספר הודעות שלא נקראו
// POST { action: "track", path }         → רישום כניסה (גם בלי התחברות)
// POST { action: "bell" }                → ההודעות בפעמון (ומסמן כנקראו)
// POST { action: "send", topic, body }   → הודעה / תגובה / עדכון למנהל האתר
// הסשן נשלח בכותרת X-User.

const owner = () => String(process.env.CONTACT_EMAIL || "").trim().toLowerCase();
const TOPICS = { message: "הודעה", comment: "תגובה", update: "עדכון / ידיעה", correction: "תיקון", ads: "פרסום" };

function device(ua = "") {
  return /iphone|ipad/i.test(ua) ? "אייפון" : /android/i.test(ua) ? "אנדרואיד" : /windows/i.test(ua) ? "מחשב Windows" : /mac/i.test(ua) ? "מחשב Mac" : "אחר";
}

async function currentUser(req) {
  const uid = checkUserSession(req.headers["x-user"]);
  if (!uid) return null;
  const { data } = await db().from("users").select("*").eq("id", uid).maybeSingle();
  return data && !data.blocked ? data : null;
}

const publicUser = (u) => ({ name: u.name, email: u.email, isOwner: u.email.toLowerCase() === owner() });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      supabaseUrl: process.env.SUPABASE_URL,
      requireLogin: process.env.REQUIRE_LOGIN !== "false",
    });
  }
  if (req.method !== "POST") return res.status(405).end();

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const ua = String(req.headers["user-agent"] || "");

  try {
    switch (body.action) {
      case "exchange": {
        const { data, error } = await db().auth.getUser(String(body.accessToken || ""));
        const au = data && data.user;
        if (error || !au || !au.email) return res.status(401).json({ error: "ההתחברות נכשלה. נסו שוב." });
        const name = au.user_metadata?.full_name || au.user_metadata?.name || au.email.split("@")[0];
        const { data: existing } = await db().from("users").select("id,blocked,visits").eq("id", au.id).maybeSingle();
        if (existing && existing.blocked) return res.status(403).json({ error: "החשבון חסום" });
        if (!existing) {
          const { error: e2 } = await db().from("users").insert({ id: au.id, email: au.email, name, last_seen: new Date().toISOString() });
          if (e2) throw e2;
        } else {
          await db().from("users").update({ name, last_seen: new Date().toISOString() }).eq("id", au.id);
        }
        // מייל למנהל על כל התחברות (משתמש חדש, או משתמש קיים ממכשיר חדש)
        mailOwner({
          subject: existing ? `נייעס סטטוס: ${name} התחבר ממכשיר נוסף` : `נייעס סטטוס: משתמש חדש נרשם: ${name}`,
          text: `${existing ? "התחברות ממכשיר נוסף" : "משתמש חדש"}\nשם: ${name}\nמייל: ${au.email}\nמכשיר: ${device(ua)}\nזמן: ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}\n\nכל המשתמשים והכניסות: בלוח הבקרה, בלשונית "משתמשים".`,
        }).catch((e) => console.error("mail", e.message));
        return res.status(200).json({ session: issueUserSession(au.id), user: publicUser({ name, email: au.email }) });
      }

      case "me": {
        const u = await currentUser(req);
        if (!u) return res.status(401).json({ error: "לא מחובר" });
        const { count } = await db().from("notifications").select("id", { count: "exact", head: true })
          .or(`user_id.is.null,user_id.eq.${u.id}`).gt("created_at", u.last_read_at);
        return res.status(200).json({ user: publicUser(u), unread: count || 0 });
      }

      case "track": {
        const u = await currentUser(req);
        await db().from("visits").insert({ user_id: u ? u.id : null, path: String(body.path || "/").slice(0, 200), device: device(ua) });
        if (u) await db().rpc("touch_user", { uid: u.id });
        return res.status(200).json({ ok: true });
      }

      case "bell": {
        const u = await currentUser(req);
        if (!u) return res.status(401).json({ error: "לא מחובר" });
        const { data, error } = await db().from("notifications").select("id,title,body,created_at,user_id")
          .or(`user_id.is.null,user_id.eq.${u.id}`).order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        await db().from("users").update({ last_read_at: new Date().toISOString() }).eq("id", u.id);
        return res.status(200).json({ items: (data || []).map((n) => ({ ...n, personal: Boolean(n.user_id), unread: n.created_at > u.last_read_at })) });
      }

      case "send": {
        const u = await currentUser(req);
        if (!u) return res.status(401).json({ error: "צריך להתחבר" });
        const text = String(body.body || "").trim().slice(0, 3000);
        if (text.length < 2) return res.status(400).json({ error: "ההודעה ריקה" });
        const topic = TOPICS[body.topic] ? body.topic : "message";
        const { error } = await db().from("messages").insert({ topic, name: u.name || u.email, email: u.email, body: text, user_id: u.id });
        if (error) throw error;
        mailOwner({
          replyTo: u.email,
          subject: `נייעס סטטוס: ${TOPICS[topic]} מאת ${u.name || u.email}`,
          text: `${TOPICS[topic]} מאת ${u.name} (${u.email}):\n\n${text}\n\n(אפשר לענות מלוח הבקרה, בלשונית "פניות")`,
        }).catch(() => {});
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: "פעולה לא מוכרת" });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "שגיאת שרת" });
  }
}
