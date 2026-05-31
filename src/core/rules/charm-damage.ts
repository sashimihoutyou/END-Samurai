import type { CharmEnemyInstance, SexCardDef, SextechState } from "../model/charm.js";
import { weaknessMultiplier } from "../model/charm.js";

// 魅了バトルの数値モデル。式は docs/02「気力防御パラメータと回復・貫通の数値モデル」/「我慢ゲージと絶頂・射精」を単一情報源とする。
// 「加算系を合算 → 弱点倍率を掛ける → 気力防御を実数値減算（裏取りは×2参照）」を本ファイルに閉じ込め、
// 二重掛けを構造的に不可能にする（通常戦闘の damage.ts と同じ思想）。

/** せっくすてくの威力加算 ＝ 身 ＋ 鎬（docs/02「3部位とパラメータ」）。性技の与気力・与我慢に乗る。 */
export function sextechPower(sextech: SextechState): number {
  return sextech.mi + sextech.shinogi;
}

/** せっくすてくの守り上乗せ（四十八手の我慢被ダメ軽減）＝ 鎬 ＋ 切先。 */
export function sextechDefense(sextech: SextechState): number {
  return sextech.shinogi + sextech.kissaki;
}

/** せっくすてくの我慢タフネス（こゆきの gamanMax＋／射精威力＋）＝ 身 ＋ 切先。 */
export function sextechGamanBonus(sextech: SextechState): number {
  return sextech.mi + sextech.kissaki;
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
 * 最終与気力ダメージ = max(0, (カード基礎 + 威力加算) × 弱点倍率 − 敵の気力防御)
 *   ※裏取り属性技は「敵の気力防御 × 2」を減算（減算は倍率の"後"）。
 */
export function computeQiDamage(
  card: SexCardDef,
  enemy: CharmEnemyInstance,
  sextech: SextechState,
): { amount: number; stage: number } {
  const stage = effectiveStage(card, enemy);
  const mult = weaknessMultiplier(stage);
  const base = card.baseQi + sextechPower(sextech);
  const afterMult = Math.floor(base * mult);

  const doubleRef = card.effects.some((e) => e.kind === "double_defense_ref");
  const effectiveDefense = Math.max(0, enemy.qiDefense) * (doubleRef ? 2 : 1);

  const amount = Math.max(0, afterMult - effectiveDefense);
  return { amount, stage };
}

/** 敵の我慢へのダメージ ＝ 与気力ダメージと同量＋1（弱点を突くほど高ぶり、絶頂が近づく）。docs/02。
 *  我慢削り→絶頂→気力大ダメージ、というリズムを主役にするため、気力直接削りより我慢削りを効かせる。 */
export function computeGamanDamage(qiDamage: number): number {
  return qiDamage + 1;
}

/** こゆき自身の我慢消費 ＝ ceil(baseQi / 2)（高火力技ほど自分も高ぶる）。 */
export function selfGamanCost(card: SexCardDef): number {
  return Math.ceil(card.baseQi / 2);
}

/** 乳繰り等の与ダメ依存の我慢回復 ＝ floor(与気力ダメージ × 係数)（係数<1.0）。 */
export function computeGamanHeal(qiDamage: number, ratio: number): number {
  return Math.floor(qiDamage * ratio);
}

/** 狙い撃ち射精の敵への威力 ＝ 基礎 ＋ せっくすてく我慢タフネス。 */
export function ejaculationDamage(base: number, sextech: SextechState): number {
  return base + sextechGamanBonus(sextech);
}
