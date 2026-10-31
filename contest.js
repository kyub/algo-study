// 실전: 사이드바 '실전 회차'(다같이, 진행자가 시작)와 주차 탭 '실전'(회차가 끝난 뒤 각자 복습).
// 회차 상태·시간·제출 기록은 피드백 서버(/contest/*)에 있고, 화면은 4초마다 서버와 맞춘다.
import { h, st, pad } from "./ui.js?v=de51c78c31";
import { problemView, statusPill } from "./practice.js?v=de51c78c31";

const POLL_MS = 4000;
const LETTERS = "ABCDE";
const STATUS = { ready: "대기", running: "진행 중", ended: "끝남" };
const LAST = { start: "시작", end: "종료", extend: "시간 연장", goto: "회차 이동", "time-up": "시간 종료(자동)" };
export const live = { snap: null, offset: 0, listeners: new Set() };
const serverNow = () => Date.now() + live.offset;
const sessionOf = (snap, n) => snap?.state.sessions[n];
const statusOf = (snap, n) => sessionOf(snap, n)?.status || "ready";
const deadline = (x) => x.started_at + x.minutes * 60000;
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${hh ? `${hh}:${pad(mm)}` : mm}:${pad(s % 60)}`;
}

async function call(ctx, path, body) {
  const init = { headers: { authorization: `Bearer ${ctx.ai.token}` } };
  if (body) {
    init.method = "POST";
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await fetch(ctx.ai.worker_url.replace(/\/$/, "") + path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `서버 오류 (${r.status})`), { data: j });
  return j;
}

// 서버 시계와의 차이를 왕복 시간의 절반으로 보정해 저장
function accept(snap, t0, t1) {
  if (!snap?.state) return;
  live.snap = snap;
  live.offset = snap.now - (t0 + t1) / 2;
  for (const f of live.listeners) f(snap);
}

export async function refresh(ctx) {
  if (!ctx.ai?.worker_url) throw new Error("실전 서버가 연결되지 않았습니다.");
  const t0 = Date.now();
  const snap = await call(ctx, "/contest/sync", { member: ctx.me });
  accept(snap, t0, Date.now());
  return snap;
}

export function sidebarLabel(snap) {
  if (!snap) return "확인 중";
  const n = snap.state.current_week;
  return `${n}주차 · ${STATUS[statusOf(snap, n)]}`;
}

// 화면이 바뀌면 스스로 멈추는 반복 작업
function every(ctx, ms, f) {
  const view = ctx.viewId();
  const id = setInterval(() => (ctx.viewId() === view ? f() : clearInterval(id)), ms);
}

function problemsOf(w) {
  const byId = Object.fromEntries((w.contest || []).map((p) => [p.id, p]));
  return (w.session?.problems || []).map((id) => byId[id]).filter(Boolean);
}

// ===================== 실전 회차 (다같이) =====================
export function contestPage(ctx, wn, pid) {
  const root = h("div", { class: "wrap wide" });
  let key = null;
  let liveEls = {};

  const keyOf = (snap) => {
    const n = wn || snap.state.current_week;
    return `${n}|${statusOf(snap, n)}|${sessionOf(snap, n)?.run || ""}`;
  };

  function render() {
    const snap = live.snap;
    if (!snap) return root.replaceChildren(h("p", { class: "muted" }, "실전 회차 정보를 불러오는 중…"));
    const n = wn || snap.state.current_week;
    const w = ctx.week(n);
    const sess = sessionOf(snap, n);
    const status = statusOf(snap, n);
    key = keyOf(snap);
    // 진행 중인 회차는 주차가 고정된 주소로 (끝난 뒤에도 그 회차 결과가 보이게)
    if (!wn && status === "running") {
      location.hash = `#/contest/${n}`;
      return;
    }
    const probs = problemsOf(w);
    const minutes = sess?.minutes || w.session?.minutes || 0;
    liveEls = { online: h("div", { class: "online" }) };
    const head = h("div", { class: "head" }, h("span", { class: "badge" }, pad(n)),
      h("div", {}, h("h1", {}, `${n}주차 실전 회차`),
        h("div", { class: "muted small" }, `${w.title} · 문제 ${probs.length}개 · 제한 ${minutes}분 · 다같이 동시에 시작`)),
      h("span", { class: "spacer" }), h("span", { class: `pill ${status === "running" ? "" : status === "ended" ? "green" : "gray"}` }, STATUS[status]));
    const parts = [head, liveEls.online];
    if (ctx.me === snap.controller) parts.push(controls(n, w, sess, status, probs));
    if (!probs.length) {
      parts.push(h("div", { class: "card soft" }, h("h3", {}, "이 주차 실전 회차 문제는 아직 준비 중입니다."),
        h("p", { class: "muted" }, "문제가 준비되면 진행자가 시작할 수 있습니다.")));
    } else if (status === "ready") {
      parts.push(lobby(probs, minutes, snap.controller));
    } else if (status === "running") {
      parts.push(...running(n, w, sess, probs));
    } else {
      parts.push(results(n, w, sess, probs));
    }
    parts.push(pastList(snap, n));
    root.replaceChildren(...parts.filter(Boolean));
    updateLive();
  }

  function updateLive() {
    const snap = live.snap;
    if (!snap) return;
    const online = new Set(snap.online);
    liveEls.online?.replaceChildren(h("span", { class: "muted small" }, "접속"),
      ...ctx.members.map((m) => h("span", { class: `who-dot ${online.has(m) ? "on" : ""}` }, m)));
    const n = wn || snap.state.current_week;
    const sess = sessionOf(snap, n);
    if (liveEls.remain && sess?.status === "running") {
      const left = deadline(sess) - serverNow();
      liveEls.remain.textContent = clock(left);
      liveEls.timer.classList.toggle("hurry", left < 5 * 60000);
      liveEls.bar.style.width = `${Math.min(100, Math.max(0, 100 * (1 - left / (sess.minutes * 60000))))}%`;
    }
  }

  async function act(n, action, extra = {}, question = "") {
    if (question && !confirm(question)) return;
    const t0 = Date.now();
    try {
      accept(await call(ctx, "/contest/action", { member: ctx.me, rev: live.snap.rev, action, week: n, ...extra }), t0, Date.now());
    } catch (e) {
      alert(e.message);
      accept(e.data, t0, Date.now());
    }
    if (action === "goto" || action === "undo") location.hash = "#/contest";
    ctx.rerender();
  }

  function controls(n, w, sess, status, probs) {
    const snap = live.snap;
    const minutesBox = h("input", { type: "number", min: "10", max: "300", value: String(w.session?.minutes || 90), class: "num", "aria-label": "제한 시간(분)" });
    const btn = (label, onclick, cls = "btn", disabled = false) => h("button", { class: cls, type: "button", onclick, disabled }, label);
    const main = status === "ready"
      ? [h("label", { class: "small" }, "제한 ", minutesBox, " 분"),
        btn("▶ 시작", () => act(n, "start", { minutes: Number(minutesBox.value), problems: w.session.problems },
          `${n}주차 실전 회차를 시작할까요?\n모두의 화면에서 ${minutesBox.value}분 타이머가 동시에 시작되고 문제가 열립니다.`), "btn primary", !probs.length)]
      : status === "running"
        ? [btn("+10분", () => act(n, "extend", { minutes: 10 }, "제한 시간을 10분 늘릴까요?")),
          btn("■ 지금 종료", () => act(n, "end", {}, `지금 끝낼까요?\n결과와 코드가 공개되고, 실전 회차가 ${Math.min(n + 1, 6)}주차로 넘어갑니다.`), "btn danger")]
        : [btn("다시 열기 (+10분)", () => act(n, "extend", { minutes: 10 }, "끝난 회차를 10분 다시 열까요? (제출을 더 받을 수 있게 됩니다)"))];
    const last = snap.last ? `${LAST[snap.last.action] || snap.last.action} (${snap.last.by})` : "";
    return h("div", { class: "controls" },
      h("span", { class: "pill" }, "진행자 전용"), ...main, h("span", { class: "spacer" }),
      btn("← 이전 회차", () => act(n - 1, "goto", {}, `실전 회차를 ${n - 1}주차로 옮길까요?`), "btn", n <= 1),
      btn("다음 회차 →", () => act(n + 1, "goto", {}, `실전 회차를 ${n + 1}주차로 옮길까요?`), "btn", n >= 6),
      btn("↶ 되돌리기", () => act(n, "undo", {}, `마지막 조작을 취소할까요?\n마지막 조작: ${last}`), "btn", !snap.rev));
  }

  function lobby(probs, minutes, host) {
    return h("div", { class: "card soft lobby" },
      h("h3", {}, `문제 ${probs.length}개 · 제한 ${minutes}분`),
      h("div", { class: "slots" }, probs.map((_, i) => h("div", { class: "slot" }, h("span", { class: "badge sm" }, LETTERS[i]), "시작하면 공개"))),
      h("p", { class: "muted" }, `진행자(${host})가 시작하면 모두의 화면에서 동시에 문제가 열리고 타이머가 돌아갑니다. `,
        "진행 중에는 채점 결과만 보이고, AI 피드백과 서로의 코드는 끝난 뒤에 공개됩니다."));
  }

  function running(n, w, sess, probs) {
    const cur = probs.find((p) => p.id === pid) || probs[0];
    const stateKey = `algo.cstat.${ctx.me}.${sess.run}`;
    const state = st.json(stateKey, {});
    liveEls.remain = h("strong", { class: "remain" });
    liveEls.bar = h("i");
    liveEls.timer = h("div", { class: "ctimer" }, h("span", {}, "남은 시간"), liveEls.remain, h("div", { class: "cbar" }, liveEls.bar));
    const tabs = h("div", { class: "ctabs" }, probs.map((p, i) => h("a", { href: `#/contest/${n}/${p.id}`, class: p.id === cur.id ? "active" : null },
      h("span", { class: "badge sm" }, LETTERS[i]), p.title, statusPill(state[p.id]))));
    const view = problemView(ctx, w, cur, {
      list: probs, base: `#/contest/${n}`, hideNav: true, showOfficial: false,
      codeKey: `algo.cc.${ctx.me}.${sess.run}.${cur.id}`, stateKey,
      feedback: "실전 회차가 끝나면 AI 피드백과 서로의 코드가 공개됩니다.",
      onGraded: async (res, code, head) => {
        const note = h("p", { class: "muted small" }, "서버에 기록하는 중…");
        head.after(note);
        try {
          await call(ctx, "/contest/submit", { member: ctx.me, week: n, run: sess.run, pid: cur.id, code, passed: res.passed, total: res.total });
          note.textContent = "제출이 기록되었습니다. (점수는 가장 높은 제출, 코드는 마지막 제출로 공개)";
        } catch (e) {
          note.className = "error small";
          note.textContent = e.message;
        }
        tabs.replaceChildren(...probs.map((p, i) => h("a", { href: `#/contest/${n}/${p.id}`, class: p.id === cur.id ? "active" : null },
          h("span", { class: "badge sm" }, LETTERS[i]), p.title, statusPill(st.json(stateKey, {})[p.id]))));
      },
    });
    return [liveEls.timer, tabs, view];
  }

  function results(n, w, sess, probs) {
    const box = h("div", { class: "stack" }, h("p", { class: "muted" }, "결과를 불러오는 중…"));
    call(ctx, `/contest/results?week=${n}`).then((r) => {
      const rows = r.members.map((m) => {
        const cells = probs.map((p) => r.table[m]?.[p.id]);
        const solved = cells.filter((c) => c?.solved_ms != null);
        return { m, cells, solved: solved.length, time: solved.reduce((s, c) => s + c.solved_ms, 0) };
      }).sort((a, b) => b.solved - a.solved || a.time - b.time);
      const cell = (c) => (c?.solved_ms != null ? h("td", { class: "ok" }, `✓ ${clock(c.solved_ms)}`)
        : c ? h("td", { class: "no" }, `${c.best}/${c.total}`) : h("td", { class: "none" }, "–"));
      const table = h("table", { class: "rtable" },
        h("thead", {}, h("tr", {}, h("th", {}, "구성원"), ...probs.map((p, i) => h("th", {}, `${LETTERS[i]}. ${p.title}`)), h("th", {}, "통과"))),
        h("tbody", {}, rows.map((row) => h("tr", {}, h("td", {}, row.m), ...row.cells.map(cell), h("td", {}, `${row.solved}/${probs.length}`)))));
      const codes = probs.map((p, i) => h("details", { class: "codecmp" },
        h("summary", {}, `${LETTERS[i]}. ${p.title} — 코드 비교`),
        h("div", { class: "links small" },
          p.link && h("a", { href: p.link, target: "_blank", rel: "noopener noreferrer" }, "원문 문제"),
          p.official && h("a", { href: p.official, target: "_blank", rel: "noopener noreferrer" }, "저자 공식 풀이"),
          h("a", { href: `#/week/${n}/contest/${p.id}` }, "복습하며 다시 풀기 · AI 피드백 →")),
        h("div", { class: "cgrid" }, r.members.map((m) => {
          const c = r.table[m]?.[p.id];
          return h("div", {}, h("div", { class: "small" }, h("strong", {}, m), " · ", c ? (c.solved_ms != null ? `통과 ${clock(c.solved_ms)}` : `${c.best}/${c.total}`) : "제출 없음"),
            c?.code ? h("pre", { class: "code" }, c.code) : h("p", { class: "muted small nocode" }, "제출한 코드가 없습니다."));
        }))));
      const took = clock((sess.ended_at || deadline(sess)) - sess.started_at);
      box.replaceChildren(h("div", { class: "card" }, h("h3", {}, `결과 · 진행 ${took}`), table,
        h("p", { class: "muted small" }, "✓ 옆 시간은 시작부터 처음 모두 통과한 제출까지 걸린 시간입니다. 숫자는 가장 높은 통과 수입니다.")),
      ...codes,
      h("p", { class: "muted small" }, h("a", { href: `#/week/${n}/contest` }, `${n}주차 실전 탭`), "에서 모든 실전 문제를 각자 시간을 재며 복습할 수 있습니다. AI 피드백도 그곳에서 받습니다."));
    }, (e) => box.replaceChildren(h("p", { class: "error" }, e.message)));
    return box;
  }

  function pastList(snap, n) {
    const ended = Object.entries(snap.state.sessions).filter(([k, x]) => x.status === "ended" && Number(k) !== n).map(([k]) => Number(k));
    if (!ended.length) return null;
    return h("p", { class: "small muted" }, "지난 회차 결과: ", ...ended.flatMap((k, i) => [i ? " · " : "", h("a", { href: `#/contest/${k}` }, `${k}주차`)]));
  }

  render();
  const poll = async () => {
    try {
      await refresh(ctx);
    } catch {
      return; // 잠깐 끊겨도 다음 번에 다시 시도
    }
    if (keyOf(live.snap) !== key) render();
    else updateLive();
  };
  poll();
  every(ctx, POLL_MS, poll);
  every(ctx, 1000, updateLive);
  return root;
}

