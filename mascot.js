// 마스코트 문어 '뭉글이': 화면 아래를 꼬물꼬물 돌아다니고, 끌어서 옮길 수 있고, 누르면 말풍선에서 대화한다.
// 그림은 Codex가 만든 원본 PNG(mascot/)를 그대로 쓰고, 화면에서만 기준 높이 72px로 줄여 그린다.
// 홈에서는 화면 아래 전체를, 풀이·실전 화면에서는 편집기를 가리지 않게 왼쪽 메뉴 아래만 돌아다닌다.
// 대답은 피드백 서버의 /chat(빠른 모델)에서 받는다. 먼저 말하는 건 몇 분에 한 번쯤 하는 혼잣말뿐이다.
import { h, st } from "./ui.js?v=b28e45d96f";

export const PET_NAME = "뭉글이";
const OFF = "algo.pet";              // "off"면 숨김 (오른쪽 위 이름 메뉴에서 바꿈)
const SIZE = 72;                     // 기준 표시 높이: 배율 = SIZE / referenceHeight
const W = 96, H = 100;               // 그리는 칸 (점프·바둥거림 여유 포함)
const HANG = H - 2 - SIZE - 6;       // 매달린 그림은 서 있는 그림보다 이만큼 위에 그려짐
const WALK = 34, RUSH = 170;         // px/초 (자기 구역 밖이면 서둘러 돌아감)
const SLEEP_AFTER = 60000;           // 입력이 없으면 졸기 시작
const JUMP_SKIP = 720, JUMP_MS = 880; // 점프 시트에서 실제로 뛰는 구간만 (Codex 미리보기와 같은 값)
const MUTTER_GAP = 5 * 60000;        // 혼잣말 최소 간격
const TYPE_MS = 38;                  // 대답을 한 글자씩 보여 주는 간격
const HISTORY = 6;                   // 서버에 같이 보내는 최근 대화 (사용자·뭉글이 합쳐서)
const MUTTER = [
  "문어는 심장이 세 개래. 나는 몇 개게?", "먹물 쏘는 연습 중이야! 아직은 안 나와…", "안경에 김 서렸다… 잠깐만!",
  "꼬물꼬물… 다리 운동 중!", "오늘 점심 뭐 먹었어? 난 플랑크톤!", "화이팅! 한 문제씩 하면 돼!",
  "막히면 잠깐 쉬었다 하자. 물 한 잔!", "어제보다 한 줄만 더 쓰면 성공이야!", "천천히 해도 괜찮아. 난 여기 있을게!",
];
const HELLO = ["불렀어? 뭐든 물어봐!", "응응, 왜? 궁금한 거 있어?", "뭉글이 등장! 파이썬 함수도 알려 줄 수 있어!"];
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const wide = matchMedia("(min-width: 861px)"); // 왼쪽 메뉴가 접히는 좁은 화면에서는 숨김

const P = {
  el: null, cv: null, hit: null, bubble: null, chat: null, asked: null, answer: null, input: null, send: null,
  data: null, states: null, img: new Map(), loading: null, ready: false,
  screen: null, ctx: null, changed: false, zone: null, custom: null,
  x: -1, y: 0, vy: 0, mode: "idle", t0: 0, until: 0, then: null, target: 0,
  input_at: performance.now(), spoke: performance.now(), raf: 0, prev: 0, drawn: "", said: "",
  history: [], ask: 0, line: null,
};

export const petOn = () => st.get(OFF) !== "off";
export function setPet(on) {
  if (on) st.del(OFF);
  else st.set(OFF, "off");
  sync();
}

// 화면이 바뀔 때 app.js가 부름: screen은 "home" | "work" | null(숨김), ctx는 { ai, me } (대화 서버와 내 이름)
export function petScreen(screen, ctx) {
  if (screen !== P.screen) {
    P.changed = true;
    P.custom = null; // 내려놓은 자리 구역은 그 화면에서만
  }
  P.screen = screen;
  if (ctx) P.ctx = ctx;
  queueMicrotask(sync); // 화면이 다 그려진 뒤 왼쪽 메뉴 위치를 잼
}

