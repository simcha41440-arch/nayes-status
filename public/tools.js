// כלים שימושיים במסך העדכונים: זמני היום, פיקוד העורף, העיר שלי, צרכנות, היום לפני שנה,
// והתרעות בראש המסך (מצב חירום, פיקוד העורף, מזג אוויר קיצוני, שבת שלום).

(function () {
  const $ = (id) => document.getElementById(id);
  const Z = window.Zmanim;
  const fmt = (d) => (d ? d.toLocaleTimeString("he-IL", { timeZone: Z.TZ, hour: "2-digit", minute: "2-digit" }) : "--:--");

  let state = { emergency: null, oref: [] };
  let articles = [];
  let lastYear = [];

  // ---------- התרעות בראש המסך ----------
  function renderAlerts() {
    const box = $("alerts");
    if (!box) return;
    const out = [];
    const holy = Z.holyNow();
    if (holy) out.push(`<div class="alert-bar calm">${icon("zmanim", 20)}<span><b>${holy === "שבת" ? "שבת שלום!" : "חג שמח!"}</b> העדכונים יחזרו במוצאי ${holy === "שבת" ? "שבת" : "החג"}.</span></div>`);

    if (state.emergency) {
      out.push(`<button class="alert-bar red" data-open="oref">${icon("alert", 20)}<span><b>${esc(state.emergency.title)}</b>${state.emergency.text ? ` ${esc(state.emergency.text)}` : ""}</span><i>הנחיות</i></button>`);
    }
    const o = state.oref[0];
    if (o && Date.now() - Date.parse(o.date) < 30 * 60 * 1000) {
      out.push(`<button class="alert-bar red" data-open="oref">${icon("oref", 20)}<span><b>פיקוד העורף · ${esc(timeAgo(o.date))}</b> ${esc(o.text.slice(0, 160))}${o.text.length > 160 ? "…" : ""}</span><i>לפרטים</i></button>`);
    }
    const wx = articles.find((a) => a.category === "weather" && a.is_breaking && Date.now() - Date.parse(a.published_at) < 12 * 3600 * 1000);
    if (wx) out.push(`<button class="alert-bar blue" data-slug="${esc(wx.slug)}">${icon("weather", 20)}<span><b>התרעת מזג אוויר:</b> ${esc(wx.title)}</span><i>לפרטים</i></button>`);

    box.innerHTML = out.join("");
    box.querySelectorAll("[data-open=oref]").forEach((b) => (b.onclick = openOref));
    box.querySelectorAll("[data-slug]").forEach((b) => (b.onclick = () => window.nayesStatus.openList([wx])));
  }

  // ---------- שורת הכלים ----------
  function nextZman() {
    const city = getPrefs().city || "ירושלים";
    const t = Z.dayTimes(city, Z.israelYMD(new Date()));
    const list = [["הנץ", t.sunrise], ['סוף ק"ש', t.shmaGra], ["חצות", t.chatzos], ["שקיעה", t.sunset], ["צאה\"כ", t.tzeis]];
    const n = list.find(([, d]) => d && d > new Date());
    return n ? `${n[0]} ${fmt(n[1])}` : `הנץ מחר ${fmt(Z.dayTimes(city, Z.nextYMD(Z.israelYMD(new Date()))).sunrise)}`;
  }

  // שני ערוצים נעוצים בראש רשימת הערוצים (כמו צ'אט נעוץ): זמני היום ופיקוד העורף
  function renderPinned() {
    const box = $("pinned");
    if (!box) return;
    const o = state.oref[0];
    const row = (key, ic, name, last, end) => `<button class="chan" data-tool="${key}">
      <div class="av plain" style="--s:52px"><span class="face ic" style="background:${CHANNEL_COLORS[ic]}">${icon(ic, 24, 1.7)}</span></div>
      <span class="mid"><b>${esc(name)}</b><span class="last">${esc(last)}</span></span>
      <span class="end"><span class="t">${esc(end)}</span><span class="pin-ic">${icon("pin", 16, 1.8)}</span></span></button>`;
    const city = getPrefs().city || "ירושלים";
    box.innerHTML = row("zmanim", "zmanim", `זמני היום · ${city}`, nextZman(), "")
      + row("oref", "oref", "פיקוד העורף", o ? o.text.replace(/\s+/g, " ").slice(0, 90) : "הנחיות וטלפונים לשעת חירום", o ? timeAgo(o.date) : "");
    box.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => TOOLS[b.dataset.tool]()));
  }

  // "גלו עוד": כרטיסים בסגנון "ערוצים מומלצים" בסטטוס, עם כפתור בתחתית
  function renderTools() {
    renderPinned();
    const box = $("tools");
    if (!box) return;
    const city = getPrefs().city || "ירושלים";
    const card = (key, ic, name, sub, btn) => `<div class="disc">
      <span class="d-ic" style="background:${CHANNEL_COLORS[ic] || CHANNEL_COLORS.general}">${icon(ic, 30, 1.6)}</span>
      <b>${esc(name)}</b><small>${esc(sub)}</small>
      <button class="follow" data-tool="${key}">${esc(btn)}</button></div>`;
    box.innerHTML = [
      card("city", "city", city, "מבזקים מהעיר", "פתיחה"),
      card("consumer", "consumer", "צרכנות", "ריקולים ומחירים", "פתיחה"),
      lastYear.length ? card("memory", "memory", "היום לפני שנה", `${lastYear.length} מבזקים`, "צפייה") : "",
      card("share", "share", "שיתוף", "וואטסאפ, מייל ועוד", "שיתוף"),
      card("ads", "megaphone", "פרסום אצלנו", "העסק שלך בסטטוס", "פרטים"),
    ].join("");
    box.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => TOOLS[b.dataset.tool]()));
  }

  const TOOLS = {
    zmanim: openZmanim,
    oref: openOref,
    city: async () => {
      const city = getPrefs().city;
      if (!city) return chooseCity(() => TOOLS.city());
      const res = await api({ city, limit: 30 });
      const list = res.articles || [];
      if (!list.length) return snack(`עוד אין מבזקים מ${city}. נעדכן כשיהיו.`, "החלפת עיר", () => chooseCity());
      window.nayesStatus.openList(list.slice(0, 20));
    },
    consumer: async () => {
      const res = await api({ category: "consumer", limit: 20 });
      const list = res.articles || [];
      if (!list.length) return snack("עוד אין מבזקים במדור הצרכנות. הם יופיעו כאן אוטומטית.");
      window.nayesStatus.openList(list);
    },
    memory: () => window.nayesStatus.openList(lastYear),
    share: shareSite,
    ads: () => { location.href = "/about?topic=ads#contact"; },
  };

  // ---------- שיתוף האתר ----------
  function shareSite() {
    openShare({ title: "נייעס סטטוס", text: "נייעס סטטוס: המבזקים הכי חשובים לציבור החרדי, בסטטוסים קצרים. רק מה ששווה לדעת." });
  }

  // ---------- חלון מלא (כמו מסך החיפוש) ----------
  function sheet(title, html) {
    let s = $("tool-sheet");
    if (!s) {
      s = document.createElement("div");
      s.id = "tool-sheet";
      s.className = "search";
      s.setAttribute("role", "dialog");
      document.body.appendChild(s);
    }
    s.innerHTML = `<div class="search-bar"><button class="menu-btn" id="sheet-back" aria-label="חזרה">${icon("back", 24)}</button>
      <h2 style="margin:0;font-size:20px;font-weight:600;flex:1">${esc(title)}</h2></div><div class="sheet-body">${html}</div>`;
    s.classList.add("open");
    $("sheet-back").onclick = () => s.classList.remove("open");
    return s;
  }

  // ---------- זמני היום ----------
  const ZROWS = [
    ["alos", "עלות השחר"], ["misheyakir", "זמן טלית ותפילין (משיכיר)"], ["sunrise", "הנץ החמה"],
    ["shmaMga", 'סוף זמן קריאת שמע (מג"א)'], ["shmaGra", 'סוף זמן קריאת שמע (גר"א)'],
    ["tfilaMga", 'סוף זמן תפילה (מג"א)'], ["tfilaGra", 'סוף זמן תפילה (גר"א)'],
    ["chatzos", "חצות היום"], ["minchaGedola", "מנחה גדולה"], ["minchaKetana", "מנחה קטנה"], ["plag", "פלג המנחה"],
    ["sunset", "שקיעת החמה"], ["tzeis", "צאת הכוכבים"], ["tzeisRt", 'צאת הכוכבים לר"ת'],
  ];

  function openZmanim(offset = 0) {
    const city = getPrefs().city || "ירושלים";
    const today = Z.israelYMD(new Date());
    const ymd = Z.nextYMD(today, offset);
    const date = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 10));
    const t = Z.dayTimes(city, ymd);
    const now = new Date();
    const nextKey = offset === 0 ? (ZROWS.find(([k]) => t[k] && t[k] > now) || [])[0] : null;

    // כניסת שבת / חג: רק ביום שישי ובערב חג (היום חול, ומחר שבת או חג)
    const tomorrowHoly = !Z.holyName(ymd) && Z.holyName(Z.nextYMD(ymd));
    let entry = "";
    if (tomorrowHoly) {
      let last = Z.nextYMD(ymd);
      const names = [Z.holyName(last)];
      while (Z.holyName(Z.nextYMD(last))) { last = Z.nextYMD(last); names.push(Z.holyName(last)); }
      const holyLabel = [...new Set(names)].join(" ו");
      const isShabbat = names.length === 1 && names[0] === "שבת";
      const te = Z.dayTimes(city, last);
      const word = isShabbat ? "השבת" : "החג";
      entry = `<div class="zm-shabbat">
        <h3>${icon("zmanim", 18)} ${isShabbat ? "כניסת שבת" : `כניסת ${esc(holyLabel)}`} ב${esc(city)}</h3>
        <div class="zm-row"><span>הדלקת נרות (${t.candlesMin} דקות לפני השקיעה)</span><b>${fmt(t.candles)}</b></div>
        <div class="zm-row"><span>צאת ${word}</span><b>${fmt(te.tzeis)}</b></div>
        <div class="zm-row"><span>צאת ${word} לר"ת</span><b>${fmt(te.tzeisRt)}</b></div>
      </div>`;
    }

    const s = sheet("זמני היום", `
      <div class="zm-top">
        <button class="zm-city" id="zm-city">${icon("local", 18)} ${esc(city)} ▾</button>
        <div class="zm-days">
          ${["היום", "מחר"].map((l, i) => `<button class="${offset === i ? "on" : ""}" data-off="${i}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="zm-date">${esc(hebrewDate(date))}</div>
      <div class="zm-list">${ZROWS.map(([k, label]) => `<div class="zm-row ${k === nextKey ? "next" : ""}"><span>${esc(label)}</span><b>${fmt(t[k])}</b></div>`).join("")}</div>
      ${entry}
      <button class="btn zm-share" id="zm-share">${icon("share", 20)} שליחת הזמנים</button>
      <p class="zm-note zm-warn">שימו לב: הזמנים מחושבים באופן ממוחשב ועלולים לסטות בכמה דקות. אין לסמוך עליהם בדיוק רב,
      ובפרט לא בדקות האחרונות שלפני סוף הזמן. יש להחמיר ולהקדים, ולעיין בלוח המקובל בקהילתכם.</p>
      <p class="zm-note">החישוב לפי מיקום העיר, בגובה פני הים. מג"א: מעלות השחר ועד צאת הכוכבים (16.1 מעלות).
      צאת הכוכבים: 8.5 מעלות מתחת לאופק.</p>`);

    s.querySelectorAll("[data-off]").forEach((b) => (b.onclick = () => openZmanim(Number(b.dataset.off))));
    $("zm-city").onclick = () => chooseCity(() => openZmanim(offset));
    $("zm-share").onclick = () => {
      const lines = ZROWS.map(([k, label]) => `${label}: ${fmt(t[k])}`).join("\n");
      const text = `זמני היום ב${city}\n${hebrewDate(date)}\n\n${lines}${tomorrowHoly ? `\nהדלקת נרות: ${fmt(t.candles)}` : ""}\n\n(הזמנים ממוחשבים ועלולים לסטות בכמה דקות)\nנייעס סטטוס:`;
      openShare({ title: `זמני היום ב${city}`, text, url: location.origin + "/" });
    };
  }

  // ---------- פיקוד העורף ----------
  const GUIDES = [
    ["בשמיעת אזעקה בבית", "להיכנס למרחב המוגן (ממ\"ד, ממ\"ק או מקלט), לסגור את הדלת והחלונות, ולהישאר בפנים עד להודעה של פיקוד העורף שאפשר לצאת."],
    ["אין מרחב מוגן", "לעבור לחדר מדרגות פנימי (לא בקומה העליונה), או לחדר פנימי בלי חלונות, הרחק מחלונות ודלתות חיצוניות."],
    ["בחוץ, בשטח פתוח", "להיכנס למבנה הקרוב. אם אין, לשכב על הקרקע ולהגן על הראש בידיים."],
    ["ברכב", "לעצור בצד הדרך, לצאת ולהיכנס למבנה קרוב. אם אין, לצאת מהרכב, לשכב על הקרקע ולהגן על הראש."],
    ["אחרי האזעקה", "לא להתקרב לחפצים חשודים או לשברי טילים, ולהתקשר למשטרה. להתעדכן רק מגורמים רשמיים."],
    ["להיות מוכנים", "מים, פנס, סוללות ומטען נייד, תרופות קבועות ומסמכים חשובים. לבדוק מראש איפה המרחב המוגן הקרוב, ובכמה זמן צריך להגיע אליו באזור שלכם."],
  ];
  const PHONES = [["מד\"א", "101"], ["משטרה", "100"], ["כבאות והצלה", "102"], ["מוקד פיקוד העורף", "104"]];

  function openOref() {
    const em = state.emergency;
    sheet("פיקוד העורף", `
      ${em ? `<div class="alert-bar red static">${icon("alert", 20)}<span><b>${esc(em.title)}</b>${em.text ? ` ${esc(em.text)}` : ""}</span></div>` : ""}
      <h3 class="sheet-h">הודעות אחרונות מפיקוד העורף</h3>
      <div class="oref-list">${state.oref.length
        ? state.oref.map((p) => `<div class="oref-item"><small>${esc(timeAgo(p.date))}${Date.now() - Date.parse(p.date) < 864e5 ? ` · ${esc(clock(p.date))}` : ""}</small><p>${esc(p.text)}</p></div>`).join("")
        : `<div class="empty" style="padding:18px">לא הצלחנו לטעון את ההודעות כרגע. נסו שוב בעוד דקה.</div>`}</div>
      <p class="zm-note">ההודעות מועתקות אוטומטית מהערוץ הרשמי של פיקוד העורף. בזמן אמת, ההתרעה הקובעת היא זו שבאפליקציה הרשמית ובאזעקה עצמה.</p>
      <h3 class="sheet-h">איך מתנהגים באזעקה</h3>
      <div class="guide">${GUIDES.map(([h, p]) => `<div><b>${esc(h)}</b><p>${esc(p)}</p></div>`).join("")}</div>
      <h3 class="sheet-h">טלפונים לשעת חירום</h3>
      <div class="phones">${PHONES.map(([n, num]) => `<a href="tel:${num}"><b>${num}</b><span>${esc(n)}</span></a>`).join("")}</div>`);
  }

  // ---------- בחירת עיר ----------
  function chooseCity(after) {
    const cur = getPrefs().city;
    const back = document.createElement("div");
    back.className = "dlg-back";
    back.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><h3>העיר שלי</h3>
      <p>נציג לך ערוץ אישי עם המבזקים מהעיר, וזמני היום לפי העיר.</p>
      <div class="city-list">${CITIES.map((c) => `<label><input type="radio" name="city" value="${esc(c)}" ${c === cur ? "checked" : ""}>${esc(c)}</label>`).join("")}</div>
      <div class="btns"><button data-cancel>ביטול</button><button data-ok>אישור</button></div></div>`;
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    back.querySelector("[data-cancel]").onclick = close;
    back.querySelector("[data-ok]").onclick = () => {
      const v = back.querySelector("input:checked");
      close();
      if (!v) return;
      setPref("city", v.value);
      renderTools();
      if (window.nayesStatus) window.nayesStatus.rerender();
      if (after) after();
    };
    document.body.appendChild(back);
  }

  function snack(text, actionLabel, action) {
    document.querySelectorAll(".snack").forEach((s) => s.remove());
    const s = document.createElement("div");
    s.className = "snack";
    s.innerHTML = `${esc(text)}${actionLabel ? ` <button class="snack-act">${esc(actionLabel)}</button>` : ""}`;
    if (actionLabel) s.querySelector("button").onclick = () => { s.remove(); action(); };
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 3500);
  }

  // ---------- טעינה ----------
  async function loadState() {
    try {
      const r = await fetch("/api/state");
      if (r.ok) state = await r.json();
    } catch {}
    renderAlerts();
    renderTools();
  }

  document.addEventListener("nayes:articles", (e) => { articles = e.detail || []; renderAlerts(); });
  renderTools();
  renderAlerts();
  loadState();
  api({ onthisday: 1 }).then((r) => { if (DEMO_MODE) return; lastYear = (r && r.articles) || []; if (lastYear.length) renderTools(); }).catch(() => {});
  setInterval(() => { if (!document.hidden) loadState(); }, 60000);
  window.nayesTools = { openZmanim, openOref, chooseCity, shareSite };
})();
