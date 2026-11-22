// פרסום ידני של מבזק (לבקשת בעל האתר): node scripts/post.mjs  (הנתונים מגיעים ממשתני סביבה)
import { db, makeSlug } from "../api/_lib/db.js";
const { POST_TITLE, POST_SUMMARY, POST_BODY, POST_CATEGORY, POST_SOURCE, POST_SLUG } = process.env;
if (!POST_TITLE || !POST_SUMMARY) throw new Error("חסרים כותרת או טקסט");
if (POST_SLUG) { // עדכון מבזק קיים
  const { error } = await db().from("articles").update({ title: POST_TITLE.slice(0, 120), summary: POST_SUMMARY.slice(0, 600), body: POST_BODY || null })
    .eq("slug", POST_SLUG);
  if (error) throw error;
  console.log(`עודכן: ${POST_SLUG}`);
  process.exit(0);
}
const slug = makeSlug();
const { error } = await db().from("articles").insert({
  slug, status: "published", published_at: new Date().toISOString(),
  title: POST_TITLE.slice(0, 120), summary: POST_SUMMARY.slice(0, 600), body: POST_BODY || null,
  category: POST_CATEGORY || "general", source_name: POST_SOURCE || "מערכת נייעס סטטוס", score: 7,
});
if (error) throw error;
console.log(`פורסם: ${POST_TITLE} → /article/${slug}`);
