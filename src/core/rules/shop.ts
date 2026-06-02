import type { ContentDB } from "../content/loader.js";
import type { CardInstance } from "../model/card.js";
import type { RunCompanion } from "../model/run-state.js";
import type { FusionRecipe, ShopDef } from "../model/shop.js";

// 野営地の施設まわりの純粋ロジック（docs/03「野営地」「経済システム」）。
// 値段・売却レートは ContentDB（data/shops.json）から引く。状態は持たず、計算だけを担う。

/** いま利用できる施設（requiresCompanion を満たすもののみ）。docs/03「道場（葵同行時）」。 */
export function availableShops(db: ContentDB, companions: readonly RunCompanion[]): ShopDef[] {
  return db.shops.shops.filter(
    (s) => !s.requiresCompanion || companions.some((c) => c.id === s.requiresCompanion),
  );
}

/** カードの売値＝floor(基準価値 × sellRatio)。仲間アクティブ・価値未設定は売れない（0）。docs/03「道場：仲間アクティブは処分対象外」。 */
export function sellPrice(db: ContentDB, defId: string): number {
  const def = db.cards.get(defId);
  if (!def || def.category === "companion_active" || def.value == null) return 0;
  return Math.floor(def.value * db.shops.sellRatio);
}

/** このデッキ個体を売却・処分できるか（仲間アクティブは不可）。 */
export function isDisposable(db: ContentDB, inst: CardInstance): boolean {
  const def = db.cards.get(inst.defId);
  return !!def && def.category !== "companion_active";
}

/**
 * 融合レシピが要求する入力カードを、デッキから消費する個体（uid）として割り当てる。
 * 入力カードを過不足なく満たせれば消費すべき uid 配列を返す。満たせなければ null。
 * 同IDの重複入力（斬る＋斬る等）に対応するため、割り当て済み uid は二重に使わない。
 * docs/03「道場：技カードのデッキ圧縮」のリメイク（2枚→1枚の閃き）。
 */
export function matchFusion(deck: readonly CardInstance[], recipe: FusionRecipe): string[] | null {
  const used: string[] = [];
  for (const needDefId of recipe.inputs) {
    const inst = deck.find((c) => c.defId === needDefId && !used.includes(c.uid));
    if (!inst) return null;
    used.push(inst.uid);
  }
  return used;
}

/** いま実行できる融合レシピのインデックス集合（デッキが入力を満たすもの）。 */
export function availableFusions(db: ContentDB, deck: readonly CardInstance[]): number[] {
  return db.shops.fusions
    .map((recipe, i) => (matchFusion(deck, recipe) ? i : -1))
    .filter((i) => i >= 0);
}
