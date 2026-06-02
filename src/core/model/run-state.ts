import type { SwordState } from "./sword.js";
import type { CardInstance } from "./card.js";
import type { Costume } from "./battle-state.js";
import type { SextechState } from "./charm.js";

// 1ラン全体の状態（docs/08 §3.1）。セーブなし＝アプリ起動中のみ存在。
// α版プロローグの縦切りでは、野犬戦→お豊魅了バトルへ HP・刀・仲間・せっくすてくを引き継ぐ器として使う。

export type Affection = "low" | "mid" | "high";

export interface RunCompanion {
  id: string;
  affection: Affection;
}

/** 所持している予備パーツ（各部位の段階IDの多重集合）。お豊のパーツ購入で増え、付け替えで装備に出し入れする。 */
export interface PartInventory {
  blade: string[];
  tsuba: string[];
  tsuka: string[];
}

export interface RunState {
  hp: number;
  maxHp: number;
  sword: SwordState; // 刀の現在状態（戦闘で摩耗する。各部位の現在段階ID）
  swordGrade: SwordState; // 装備中パーツの等級（打ち直しで戻す上限。摩耗しても下がらない）。docs/03「パーツ交換」
  parts: PartInventory; // 所持予備パーツ（未装備）。お豊のパーツ購入で増える
  costume: Costume; // 衣装破損段階（戦闘間で持続。docs/05）
  deck: CardInstance[];
  companions: RunCompanion[];
  sextech: SextechState;
  rescuedCount: number;
  zeni: number; // 所持金（銭）。戦闘・温泉で得て、野営地の施設で使う。docs/03「経済システム」
  flags: Record<string, boolean>;
}
