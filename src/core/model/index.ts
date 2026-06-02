// model 層の再エクスポート（UI/テストからの参照を簡潔にする）。
export type { SwordPart, SwordState, SwordStage, SwordPartStages, SwordStageMods } from "./sword.js";
export type { CardDef, CardInstance, CardCategory, CardEffect, CardRequirement, TargetType } from "./card.js";
export type { EnemyDef, EnemyInstance, EnemyArchetype, EnemyEffect, IntentDef } from "./enemy.js";
export type { BattleState, BattleEvent, BattlePhase, BonusPools } from "./battle-state.js";
export type {
  SexAttr,
  SexEffect,
  SexCardDef,
  CharmEnemyEffect,
  CharmIntentDef,
  CharmEnemyDef,
  CharmEnemyInstance,
  CharmStatusInstance,
  SextechState,
  CharmPhase,
  CharmBattleState,
  CharmEvent,
} from "./charm.js";
export {
  WEAKNESS_MULTIPLIERS,
  WEAKNESS_MAX_STAGE,
  weaknessMultiplier,
} from "./charm.js";
export type { RunState, RunCompanion, Affection, PartInventory } from "./run-state.js";
export type { ShopData, ShopDef, ShopStock, ShopKind, ShopPart, FusionRecipe } from "./shop.js";