// ===================== 주차별 실전 복습 (각자) =====================
const reviewKey = (me) => `algo.rstate.${me}`;

function gate(ctx, w, build) {
  const box = h("div", { class: "stack" });
  const show = () => {
    const snap = live.snap;
    if (!(w.contest || []).length) return box.replaceChildren(h("div", { class: "card soft" }, h("h3", {}, "실전 문제 준비 중"),
      h("p", { class: "muted" }, "이 주차의 교재 기출 문제를 정리하면 열립니다.")));
    if (!snap) return box.replaceChildren(h("p", { class: "muted" }, "실전 회차 상태를 확인하는 중…"));
    if (statusOf(snap, w.n) !== "ended") {
      return box.replaceChildren(h("div", { class: "card soft" }, h("h3", {}, "다같이 하는 실전 회차가 끝나면 열립니다."),
        h("p", { class: "muted" }, `${w.n}주차 실전 문제 ${w.contest.length}개는 실전 회차(사이드바)를 마친 뒤 여기에서 각자 시간을 재며 풀 수 있습니다. `,
          "회차에 참여하지 못한 사람도 이곳에서 같은 문제를 풀 수 있습니다."),
        h("a", { class: "btn", href: "#/contest" }, "실전 회차로 가기")));
    }
    box.replaceChildren(build());
  };
  show();
  // 갖고 있던 상태로 먼저 보여 주고, 서버에서 최신 상태를 받아 잠김 여부가 바뀌었을 때만 다시 그림
  const before = live.snap && statusOf(live.snap, w.n);
  refresh(ctx).then(() => { if (!before || statusOf(live.snap, w.n) !== before) show(); },
    () => { if (!live.snap) box.replaceChildren(h("p", { class: "error" }, "실전 서버에 연결하지 못했습니다. 새로고침해 주세요.")); });
  return box;
}

