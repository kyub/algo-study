// Python 실행기 (Web Worker). Pyodide(브라우저 안 Python 3.12)로 스터디원 코드를 실행한다.
// 무한 루프 등으로 응답이 없으면 화면 쪽(runner.js)이 이 워커를 강제 종료한다.
importScripts("https://cdn.jsdelivr.net/npm/pyodide@0.27.8/pyodide.js");

const HARNESS = `
import sys, io, time, traceback

class _Out(io.StringIO):
    LIMIT = 1_000_000

    def write(self, s):
        if self.tell() + len(s) > self.LIMIT:
            raise RuntimeError("출력이 너무 깁니다 (1MB 초과)")
        return super().write(s)

def _clean(tb):
    # 실행기 내부 줄은 빼고 solution.py에서 난 부분만 남김
    lines = tb.rstrip().splitlines()
    for i, line in enumerate(lines):
        if 'File "solution.py"' in line:
            return "Traceback (most recent call last):\\n" + "\\n".join(lines[i:]) + "\\n"
    return lines[-1] + "\\n"

def _run(code, data):
    out, err = _Out(), io.StringIO()
    saved = sys.stdin, sys.stdout, sys.stderr
    sys.stdin, sys.stdout, sys.stderr = io.StringIO(data), out, err
    status = "ok"
    t0 = time.perf_counter()
    try:
        exec(compile(code, "solution.py", "exec"), {"__name__": "__main__"})
    except SystemExit as e:
        if e.code not in (None, 0):
            status = "error"
            err.write(f"SystemExit: {e.code}\\n")
    except BaseException:
        status = "error"
        err.write(_clean(traceback.format_exc()))
    finally:
        elapsed = time.perf_counter() - t0
        sys.stdin, sys.stdout, sys.stderr = saved
    return status, out.getvalue(), err.getvalue(), elapsed
`;

let pyodide = null;
const ready = (async () => {
  pyodide = await loadPyodide();
  pyodide.runPython(HARNESS);
  postMessage({ type: "ready", version: pyodide.version });
})().catch((e) => postMessage({ type: "fatal", error: String(e) }));

// { inputs: [stdin, ...] } → 케이스마다 start / case 메시지, 마지막에 done
onmessage = async ({ data }) => {
  await ready;
  const run = pyodide.globals.get("_run");
  try {
    for (let i = 0; i < data.inputs.length; i++) {
      postMessage({ type: "start", i });
      const r = run(data.code, data.inputs[i]);
      const [status, out, err, time] = r.toJs();
      r.destroy();
      postMessage({ type: "case", i, status, out, err, time });
    }
  } finally {
    run.destroy();
  }
  postMessage({ type: "done" });
};
