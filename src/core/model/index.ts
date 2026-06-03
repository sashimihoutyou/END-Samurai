// model 層の再エクスポート（UI/テストからの参照を簡潔にする）。
export type { SwordPart, SwordState, SwordStage, SwordPartStages, SwordStageMods } from "./sword.js";
export type { CardDef, CardInstance, CardCategory, CardEffect, CardRequirement, TargetType } from "./card.js";
export type { EnemyDef, EnemyInstance, EnemyArchetype, EnemyEffect, IntentDef } from "./enemy.js";
export type { BattleState, BattleEvent, BattlePhase, BonusPools } from "./battle-state.js";
export type {
  SexAttr,
  SizeCategory,
  SizePreference,
  HandCount,
  TorokashiEnemyDef,
  ChoiceResult,
  TorokashiOutcome,
  TorokashiState,
  TorokashiEvent,
} from "./torokashi.js";
export { ALL_ATTRS, SECOND_LOOP_ONLY } from "./torokashi.js";
export type { RunState, RunCompanion, Affection, PartInventory } from "./run-state.js";
export type { ShopData, ShopDef, ShopStock, ShopKind, ShopPart, FusionRecipe } from "./shop.js";
