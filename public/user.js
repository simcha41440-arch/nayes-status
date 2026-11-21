// משתמשים: התחברות עם Google (פעם אחת, ואז נשארים מחוברים), רישום כניסות, פעמון הודעות, ושליחת הודעות למנהל.

(function () {
  const USER_KEY = "nayes_user";
  const INFO_KEY = "nayes_user_info";
  const get = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
  const $ = (id) => document.getElementById(id);

  let config = { requireLogin: true, supabaseUrl: "" };

  async function post(action, payload = {}) {
    const r = await fetch("/api/me", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User": get(USER_KEY) },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || `שגיאה ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  function saveUser(session, user) {
    set(USER_KEY, session);
    set(INFO_KEY, JSON.stringify(user));
    // בעל האתר: אותו חיבור משמש גם ככניסה ללוח הבקרה (עם סיסמה)
    if (user && user.isOwner) set("nayes_profile", session);
  }

  function googleUrl() {
    const back = location.origin + location.pathname;
    return `${config.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
  }

  // ---------- מסך התחברות ----------
  function showWall(message) {
    let w = $("login-wall");
    if (!w) {
      w = document.createElement("div");
      w.id = "login-wall";
      w.className = "login-wall";
      document.body.appendChild(w);
    }
    w.innerHTML = `
      <div class="lw-box">
        <div class="av plain" style="--s:84px;margin:0 auto 18px"><span class="face logo" style="font-size:38px">נ</span></div>
        <h1>נייעס <em>סטטוס</em></h1>
        <p class="lw-sub">רק מה ששווה לדעת. המבזקים הכי חשובים, בסטטוסים קצרים.</p>
        <a class="lw-google" href="${googleUrl()}">
          <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          התחברות עם Google
        </a>
        <p class="lw-note">מתחברים פעם אחת, ונשארים מחוברים.</p>
        ${message ? `<p class="lw-err">${esc(message)}</p>` : ""}
        <p class="lw-links"><a href="/about">אודות ומדיניות תוכן</a></p>
      </div>`;
    document.documentElement.classList.add("walled");
  }

  function hideWall() {
    const w = $("login-wall");
    if (w) w.remove();
    document.documentElement.classList.remove("walled");
  }

  // חזרה מ-Google: Supabase מחזיר access_token בכתובת
  async function handleReturn() {
    const h = new URLSearchParams(location.hash.slice(1));
    const at = h.get("access_token");
    const err = h.get("error_description");
    if (!at && !err) return null;
    history.replaceState(null, "", location.pathname + location.search);
    if (err) return { error: "ההתחברות בוטלה או נכשלה. נסו שוב." };
    try {
      const { session, user } = await post("exchange", { accessToken: at });
      saveUser(session, user);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ---------- כניסות: רישום בכל טעינה ופעימה כל דקה (כדי לדעת מי מחובר עכשיו) ----------
  function track() {
    post("track", { path: location.pathname }).catch(() => {});
  }

  // ---------- פעמון ----------
  async function refreshBell() {
    const badge = $("bell-badge");
    if (!badge || !get(USER_KEY)) return;
    try {
      const { unread, user } = await post("me");
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.hidden = !unread;
      if (user) saveUser(get(USER_KEY), user);
    } catch (e) {
      if (e.status === 401) { set(USER_KEY, ""); if (config.requireLogin) showWall(); }
    }
  }

  async function openBell() {
    const p = $("bell-panel");
    if (!p) return;
    p.classList.add("open");
    $("bell-list").innerHTML = `<div class="skeleton" style="height:120px;margin:16px"></div>`;
    if (!get(USER_KEY)) {
      $("bell-list").innerHTML = `<div class="empty">כדי לקבל הודעות ולשלוח לנו הודעות, צריך להתחבר.<br><br><a class="btn" href="${googleUrl()}">התחברות עם Google</a></div>`;
      return;
    }
    try {
      const { items } = await post("bell");
      $("bell-badge").hidden = true;
      $("bell-list").innerHTML = items.length
        ? items.map((n) => `<div class="bell-item ${n.unread ? "unread" : ""}">
            <div class="av plain" style="--s:44px"><span class="face logo" style="font-size:19px">נ</span></div>
            <div class="bi-mid"><b>${esc(n.title)}</b>${n.personal ? `<span class="bi-tag">אישי</span>` : ""}
              ${n.body ? `<p>${esc(n.body)}</p>` : ""}<small>${esc(timeAgo(n.created_at))}</small></div></div>`).join("")
        : `<div class="empty">אין הודעות חדשות.</div>`;
    } catch (e) {
      $("bell-list").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  function setupBell() {
    const btn = $("bell-btn");
    if (!btn) return;
    btn.innerHTML = `${icon("bell", 24)}<i class="bell-badge" id="bell-badge" hidden></i>`;
    btn.onclick = openBell;
    $("bell-back").innerHTML = icon("back", 24);
    $("bell-back").onclick = () => $("bell-panel").classList.remove("open");
    $("bell-form").onsubmit = async (e) => {
      e.preventDefault();
      const msg = $("bell-msg");
      if (!get(USER_KEY)) { location.href = googleUrl(); return; }
      msg.className = "form-msg"; msg.textContent = "שולח...";
      try {
        await post("send", { topic: $("bell-topic").value, body: $("bell-text").value });
        $("bell-text").value = "";
        msg.className = "form-msg good"; msg.textContent = "נשלח. תודה!";
      } catch (err) {
        msg.className = "form-msg bad"; msg.textContent = err.message;
      }
    };
  }

  // ---------- הפעלה ----------
  async function init() {
    try { config = await (await fetch("/api/me?config=1")).json(); } catch {}
    const back = await handleReturn();
    setupBell();

    if (!get(USER_KEY) && config.requireLogin) {
      showWall(back && back.error);
    } else {
      hideWall();
    }
    track();
    refreshBell();
    setInterval(() => { if (!document.hidden) { track(); refreshBell(); } }, 60000);
  }

  window.nayesUser = { info: () => { try { return JSON.parse(get(INFO_KEY) || "null"); } catch { return null; } }, logout: () => { set(USER_KEY, ""); set(INFO_KEY, ""); location.reload(); } };
  init();
})();
