// פרסום ידני של מבזק (לבקשת בעל האתר): node scripts/post.mjs  (הנתונים מגיעים ממשתני סביבה)
import { db, makeSlug } from "../api/_lib/db.js";
import { checkAndStore } from "../api/_lib/media.js";

// סרטון מיוטיוב: מוטמע באתר (לא מועתק). תמונת התצוגה שלו נבדקת לפני הפרסום.
async function youtube(input) {
  const id = (/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(input) || [])[1] || (/^[A-Za-z0-9_-]{11}$/.test(input) ? input : null);
  if (!id) throw new Error("קישור יוטיוב לא תקין");
  const r = await fetch(`https://img.youtube.com/vi/${id}/hqdefault.jpg`);
  if (!r.ok) throw new Error("לא נמצאה תמונת תצוגה לסרטון");
  const stored = await checkAndStore({ buffer: Buffer.from(await r.arrayBuffer()), type: "image/jpeg" });
  if (!stored.approved) throw new Error("תמונת הסרטון לא עברה בדיקה: " + stored.reason);
  return { video_url: `https://www.youtube-nocookie.com/embed/${id}`, image_url: stored.url };
}
// הורדת מבזקים מהאתר: POST_UNPUBLISH=slug1,slug2
if (process.env.POST_UNPUBLISH) {
  const slugs = process.env.POST_UNPUBLISH.split(",").map((x) => x.trim()).filter(Boolean);
  const { error } = await db().from("articles").update({ status: "rejected" }).in("slug", slugs);
  if (error) throw error;
  console.log(`הורדו: ${slugs.join(", ")}`);
  process.exit(0);
}
const { POST_TITLE, POST_SUMMARY, POST_BODY, POST_CATEGORY, POST_SOURCE, POST_SLUG, POST_YOUTUBE, POST_CREDIT } = process.env;
const media = POST_YOUTUBE ? await youtube(POST_YOUTUBE.trim()) : {};
if (POST_YOUTUBE) media.image_credit = POST_CREDIT || "וידאו: יוטיוב";
if (!POST_TITLE || !POST_SUMMARY) throw new Error("חסרים כותרת או טקסט");
if (POST_SLUG) { // עדכון מבזק קיים
  const { error } = await db().from("articles").update({ title: POST_TITLE.slice(0, 120), summary: POST_SUMMARY.slice(0, 600), body: POST_BODY || null, ...media })
    .eq("slug", POST_SLUG);
  if (error) throw error;
  console.log(`עודכן: ${POST_SLUG}`);
  process.exit(0);
}
const slug = makeSlug();
const { error } = await db().from("articles").insert({
  slug, status: "published", published_at: new Date().toISOString(),
  title: POST_TITLE.slice(0, 120), summary: POST_SUMMARY.slice(0, 600), body: POST_BODY || null,
  category: POST_CATEGORY || "general", source_name: POST_SOURCE || "מערכת נייעס סטטוס", score: 7, ...media,
});
if (error) throw error;
console.log(`פורסם: ${POST_TITLE} → /article/${slug}`);
