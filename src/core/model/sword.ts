// 刀の3部位と段階。補正値の数値は docs/01「刀の状態段階と補正値」を単一情報源とし、
// data/sword-stages.json に転記する（ここでは型のみ定義し、値はハードコードしない）。

export type SwordPart = "blade" | "tsuba" | "tsuka"; // 刀身・鍔・柄

export interface SwordStageMods {
  attack?: number; // 攻撃力補正（刀身）
  ap?: number; // AP補正（技カードのAP消費に加算。最低1は使用側で担保）
  baseDefense?: number; // 基礎防御補正（鍔）
  comboRate?: number; // 連撃率（0..1の割合。柄）
  debuffNullifyRate?: number; // デバフ無効化率（0..1。鍔）
}

export interface SwordStage {
  id: string;
  name: string; // 表示名（"なまくら" 等）
  order: number; // 段階の並び（低→高）。修繕で上昇・デバフで低下
  mods: SwordStageMods;
}

export interface SwordPartStages {
  part: SwordPart;
  baseStageId: string; // 基準＝"新品同様"（補正0）
  stages: SwordStage[];
}

/** ランを通して持つ刀の現在状態（各部位の現在段階ID） */
export interface SwordState {
  blade: string;
  tsuba: string;
  tsuka: string;
}
