import type { ContentDB } from "../core/content/loader.js";

// text.json への薄いアクセサ。UI層専用（Core層はテキスト表示を知らない）。
// 配列値は「ランダム抽選候補」（docs/08 §2.9）。抽選は演出なのでUI層で Math.random を使う。

export function tLine(db: ContentDB, key: string, vars?: Record<string, string>): string {
  const v = db.text[key];
  const s = Array.isArray(v) ? (v[0] ?? key) : (v ?? key);
  return vars ? format(s, vars) : s;
}

export function tLines(db: ContentDB, key: string): string[] {
  const v = db.text[key];
  if (Array.isArray(v)) return v;
  return v ? [v] : [key];
}

/** 配列なら1つランダム抽選、文字列ならそのまま。未定義なら undefined。 */
export function tPick(db: ContentDB, key: string, vars?: Record<string, string>): string | undefined {
  const v = db.text[key];
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v;
  return vars ? format(s, vars) : s;
}

function format(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
