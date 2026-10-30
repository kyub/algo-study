// 연습문제: 목록, 풀이 화면(편집기·실행·채점), AI 피드백 요청.
import { h, st, sec } from "./ui.js?v=65d0ba1b42";
import { grade } from "./runner.js?v=65d0ba1b42";

const RUN_LIMIT = 10; // '실행' 버튼 한 번의 시간 제한(초)
const STARTER = "# 여기에 풀이를 작성하세요. 입력은 input(), 출력은 print()를 씁니다.\n";
const cut = (s, n) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n}자 생략)` : s);
const stateKey = (me) => `algo.state.${me}`;

function statusPill(s) {
  if (s?.solved) return h("span", { class: "pill green" }, "통과");
  if (s?.tried) return h("span", { class: "pill yellow" }, `도전 중 · 최고 ${s.best}`);
  return h("span", { class: "pill gray" }, "안 풂");
}

export function practiceList(ctx, w) {
  const items = w.practice || [];
  if (!items.length) return h("p", { class: "muted" }, "이 주차의 연습문제는 강의자료와 함께 정리됩니다.");
  const state = st.json(stateKey(ctx.me), {});
  const solved = items.filter((p) => state[p.id]?.solved).length;
  return h("div", { class: "stack" },
    h("p", { class: "muted small" },
      `영상에 나온 문제 ${items.length}개입니다. 브라우저 안에서 Python을 실행하고, 제출하면 채점과 AI 피드백이 나옵니다. `,
      `코드와 기록은 이 기기에 저장됩니다. (${ctx.me}: ${solved}/${items.length} 통과)`),
    h("div", { class: "plist" }, items.map((p, k) => h("a", { class: "item", href: `#/week/${w.n}/practice/${p.id}` },
      h("span", { class: "badge sm ghost" }, k + 1), h("span", { class: "t" }, p.title),
      h("span", { class: "pill" }, p.tag), statusPill(state[p.id])))));
}

export function statementText(p) {
  const ex = p.examples.map((e, i) => `예제 ${i + 1} 입력:\n${e.input}예제 ${i + 1} 출력:\n${e.output}`).join("\n");
  return cut([...p.story, "[입력]", ...p.input, "[출력]", ...p.output, "[제한]", ...p.limits, ex].join("\n"), 4800);
}