function sync() {
  if (!P.screen || !wide.matches || !petOn()) {
    if (P.el) {
      closeChat();
      P.el.hidden = true;
    }
    cancelAnimationFrame(P.raf);
    P.raf = 0;
    return;
  }
  mount();
  load().then(() => {
    if (!P.screen || !wide.matches || !petOn()) return;
    P.zone = null;
    if (P.x < 0) { // 처음 나타날 때는 구역 안 아무 데서나 폴짝
      const [a, b] = zone();
      P.x = a + Math.random() * (b - a);
      place();
      setMode("jump", JUMP_MS);
    } else if (P.changed && ["idle", "walk", "sleep"].includes(P.mode)) {
      next();
    }
    P.changed = false;
    if (P.el.hidden) {
      P.el.hidden = false;
      P.prev = performance.now();
      P.raf = requestAnimationFrame(tick);
    }
  }, () => { /* 그림을 못 받으면 문어 없이 사이트만 씀 */ });
}

function mount() {
  if (P.el) return;
  P.cv = h("canvas", { class: "pet-art", width: W, height: H, "aria-hidden": "true" });
  P.bubble = h("div", { class: "pet-bubble", role: "status" });
  P.asked = h("p", { class: "pet-asked" });
  P.answer = h("p", { class: "pet-answer", "aria-live": "polite" });
  P.input = h("input", { type: "text", maxlength: "100", autocomplete: "off", placeholder: `${PET_NAME}에게 말 걸기`, "aria-label": `${PET_NAME}에게 할 말` });
  P.send = h("button", { type: "button", class: "pet-send", onclick: ask }, "보내기");
  P.chat = h("div", { class: "pet-chat", role: "dialog", "aria-label": `${PET_NAME}와 대화` },
    h("button", { type: "button", class: "pet-close", "aria-label": "대화 닫기", onclick: closeChat }, "×"),
    P.asked, P.answer, h("div", { class: "pet-row" }, P.input, P.send));
  P.hit = h("div", { class: "pet-hit", role: "button", tabindex: "0", "aria-label": `${PET_NAME}: 누르면 대화하고, 끌어서 옮길 수 있어요` });
  P.el = h("div", { class: "pet", hidden: true },
    P.cv, h("span", { class: "pet-zz", "aria-hidden": "true" }, "z z"), P.bubble, P.chat, P.hit);
  document.body.append(P.el);

  // 5px 넘게 끌면 잡기, 아니면 누르기(대화창 열기·닫기)
  let press = null;
  P.hit.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !P.ready) return;
    e.preventDefault();
    P.hit.setPointerCapture(e.pointerId);
    press = { x: e.clientX, y: e.clientY, moved: false };
  });
  P.hit.addEventListener("pointermove", (e) => {
    if (!press) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    if (!press.moved) {
      press.moved = true;
      closeChat();
      setMode("grab");
    }
    hold(e.clientX, e.clientY);
  });
  const release = (e) => {
    if (!press) return;
    const moved = press.moved;
    press = null;
    if (P.hit.hasPointerCapture(e.pointerId)) P.hit.releasePointerCapture(e.pointerId);
    if (moved) {
      // 내려놓은 자리 주변을 새 구역으로 (다른 화면으로 가면 원래 구역)
      P.custom = [Math.max(8, P.x - 110), Math.max(8, Math.min(innerWidth - W - 8, P.x + 110))];
      P.vy = 0;
      setMode("fall");
    } else if (e.type === "pointerup") {
      toggleChat();
    }
  };
  P.hit.addEventListener("pointerup", release);
  P.hit.addEventListener("pointercancel", release);
  P.hit.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleChat();
    }
  });
  P.input.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 글자 확정용
    if (e.key === "Enter") ask();
  });
  P.chat.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChat(); });
  addEventListener("pointerdown", (e) => { if (chatting() && !P.el.contains(e.target)) closeChat(); });

  for (const t of ["pointermove", "pointerdown", "keydown", "wheel"]) addEventListener(t, wake, { passive: true });
  addEventListener("resize", () => {
    P.zone = null;
    if (P.x >= 0) {
      P.x = Math.max(0, Math.min(innerWidth - W, P.x));
      place();
    }
  });
  wide.addEventListener("change", sync);
  addEventListener("algo:graded", (e) => { // practice.js가 채점 뒤 보냄: 모두 통과하면 말없이 폴짝
    const { passed, total } = e.detail;
    if (shown() && passed === total && ["idle", "walk", "sleep"].includes(P.mode)) setMode("jump", JUMP_MS);
  });
}