export function reviewList(ctx, w) {
  return gate(ctx, w, () => {
    const state = st.json(reviewKey(ctx.me), {});
    const inSession = new Set(w.session?.problems || []);
    const solved = w.contest.filter((p) => state[p.id]?.solved).length;
    return h("div", { class: "stack" },
      h("p", { class: "muted small" }, `교재 기출 ${w.contest.length}문제입니다. 문제를 열면 타이머가 돌아가고, 목표 시간과 비교할 수 있습니다. `,
        `★는 실전 회차에서 다같이 푼 문제입니다. (${ctx.me}: ${solved}/${w.contest.length} 통과)`),
      h("div", { class: "plist" }, w.contest.map((p, k) => h("a", { class: "item", href: `#/week/${w.n}/contest/${p.id}` },
        h("span", { class: "badge sm ghost" }, k + 1), h("span", { class: "t" }, inSession.has(p.id) ? "★ " : "", p.title),
        h("span", { class: "pill" }, p.tag), p.kind === "function" ? h("span", { class: "pill gray" }, "함수") : null,
        h("span", { class: "muted small" }, `목표 ${p.minutes}분`), statusPill(state[p.id])))));
  });
}

export function reviewProblem(ctx, w, p) {
  return gate(ctx, w, () => {
    const me = ctx.me;
    const startKey = `algo.rtimer.${me}.${p.id}`;
    if (!st.get(startKey)) st.set(startKey, String(Date.now()));
    const shown = h("strong", {});
    const bar = h("div", { class: "rtimer" }, h("span", {}, "⏱ 경과"), shown, h("span", { class: "muted" }, `/ 목표 ${p.minutes}분`),
      h("span", { class: "spacer" }),
      h("button", { class: "btn tiny", type: "button", onclick: () => { st.set(startKey, String(Date.now())); tick(); } }, "타이머 다시 시작"));
    const tick = () => {
      const solved = st.json(reviewKey(me), {})[p.id];
      const ms = Date.now() - Number(st.get(startKey) || Date.now());
      shown.textContent = solved?.time ? `통과 ${solved.time}` : clock(ms);
      bar.classList.toggle("over", !solved?.time && ms > p.minutes * 60000);
      bar.classList.toggle("done", !!solved?.time);
    };
    tick();
    every(ctx, 1000, tick);
    return problemView(ctx, w, p, {
      list: w.contest, base: `#/week/${w.n}/contest`, top: bar, showOfficial: true,
      codeKey: `algo.rcode.${me}.${p.id}`, stateKey: reviewKey(me), fbKey: `algo.rfb.${me}.${p.id}`,
      onGraded: (res) => {
        if (res.passed !== res.total) return;
        const state = st.json(reviewKey(me), {});
        if (!state[p.id].time) {
          state[p.id].time = clock(Date.now() - Number(st.get(startKey)));
          st.set(reviewKey(me), JSON.stringify(state));
        }
        tick();
      },
    });
  });
}
