import type { ContentDB } from "../content/loader.js";
import type { CardInstance } from "../model/card.js";
import type { RunCompanion } from "../model/run-state.js";
import type { ShopDef } from "../model/shop.js";

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
