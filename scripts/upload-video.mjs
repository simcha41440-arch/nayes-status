// העלאת סרטון שבעל האתר שלח: בדיקת פריימים, שמירה באחסון ופרסום מבזק. node scripts/upload-video.mjs <קובץ>
import { readFile, mkdtemp, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { db, makeSlug } from "../api/_lib/db.js";
import { checkFrames } from "../api/_lib/ai.js";
const run = promisify(execFile);
// ffmpeg מוכן מראש (בלי התקנה איטית בשרת)
const FFMPEG = (await import("ffmpeg-static").catch(() => ({}))).default || "ffmpeg";
const FFPROBE = (await import("ffprobe-static").catch(() => ({}))).default?.path || "ffprobe";
const file = process.argv[2];
const { POST_TITLE, POST_SUMMARY, POST_BODY, POST_CATEGORY, POST_CREDIT } = process.env;

// תמונה (לא סרטון): נשמרת ומתפרסמת ישר
if (/\.(jpe?g|png|webp)$/i.test(file)) {
  const ext = file.split(".").pop().toLowerCase().replace("jpeg", "jpg");
  const type = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext];
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const { error: e1 } = await db().storage.from("media").upload(name, await readFile(file), { contentType: type });
  if (e1) throw e1;
  const slug = makeSlug();
  const { error: e2 } = await db().from("articles").insert({
    slug, status: "published", published_at: process.env.POST_AT || new Date().toISOString(), score: 7,
    title: POST_TITLE, summary: POST_SUMMARY, body: POST_BODY || null, category: POST_CATEGORY || "general",
    source_name: "מערכת נייעס סטטוס", image_url: `/media/${name}`, image_credit: POST_CREDIT || null,
  });
  if (e2) throw e2;
  console.log(`פורסם: /article/${slug}`);
  process.exit(0);
}

const dir = await mkdtemp(path.join(tmpdir(), "v-"));
const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
const dur = Number(stdout) || 10;
await run(FFMPEG, ["-v", "error", "-i", file, "-vf", `fps=${Math.min(1, 16 / dur)},scale=512:-2`, "-frames:v", "16", path.join(dir, "f%02d.jpg")]);
const frames = await Promise.all((await readdir(dir)).sort().map(async (f) => {
  const buffer = await readFile(path.join(dir, f));
  return { base64: buffer.toString("base64"), mediaType: "image/jpeg", buffer };
}));
// סרטון שבעל האתר עצמו מעלה: עולה בלי בדיקה (הבדיקה האוטומטית היא רק לתוכן שעולה לבד או שגולשים שולחים)
if (process.env.SKIP_CHECK !== "true") {
  const check = await checkFrames(frames);
  if (!check.approved) throw new Error("הסרטון לא עבר בדיקה: " + check.reason);
  console.log("✓ הסרטון עבר בדיקה");
}

const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
const store = async (name, buf, type) => {
  const { error } = await db().storage.from("media").upload(name, buf, { contentType: type });
  if (error) throw error;
  return `/media/${name}`;
};
const video = await store(`${id}.mp4`, await readFile(file), "video/mp4");
const poster = await store(`${id}p.jpg`, frames[Math.min(2, frames.length - 1)].buffer, "image/jpeg");
const slug = makeSlug();
const { error } = await db().from("articles").insert({
  slug, status: "published", published_at: process.env.POST_AT || new Date().toISOString(), score: 7,
  title: POST_TITLE, summary: POST_SUMMARY, body: POST_BODY || null, category: POST_CATEGORY || "world",
  source_name: "מערכת נייעס סטטוס", video_url: video, image_url: poster, video_sound: true, image_credit: POST_CREDIT || null,
});
if (error) throw error;
console.log(`פורסם: /article/${slug}`);
