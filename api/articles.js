import { db, PUBLIC_FIELDS, PUBLIC_FIELDS_BASIC, isMissingColumn } from "./_lib/db.js";
import { CATEGORIES, REACTIONS } from "./_lib/config.js";

// API ציבורי לקריאת ידיעות שפורסמו.
// GET /api/articles                    → הידיעות האחרונות
// GET /api/articles?category=economy   → לפי קטגוריה
// GET /api/articles?city=בני%20ברק      → לפי עיר
// GET /api/articles?slug=...           → ידיעה אחת (ומעלה את מונה הצפיות)
// GET /api/articles?popular=1          → הכי נקראים ב-48 השעות האחרונות
// GET /api/articles?after=<iso>        → רק מבזקים שפורסמו אחרי זמן מסוים (לרענון החי)
// POST /api/articles { slug, emoji }   → תגובת אימוג'י

export default async function handler(req, res) {
  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!REACTIONS.includes(body.emoji) || !body.slug) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    try {
      const { data, error } = await db().rpc("add_reaction", {
        article_slug: String(body.slug), emoji: body.emoji,
      });
      if (error) throw error;
      res.status(200).json({ reactions: data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "server error" });
    }
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    const { slug, category, city, popular } = req.query;
    const limit = Math.min(Number(req.query.limit) || 30, 60);

    if (slug) {
      const one = (fields) => db().from("articles").select(fields).eq("slug", String(slug)).eq("status", "published").maybeSingle();
      let { data, error } = await one(PUBLIC_FIELDS);
      if (isMissingColumn(error)) ({ data, error } = await one(PUBLIC_FIELDS_BASIC));
      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "not found" });
        return;
      }
      await db().rpc("increment_views", { article_slug: String(slug) });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ article: data });
      return;
    }

    // היום לפני שנה: מבזקים מאותו תאריך בשנה שעברה (לפי שעון ישראל)
    if (req.query.onthisday) {
      const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
      const [y, m, d] = ymd.split("-").map(Number);
      const from = new Date(Date.UTC(y - 1, m - 1, d) - 3 * 3600 * 1000).toISOString(); // חצות בישראל (בערך)
      const to = new Date(Date.UTC(y - 1, m - 1, d + 1) - 3 * 3600 * 1000).toISOString();
      const q = (fields) => db().from("articles").select(fields).eq("status", "published")
        .gte("published_at", from).lt("published_at", to).order("score", { ascending: false, nullsFirst: false }).limit(10);
      let { data, error } = await q(PUBLIC_FIELDS);
      if (isMissingColumn(error)) ({ data, error } = await q(PUBLIC_FIELDS_BASIC));
      if (error) throw error;
      res.setHeader("Cache-Control", "public, s-maxage=600");
      res.status(200).json({ articles: data || [] });
      return;
    }

    const build = (fields) => {
      let q = db().from("articles").select(fields).eq("status", "published");

      if (category && CATEGORIES[category]) q = q.eq("category", category);
      if (city) q = q.eq("city", String(city));
      if (req.query.after) q = q.gt("published_at", String(req.query.after));
      if (req.query.before) q = q.lt("published_at", String(req.query.before));
      if (popular) {
        const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
        q = q.gte("published_at", since).order("views", { ascending: false });
      } else {
        q = q.order("published_at", { ascending: false });
      }
      return q.limit(limit);
    };

    let { data, error } = await build(PUBLIC_FIELDS);
    if (isMissingColumn(error)) ({ data, error } = await build(PUBLIC_FIELDS_BASIC));
    if (error) throw error;

    // מטמון קצר ב-CDN: עומס נמוך על המסד, ועדיין עדכני תוך פחות מדקה.
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    res.status(200).json({ articles: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
}
