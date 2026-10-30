// 실행·채점: pyworker.js를 관리하고, 시간 제한을 넘기면 워커를 종료한다.
// 채점 규칙: 줄 단위 비교, 줄 끝 공백과 마지막 빈 줄은 무시.

export function normalize(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join("\n");
}

export class Runner {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.ready = null;
    this.onstate = null; // "loading" | "ready" | "error"
  }

  start() {
    if (this.ready) return this.ready;
    this.onstate?.("loading");
    const w = new Worker(this.url);
    this.worker = w;
    this.ready = new Promise((resolve, reject) => {
      w.onmessage = ({ data }) => {
        if (data.type === "ready") { this.version = data.version; this.onstate?.("ready", data.version); resolve(); }
        if (data.type === "fatal") reject(new Error(data.error));
      };
      w.onerror = (e) => reject(new Error(e.message || "Python을 불러오지 못했습니다"));
    }).catch((e) => {
      this.kill();
      this.onstate?.("error");
      throw e;
    });
    return this.ready;
  }

  kill() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }

  // inputs를 차례로 실행. 한 케이스가 limit초(+여유)를 넘기면 워커를 종료하고 timeout으로 끝냄
  async exec(code, inputs, limit, onCase) {
    await this.start();
    const w = this.worker;
    return new Promise((resolve) => {
      const results = [];
      let timer = null;
      w.onmessage = ({ data }) => {
        if (data.type === "start") {
          timer = setTimeout(() => {
            this.kill();
            const r = { i: data.i, status: "timeout", out: "", err: "", time: limit };
            results.push(r);
            onCase?.(r);
            resolve(results);
          }, limit * 1000 + 1500);
        } else if (data.type === "case") {
          clearTimeout(timer);
          const r = data.status === "ok" && data.time > limit ? { ...data, status: "timeout" } : data;
          results.push(r);
          onCase?.(r);
        } else if (data.type === "done") {
          resolve(results);
        }
      };
      w.postMessage({ code, inputs });
    });
  }
}

// 함수형 문제(프로그래머스, kind "function"): 입력은 인자 JSON 배열, solution(*인자)의 반환값을 JSON으로 비교
const MARK = "\n__RESULT__";
const DRIVER = [
  "",
  "import json as _j, sys as _s",
  "_a = _j.loads(_s.stdin.read())",
  "_r = solution(*_a)",
  'print("\\n__RESULT__" + _j.dumps(_r, ensure_ascii=False))',
  "",
].join("\n");
const canon = (s) => { try { return JSON.stringify(JSON.parse(s)); } catch { return null; } };

// 함수형이면 스터디원 코드 뒤에 호출 코드를 붙임 (스터디원 코드의 줄 번호는 그대로)
export const prepare = (p, code) => (p.kind === "function" ? code.trimEnd() + "\n" + DRIVER : code);

// 출력을 print로 찍은 부분과 반환값(JSON)으로 나눔
export function splitResult(out) {
  const i = out.lastIndexOf(MARK);
  return i < 0 ? { printed: out, result: null } : { printed: out.slice(0, i), result: out.slice(i + MARK.length).trim() };
}

export function judge(p, out, expected) {
  if (p.kind !== "function") return normalize(out) === normalize(expected);
  const { result } = splitResult(out);
  return result !== null && canon(result) === canon(expected);
}

// 채점: tests = [{input, output}], 첫 실패에서도 나머지는 계속 (시간 초과면 중단)
export async function grade(runner, code, tests, limit, onCase, p = {}) {
  const results = await runner.exec(prepare(p, code), tests.map((t) => t.input), limit, (r) => {
    if (r.status === "ok") r.status = judge(p, r.out, tests[r.i].output) ? "pass" : "wrong";
    onCase?.(r);
  });
  const passed = results.filter((r) => r.status === "pass").length;
  return { results, passed, total: tests.length, maxTime: Math.max(0, ...results.map((r) => r.time || 0)) };
}
