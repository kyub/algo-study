// 알고리즘 스터디 사이트 (GitHub Pages, 서버 없음).
// 공개되는 것은 이 화면 틀뿐이고, 내용은 data/의 암호화 묶음을 비밀번호로 풀어서 보여 준다.
import { loadMeta, deriveRawKey, openVault, fetchBlob, b64decode, b64encode } from "./vault.js?v=4170285632";

const BUILD = document.body.dataset.build;
const app = document.getElementById("app");
const KEY = "algo.key";
const MEMBER = "algo.member";
const S = { meta: null, key: null, m: null, view: 0, onKey: null, urls: new Map() };

// ---------- 저장소 (사생활 보호 모드 등에서 실패해도 동작하게) ----------
const st = {
  get(k) {
    try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; }
  },
  set(k, v, remember = true) {
    try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch { /* 저장 못 해도 이번 화면은 사용 가능 */ }
  },
  del(k) {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* 무시 */ }
  },
};

// ---------- 요소 만들기 (내용은 항상 textContent로 넣음) ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "checked") el.checked = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const pad = (n) => String(n).padStart(2, "0");
const week = (n) => S.m.weeks.find((w) => w.n === n);
const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// 같은 파일은 한 번만 풀어서 다시 씀
function blobUrl(f, type) {
  if (!S.urls.has(f.id)) {
    S.urls.set(f.id, fetchBlob(S.key, f.id, type).then((b) => URL.createObjectURL(b)));
  }
  return S.urls.get(f.id);
}

// ---------- 시작 ----------
async function boot() {
  try {
    S.meta = await loadMeta(BUILD);
  } catch {
    app.replaceChildren(h("p", { class: "boot" }, "사이트 데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요."));
    return;
  }
  const saved = readSavedKey();
  if (saved) {
    try { await unlock(saved); } catch { st.del(KEY); }
  }
  addEventListener("hashchange", route);
  document.addEventListener("keydown", (e) => {
    if (S.onKey && !e.target.closest("input, textarea")) S.onKey(e);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".me")) document.querySelector(".dropdown.open")?.classList.remove("open");
  });
  route();
}

function readSavedKey() {
  try {
    const v = JSON.parse(st.get(KEY));
    return v && v.salt === S.meta.salt ? b64decode(v.k) : null;
  } catch {
    return null;
  }
}

async function unlock(raw) {
  const { key, manifest } = await openVault(raw, S.meta);
  S.key = key;
  S.m = manifest;
}

function logout() {
  st.del(KEY);
  st.del(MEMBER);
  for (const p of S.urls.values()) p.then(URL.revokeObjectURL, () => {});
  S.urls.clear();
  S.key = S.m = null;
  location.hash = "";
  route();
}

// ---------- 화면 고르기 ----------
function route() {
  S.view += 1;
  S.onKey = null;
  if (!S.m) return viewLogin();
  const me = st.get(MEMBER);
  if (!me || !S.m.members.includes(me)) return viewWho();
  const [page, a, b] = location.hash.replace(/^#\/?/, "").split("/");
  if (page === "week" && week(Number(a))) return shell(viewWeek(week(Number(a)), b || "slides"), Number(a));
  if (page === "contest") return shell(viewContest(), "contest");
  shell(viewHome(), "home");
}

function viewLogin() {
  document.title = S.meta ? "알고리즘 스터디" : document.title;
  const pw = h("input", { type: "password", id: "pw", autocomplete: "current-password", required: true });
  const remember = h("input", { type: "checkbox", checked: true });
  const err = h("div", { class: "error", role: "alert" });
  const btn = h("button", { class: "btn primary", type: "submit" }, "입장");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = "확인 중…";
      err.textContent = "";
      try {
        const raw = await deriveRawKey(pw.value, S.meta);
        await unlock(raw);
        st.set(KEY, JSON.stringify({ salt: S.meta.salt, k: b64encode(raw) }), remember.checked);
        route();
      } catch {
        err.textContent = "비밀번호가 맞지 않습니다.";
        btn.disabled = false;
        btn.textContent = "입장";
        pw.select();
      }
    },
  },
    h("div", { class: "field" }, h("label", { for: "pw" }, "스터디 공용 비밀번호"), pw),
    h("label", { class: "check" }, remember, "이 기기에서 로그인 유지"),
    btn, err);
  app.replaceChildren(h("main", { class: "gate" }, h("div", { class: "card" },
    h("div", { class: "mark" }, h("span", { class: "badge" }, "A"), "알고리즘 스터디"),
    h("h1", {}, "코딩 테스트 6주 스터디"),
    h("p", { class: "muted small" }, "강의자료 · 연습문제 · 실전"),
    form)));
  pw.focus();
}

