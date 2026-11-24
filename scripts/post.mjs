// פרסום ידני של מבזק (לבקשת בעל האתר): node scripts/post.mjs  (הנתונים מגיעים ממשתני סביבה)
import { db, makeSlug } from "../api/_lib/db.js";
import { checkAndStore } from "../api/_lib/media.js";

// סרטון מיוטיוב: מוטמע באתר (לא מועתק). תמונת התצוגה שלו נבדקת לפני הפרסום.
async function youtube(input) {
  // כמה סרטונים ברצף (אלבום): "ids:ID1,ID2,ID3"
  if (input.startsWith("ids:")) {
    const ids = input.slice(4).split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{11}$/.test(x));
    if (!ids.length) throw new Error("אין מזהי סרטונים תקינים");
    const first = await youtube(ids[0]);
    return { ...first, video_url: `https://www.youtube-nocookie.com/embed/${ids[0]}?playlist=${ids.join(",")}` };
  }
  // רשימת השמעה (אלבום שלם)
  const list = (/[?&]list=([A-Za-z0-9_-]+)/.exec(input) || [])[1];
  if (list && !/[?&]v=/.test(input)) return { video_url: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, image_url: null };
  const id = (/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(input) || [])[1] || (/^[A-Za-z0-9_-]{11}$/.test(input) ? input : null);
  if (!id) throw new Error("קישור יוטיוב לא תקין");
  const r = await fetch(`https://img.youtube.com/vi/${id}/hqdefault.jpg`);
  if (!r.ok) throw new Error("לא נמצאה תמונת תצוגה לסרטון");
  const stored = await checkAndStore({ buffer: Buffer.from(await r.arrayBuffer()), type: "image/jpeg" });
  if (!stored.approved) throw new Error("תמונת הסרטון לא עברה בדיקה: " + stored.reason);
  return { video_url: `https://www.youtube-nocookie.com/embed/${id}`, image_url: stored.url };
}

// תמונה מוויקישיתוף (רק ברישיון חופשי): POST_IMAGE="commons:חיפוש|מילת חובה|מה צריך להיראות"
const strip = (x = "") => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
async function commons(spec) {
  const [q, must = "", want = ""] = spec.slice(8).split("|").map((x) => x.trim());
  const UA = { "User-Agent": "NayesStatus/1.0 (news site; contact via site)" };
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(q + " filetype:bitmap")}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1080`, { headers: UA });
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0]; if (!info || !/image\/(jpeg|png)/.test(info.mime || "")) continue;
    const meta = info.extmetadata || {}; const license = strip(meta.LicenseShortName?.value || "");
    if (!/^(CC BY|CC0|Public domain|PD)/i.test(license) || /NC|ND/.test(license)) continue;
    const text = `${p.title} ${strip(meta.ImageDescription?.value || "")}`.toLowerCase();
    if (must && !text.includes(must.toLowerCase())) continue;
    const img = await fetch(info.thumburl || info.url, { headers: UA }); if (!img.ok) continue;
    const stored = await checkAndStore({ buffer: Buffer.from(await img.arrayBuffer()), type: (img.headers.get("content-type") || "image/jpeg").split(";")[0] }, want);
    if (!stored.approved) { console.log(`נפסלה: ${p.title} (${stored.reason})`); continue; }
    console.log(`תמונה: ${p.title}`);
    return { image_url: stored.url, image_credit: `צילום ארכיון: ${strip(meta.Artist?.value || "").slice(0, 60) || "ויקישיתוף"} / ויקישיתוף (${license})` };
  }
  throw new Error("לא נמצאה תמונה מתאימה בוויקישיתוף");
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
if (process.env.POST_IMAGE && process.env.POST_IMAGE.startsWith("commons:")) Object.assign(media, await commons(process.env.POST_IMAGE));
if (!POST_TITLE || !POST_SUMMARY) throw new Error("חסרים כותרת או טקסט");
let targetSlug = POST_SLUG;
// "like:מילה" = המבזק האחרון שהכותרת שלו מכילה את המילה; מוקפץ מחדש למעלה
const bump = Boolean(targetSlug && targetSlug.startsWith("like:"));
if (bump) {
  const { data } = await db().from("articles").select("slug,title").eq("status", "published").ilike("title", `%${targetSlug.slice(5)}%`).order("published_at", { ascending: false }).limit(1);
  if (!data || !data.length) throw new Error("לא נמצא מבזק מתאים");
  targetSlug = data[0].slug; console.log(`נמצא: ${data[0].title} (${targetSlug})`);
}
if (targetSlug) { // עדכון מבזק קיים
  const { error } = await db().from("articles").update({ title: POST_TITLE.slice(0, 120), summary: POST_SUMMARY.slice(0, 600), body: POST_BODY || null, ...media, ...(bump ? { published_at: new Date().toISOString() } : {}) })
    .eq("slug", targetSlug);
  if (error) throw error;
  console.log(`עודכן: ${targetSlug}`);
  process.exit(0);
}
const slug = makeSlug();
const { error } = await db().from("articles").insert({
  slug, status: "published", published_at: new Date(Date.now() - 3 * 60000).toISOString(),
  title: POST_TITLE.slice(0, 120), summary: POST_SUMMARY.slice(0, 600), body: POST_BODY || null,
  category: POST_CATEGORY || "general", source_name: POST_SOURCE || "מערכת נייעס סטטוס", score: 7, ...media,
});
if (error) throw error;
console.log(`פורסם: ${POST_TITLE} → /article/${slug}`);