function load() {
  if (!P.loading) {
    P.loading = (async () => {
      const r = await fetch("mascot/animations.json");
      if (!r.ok) throw new Error(`mascot ${r.status}`);
      const d = await r.json();
      const pic = async (k, file) => {
        const im = new Image();
        im.src = `mascot/${file}`;
        await im.decode();
        P.img.set(k, im);
      };
      await Promise.all([pic("identity", d.identityImage), ...d.states.map((s) => pic(s.id, s.sheet))]);
      P.data = d;
      P.states = new Map(d.states.map((s) => [s.id, s]));
      P.ready = true;
      P.el.dataset.ready = "1";
    })();
  }
  return P.loading;
}

const shown = () => P.ready && P.el && !P.el.hidden;
const chatting = () => !!P.el?.classList.contains("chatting");

function pick(list) {
  const rest = list.filter((s) => s !== P.said);
  return (P.said = rest[Math.floor(Math.random() * rest.length)]);
}

// 혼잣말 (대화창 없이 잠깐 뜨는 말풍선)
function say(text, ms = 4000) {
  if (!shown()) return;
  P.spoke = performance.now();
  P.bubble.textContent = text;
  setMode("talk", ms);
}

// ---------- 대화 ----------
function toggleChat() {
  if (chatting()) return closeChat();
  if (!shown() || P.mode === "fall" || P.mode === "grab") return;
  P.el.classList.add("chatting");
  P.history = [];
  P.asked.textContent = "";
  P.input.value = "";
  speak(pick(HELLO));
  setTimeout(() => P.input.focus(), 0);
}

function closeChat() {
  if (!chatting()) return;
  P.el.classList.remove("chatting");
  P.ask += 1; // 기다리던 대답은 버림
  P.line = null;
  setBusy(false);
  if (["chat", "think", "speak"].includes(P.mode)) next();
}

function setBusy(b) {
  P.send.disabled = b;
  P.input.readOnly = b;
}

async function ask() {
  const text = P.input.value.trim();
  if (!text || P.send.disabled) return;
  P.input.value = "";
  P.asked.textContent = `나: ${text}`;
  P.answer.replaceChildren(h("span", { class: "pet-dots", "aria-label": "생각 중" }, h("i"), h("i"), h("i")));
  P.answer.dataset.done = "";
  P.line = null;
  setBusy(true);
  setMode("think");
  const id = ++P.ask;
  const messages = [...P.history.slice(-HISTORY), { role: "user", content: text }];
  const { reply, ok } = await request(messages);
  if (id !== P.ask) return; // 그사이 대화창을 닫았음
  if (ok) P.history.push(messages.at(-1), { role: "assistant", content: reply });
  setBusy(false);
  speak(reply);
  P.input.focus();
}

