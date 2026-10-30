// 암호화 묶음 열기. 형식은 src/build_site.py의 seal()과 짝을 이룬다.
//   master = PBKDF2-SHA256(비밀번호 NFC, salt, iter, 32바이트)
//   enc    = HMAC-SHA256(master, "enc")  → AES-256-GCM 키
//   blob   = IV(12바이트) + 암호문(태그 포함)

const te = new TextEncoder();

export const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64encode = (u8) => btoa(String.fromCharCode(...u8));

export async function loadMeta(build) {
  const r = await fetch(`data/vault.json?v=${build}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`vault.json ${r.status}`);
  return r.json();
}

// 비밀번호 → AES 키 원본 바이트 (로그인 유지용으로 저장할 수 있음)
export async function deriveRawKey(password, meta) {
  const base = await crypto.subtle.importKey(
    "raw", te.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64decode(meta.salt), iterations: meta.iter }, base, 256);
  const hk = await crypto.subtle.importKey("raw", master, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", hk, te.encode("enc")));
}

// 키가 틀리면 GCM 태그 검사에서 예외가 난다
export async function openVault(raw, meta) {
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(meta.iv) }, key, b64decode(meta.ct));
  return { key, manifest: JSON.parse(new TextDecoder().decode(pt)) };
}

export async function fetchBlob(key, id, type) {
  const r = await fetch(`data/b/${id}.bin`);
  if (!r.ok) throw new Error(`blob ${id} ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12));
  return new Blob([pt], { type });
}
