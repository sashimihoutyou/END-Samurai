// 決定論的・シード付き乱数。Core層の鉄則「乱数は注入する」を体現する。
// グローバルな Math.random() は Core では使わない。これによりリプレイ・テスト・
// Godot移植時の挙動照合が可能になる（→ docs/08「アーキテクチャ方針」）。

export interface Rng {
  /** [0, 1) の浮動小数 */
  next(): number;
  /** [0, maxExclusive) の整数 */
  int(maxExclusive: number): number;
  /** 確率 p (0..1) で true */
  chance(p: number): boolean;
  /** 配列をフィッシャー–イェーツでシャッフルした新配列を返す（非破壊） */
  shuffle<T>(items: readonly T[]): T[];
  /** 現在の内部状態（再現・デバッグ用） */
  state(): number;
}

/** mulberry32: 軽量で十分な品質の決定論的PRNG。GDScriptへ容易に移植可能。 */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  };

  const chance = (p: number): boolean => next() < p;

  const shuffle = <T>(items: readonly T[]): T[] => {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  return { next, int, chance, shuffle, state: () => s };
}
