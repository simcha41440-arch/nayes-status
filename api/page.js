// דף מבזק משותף (/article/<slug>): אותו עמוד ראשי, אבל עם כותרת, תיאור ותמונה של המבזק בתוך ה-HTML.
// כך גוגל מוצא את המבזק בחיפוש, ושיתוף בוואטסאפ מציג כרטיס יפה.
import { db } from "./_lib/db.js";

const SITE = "https://www.nayesstatus.com";
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let shell = null;

export default async function handler(req, res) {
  try {
    const slug = String(req.query.slug || "");
    if (!shell) shell = await (await fetch(`${SITE}/index.html`)).text();
    const { data: a } = await db().from("articles")
      .select("slug,title,summary,image_url,published_at,category").eq("slug", slug).eq("status", "published").maybeSingle();
    let html = shell;
    if (a) {
      const url = `${SITE}/article/${encodeURIComponent(a.slug)}`;
      const title = `${a.title} | נייעס סטטוס`;
      const desc = a.summary || "המבזקים הכי חשובים, בסטטוסים קצרים. נייעס סטטוס: רק מה ששווה לדעת.";
      const img = a.image_url ? `${SITE}${a.image_url}` : `${SITE}/icons/og-image.png`;
      const ld = {
        "@context": "https://schema.org", "@type": "NewsArticle", headline: a.title, description: desc,
        datePublished: a.published_at, image: [img], mainEntityOfPage: url,
        publisher: { "@type": "Organization", name: "נייעס סטטוס", logo: { "@type": "ImageObject", url: `${SITE}/icons/icon-512.png` } },
      };
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(a.title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
        .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`)
        .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
        .replace("</head>", `  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n</head>`)
        .replace('<h1 class="seo-h1">', `<h1 class="seo-h1">${esc(a.title)} · `);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(a ? 200 : 404).send(html);
  } catch (err) {
    console.error(err);
    res.writeHead(302, { Location: "/" });
    res.end();
  }
}