function viewWho() {
  document.title = "알고리즘 스터디";
  const pick = (name) => {
    st.set(MEMBER, name);
    if (!location.hash) route();
    else location.hash = "";
  };
  app.replaceChildren(h("main", { class: "gate" }, h("div", { class: "card" },
    h("div", { class: "mark" }, h("span", { class: "badge" }, "A"), S.m.title),
    h("h1", {}, "누구인가요?"),
    h("p", { class: "muted small" }, "오른쪽 위 이름 버튼에서 언제든 바꿀 수 있습니다."),
    h("div", { class: "who" }, S.m.members.map((name) =>
      h("button", { type: "button", onclick: () => pick(name) }, h("span", { class: "avatar" }, name[0]), name))))));
}

// ---------- 공통 틀 ----------
function shell(content, active) {
  const me = st.get(MEMBER);
  const cur = week(S.m.current_week);
  const side = h("nav", { class: "side" },
    h("a", { href: "#/", class: active === "home" ? "active" : null }, "홈"),
    h("div", { class: "sep" }),
    h("h4", {}, "주차"),
    S.m.weeks.map((w) => h("a", { href: `#/week/${w.n}`, class: active === w.n ? "active" : null },
      h("span", { class: w.deck ? "badge sm" : "badge sm ghost" }, pad(w.n)), w.title,
      w.n === S.m.current_week ? h("span", { class: "dot", title: "이번 주" }) : null)),
    h("div", { class: "sep" }),
    h("h4", {}, "실전"),
    h("a", { href: "#/contest", class: active === "contest" ? "active" : null }, "실전 회차", h("span", { class: "pill gray" }, "준비 중")));
  side.addEventListener("click", (e) => { if (e.target.closest("a")) side.classList.remove("open"); });
  const drop = h("div", { class: "dropdown" },
    h("button", { type: "button", onclick: () => { st.del(MEMBER); route(); } }, "다른 이름으로 바꾸기"),
    h("button", { type: "button", onclick: logout }, "로그아웃"));
  const top = h("header", { class: "top" },
    h("button", { class: "btn icon menu-btn", type: "button", "aria-label": "메뉴", onclick: () => side.classList.toggle("open") }, "☰"),
    h("a", { class: "brand", href: "#/" }, h("span", { class: "badge sm" }, pad(cur.n)), S.m.title),
    h("span", { class: "now" }, `이번 주: ${cur.title}`),
    h("span", { class: "spacer" }),
    h("div", { class: "me" },
      h("button", { type: "button", onclick: () => drop.classList.toggle("open") },
        h("span", { class: "avatar sm" }, me[0]), h("span", { class: "name" }, me), " ▾"),
      drop));
  app.replaceChildren(top, h("div", { class: "layout" }, side, h("main", { class: "main" }, content)));
  scrollTo(0, 0);
}

// ---------- 홈 ----------
function viewHome() {
  document.title = "알고리즘 스터디";
  const cur = week(S.m.current_week);
  return h("div", { class: "wrap" },
    h("section", { class: "card hero" },
      h("div", {},
        h("span", { class: "pill" }, `이번 주 · ${cur.n}주차`),
        h("h1", {}, cur.title),
        h("div", { class: "muted" }, cur.chapters),
        h("div", { class: "actions" },
          h("a", { class: "btn primary", href: `#/week/${cur.n}` }, "강의자료 보기"),
          h("a", { class: "btn", href: `#/week/${cur.n}/practice` }, "연습문제"))),
      h("span", { class: "badge xl" }, pad(cur.n))),
    h("h2", { class: "section-title" }, "6주 일정"),
    h("div", { class: "weeks" }, S.m.weeks.map((w) => h("a", { class: "card", href: `#/week/${w.n}` },
      h("div", { class: "row" }, h("span", { class: w.deck ? "badge sm" : "badge sm ghost" }, pad(w.n)), h("h3", {}, w.title)),
      h("div", { class: "muted small" }, w.chapters),
      h("div", {}, w.deck ? h("span", { class: "pill green" }, "강의자료 있음") : h("span", { class: "pill gray" }, "준비 중"))))),
    h("p", { class: "muted small" }, `교재: ${S.m.book} · 구성원: ${S.m.members.join(", ")}`));
}

// ---------- 주차 ----------
function viewWeek(w, tab) {
  document.title = `${w.n}주차 ${w.title} · 알고리즘 스터디`;
  const tabs = [["slides", "강의자료"], ["practice", "연습문제"], ["contest", "실전"]];
  const body = tab === "practice" ? practiceTab(w) : tab === "contest" ? contestTab() : slidesTab(w);
  return h("div", { class: "wrap" },
    h("div", { class: "head" }, h("span", { class: "badge" }, pad(w.n)),
      h("div", {}, h("h1", {}, w.title), h("div", { class: "muted small" }, w.chapters))),
    h("nav", { class: "tabs" }, tabs.map(([k, label]) =>
      h("a", { href: `#/week/${w.n}/${k}`, class: k === tab ? "active" : null }, label))),
    body);
}

