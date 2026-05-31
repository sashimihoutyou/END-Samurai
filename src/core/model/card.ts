// カード定義。docs/08「データスキーマ＞カード」に対応。
// α版 Phase 1 では skill カードの attack/block/dodge_next/fixed_damage のみを実装する。
// 道具カード・修繕・自傷・状態異常付与などの effect は後続フェーズで union に追加する。

export type CardCategory = "skill" | "item" | "companion_active";
export type TargetType = "single" | "all" | "pierce" | "self" | "self_aoe";

export type CardEffect =
  | { kind: "attack"; multiplier: number; ignoreDefense?: boolean } // 刀身攻撃力×倍率
  | { kind: "fixed_damage"; amount: number; ignoreDefense?: boolean } // 柄打ち等（刀身無関係）
  | { kind: "block"; amount: number } // 受ける
  | { kind: "dodge_next" }; // 見切る（次の敵攻撃を完全回避）

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
}

/** デッキ内の個体。回数など個体ごとの可変状態を持つ。 */
export interface CardInstance {
  uid: string; // 個体ID（同名カードの区別用）
  defId: string; // CardDef.id への参照
  usesLeft?: number; // item の残り回数
}
