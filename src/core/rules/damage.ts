import type { CardDef } from "../model/card.js";
import type { Costume } from "../model/battle-state.js";
import type { SwordState } from "../model/sword.js";
import { getStage, type ContentDB } from "../content/loader.js";

// 衣装破損の補正（docs/05「衣装破損システム」）。破損＝鍔基礎防御-1／大破＝-2・技AP-1・連撃率+5%。
export function costumeDefensePenalty(costume: Costume): number {
  return costume === "damaged" ? 1 : costume === "broken" ? 2 : 0;
}
export function costumeApPenalty(costume: Costume): number {
  return costume === "broken" ? -1 : 0; // 大破でAP-1（最低1は使用側で担保）
}
export function costumeComboBonus(costume: Costume): number {
  return costume === "broken" ? 0.05 : 0; // 大破で連撃率+5%
}

// 通常戦闘の数値モデル。式・基準値は docs/01「戦闘の数値モデル」を単一情報源とする。
// 「加算プールを合算してからカード倍率を掛ける（二重掛けしない）」を本ファイルに閉じ込め、
// 構造的に二重掛けを不可能にする。

/** 刀身の実効攻撃力 ＝ 基礎攻撃力 ＋ 刀身段階補正 ＋ 攻撃力ボーナスプール */
export function bladeAttackPower(db: ContentDB, sword: SwordState, bonusAttack: number): number {
  const stage = getStage(db, "blade", sword.blade);
  return db.combat.baseBladeAttack + (stage.mods.attack ?? 0) + bonusAttack;
}

/**
 * 攻撃ダメージ = max(1, floor(power × multiplier) − 敵防御)
 * ignoreDefense（連撃・柄打ち等）は敵防御の減算を行わない。
 * 下限1＝高防御の敵にも最低1チップは通る（docs/01）。
 */
export function computeAttackDamage(
  power: number,
  multiplier: number,
  enemyDefense: number,
  ignoreDefense: boolean,
): number {
  const raw = Math.floor(power * multiplier);
  const afterDefense = ignoreDefense ? raw : raw - enemyDefense;
  return Math.max(1, afterDefense);
}

/** 固定ダメージ（刀身無関係）。ignoreDefense でなければ敵防御を減算し、下限1。 */
export function computeFixedDamage(amount: number, enemyDefense: number, ignoreDefense: boolean): number {
  const afterDefense = ignoreDefense ? amount : amount - enemyDefense;
  return Math.max(1, afterDefense);
}

/** こゆきの基礎防御 ＝ 鍔基礎防御 ＋ 鍔段階補正 − 衣装破損ペナルティ（受ける等の積み増しは別途プールで加算）。 */
export function baseDefense(db: ContentDB, sword: SwordState, costume: Costume = "normal"): number {
  const stage = getStage(db, "tsuba", sword.tsuba);
  return Math.max(0, db.combat.baseTsubaDefense + (stage.mods.baseDefense ?? 0) - costumeDefensePenalty(costume));
}

/** 技カードの実効AP消費 ＝ max(1, 基本AP ＋ 刀身段階AP補正 ＋ 柄段階AP補正 ＋ 衣装大破補正)。 */
export function cardApCost(db: ContentDB, card: CardDef, sword: SwordState, costume: Costume = "normal"): number {
  const bladeAp = getStage(db, "blade", sword.blade).mods.ap ?? 0;
  const tsukaAp = getStage(db, "tsuka", sword.tsuka).mods.ap ?? 0;
  return Math.max(1, card.ap + bladeAp + tsukaAp + costumeApPenalty(costume));
}

/** 総連撃率 ＝ 柄段階の連撃率 ＋ 連撃率ボーナスプール（上限は呼び出し側で適用）。 */
export function comboRate(db: ContentDB, sword: SwordState, bonusComboRate: number): number {
  const tsuka = getStage(db, "tsuka", sword.tsuka).mods.comboRate ?? 0;
  return tsuka + bonusComboRate;
}