function slidesTab(w) {
  const d = w.deck;
  if (!d) {
    return h("div", { class: "card soft" }, h("h3", {}, "강의자료 준비 중"),
      h("p", { class: "muted" }, "PPT가 완성되면 여기에서 슬라이드를 보고 PPTX·PDF로 내려받을 수 있습니다."));
  }
  const view = S.view;
  const n = d.slides.length;
  let i = -1;
  const img = h("img", { alt: "" });
  const stage = h("div", { class: "stage" }, h("div", { class: "loading" }, "슬라이드 여는 중…"));
  const count = h("span", { class: "count" });
  const prev = h("button", { class: "btn icon", type: "button", title: "이전 (←)", onclick: () => go(i - 1) }, "←");
  const next = h("button", { class: "btn icon", type: "button", title: "다음 (→)", onclick: () => go(i + 1) }, "→");
  const full = h("button", { class: "btn", type: "button", onclick: () => stage.requestFullscreen?.() }, "전체 화면");
  const thumbs = h("div", { class: "thumbs" }, d.thumbs.map((_, k) =>
    h("button", { type: "button", title: `${k + 1}쪽`, onclick: () => go(k) }, h("span", {}, k + 1))));

  async function go(k) {
    if (k < 0 || k >= n || k === i) return;
    i = k;
    count.textContent = `${i + 1} / ${n}`;
    prev.disabled = i === 0;
    next.disabled = i === n - 1;
    [...thumbs.children].forEach((t, j) => t.classList.toggle("active", j === i));
    thumbs.children[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    try {
      const url = await blobUrl(d.slides[k], "image/webp");
      if (S.view !== view || i !== k) return;
      img.src = url;
      img.alt = `${w.n}주차 슬라이드 ${k + 1}`;
      if (!img.isConnected) stage.replaceChildren(img);
      for (const j of [k + 1, k - 1]) if (j >= 0 && j < n) blobUrl(d.slides[j], "image/webp");
    } catch {
      if (S.view === view) stage.replaceChildren(h("div", { class: "loading" }, "슬라이드를 열지 못했습니다. 새로고침해 주세요."));
    }
  }
  S.onKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "PageDown") go(i + 1);
    else if (e.key === "ArrowLeft" || e.key === "PageUp") go(i - 1);
  };
  (async () => {
    for (let k = 0; k < n; k++) {
      try {
        const url = await blobUrl(d.thumbs[k], "image/webp");
        if (S.view !== view) return;
        thumbs.children[k].prepend(h("img", { src: url, alt: "" }));
      } catch { /* 썸네일 하나 실패는 건너뜀 */ }
    }
  })();
  go(0);

  return h("section", { class: "viewer" },
    h("div", { class: "viewbar" }, prev, count, next, full, h("span", { class: "spacer" }),
      downloadButton(d.pptx, "PPTX"), downloadButton(d.pdf, "PDF")),
    stage, thumbs,
    h("p", { class: "muted small" },
      "키보드 ←/→로 넘길 수 있습니다. PPTX는 Noto Sans KR 글꼴이 설치된 PC에서 열어야 디자인이 그대로 보입니다. ",
      "PDF는 보기용이며 글자 검색·복사가 되지 않을 수 있습니다."));
}

function downloadButton(f, label) {
  const btn = h("button", { class: "btn", type: "button" }, `${label} 받기 (${mb(f.size)})`);
  btn.addEventListener("click", async () => {
    const text = btn.textContent;
    btn.disabled = true;
    btn.textContent = "받는 중…";
    try {
      const url = URL.createObjectURL(await fetchBlob(S.key, f.id, f.type));
      const a = h("a", { href: url, download: f.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      alert("내려받기에 실패했습니다. 새로고침 후 다시 시도해 주세요.");
    } finally {
      btn.disabled = false;
      btn.textContent = text;
    }
  });
  return btn;
}

function practiceTab(w) {
  const items = w.practice || [];
  return h("div", { class: "stack" },
    h("div", { class: "keypoint" },
      h("strong", {}, "연습문제는 다음 단계에서 열립니다. "),
      "브라우저에서 Python을 실행하고, 제출하면 채점과 AI 피드백이 바로 나옵니다."),
    items.length
      ? h("div", { class: "plist" }, items.map((p, k) => h("div", { class: "item" },
        h("span", { class: "badge sm ghost" }, k + 1), h("span", { class: "t" }, p.title),
        h("span", { class: "pill" }, p.tag), h("span", { class: "pill gray" }, "준비 중"))))
      : h("p", { class: "muted" }, "이 주차의 연습문제는 강의자료와 함께 정리됩니다."));
}

function contestTab() {
  return h("div", { class: "card soft" }, h("h3", {}, "실전 문제 준비 중"),
    h("p", { class: "muted" },
      "실전은 3명이 함께 시작하고, 제한 시간이 끝나면 결과표·서로의 코드·AI 피드백을 공개합니다. ",
      "교재 기출 문제를 정리하면 열립니다."));
}

function viewContest() {
  document.title = "실전 · 알고리즘 스터디";
  return h("div", { class: "wrap" }, h("div", { class: "head" }, h("h1", {}, "실전 회차")), contestTab());
}

boot();
