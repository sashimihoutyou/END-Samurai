// 同行仲間の定義（docs/03「同行NPCシステム・仲間スキル」）。
// α版は お豊・葵 の2名。各仲間は「弱いパッシブ」＋「デッキ固定投入のアクティブカード」を持つ。
// 好感度（low/mid/high）でパッシブ効果量が変わる（docs/03「好感度システム」）。

export type Affection = "low" | "mid" | "high";

/** パッシブ種別（戦闘開始時に作用）。 */
export type CompanionPassive =
  | "battle_start_defense" // お豊「鍛えの目」：戦闘開始時、防御値+（低1/中2/高3）
  | "battle_start_upgrade"; // 葵「見取り稽古」：戦闘開始時、手札の技を1ランク上へ（中まで1枚/高2枚）

export interface CompanionDef {
  id: string;
  name: string;
  activeCardId: string; // デッキへ固定投入するアクティブカード（category="companion_active"）
  passive: CompanionPassive;
}