export async function requestFeedback(ai, member, p, code, summary) {
  const r = await fetch(ai.worker_url.replace(/\/$/, "") + "/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ai.token}` },
    body: JSON.stringify({ member, problem: { title: p.title, statement: statementText(p) }, code, result: summary }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `피드백 서버 오류 (${r.status})`);
  return j;
}

// **굵게**, `코드`만 지원하는 안전한 표시 (HTML로 해석하지 않음)
function richText(text) {
  return text.split("\n").map((line) => {
    if (!line.trim()) return h("div", { class: "gap" });
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((s) =>
      s.startsWith("**") ? h("strong", {}, s.slice(2, -2)) : s.startsWith("`") ? h("code", {}, s.slice(1, -1)) : s);
    return h("p", {}, parts);
  });
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function summarize(p, tests, res) {
  if (res.passed === res.total) return `채점: 모두 통과 (${res.total}/${res.total}). 가장 오래 걸린 테스트 ${sec(res.maxTime)}.`;
  const bad = res.results.find((r) => r.status !== "pass");
  const kind = { wrong: "오답", error: "실행 중 오류", timeout: `시간 초과(${p.time_limit}초)` }[bad.status];
  const t = tests[bad.i];
  const lines = [`채점: ${res.passed}/${res.total} 통과. 처음 실패: ${bad.i < p.examples.length ? "예제" : "테스트"} ${bad.i + 1} (${kind}).`,
    `입력:\n${cut(t.input, 300)}`];
  if (bad.status === "wrong") lines.push(`기대 출력:\n${cut(t.output, 200)}`, `실제 출력:\n${cut(bad.out, 200)}`);
  if (bad.status === "error") lines.push(`오류:\n${cut(bad.err, 600)}`);
  if (res.results.length < res.total) lines.push("시간 초과로 나머지 테스트는 실행하지 않음.");
  return cut(lines.join("\n"), 1900);
}

export function problemView(ctx, w, p) {
  const me = ctx.me;
  const codeKey = `algo.code.${me}.${p.id}`;
  const fbKey = `algo.fb.${me}.${p.id}`;
  const idx = w.practice.findIndex((x) => x.id === p.id);
  const prev = w.practice[idx - 1];
  const next = w.practice[idx + 1];

  // ----- 아래 결과 영역 (입력 / 실행 결과 / 채점 결과 / AI 피드백) -----
  const inputBox = h("textarea", { class: "stdin", spellcheck: "false", "aria-label": "표준 입력" });
  inputBox.value = p.examples[0]?.input || "";
  const outBox = h("pre", { class: "term" }, "▶ 실행을 누르면 입력 탭의 값을 넣어 실행합니다. (Ctrl+Enter)");
  const gradeBox = h("div", { class: "gradebox" }, h("p", { class: "muted" }, "제출하면 모든 테스트로 채점하고 AI 피드백을 받습니다. (Ctrl+Shift+Enter)"));
  const fbBox = h("div", { class: "fbbox" }, h("p", { class: "muted" }, "제출하면 AI 코치(Claude)의 피드백이 여기에 나옵니다."));
  const panes = { input: inputBox, out: outBox, grade: gradeBox, fb: fbBox };
  const tabBtns = {};
  const paneHost = h("div", { class: "pane" });
  const tabsBar = h("div", { class: "rtabs" });
  const showTab = (k, scroll = false) => {
    paneHost.replaceChildren(panes[k]);
    if (scroll) tabsBar.scrollIntoView({ block: "nearest", behavior: "smooth" });
    for (const [key, b] of Object.entries(tabBtns)) b.classList.toggle("active", key === k);
    if (k === "fb") tabBtns.fb.classList.remove("new");
  };
  for (const [k, label] of [["input", "입력"], ["out", "실행 결과"], ["grade", "채점 결과"], ["fb", "AI 피드백"]]) {
    tabBtns[k] = h("button", { type: "button", onclick: () => showTab(k) }, label);
  }
  tabsBar.append(...Object.values(tabBtns));

  // ----- 편집기 -----
  const host = h("div", { class: "editor" });
  const initial = st.get(codeKey) ?? STARTER;
  let editor;
  if (window.CodeMirror) {
    const cm = window.CodeMirror(host, {
      value: initial, mode: "python", theme: "algo", lineNumbers: true, indentUnit: 4, tabSize: 4,
      indentWithTabs: false, matchBrackets: true,
      extraKeys: {
        Tab: (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection("    ", "end")),
        "Shift-Tab": (c) => c.indentSelection("subtract"),
        "Ctrl-Enter": () => run(), "Cmd-Enter": () => run(),
        "Shift-Ctrl-Enter": () => submit(), "Shift-Cmd-Enter": () => submit(),
      },
    });
    setTimeout(() => cm.refresh(), 0);
    editor = { get: () => cm.getValue(), set: (v) => cm.setValue(v), onChange: (f) => cm.on("change", f) };
  } else {
    const ta = h("textarea", { class: "plain-editor", spellcheck: "false" });
    ta.value = initial;
    host.append(ta);
    editor = { get: () => ta.value, set: (v) => { ta.value = v; }, onChange: (f) => ta.addEventListener("input", f) };
  }
  let saveTimer;
  editor.onChange(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => st.set(codeKey, editor.get()), 400);
  });

  const status = h("span", { class: "rstatus" }, "Python 준비 전");
  const runBtn = h("button", { class: "btn", type: "button", onclick: () => run() }, "▶ 실행");
  const submitBtn = h("button", { class: "btn primary", type: "button", onclick: () => submit() }, "제출");
  const resetBtn = h("button", {
    class: "btn ghost", type: "button",
    onclick: () => { if (confirm("작성한 코드를 지우고 처음 코드로 돌릴까요?")) editor.set(STARTER); },
  }, "처음 코드로");
  let busy = false;
  const setBusy = (b) => { busy = b; runBtn.disabled = b; submitBtn.disabled = b; };

  ctx.runner.onstate = (s, version) => {
    status.textContent = { loading: "Python 불러오는 중… (처음 한 번은 10초쯤)", ready: `Python 준비됨${version ? ` (Pyodide ${version})` : ""}`, error: "Python을 불러오지 못했습니다" }[s];
    status.className = `rstatus ${s}`;
  };
  if (ctx.runner.ready) ctx.runner.ready.then(() => ctx.runner.onstate?.("ready", ctx.runner.version), () => {});
  ctx.runner.start().catch(() => {});

  async function run() {
    if (busy) return;
    setBusy(true);
    showTab("out", true);
    outBox.textContent = "실행 중…";
    try {
      const [r] = await ctx.runner.exec(editor.get(), [inputBox.value], RUN_LIMIT);
      const tail = r.status === "timeout" ? `시간 초과: ${RUN_LIMIT}초 안에 끝나지 않았습니다. 무한 반복이 없는지 확인해 보세요.` : `(실행 시간 ${sec(r.time)})`;
      outBox.replaceChildren(h("span", { class: "prompt" }, "$ python solution.py < 입력"), "\n",
        cut(r.out, 20000), r.err ? h("span", { class: "err" }, r.err) : "", h("span", { class: "meta" }, (r.out.endsWith("\n") || !r.out ? "" : "\n") + tail));
    } catch (e) {
      outBox.textContent = `Python을 불러오지 못했습니다: ${e.message}\n인터넷 연결을 확인하고 새로고침해 주세요.`;
    }
    setBusy(false);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    showTab("grade", true);
    const code = editor.get();
    st.set(codeKey, code);
    gradeBox.replaceChildren(h("p", { class: "muted" }, "테스트를 불러오는 중…"));
    let tests;
    try {
      tests = await ctx.loadTests(p);
    } catch {
      gradeBox.replaceChildren(h("p", { class: "error" }, "테스트를 불러오지 못했습니다. 새로고침해 주세요."));
      setBusy(false);
      return;
    }
    const labels = { pass: "통과", wrong: "오답", error: "오류", timeout: "시간 초과" };
    const rows = tests.map((_, i) => h("div", { class: "trow" },
      h("span", { class: "tn" }, i < p.examples.length ? `예제 ${i + 1}` : `테스트 ${i + 1}`), h("span", { class: "ts" }, "대기"), h("span", { class: "tt" })));
    const head = h("div", { class: "gsum" }, `채점 중… (테스트 ${tests.length}개)`);
    gradeBox.replaceChildren(head, h("div", { class: "tlist" }, rows));
    let res;
    try {
      res = await grade(ctx.runner, code, tests, p.time_limit, (r) => {
        const row = rows[r.i];
        row.className = `trow ${r.status}`;
        row.children[1].textContent = labels[r.status];
        row.children[2].textContent = r.status === "timeout" ? "" : r.time < 0.01 ? "<0.01초" : `${r.time.toFixed(2)}초`;
      });
    } catch (e) {
      head.textContent = `Python을 불러오지 못했습니다: ${e.message}`;
      setBusy(false);
      return;
    }
    rows.slice(res.results.length).forEach((row) => { row.children[1].textContent = "실행 안 함"; });
    const ok = res.passed === res.total;
    head.className = `gsum ${ok ? "pass" : "fail"}`;
    head.textContent = ok ? `모두 통과 ✓ ${res.total}/${res.total} · 가장 오래 걸린 테스트 ${sec(res.maxTime)}` : `${res.passed}/${res.total} 통과`;
    const bad = res.results.find((r) => r.status !== "pass");
    if (bad) {
      const t = tests[bad.i];
      const box = h("div", { class: "fail-detail" },
        h("strong", {}, `처음 실패: ${rows[bad.i].children[0].textContent} · ${labels[bad.status]}`),
        h("div", { class: "muted small" }, "입력"), h("pre", {}, cut(t.input, 400)));
      if (bad.status === "wrong") box.append(h("div", { class: "muted small" }, "기대 출력"), h("pre", {}, cut(t.output, 400)), h("div", { class: "muted small" }, "내 출력"), h("pre", {}, cut(bad.out, 400) || "(출력 없음)"));
      if (bad.status === "error") box.append(h("div", { class: "muted small" }, "오류"), h("pre", { class: "err" }, cut(bad.err, 1200)));
      if (bad.status === "timeout") box.append(h("p", { class: "muted small" }, `${p.time_limit}초 안에 끝나지 않았습니다. 더 빠른 방법이나 무한 반복을 확인해 보세요.`));
      head.after(box);
    }
    const state = st.json(stateKey(me), {});
    const prevState = state[p.id] || {};
    const bestPassed = Math.max(res.passed, prevState.bestPassed || 0);
    state[p.id] = { tried: true, solved: prevState.solved || ok, bestPassed, best: `${bestPassed}/${res.total}`, at: Date.now() };
    st.set(stateKey(me), JSON.stringify(state));
    setBusy(false);
    feedback(code, summarize(p, tests, res));
  }

  function renderFeedback(j, cached) {
    const meta = `이번 달 사용 $${j.month_usd} / $${j.limit_usd} · 오늘 내 사용 ${j.today?.[me] ?? "?"}/${j.daily_per_member}회`;
    const parts = [h("div", { class: "fb-text" }, richText(j.feedback)),
      j.truncated && h("p", { class: "muted small" }, "(피드백이 길어 일부가 잘렸습니다)"),
      h("p", { class: "muted small fb-meta" }, cached ? `같은 코드로 받은 이전 피드백입니다. · ${meta}` : meta)];
    fbBox.replaceChildren(...parts.filter(Boolean)); // replaceChildren은 null을 "null" 글자로 넣으므로 걸러 냄
    tabBtns.fb.classList.add("new");
  }

  async function feedback(code, summary) {
    const ai = ctx.ai;
    if (!ai?.worker_url || !ai.token) {
      fbBox.replaceChildren(h("p", { class: "muted" }, "AI 피드백 서버가 아직 연결되지 않았습니다."));
      return;
    }
    const hash = await sha256hex(`${code}\u0000${summary}`);
    const cached = st.json(fbKey, null);
    if (cached?.hash === hash) return renderFeedback(cached.data, true);
    fbBox.replaceChildren(h("p", { class: "muted" }, "AI 피드백을 받는 중… (보통 10~30초)"));
    tabBtns.fb.classList.add("new");
    try {
      const j = await requestFeedback(ai, me, p, code, summary);
      st.set(fbKey, JSON.stringify({ hash, data: j }));
      renderFeedback(j, false);
    } catch (e) {
      fbBox.replaceChildren(h("p", { class: "error" }, e.message), h("p", { class: "muted small" }, "채점 결과는 그대로 유효합니다."));
    }
  }

  const cachedFb = st.json(fbKey, null);
  if (cachedFb?.data) renderFeedback(cachedFb.data, true);
  showTab("input");

  // ----- 왼쪽 문제 설명 -----
  const section = (title, lines) => [h("h3", {}, title), ...lines.map((t) => h("p", {}, t))];
  const statement = h("section", { class: "card problem" },
    h("div", { class: "ptitle" }, h("h2", {}, p.title), h("span", { class: "pill" }, p.tag)),
    h("div", { class: "muted small" }, p.source),
    h("h3", {}, "문제"), ...p.story.map((t) => h("p", {}, t)),
    ...section("입력", p.input), ...section("출력", p.output),
    h("h3", {}, "제한"), h("ul", {}, p.limits.map((t) => h("li", {}, t))),
    ...p.examples.map((e, i) => h("div", { class: "example" },
      h("div", { class: "ex-head" }, h("strong", {}, `예제 ${i + 1}`),
        h("button", { class: "btn tiny", type: "button", onclick: () => { inputBox.value = e.input; showTab("input"); } }, "입력 칸에 넣기")),
      h("div", { class: "ex-grid" },
        h("div", {}, h("div", { class: "muted small" }, "입력"), h("pre", {}, e.input)),
        h("div", {}, h("div", { class: "muted small" }, "출력"), h("pre", {}, e.output))),
      e.note ? h("p", { class: "muted small" }, e.note) : null)));

  const nav = h("div", { class: "pnav" },
    h("a", { href: `#/week/${w.n}/practice` }, "← 목록"),
    h("span", { class: "spacer" }),
    prev ? h("a", { href: `#/week/${w.n}/practice/${prev.id}` }, `← ${prev.title}`) : null,
    next ? h("a", { href: `#/week/${w.n}/practice/${next.id}` }, `${next.title} →`) : null);

  const work = h("section", { class: "work" },
    h("div", { class: "codepanel" },
      h("div", { class: "codebar" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")), h("span", { class: "fname" }, "solution.py"),
        h("span", { class: "spacer" }), status),
      host),
    h("div", { class: "actions" }, resetBtn, h("span", { class: "spacer" }), runBtn, submitBtn),
    tabsBar, paneHost);

  return h("div", { class: "stack" }, nav, h("div", { class: "solve" }, statement, work));
}
