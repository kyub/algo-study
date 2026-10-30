// 화면 공용 도구: 저장소, 요소 만들기, 숫자 표시.

// 사생활 보호 모드 등에서 저장이 실패해도 화면은 동작하게
export const st = {
  get(k) {
    try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; }
  },
  set(k, v, remember = true) {
    try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch { /* 저장 못 해도 이번 화면은 사용 가능 */ }
  },
  del(k) {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* 무시 */ }
  },
  json(k, fallback) {
    try { return JSON.parse(this.get(k)) ?? fallback; } catch { return fallback; }
  },
};

// 요소 만들기 (내용은 항상 텍스트로 넣음)
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "value") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const pad = (n) => String(n).padStart(2, "0");
export const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const sec = (t) => (t < 0.01 ? "0.01초 미만" : `${t.toFixed(2)}초`);
