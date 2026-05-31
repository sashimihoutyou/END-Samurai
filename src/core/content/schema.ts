import { z } from "zod";

// JSONコンテンツの実行時バリデーション。スキーマずれを早期検出する。
// docs/08「データスキーマ」に対応。α版 Phase 1 の範囲のみを厳密化し、
// 後続フェーズの effect 種別はその都度ここへ追加する。

const swordPart = z.enum(["blade", "tsuba", "tsuka"]);

export const combatConfigSchema = z.object({
  baseAp: z.number().int(),
  baseMaxHp: z.number().int(),
  baseBladeAttack: z.number().int(),
  baseTsubaDefense: z.number().int(),
  handLimit: z.number().int().positive(),
});

const swordStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  mods: z
    .object({
      attack: z.number().optional(),
      ap: z.number().optional(),
      baseDefense: z.number().optional(),
      comboRate: z.number().optional(),
      debuffNullifyRate: z.number().optional(),
    })
    .strict(),
});

export const swordPartStagesSchema = z.object({
  part: swordPart,
  baseStageId: z.string(),
  stages: z.array(swordStageSchema).nonempty(),
});

const cardEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("attack"), multiplier: z.number(), ignoreDefense: z.boolean().optional() }),
  z.object({ kind: z.literal("fixed_damage"), amount: z.number().int(), ignoreDefense: z.boolean().optional() }),
  z.object({ kind: z.literal("block"), amount: z.number().int() }),
  z.object({ kind: z.literal("dodge_next") }),
]);

const cardRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blade_stage_at_least"), stage: z.string() }),
  z.object({ kind: z.literal("no_action_last_turn") }),
]);

export const cardDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["skill", "item", "companion_active"]),
  ap: z.number().int().nonnegative(),
  target: z.enum(["single", "all", "pierce", "self", "self_aoe"]),
  flavorKey: z.string().optional(),
  effects: z.array(cardEffectSchema),
  requirements: z.array(cardRequirementSchema).optional(),
  uses: z.number().int().positive().optional(),
});

const enemyEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("damage"), amount: z.number().int() }),
  z.object({ kind: z.literal("apply_status"), status: z.string(), x: z.number().int() }),
  z.object({ kind: z.literal("degrade_part"), part: swordPart, chance: z.number() }),
  z.object({ kind: z.literal("grab") }),
]);

const intentSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
  effects: z.array(enemyEffectSchema),
  telegraphPart: swordPart.optional(),
  concealEffect: z.boolean().optional(),
});

export const enemyDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  archetype: z.enum(["cyclic", "sniper", "timed", "random_intent", "concealed", "synergy"]),
  hp: z.number().int().positive(),
  defense: z.number().int().nonnegative(),
  intents: z.array(intentSchema).nonempty(),
  charmTarget: z.boolean().optional(),
  isBoss: z.boolean().optional(),
});

export const contentSchema = z.object({
  combat: combatConfigSchema,
  swordStages: z.array(swordPartStagesSchema).length(3),
  cards: z.array(cardDefSchema).nonempty(),
  enemies: z.array(enemyDefSchema).nonempty(),
});

export type CombatConfig = z.infer<typeof combatConfigSchema>;
export type Content = z.infer<typeof contentSchema>;
