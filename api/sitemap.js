// מפת אתר לגוגל: העמוד הראשי, אודות, וכל המבזקים מהשבועיים האחרונים.
import { db } from "./_lib/db.js";
const SITE = "https://www.nayesstatus.com";

export default async function handler(req, res) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data } = await db().from("articles").select("slug,published_at").eq("status", "published")
    .gte("published_at", since).order("published_at", { ascending: false }).limit(1000);
  const urls = [
    `<url><loc>${SITE}/</loc><changefreq>always</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${SITE}/about</loc><changefreq>monthly</changefreq></url>`,
    ...(data || []).map((a) => `<url><loc>${SITE}/article/${encodeURIComponent(a.slug)}</loc><lastmod>${a.published_at}</lastmod></url>`),
  ];
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600");
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
}