async function request(messages) {
  const ai = P.ctx?.ai;
  if (!ai?.worker_url || !ai.token) return { reply: "지금은 대화 서버가 안 열려 있어… 다음에 얘기하자!" };
  try {
    const r = await fetch(ai.worker_url.replace(/\/$/, "") + "/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ai.token}` },
      body: JSON.stringify({ member: P.ctx.me, messages }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.reply) return { reply: j.reply, ok: true };
    return { reply: j.error || "앗, 지금은 대답이 안 나와… 조금 있다가 다시 물어봐!" };
  } catch {
    return { reply: "앗, 연결이 안 돼… 인터넷을 확인하고 다시 물어봐!" };
  }
}

// 대답을 한 글자씩 보여 주며 말하는 모션. `코드`는 코드 글씨로
function speak(text) {
  const parts = text.split(/(`[^`]+`)/).filter(Boolean)
    .map((s) => (s.length > 2 && s.startsWith("`") && s.endsWith("`") ? { code: true, s: s.slice(1, -1) } : { code: false, s }));
  P.line = { parts, total: parts.reduce((n, p) => n + p.s.length, 0), shown: -1 };
  setMode("speak");
  reveal(calm.matches ? P.line.total : 0);
}

function reveal(n) {
  const line = P.line;
  if (!line || n === line.shown) return;
  line.shown = n;
  let left = n;
  P.answer.replaceChildren(...line.parts.map((p) => {
    const s = p.s.slice(0, Math.max(0, left));
    left -= p.s.length;
    return p.code ? (s ? h("code", {}, s) : "") : s;
  }));
  P.answer.dataset.done = n >= line.total ? "1" : "";
  P.answer.setAttribute("aria-busy", String(n < line.total)); // 화면 낭독기는 다 쓴 뒤에 한 번만 읽음
}

// ---------- 움직임 ----------
function wake() {
  P.input_at = performance.now();
  if (P.mode === "sleep") setMode("jump", JUMP_MS);
}

function setMode(mode, ms = 0, then = null) {
  P.mode = mode;
  P.t0 = performance.now();
  P.until = ms ? P.t0 + ms : 0;
  P.then = then;
  if (!P.el) return;
  P.el.dataset.mode = mode;
  P.el.classList.toggle("talking", mode === "talk");
  P.el.classList.toggle("sleeping", mode === "sleep");
}

// 돌아다니는 구역 [왼쪽 끝, 오른쪽 끝] (문어 칸의 왼쪽 위치 기준)
function zone() {
  if (P.custom) return P.custom;
  if (P.zone?.screen !== P.screen) { // 화면마다 다시 잼 (창 크기가 바뀌면 resize에서 지움)
    const side = document.querySelector(".side")?.getBoundingClientRect();
    const left = side?.width ? side.right : 0;
    const range = P.screen === "home"
      ? [left + 8, Math.max(left + 8, innerWidth - W - 12)]
      : [8, Math.max(8, left - W - 8)];
    P.zone = Object.assign(range, { screen: P.screen });
  }
  return P.zone;
}

function next() {
  if (chatting()) return setMode("chat");
  const [a, b] = zone();
  if (P.x < a || P.x > b) {
    if (!calm.matches) return walkTo(a + Math.random() * (b - a));
    P.x = Math.max(a, Math.min(b, P.x));
    place();
  }
  if (performance.now() - P.spoke > MUTTER_GAP && Math.random() < 0.05) return say(pick(MUTTER));
  if (calm.matches) return setMode("idle", 8000);
  const r = Math.random();
  const t = a + Math.random() * (b - a);
  if (r < 0.5 && Math.abs(t - P.x) > 30) return walkTo(t);
  if (r < 0.9) return setMode("idle", 1800 + Math.random() * 3500);
  setMode("jump", JUMP_MS);
}

function walkTo(x) {
  P.target = x;
  setMode("walk");
}

function hold(cx, cy) {
  P.x = Math.max(0, Math.min(innerWidth - W, cx - W / 2));
  P.y = Math.max(-HANG, Math.min(innerHeight - H - 8, innerHeight - 6 - H - (cy - 8))); // 손가락이 머리 위에 오게
  place();
}

function place() {
  P.el.style.transform = `translate(${Math.round(P.x)}px, ${Math.round(-P.y)}px)`;
  P.el.classList.toggle("flip", P.x > innerWidth - 380); // 오른쪽 끝에서는 말풍선을 왼쪽으로
  P.el.dataset.y = String(Math.round(P.y));
}

function tick(now) {
  const dt = Math.min(now - P.prev, 100) / 1000;
  P.prev = now;
  update(now, dt);
  draw(now);
  P.raf = requestAnimationFrame(tick);
}

function update(now, dt) {
  const m = P.mode;
  if (m === "grab" || m === "chat" || m === "think") return;
  if (m === "speak") {
    reveal(calm.matches ? P.line.total : Math.min(P.line.total, Math.floor((now - P.t0) / TYPE_MS) + 1));
    if (P.line.shown >= P.line.total) setMode("chat");
    return;
  }
  if (m === "fall") {
    P.vy += 2600 * dt;
    P.y = Math.max(-HANG, P.y - P.vy * dt);
    if (P.y === -HANG) { // 매달린 그림의 촉수가 바닥에 닿으면 서 있는 그림으로 착지
      P.y = 0;
      setMode("jump", JUMP_MS);
    }
    return place();
  }
  if (m === "walk") {
    const [a, b] = zone();
    if (P.target < a - 1 || P.target > b + 1) return next(); // 화면이 바뀌어 옛 구역으로 가던 중이면 다시 정함
    const d = P.target - P.x;
    P.x += Math.sign(d) * Math.min(Math.abs(d), (P.x >= a && P.x <= b ? WALK : RUSH) * dt);
    place();
    if (Math.abs(P.target - P.x) < 0.5) return setMode("idle", 1200 + Math.random() * 2500);
  }
  if ((m === "idle" || m === "walk") && now - P.input_at > SLEEP_AFTER && !calm.matches) return setMode("sleep");
  if (P.until && now >= P.until) {
    const then = P.then;
    if (then) then();
    else next();
  }
}

// 프레임 고르기: Codex 재생기(output/mascot/octopus15_motion_v01/motion_player.js)의 cycle과 같은 규칙
function cycle(s, time) {
  const phase = (((time % s.duration) + s.duration) % s.duration) / s.duration;
  if (s.id === "02_jump") {
    const frame = phase < 0.45 || phase >= 0.9 ? -1 : phase < 0.55 ? 0 : phase < 0.67 ? 1 : phase < 0.78 ? 2 : 3;
    const arc = (phase - 0.52) / 0.32;
    return { frame, phase, lift: arc >= 0 && arc <= 1 ? -Math.sin(Math.PI * arc) * 0.14 : 0 };
  }
  if (s.id === "03_sleepy") return { frame: phase < 0.23 ? 0 : phase < 0.45 ? 1 : phase < 0.73 ? 2 : 3, phase, lift: 0 };
  return { frame: Math.min(3, Math.floor(phase * 4)), phase, lift: 0 };
}

// chat(듣는 중)·think(생각 중)는 기본 그림. think는 고개를 갸웃, speak는 말하기 그림을 빨리 넘기며 몸을 통통 튕김
const ART = { walk: "01_squirm", jump: "02_jump", sleep: "03_sleepy", talk: "04_talk", speak: "04_talk", grab: "05_grabbed", fall: "05_grabbed" };

function draw(now) {
  const id = ART[P.mode];
  const s = id && P.states.get(id);
  const still = calm.matches;
  const age = now - P.t0;
  const t = still ? 0 : (age + (id === "02_jump" ? JUMP_SKIP : 0)) * (P.mode === "speak" ? 2 : 1);
  const c = s ? cycle(s, t) : { frame: -1, phase: 0, lift: 0 };
  const f = c.frame < 0 ? P.data.identityFrame : s.frames[c.frame];
  const k = SIZE / (c.frame < 0 ? f.sh : s.referenceHeight);
  const sway = id === "01_squirm" ? Math.sin(c.phase * 2 * Math.PI) * SIZE * 0.025 : 0;
  const tilt = still ? 0 : id === "05_grabbed" ? Math.sin(c.phase * 2 * Math.PI) * 0.065
    : P.mode === "think" ? Math.sin(age / 420) * 0.08 : 0;
  const squash = still || P.mode !== "speak" ? 0 : Math.abs(Math.sin(age / 95)) * 0.04;
  const dpr = devicePixelRatio || 1;
  const key = `${id}|${c.frame}|${c.lift.toFixed(3)}|${sway.toFixed(1)}|${tilt.toFixed(3)}|${squash.toFixed(3)}|${dpr}`;
  if (key === P.drawn) return; // 같은 그림이면 다시 그리지 않음 (가만히 있을 때 CPU 아낌)
  P.drawn = key;
  if (P.cv.width !== Math.round(W * dpr)) {
    P.cv.width = Math.round(W * dpr);
    P.cv.height = Math.round(H * dpr);
  }
  const g = P.cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  const img = P.img.get(c.frame < 0 ? "identity" : id);
  if (id === "05_grabbed") { // 머리 위를 잡힌 채 흔들림
    g.translate(W / 2, 6);
    g.rotate(tilt);
    g.drawImage(img, f.sx, f.sy, f.sw, f.sh, -(f.anchorX - f.sx) * k, 0, f.sw * k, f.sh * k);
  } else { // 발밑 가운데를 기준으로 기울이고 눌렀다 폄
    g.translate(W / 2 + sway, H - 2 + c.lift * SIZE);
    g.rotate(tilt);
    g.scale(1 + squash / 2, 1 - squash);
    g.drawImage(img, f.sx, f.sy, f.sw, f.sh, -(f.sw * k) / 2, -f.sh * k, f.sw * k, f.sh * k);
  }
  P.el.dataset.frame = String(c.frame);
}
