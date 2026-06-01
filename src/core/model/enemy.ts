import type { SwordPart } from "./sword.js";
import type { StatusId, StatusInstance } from "./status.js";

// 敵定義。docs/01「敵行動アーキタイプ」の6型を archetype として持つ。
// α版は cyclic（周期型）/ sniper（狙撃型）を解釈する。他の型は後続フェーズで追加。

export type EnemyArchetype =
  | "cyclic"
  | "sniper"
  | "timed"
  | "random_intent"
  | "concealed"
  | "synergy";

export type EnemyEffect =
  | { kind: "damage"; amount: number } // こゆきへのダメージ
  | { kind: "apply_status"; status: StatusId; x: number } // 状態異常付与（毒/出血/気絶）
  | { kind: "degrade_part"; part: SwordPart; chance: number } // 部位狙い（sniper）
  | { kind: "grab" };

export interface IntentDef {
  id: string;
  label: string; // 行動予告テキスト
  icon: string; // 予告アイコン種別
  effects: EnemyEffect[];
  telegraphPart?: SwordPart; // 部位狙い予告（sniper）
  concealEffect?: boolean; // 隠匿型：効果種別を伏せる（数値は表示）
}

export interface EnemyDef {
  id: string;
  name: string;
  archetype: EnemyArchetype;
  hp: number;
  defense: number; // 敵の防御値（こゆきの与ダメージを実数値減算）
  intents: IntentDef[];
  charmTarget?: boolean; // 魅了遭遇イベント対象か
  isBoss?: boolean;
}

/** 戦闘中の敵個体。 */
export interface EnemyInstance {
  uid: string;
  defId: string;
  name: string;
  hp: number;
  maxHp: number;
  defense: number;
  archetype: EnemyArchetype;
  intents: IntentDef[];
  intentIndex: number; // 次に実行する予告（cyclic はこれをループ）
  statuses: StatusInstance[]; // 敵に付与された状態異常（出血DoT・気絶スキップ）
}
