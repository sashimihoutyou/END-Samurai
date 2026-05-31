// model 層の再エクスポート（UI/テストからの参照を簡潔にする）。
export type { SwordPart, SwordState, SwordStage, SwordPartStages, SwordStageMods } from "./sword.js";
export type { CardDef, CardInstance, CardCategory, CardEffect, CardRequirement, TargetType } from "./card.js";
export type { EnemyDef, EnemyInstance, EnemyArchetype, EnemyEffect, IntentDef } from "./enemy.js";
export type { BattleState, BattleEvent, BattlePhase, BonusPools } from "./battle-state.js";
