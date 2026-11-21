// מצב האתר (למשל "מצב חירום"), נשמר כקובץ קטן באחסון של Supabase. בלי טבלה ובלי עדכון למסד הנתונים.
import { db } from "./db.js";

const BUCKET = "media";
const FILE = "site/state.json";

export async function getState() {
  try {
    const { data, error } = await db().storage.from(BUCKET).download(FILE);
    if (error || !data) return {};
    return JSON.parse(await data.text());
  } catch {
    return {};
  }
}

export async function setState(patch) {
  const next = { ...(await getState()), ...patch, updated_at: new Date().toISOString() };
  const { error } = await db().storage.from(BUCKET).upload(FILE, JSON.stringify(next), {
    upsert: true, contentType: "application/json", cacheControl: "10",
  });
  if (error) throw error;
  return next;
}
