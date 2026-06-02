import type { SwordPart } from "./sword.js";
import type { StatusId, StatusInstance } from "./status.js";

// 敵定義。docs/01「敵行動アーキタイプ」の6型を archetype として持つ。
// cyclic（周期）/ sniper（狙撃）/ random_intent（予告ランダム）/ timed（時限）/
// concealed（隠匿・くびなし）/ synergy（連携）の6型すべてを normal-battle.ts が解釈する。

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
  bounty?: number; // 撃破時に得る銭（docs/03「経済システム」。省略＝0）
  charmTarget?: boolean; // 魅了遭遇イベント対象か
  isBoss?: boolean;
  // timed（時限型）：intents[0]＝溜め／intents[last]＝大技。fuse ターン溜めて確定発動する。
  fuse?: number;
  selfDestruct?: boolean; // timed：大技発動後に自壊する（自爆しかばね）。false/省略＝fuse をリセットしてループ。
  // synergy（連携型）：生存している味方が1体でもいる間、与ダメージにこのボーナスが乗る。
  synergyBonus?: number;
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
  fuse?: number; // timed：大技発動までの残りターン（予告に表示）。
}
