import type { CardInstance } from "./card.js";
import type { EnemyInstance } from "./enemy.js";
import type { SwordState } from "./sword.js";

// 戦闘中の状態。Core層の純粋関数（rules/normal-battle.ts）が
// 「現在の state を受け取り、新しい state＋発生イベント配列を返す」形で更新する。

export type BattlePhase = "player" | "enemy" | "won" | "lost";

export interface BonusPools {
  attack: number; // 攻撃力ボーナスプール
  defense: number; // 防御値ボーナスプール（こゆき）
  comboRate: number; // 連撃率ボーナスプール（0..1）
}

export interface BattleState {
  kind: "normal";
  enemies: EnemyInstance[];
  hand: CardInstance[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  ap: number;
  apMax: number;
  blockPool: number; // こゆきの防御値（敵攻撃で消費する共有プール）
  bonusPools: BonusPools;
  hp: number;
  maxHp: number;
  sword: SwordState;
  turn: number;
  actedThisTurn: boolean; // 居合「前ターン未行動」判定用
  dodgeNext: boolean; // 見切る：次の敵攻撃を完全回避
  phase: BattlePhase;
}

// UI層が再生する「何が起きたか」のイベント列。描画方法は持たない。
export type BattleEvent =
  | { type: "TurnStarted"; turn: number }
  | { type: "CardPlayed"; cardDefId: string; cardUid: string }
  | { type: "DamageDealt"; enemyUid: string; amount: number; ignoredDefense: boolean }
  | { type: "ComboTriggered"; enemyUid: string; amount: number }
  | { type: "BlockGained"; amount: number }
  | { type: "DodgeArmed" }
  | { type: "EnemyDefeated"; enemyUid: string }
  | { type: "EnemyActed"; enemyUid: string; intentId: string }
  | { type: "DamageTaken"; amount: number; blocked: number; dodged: boolean }
  | { type: "KoyukiReaction"; reactionKey: string }
  | { type: "BattleWon" }
  | { type: "BattleLost" };
