(function () {
  const TOKEN_KEY = "nayes_admin_token";
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch {}
  let tab = "pending";

  const $ = (id) => document.getElementById(id);

  // מקטין תמונה מהמחשב ל-1280 פיקסלים לכל היותר וממיר ל-JPEG, כדי שתעלה מהר.
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("לא הצלחתי לקרוא את הקובץ"));
      img.src = URL.createObjectURL(file);
    });
  }

  // "אסימון פרופיל": מתקבל אחרי אישור דרך המייל של בעל האתר, ונשמר בדפדפן הזה לשנה.
  const PROFILE_KEY = "nayes_profile";
  const getProfile = () => { try { return localStorage.getItem(PROFILE_KEY) || ""; } catch { return ""; } };

  async function call(action, payload = {}) {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device": getProfile(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && token && action !== "login") { logout(); throw new Error("נדרשת כניסה מחדש"); }
    if (!r.ok) { const err = new Error(data.error || `שגיאה ${r.status}`); err.data = data; throw err; }
    return data;
  }

  function show(loggedIn) {
    if (!loggedIn) loginStep();
    $("login").classList.toggle("hidden", loggedIn);
    $("app").classList.toggle("hidden", !loggedIn);
    $("logout").classList.toggle("hidden", !loggedIn);
    if (loggedIn) load();
  }

  function logout() {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    show(false);
  }

  function loginStep() {
    const has = Boolean(getProfile());
    $("step-profile").classList.toggle("hidden", has);
    $("step-password").classList.toggle("hidden", !has);
    if (has) setTimeout(() => $("password").focus(), 50);
  }

  // חזרה מהקישור שבמייל: Supabase מעביר לכאן access_token
  async function handleMagicLink() {
    const h = new URLSearchParams(location.hash.slice(1));
    const at = h.get("access_token");
    const err = h.get("error_description");
    if (!at && !err) return;
    history.replaceState(null, "", "/admin");
    if (err) { $("login-msg").textContent = "הקישור פג או כבר נוצל. בקש קישור חדש."; return; }
    try {
      const { profile } = await call("verifyProfile", { accessToken: at });
      try { localStorage.setItem(PROFILE_KEY, profile); } catch {}
      $("login-msg").className = "msg good";
      $("login-msg").textContent = "הפרופיל אושר. עכשיו רק סיסמה.";
    } catch (e) {
      $("login-msg").className = "msg bad";
      $("login-msg").textContent = e.message;
    }
    loginStep();
  }

  $("send-link").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await call("sendProfileLink");
      $("login-msg").className = "msg good";
      $("login-msg").textContent = "נשלח קישור כניסה למייל של מנהל האתר. פתחו אותו במכשיר הזה.";
    } catch (err) {
      $("login-msg").className = "msg bad";
      $("login-msg").textContent = err.message;
    }
    e.target.disabled = false;
  });

  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-msg").className = "msg bad";
    $("login-msg").textContent = "";
    try {
      const { token: t } = await call("login", { password: $("password").value, profile: getProfile() });
      token = t;
      try { localStorage.setItem(TOKEN_KEY, t); } catch {}
      show(true);
    } catch (err) {
      if (err.data && err.data.needProfile) { try { localStorage.removeItem(PROFILE_KEY); } catch {} loginStep(); }
      $("login-msg").textContent = err.message;
    }
  });
  $("logout").addEventListener("click", logout);

  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
      tab = b.dataset.tab;
      load();
    }));

  async function load() {
    const panel = $("panel");
    if (tab === "compose") return renderCompose(panel);
    if (tab === "ads") return renderAds(panel);
    if (tab === "messages") return renderMessages(panel);
    if (tab === "users") return renderUsers(panel);
    if (tab === "emergency") return renderEmergency(panel);
    panel.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    try {
      const { articles } = await call("list", { status: tab });
      if (tab === "pending") $("count").textContent = articles.length;
      panel.innerHTML = articles.length
        ? ""
        : `<div class="empty">${tab === "pending" ? "אין מבזקים ממתינים. הכל מעודכן ✓" : "עדיין לא פורסמו מבזקים."}</div>`;
      articles.forEach((a) => panel.appendChild(itemEl(a)));
    } catch (err) {
      panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function itemEl(a) {
    const el = document.createElement("div");
    el.className = `item ${a.is_breaking ? "breaking" : ""}`;
    const catOptions = Object.entries(CATEGORIES)
      .map(([k, v]) => `<option value="${k}" ${k === a.category ? "selected" : ""}>${esc(v.emoji + " " + v.name)}</option>`).join("");

    el.innerHTML = `
      ${a.ai_notes ? `<div class="notes"><b>הערות העורך האוטומטי:</b> ${esc(a.ai_notes)}</div>` : ""}
      <div class="src">${a.score ? `<span class="score">⭐ ${a.score}/10</span> · ` : ""}${esc(timeAgo(a.created_at))}${a.source_name ? " · מקור: " + (a.source_url ? `<a href="${esc(a.source_url)}" target="_blank" rel="noopener">${esc(a.source_name)}</a>` : esc(a.source_name)) : ""}</div>
      <label>כותרת</label><input type="text" class="title" data-f="title" value="${esc(a.title)}">
      <label>טקסט המבזק (מה שרואים בסטטוס)</label><textarea class="short" data-f="summary">${esc(a.summary)}</textarea>
      <label>💡 מה זה אומר עליך? (לא חובה)</label><input type="text" data-f="impact" value="${esc(a.impact)}">
      <label>עוד פרטים (לא חובה, שורה ריקה בין פסקאות)</label><textarea class="body" data-f="body">${esc(a.body)}</textarea>
      <div class="row2">
        <div><label>קטגוריה</label><select data-f="category">${catOptions}</select></div>
        <div><label>עיר (לא חובה)</label><input type="text" data-f="city" value="${esc(a.city)}"></div>
        <div><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:16px">
          <input type="checkbox" data-f="is_breaking" ${a.is_breaking ? "checked" : ""}> מבזק</label></div>
      </div>
      <label>תמונה (לא חובה, תיבדק אוטומטית ותישמר באתר עצמו)</label>
      <div class="img-row"><input type="text" class="img-url" placeholder="קישור לתמונה, או העלאה מהמחשב ←" value="${esc(a.image_url)}" dir="ltr">
        <button class="btn ghost img-btn" type="button">בדיקה ושמירה</button>
        <label class="btn ghost" style="margin:0;cursor:pointer">📁 מהמחשב<input type="file" accept="image/*" class="img-file" hidden></label></div>
      ${a.image_url ? `<img class="thumb" src="${esc(a.image_url)}" alt="">` : ""}
      <p class="msg img-msg"></p>
      <label>סרטון (לא חובה. כל הסרטון נבדק פריים אחרי פריים)</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:15px;font-weight:600">
        <input type="checkbox" class="vid-sound" ${a.video_sound ? "checked" : ""}> שמעתי את הסרטון בעצמי, והקול תקין (רק אז הסרטון יושמע עם קול)</label>
      <div class="img-row">
        <label class="btn ghost" style="margin:0;cursor:pointer">🎬 העלאת סרטון<input type="file" accept="video/mp4,video/webm,video/quicktime" class="vid-file" hidden></label>
        ${a.video_url ? `<button class="btn gray vid-remove" type="button">הסרת הסרטון</button>` : ""}
      </div>
      ${a.video_url ? `<video class="thumb" src="${esc(a.video_url)}" muted controls playsinline preload="metadata"></video>` : ""}
      <p class="msg vid-msg"></p>
      <div class="actions">
        ${a.status === "pending"
          ? `<button class="btn green" data-act="publish">פרסום</button>
             <button class="btn ghost" data-act="save">שמירה</button>
             <button class="btn gray" data-act="reject">דחייה</button>`
          : `<button class="btn ghost" data-act="save">שמירת שינויים</button>
             <a class="btn ghost" href="/article/${encodeURIComponent(a.slug)}" target="_blank">צפייה</a>
             <button class="btn gray" data-act="reject">הסרה מהאתר</button>`}
      </div>
      <p class="msg act-msg"></p>`;

    const fields = () => {
      const f = {};
      el.querySelectorAll("[data-f]").forEach((i) => { f[i.dataset.f] = i.type === "checkbox" ? i.checked : i.value; });
      return f;
    };
    const msg = (sel, text, good) => { const m = el.querySelector(sel); m.textContent = text; m.className = `msg ${sel.slice(1)} ${good ? "good" : "bad"}`; };

    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      b.disabled = true;
      try {
        if (act === "save" || act === "publish") await call("update", { id: a.id, fields: fields() });
        if (act === "publish") await call("publish", { id: a.id });
        if (act === "reject") {
          if (!confirm(a.status === "published" ? "להסיר את הידיעה מהאתר?" : "לדחות את הידיעה?")) { b.disabled = false; return; }
          await call("reject", { id: a.id });
        }
        if (act === "save") { msg(".act-msg", "נשמר ✓", true); b.disabled = false; return; }
        el.remove();
        if (tab === "pending") $("count").textContent = Math.max(0, Number($("count").textContent) - 1);
      } catch (err) {
        msg(".act-msg", err.message);
        b.disabled = false;
      }
    }));

    async function saveImage(payload, btn) {
      if (btn) btn.disabled = true;
      msg(".img-msg", payload.url === "" && !payload.file ? "מסיר..." : "בודק את התמונה...", true);
      try {
        const r = await call("setImage", { id: a.id, ...payload });
        if (r.removed) msg(".img-msg", "התמונה הוסרה", true);
        else if (r.approved) { msg(".img-msg", "התמונה אושרה ונשמרה ✓", true); el.querySelector(".img-url").value = r.url; }
        else { msg(".img-msg", "התמונה נפסלה: " + r.reason); el.querySelector(".img-url").value = ""; }
      } catch (err) { msg(".img-msg", err.message); }
      if (btn) btn.disabled = false;
    }
    el.querySelector(".vid-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      e.target.value = "";
      try {
        await uploadVideo(a, f, el.querySelector(".vid-sound").checked, (t, good) => msg(".vid-msg", t, good));
        load();
      } catch (err) { msg(".vid-msg", err.message); }
    });
    el.querySelector(".vid-sound").addEventListener("change", async (e) => {
      if (!a.video_url) return; // יישמר יחד עם הסרטון כשיועלה
      try {
        await call("setVideoSound", { id: a.id, sound: e.target.checked });
        msg(".vid-msg", e.target.checked ? "הסרטון יושמע עם קול" : "הסרטון יוצג בלי קול", true);
      } catch (err) { msg(".vid-msg", err.message); }
    });
    const vr = el.querySelector(".vid-remove");
    if (vr) vr.addEventListener("click", async () => {
      if (!confirm("להסיר את הסרטון מהמבזק?")) return;
      await call("removeVideo", { id: a.id });
      load();
    });

    el.querySelector(".img-btn").addEventListener("click", (e) => saveImage({ url: el.querySelector(".img-url").value.trim() }, e.target));
    el.querySelector(".img-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { await saveImage({ file: await readImageFile(f) }); } catch (err) { msg(".img-msg", err.message); }
      e.target.value = "";
    });

    return el;
  }

  function renderCompose(panel) {
    panel.innerHTML = `
      <div class="compose">
        <p style="margin-top:0">הדביקו הודעה מוואטסאפ, הודעה לעיתונות או כל חומר גלם. העורך האוטומטי יכתוב ממנה מבזק מוכן, והוא יחכה לאישורכם בלשונית "ממתינים".</p>
        <textarea id="raw" placeholder="הדביקו כאן את הטקסט..."></textarea>
        <div class="row2">
          <input type="text" id="srcName" placeholder="שם המקור (לא חובה)">
          <input type="text" id="srcUrl" placeholder="קישור למקור (לא חובה)" dir="ltr">
        </div>
        <div class="actions"><button class="btn" id="go">כתיבת ידיעה</button></div>
        <p class="msg" id="compose-msg"></p>
      </div>`;
    $("go").addEventListener("click", async (e) => {
      const m = $("compose-msg");
      e.target.disabled = true;
      m.className = "msg good"; m.textContent = "העורך כותב... (כחצי דקה)";
      try {
        const r = await call("compose", { text: $("raw").value, sourceName: $("srcName").value, sourceUrl: $("srcUrl").value });
        if (r.rejected) { m.className = "msg bad"; m.textContent = "החומר לא מתאים לאתר: " + r.reason; }
        else {
          m.textContent = `המבזק מוכן ✓ (ציון ${r.article.score || "?"}/10). הוא מחכה לאישורך בלשונית "ממתינים".`;
          $("raw").value = "";
          $("count").textContent = Number($("count").textContent) + 1;
        }
      } catch (err) { m.className = "msg bad"; m.textContent = err.message; }
      e.target.disabled = false;
    });
  }

  // ---------- משתמשים, כניסות והודעות לפעמון ----------
  async function renderUsers(panel) {
    panel.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    let r;
    try { r = await call("usersList"); } catch (err) { panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    const s = r.stats;
    panel.innerHTML = `
      <div class="stats" style="grid-template-columns:repeat(4,1fr)">
        <div><b>${s.online}</b><span>🟢 מחוברים עכשיו</span></div>
        <div><b>${s.users}</b><span>משתמשים</span></div>
        <div><b>${s.newToday}</b><span>חדשים היום</span></div>
        <div><b>${s.visitsToday}</b><span>כניסות היום</span></div>
      </div>
      <div class="item" style="border-top-color:var(--brand)">
        <h3 style="margin:0 0 6px">🔔 הודעה לפעמון של כולם</h3>
        <label>כותרת</label><input type="text" id="n-title" placeholder="למשל: עדכון חשוב לקוראים">
        <label>תוכן (לא חובה)</label><textarea class="short" id="n-body"></textarea>
        <div class="actions"><button class="btn green" id="n-send">שליחה לכולם</button></div>
        <p class="msg" id="n-msg"></p>
      </div>
      <h3 style="margin:18px 4px 8px">המשתמשים</h3>
      <div id="u-list"></div>
      <h3 style="margin:18px 4px 8px">כניסות אחרונות</h3>
      <div class="item" id="v-list" style="padding:6px 16px"></div>`;

    $("n-send").onclick = () => sendNotice(null, $("n-title").value, $("n-body").value, $("n-msg"), () => { $("n-title").value = ""; $("n-body").value = ""; });

    $("u-list").innerHTML = r.users.length ? r.users.map((u) => `
      <div class="item" style="${u.blocked ? "opacity:.55" : ""}">
        <h3 style="margin:0 0 2px">${u.online ? "🟢 " : ""}${esc(u.name || "")}</h3>
        <div class="src" dir="ltr" style="text-align:right">${esc(u.email)}</div>
        <div class="src">נרשם ${esc(new Date(u.created_at).toLocaleDateString("he-IL"))} · ${u.visits} כניסות${u.last_seen ? ` · נראה לאחרונה ${esc(timeAgo(u.last_seen))}` : ""}${u.blocked ? " · חסום" : ""}</div>
        <div class="actions">
          <button class="btn ghost" data-msg="${esc(u.id)}" data-name="${esc(u.name || u.email)}">הודעה אישית</button>
          <button class="btn gray" data-block="${esc(u.id)}" data-b="${u.blocked ? "0" : "1"}">${u.blocked ? "ביטול חסימה" : "חסימה"}</button>
        </div>
        <div class="dm" id="dm-${esc(u.id)}"></div>
      </div>`).join("") : `<div class="empty">עדיין אין משתמשים רשומים.</div>`;

    $("v-list").innerHTML = r.visits.length ? r.visits.map((v) => `
      <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14.5px">
        <span>${v.who ? esc(v.who) : `<span style="color:var(--muted)">אורח</span>`} · ${esc(v.device || "")} · <span dir="ltr">${esc(v.path || "/")}</span></span>
        <span style="color:var(--muted);white-space:nowrap">${esc(timeAgo(v.created_at))}</span></div>`).join("") : `<p class="src">אין כניסות עדיין.</p>`;

    panel.querySelectorAll("[data-msg]").forEach((b) => (b.onclick = () => {
      const box = $(`dm-${b.dataset.msg}`);
      box.innerHTML = `<label>הודעה אישית ל${esc(b.dataset.name)}</label><input type="text" class="dm-t" placeholder="כותרת"><textarea class="short dm-b" placeholder="תוכן"></textarea>
        <div class="actions"><button class="btn green dm-s">שליחה</button></div><p class="msg dm-m"></p>`;
      box.querySelector(".dm-s").onclick = () => sendNotice(b.dataset.msg, box.querySelector(".dm-t").value, box.querySelector(".dm-b").value, box.querySelector(".dm-m"), () => {});
    }));
    panel.querySelectorAll("[data-block]").forEach((b) => (b.onclick = async () => {
      const blocking = b.dataset.b === "1";
      if (blocking && !confirm("לחסום את המשתמש? הוא לא יוכל להתחבר.")) return;
      await call("userBlock", { id: b.dataset.block, blocked: blocking });
      renderUsers(panel);
    }));
  }

  async function sendNotice(userId, title, body, msgEl, done) {
    msgEl.className = "msg good"; msgEl.textContent = "שולח...";
    try {
      await call("notify", { userId, title, body });
      msgEl.textContent = userId ? "ההודעה נשלחה לפעמון של המשתמש ✓" : "ההודעה נשלחה לפעמון של כולם ✓";
      done();
    } catch (err) { msgEl.className = "msg bad"; msgEl.textContent = err.message; }
  }

  // ---------- סרטונים ----------
  // שולפים פריימים מהסרטון בדפדפן, שולחים לבדיקה, ורק אם אושר מעלים את הסרטון.
  const MAX_VIDEO_MB = 50;
  const MAX_VIDEO_SEC = 180;

  function extractFrames(file) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto";
      v.src = URL.createObjectURL(file);
      v.onerror = () => reject(new Error("לא הצלחתי לקרוא את הסרטון"));
      v.onloadedmetadata = async () => {
        const dur = v.duration;
        if (!isFinite(dur) || dur <= 0) return reject(new Error("לא הצלחתי לקרוא את אורך הסרטון"));
        if (dur > MAX_VIDEO_SEC) return reject(new Error(`הסרטון ארוך מדי (עד ${MAX_VIDEO_SEC / 60} דקות)`));
        // פריים בכל שנייה וחצי בערך, בין 8 ל-40 פריימים
        const n = Math.max(8, Math.min(40, Math.ceil(dur / 1.5)));
        const scale = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        const g = c.getContext("2d");
        const frames = [];
        for (let i = 0; i < n; i++) {
          const t = Math.min(dur - 0.05, (dur * (i + 0.5)) / n);
          await new Promise((res) => { v.onseeked = res; v.currentTime = t; });
          g.drawImage(v, 0, 0, c.width, c.height);
          frames.push(c.toDataURL("image/jpeg", 0.7));
        }
        URL.revokeObjectURL(v.src);
        resolve({ frames, duration: dur });
      };
    });
  }

  async function uploadVideo(a, file, sound, say) {
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`הסרטון גדול מדי (עד ${MAX_VIDEO_MB}MB)`);
    say("שולף פריימים מהסרטון...", true);
    const { frames } = await extractFrames(file);
    say(`בודק ${frames.length} פריימים... (כחצי דקה)`, true);
    const type = file.type || "video/mp4";
    const r = await call("checkVideo", { frames, type });
    if (!r.approved) { say("הסרטון נפסל: " + r.reason); return; }
    say("הסרטון אושר. מעלה...", true);
    const up = await fetch(r.uploadUrl, { method: "PUT", headers: { "Content-Type": type, "x-upsert": "false" }, body: file });
    if (!up.ok) throw new Error(`ההעלאה נכשלה (${up.status})`);
    await call("attachVideo", { id: a.id, name: r.name, approval: r.approval, poster: r.posterUrl, sound });
    say("הסרטון עלה ונשמר ✓", true);
  }

  // ---------- פרסומות ----------
  const PLACEMENTS = { top: "📌 נעוצה למעלה", feed: "✨ סטטוס ממומן", side: "🖥️ צד המסך (מחשב)" };

  async function renderAds(panel) {
    panel.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    let list = [];
    try { list = (await call("adsList")).ads; } catch (err) { panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }

    const totalImp = list.reduce((s, a) => s + a.impressions, 0);
    const totalClk = list.reduce((s, a) => s + a.clicks, 0);
    panel.innerHTML = `
      <div class="stats">
        <div><b>${list.filter((a) => a.active).length}</b><span>מודעות פעילות</span></div>
        <div><b>${totalImp.toLocaleString("he-IL")}</b><span>חשיפות</span></div>
        <div><b>${totalClk.toLocaleString("he-IL")}</b><span>לחיצות</span></div>
      </div>
      <div class="actions" style="margin:0 0 14px"><button class="btn" id="new-ad">+ מודעה חדשה</button></div>
      <div id="ad-form"></div>
      <div id="ad-list"></div>`;

    const box = $("ad-list");
    if (!list.length) box.innerHTML = `<div class="empty">עדיין אין מודעות. הוסיפו את המפרסם הראשון 🎉</div>`;
    list.forEach((ad) => {
      const el = document.createElement("div");
      el.className = "item";
      el.style.borderTopColor = ad.color || "var(--ink)";
      const ctr = ad.impressions ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : "0";
      el.innerHTML = `
        <div class="src">${esc(PLACEMENTS[ad.placement])} · ${ad.active ? "🟢 פעילה" : "⏸ מושהית"}
          ${ad.ends_at ? ` · עד ${esc(new Date(ad.ends_at).toLocaleDateString("he-IL"))}` : ""}</div>
        <h3 style="margin:6px 0 2px">${esc(ad.title)}</h3>
        <div>${esc(ad.advertiser)}${ad.text ? " · " + esc(ad.text) : ""}</div>
        <div class="src" style="margin-top:6px">👁 ${ad.impressions.toLocaleString("he-IL")} חשיפות · 👆 ${ad.clicks.toLocaleString("he-IL")} לחיצות · ${ctr}%</div>
        <div class="actions">
          <button class="btn ghost" data-a="edit">עריכה</button>
          <button class="btn ${ad.active ? "gray" : "green"}" data-a="toggle">${ad.active ? "השהיה" : "הפעלה"}</button>
          <button class="btn gray" data-a="del">מחיקה</button>
        </div>`;
      el.querySelector('[data-a="edit"]').onclick = () => adForm(ad);
      el.querySelector('[data-a="toggle"]').onclick = async () => { await call("adToggle", { id: ad.id, active: !ad.active }); renderAds(panel); };
      el.querySelector('[data-a="del"]').onclick = async () => {
        if (!confirm(`למחוק את המודעה של ${ad.advertiser}?`)) return;
        await call("adDelete", { id: ad.id }); renderAds(panel);
      };
      box.appendChild(el);
    });
    $("new-ad").onclick = () => adForm({});
  }

  function adForm(ad) {
    const f = $("ad-form");
    const v = (k) => esc(ad[k] || "");
    const d = (k) => (ad[k] ? new Date(ad[k]).toISOString().slice(0, 10) : "");
    f.innerHTML = `
      <div class="item" style="border-top-color:var(--brand)">
        <h3 style="margin:0">${ad.id ? "עריכת מודעה" : "מודעה חדשה"}</h3>
        <label>מיקום</label>
        <select id="ad-placement">${Object.entries(PLACEMENTS).map(([k, n]) => `<option value="${k}" ${ad.placement === k ? "selected" : ""}>${n}</option>`).join("")}</select>
        <div class="row2" style="grid-template-columns:1fr 1fr">
          <div><label>שם המפרסם *</label><input type="text" id="ad-advertiser" value="${v("advertiser")}"></div>
          <div><label>צבע המותג</label><input type="color" id="ad-color" value="${esc(ad.color || "#0a7d5a")}" style="width:100%;height:40px"></div>
        </div>
        <label>כותרת *</label><input type="text" id="ad-title" value="${v("title")}" placeholder="למשל: מבצע חנוכה, 1+1 על הכל 🎉">
        <label>טקסט קצר</label><input type="text" id="ad-text" value="${v("text")}">
        <div class="row2" style="grid-template-columns:1fr 2fr">
          <div><label>טקסט הכפתור</label><input type="text" id="ad-cta" value="${v("cta")}" placeholder="לפרטים"></div>
          <div><label>קישור (https://, tel: או mailto:)</label><input type="text" id="ad-link" value="${v("link")}" dir="ltr" placeholder="tel:0500000000"></div>
        </div>
        <label>תמונה (לא חובה, תיבדק אוטומטית ותישמר באתר עצמו)</label>
        <div class="img-row"><input type="text" id="ad-image" value="${v("image_url")}" dir="ltr" placeholder="קישור לתמונה, או העלאה מהמחשב ←">
          <label class="btn ghost" style="margin:0;cursor:pointer">📁 מהמחשב<input type="file" accept="image/*" id="ad-file" hidden></label></div>
        <p class="msg" style="font-size:13px;color:var(--muted)">⚠️ לפני שמירה, היכנסו בעצמכם לקישור של המפרסם ובדקו שהוא מוביל לאתר ראוי. קישור לאתר לא ראוי עלול לגרום לחסימת האתר כולו בסינונים.</p>
        <div class="row2" style="grid-template-columns:1fr 1fr">
          <div><label>מתאריך (לא חובה)</label><input type="date" id="ad-start" value="${d("starts_at")}"></div>
          <div><label>עד תאריך (לא חובה)</label><input type="date" id="ad-end" value="${d("ends_at")}"></div>
        </div>
        <div class="actions"><button class="btn green" id="ad-save">שמירה</button><button class="btn ghost" id="ad-cancel">ביטול</button></div>
        <p class="msg" id="ad-msg"></p>
      </div>`;
    f.scrollIntoView({ behavior: "smooth" });
    $("ad-cancel").onclick = () => (f.innerHTML = "");
    $("ad-file").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const m = $("ad-msg");
      m.className = "msg good"; m.textContent = "בודק את התמונה...";
      try {
        const r = await call("uploadImage", { file: await readImageFile(file) });
        if (r.approved) { $("ad-image").value = r.url; m.textContent = "התמונה אושרה ✓"; }
        else { m.className = "msg bad"; m.textContent = "התמונה נפסלה: " + r.reason; }
      } catch (err) { m.className = "msg bad"; m.textContent = err.message; }
      e.target.value = "";
    };
    $("ad-save").onclick = async (e) => {
      const m = $("ad-msg");
      e.target.disabled = true;
      m.className = "msg good"; m.textContent = $("ad-image").value ? "שומר ובודק את התמונה..." : "שומר...";
      const day = (id, end) => { const x = $(id).value; return x ? new Date(x + (end ? "T23:59:59" : "T00:00:00")).toISOString() : null; };
      try {
        const r = await call("adSave", { ad: {
          id: ad.id, placement: $("ad-placement").value, advertiser: $("ad-advertiser").value,
          color: $("ad-color").value, title: $("ad-title").value, text: $("ad-text").value,
          cta: $("ad-cta").value, link: $("ad-link").value, image_url: $("ad-image").value,
          starts_at: day("ad-start"), ends_at: day("ad-end", true),
        } });
        if (r.imageRejected) { m.className = "msg bad"; m.textContent = "התמונה נפסלה: " + r.reason; e.target.disabled = false; return; }
        renderAds($("panel"));
      } catch (err) { m.className = "msg bad"; m.textContent = err.message; e.target.disabled = false; }
    };
  }

  // ---------- פניות ----------
  const TOPICS = { general: "פנייה כללית", ads: "📣 פרסום", correction: "תיקון / טעות", message: "💬 הודעה ממשתמש", comment: "💭 תגובה", update: "📰 עדכון מקורא" };
  async function renderMessages(panel) {
    panel.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    let list = [];
    try { list = (await call("messagesList")).messages; } catch (err) { panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    panel.innerHTML = list.length ? "" : `<div class="empty">אין פניות עדיין.</div>`;
    list.forEach((m) => {
      const el = document.createElement("div");
      el.className = "item";
      el.style.opacity = m.done ? ".55" : "1";
      el.innerHTML = `
        <div class="src">${esc(TOPICS[m.topic] || m.topic)} · ${esc(timeAgo(m.created_at))}${m.done ? " · ✓ טופל" : ""}</div>
        <h3 style="margin:6px 0 2px">${esc(m.name)}</h3>
        <div class="src" dir="ltr" style="text-align:right">${m.phone ? `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : ""} ${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ""}</div>
        <p style="white-space:pre-wrap;margin:10px 0 0">${esc(m.body)}</p>
        <div class="actions"><button class="btn ${m.done ? "ghost" : "green"}" data-a="done">${m.done ? "סמן כלא טופל" : "סמן כטופל"}</button>
          ${m.user_id ? `<button class="btn ghost" data-a="reply">תשובה לפעמון שלו</button>` : ""}</div>
        <div class="dm"></div>`;
      el.querySelector('[data-a="done"]').onclick = async () => { await call("messageDone", { id: m.id, done: !m.done }); renderMessages(panel); };
      const rb = el.querySelector('[data-a="reply"]');
      if (rb) rb.onclick = () => {
        const box = el.querySelector(".dm");
        box.innerHTML = `<label>תשובה ל${esc(m.name)}</label><textarea class="short dm-b"></textarea><div class="actions"><button class="btn green dm-s">שליחה</button></div><p class="msg dm-m"></p>`;
        box.querySelector(".dm-s").onclick = () => sendNotice(m.user_id, "תשובה ממערכת נייעס סטטוס", box.querySelector(".dm-b").value, box.querySelector(".dm-m"), () => call("messageDone", { id: m.id, done: true }));
      };
      panel.appendChild(el);
    });
  }

  // ---------- מצב חירום: פס אדום בראש האתר לכל הגולשים ----------
  async function renderEmergency(panel) {
    panel.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    let em = {};
    try { em = (await call("stateGet")).state.emergency || {}; } catch (err) { panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    panel.innerHTML = `<div class="item">
      <h3 style="margin:0 0 6px">${em.on ? "🚨 מצב חירום פעיל עכשיו" : "מצב חירום כבוי"}</h3>
      <p class="src" style="margin:0 0 12px">כשמצב חירום פעיל, מופיע לכל הגולשים פס אדום בראש האתר עם ההודעה שלך, וקיצור להנחיות פיקוד העורף.
      הודעות פיקוד העורף מהשעה האחרונה מופיעות באתר גם בלי זה, אוטומטית.</p>
      <label>כותרת</label><input id="em-title" value="${esc(em.title || "מצב חירום")}" maxlength="120">
      <label>הודעה לגולשים</label><textarea id="em-text" class="short" maxlength="1000" placeholder="למשל: יש לפעול לפי הנחיות פיקוד העורף ולהישאר בקרבת מרחב מוגן.">${esc(em.text || "")}</textarea>
      <div class="actions">
        <button class="btn ${em.on ? "" : "green"}" id="em-on">${em.on ? "עדכון ההודעה" : "הפעלת מצב חירום"}</button>
        ${em.on ? `<button class="btn ghost" id="em-off">כיבוי מצב חירום</button>` : ""}
      </div><p class="msg" id="em-msg"></p></div>`;
    const save = async (on) => {
      const msg = $("em-msg");
      msg.className = "msg"; msg.textContent = "שומר...";
      try {
        await call("emergencySet", { on, title: $("em-title").value, text: $("em-text").value });
        renderEmergency(panel);
      } catch (err) { msg.className = "msg bad"; msg.textContent = err.message; }
    };
    $("em-on").onclick = () => save(true);
    if ($("em-off")) $("em-off").onclick = () => save(false);
  }

  show(Boolean(token));
  handleMagicLink();
})();
