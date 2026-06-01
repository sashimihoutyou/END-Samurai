import type { CardInstance } from "./card.js";
import type { EnemyInstance } from "./enemy.js";
import type { StatusId, StatusInstance } from "./status.js";
import type { SwordPart, SwordState } from "./sword.js";

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
  // 掴み（docs/01「状態異常・掴み」）：掴んできた敵のuid。次の自ターンにその敵を攻撃すると解除。
  // 解除できないまま敵ターンを迎えると「押し倒し」され、その敵ターンは防御値半減＋完全回避不可。
  grabbedBy: string | null;
  pinned: boolean; // 押し倒し中（この敵ターンの被ダメ処理に影響）
  // 部位狙い予告（狙撃型）への対応選択。docs/01「部位狙いへの受け／いなし」。
  // "ukeru"（既定）＝通常処理／"inasu"＝狙われた部位は確定で守るが被ダメ+50%。
  braceChoice: "ukeru" | "inasu";
  statuses: StatusInstance[]; // こゆき側の状態異常（毒＝AP低下／出血＝DoT）。docs/01「状態異常」
  costume: Costume; // 衣装破損段階（防御・AP・連撃率に影響）。docs/05「衣装破損システム」
  phase: BattlePhase;
}

/** 衣装破損段階（docs/05）。通常→破損→大破。 */
export type Costume = "normal" | "damaged" | "broken";

// UI層が再生する「何が起きたか」のイベント列。描画方法は持たない。
export type BattleEvent =
  | { type: "TurnStarted"; turn: number }
  | { type: "CardPlayed"; cardDefId: string; cardUid: string }
  | { type: "DamageDealt"; enemyUid: string; amount: number; ignoredDefense: boolean }
  | { type: "ComboTriggered"; enemyUid: string; amount: number }
  | { type: "BlockGained"; amount: number }
  | { type: "DodgeArmed" }
  | { type: "PartRepaired"; part: SwordPart; from: string; to: string }
  | { type: "Healed"; amount: number }
  | { type: "EnemyDefeated"; enemyUid: string }
  | { type: "EnemyActed"; enemyUid: string; intentId: string }
  | { type: "DamageTaken"; amount: number; blocked: number; dodged: boolean }
  | { type: "PartDegraded"; part: SwordPart; from: string; to: string } // 敵の部位狙いで段階低下
  | { type: "PartDefended"; part: SwordPart } // 受け切る／いなすで部位を守った
  | { type: "Grabbed"; enemyUid: string } // 掴まれた
  | { type: "GrabReleased"; enemyUid: string } // 掴みを振りほどいた（攻撃で解除）
  | { type: "PinnedDown" } // 押し倒された（防御半減・回避不可）
  | { type: "EnemyDefenseDown"; enemyUid: string; amount: number } // 崩しで敵防御値を削った
  | { type: "StatusApplied"; status: StatusId; x: number; toKoyuki: boolean; enemyUid: string | null } // 状態異常付与
  | { type: "BleedTicked"; enemyUid: string | null; amount: number } // 出血DoT（null=こゆき）
  | { type: "StunSkipped"; enemyUid: string } // 気絶で敵が行動をスキップ
  | { type: "CostumeChanged"; to: Costume } // 衣装が破損／大破した
  | { type: "KoyukiReaction"; reactionKey: string }
  | { type: "BattleWon" }
  | { type: "BattleLost" };
