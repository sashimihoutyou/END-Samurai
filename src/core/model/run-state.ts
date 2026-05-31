import type { SwordState } from "./sword.js";
import type { CardInstance } from "./card.js";
import type { SextechState } from "./charm.js";

// 1ラン全体の状態（docs/08 §3.1）。セーブなし＝アプリ起動中のみ存在。
// α版プロローグの縦切りでは、野犬戦→お豊魅了バトルへ HP・刀・仲間・せっくすてくを引き継ぐ器として使う。

export type Affection = "low" | "mid" | "high";

export interface RunCompanion {
  id: string;
  affection: Affection;
}

export interface RunState {
  hp: number;
  maxHp: number;
  sword: SwordState;
  deck: CardInstance[];
  companions: RunCompanion[];
  sextech: SextechState;
  rescuedCount: number;
  flags: Record<string, boolean>;
}
