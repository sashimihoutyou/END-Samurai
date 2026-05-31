import type { CharmEnemyInstance, SexCardDef, SextechState } from "../model/charm.js";
import { weaknessMultiplier } from "../model/charm.js";

// 魅了バトルの数値モデル。式は docs/02「気力防御パラメータと回復・貫通の数値モデル」を単一情報源とする。
// 「加算系を合算 → 開発倍率を掛ける → 気力防御を実数値減算（裏取りは×2参照）」を本ファイルに閉じ込め、
// 二重掛けを構造的に不可能にする（通常戦闘の damage.ts と同じ思想）。

/** せっくすてくの威力加算 ＝ 身 ＋ 鎬（docs/02「3部位とパラメータ」）。 */
export function sextechPower(sextech: SextechState): number {
  return sextech.mi + sextech.shinogi;
}

/** せっくすてくの防御（守り上乗せ）＝ 鎬 ＋ 切先。 */
export function sextechDefense(sextech: SextechState): number {
  return sextech.shinogi + sextech.kissaki;
}

/** せっくすてくの連撃（開発加速の発生率。0..1）＝ (身 ＋ 切先) × 係数。 */
export function sextechDevAccelRate(sextech: SextechState): number {
  return Math.min(0.5, (sextech.mi + sextech.kissaki) * 0.05);
}

/** 複合でない単一属性技の属性を返す（基本8種は単一属性）。 */
export function primaryAttr(card: SexCardDef): SexCardDef["attrs"][number] {
  return card.attrs[0];
}

/**
 * 命中時に参照する弱点段階。複合技は「現在の弱点段階の倍率が高い方」（docs/02「複合属性技」）。
 * 基本8種は単一属性なのでその属性段階そのもの。
 */
export function effectiveStage(card: SexCardDef, enemy: CharmEnemyInstance): number {
  let best = enemy.weakness[card.attrs[0]];
  for (const a of card.attrs) {
    if (enemy.weakness[a] > best) best = enemy.weakness[a];
  }
  return best;
}

/**
 * 最終与気力ダメージ = max(0, (カード基礎 + 威力加算 + 祝福加算) × 開発倍率 − 敵の気力防御)
 *   ※裏取り属性技は「敵の気力防御 × 2」を減算（減算は開発倍率の"後"）。
 * 祝福加算はα版プロローグでは 0（祝福システム未実装）。
 */
export function computeQiDamage(
  card: SexCardDef,
  enemy: CharmEnemyInstance,
  sextech: SextechState,
): { amount: number; stage: number } {
  const stage = effectiveStage(card, enemy);
  const mult = weaknessMultiplier(stage);
  const base = card.baseQi + sextechPower(sextech); // 祝福加算は0
  const afterMult = Math.floor(base * mult);

  const doubleRef = card.effects.some((e) => e.kind === "double_defense_ref");
  const effectiveDefense = Math.max(0, enemy.qiDefense) * (doubleRef ? 2 : 1);

  const amount = Math.max(0, afterMult - effectiveDefense);
  return { amount, stage };
}

/** 乳繰りの与ダメ依存回復 ＝ floor(最終与気力ダメージ × 回復係数)（係数<1.0）。 */
export function computeHeal(qiDamage: number, ratio: number): number {
  return Math.floor(qiDamage * ratio);
}
