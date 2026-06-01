// カード定義。docs/08「データスキーマ＞カード」に対応。
// 技カードの attack/block/dodge_next/fixed_damage に加え、道具カードの修繕・回復、
// 崩し（enemy_defense_down）・自傷（self_degrade）・状態異常付与（apply_status）を実装する。
// 状態異常解除（cure_status＝まじない札）は後続フェーズで追加する。

import type { SwordPart } from "./sword.js";
import type { StatusId } from "./status.js";

export type CardCategory = "skill" | "item" | "companion_active";
export type TargetType = "single" | "all" | "pierce" | "self" | "self_aoe";

export type CardEffect =
  | { kind: "attack"; multiplier: number; ignoreDefense?: boolean } // 刀身攻撃力×倍率
  | { kind: "fixed_damage"; amount: number; ignoreDefense?: boolean } // 柄打ち等（刀身無関係）
  | { kind: "block"; amount: number } // 受ける
  | { kind: "dodge_next" } // 見切る（次の敵攻撃を完全回避）
  | { kind: "repair_part"; part: SwordPart; cap?: string } // 修繕：指定部位を1段階回復（cap段階まで。低レア道具は回復上限あり）
  | { kind: "heal"; amount: number } // きずぐすり：HP回復
  | { kind: "enemy_defense_down"; amount: number } // 崩し：対象の防御値を下げる（この戦闘中持続。docs/01「崩し」）
  | { kind: "self_degrade"; part: SwordPart; stages?: number } // 自傷コスト：自分の指定部位を低下（柄打ち・捨て身）
  | { kind: "apply_status"; status: StatusId; x: number; toTarget: boolean } // 出血・気絶等を付与（toTarget=敵へ／false=こゆきへ）
  // 仲間アクティブ用（この戦闘中持続のバフ。docs/03「仲間スキル」）
  | { kind: "buff_attack"; amount: number } // 攻撃力ボーナス
  | { kind: "buff_defense"; amount: number } // 防御値ボーナス（毎ターンの防御プールに充填）
  | { kind: "buff_combo"; amount: number } // 連撃率ボーナス（0..1）
  | { kind: "ap_discount"; amount: number } // 技カードのAP消費を軽減（最低1）
  | { kind: "nullify_degrade"; count: number }; // 刀部位デバフをcount回無効化

export type CardRequirement =
  | { kind: "blade_stage_at_least"; stage: string }
  | { kind: "no_action_last_turn" };

export interface CardDef {
  id: string;
  name: string;
  category: CardCategory;
  ap: number; // 基本AP消費（刀段階のAP補正は使用時に加算）
  target: TargetType;
  flavorKey?: string; // フレーバーテキスト参照キー（text.json）
  effects: CardEffect[];
  requirements?: CardRequirement[];
  uses?: number; // 道具カードの残り回数（item のみ）
  upgradeId?: string; // 葵パッシブ「見取り稽古」で一時的に置換される上位カードID（docs/03）
}

/** デッキ内の個体。回数など個体ごとの可変状態を持つ。 */
export interface CardInstance {
  uid: string; // 個体ID（同名カードの区別用）
  defId: string; // CardDef.id への参照
  usesLeft?: number; // item の残り回数
}
