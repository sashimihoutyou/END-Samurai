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

const statusId = z.enum(["poison", "bleed", "stun"]);

const cardEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("attack"), multiplier: z.number(), ignoreDefense: z.boolean().optional() }),
  z.object({ kind: z.literal("fixed_damage"), amount: z.number().int(), ignoreDefense: z.boolean().optional() }),
  z.object({ kind: z.literal("block"), amount: z.number().int() }),
  z.object({ kind: z.literal("dodge_next") }),
  z.object({ kind: z.literal("repair_part"), part: swordPart, cap: z.string().optional() }),
  z.object({ kind: z.literal("heal"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("enemy_defense_down"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("self_degrade"), part: swordPart, stages: z.number().int().positive().optional() }),
  z.object({ kind: z.literal("apply_status"), status: statusId, x: z.number().int().positive(), toTarget: z.boolean() }),
  z.object({ kind: z.literal("buff_attack"), amount: z.number().int() }),
  z.object({ kind: z.literal("buff_defense"), amount: z.number().int() }),
  z.object({ kind: z.literal("buff_combo"), amount: z.number() }),
  z.object({ kind: z.literal("ap_discount"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("nullify_degrade"), count: z.number().int().positive() }),
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
  upgradeId: z.string().optional(),
  value: z.number().int().nonnegative().optional(),
});

// 同行仲間（docs/03「仲間スキル」）。
export const companionDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  activeCardId: z.string(),
  passive: z.enum(["battle_start_defense", "battle_start_upgrade"]),
});

const enemyEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("damage"), amount: z.number().int() }),
  z.object({ kind: z.literal("apply_status"), status: statusId, x: z.number().int().positive() }),
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
  bounty: z.number().int().nonnegative().optional(),
  charmTarget: z.boolean().optional(),
  isBoss: z.boolean().optional(),
});

// ── 魅了バトル（docs/02・08 §2.6）──────────────────────────────

const sexAttr = z.enum([
  "kuchizuke",
  "hogushi",
  "chichikuri",
  "seikou",
  "ushirodori",
  "matagari",
  "uradori",
]);

const sexEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("qi_damage") }),
  z.object({ kind: z.literal("qi_defense_down"), amount: z.number().int() }),
  z.object({ kind: z.literal("heal_from_damage"), ratio: z.number().positive().max(1) }),
  z.object({ kind: z.literal("atk_debuff"), amount: z.number().int() }),
  z.object({ kind: z.literal("double_defense_ref") }),
  z.object({ kind: z.literal("weaken_attr"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("guard_up"), amount: z.number().int() }),
  z.object({ kind: z.literal("guard_down"), amount: z.number().int() }),
  z.object({ kind: z.literal("targeted_finish"), gamanToEnemy: z.number().int().nonnegative(), selfHpLoss: z.number().int().nonnegative().optional() }),
]);

export const sexCardDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  attrs: z.array(sexAttr).nonempty(),
  ap: z.number().int().nonnegative(),
  baseQi: z.number().int().nonnegative(),
  target: z.enum(["single", "all"]),
  effects: z.array(sexEffectSchema),
  flavorKey: z.string().optional(),
});

const weaknessSchema = z.object({
  kuchizuke: z.number().int().min(0).max(3),
  hogushi: z.number().int().min(0).max(3),
  chichikuri: z.number().int().min(0).max(3),
  seikou: z.number().int().min(0).max(3),
  ushirodori: z.number().int().min(0).max(3),
  matagari: z.number().int().min(0).max(3),
  uradori: z.number().int().min(0).max(3),
});

const charmEnemyEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gaman_attack"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("apply_status"), status: z.string(), x: z.number().int() }),
]);

const charmIntentSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
  effects: z.array(charmEnemyEffectSchema),
});

export const charmEnemyDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  qi: z.number().int().positive(),
  gaman: z.number().int().positive(),
  qiDefense: z.number().int().nonnegative(),
  weakness: weaknessSchema,
  intents: z.array(charmIntentSchema).nonempty(),
  joinCompanionId: z.string().optional(),
});

export const textSchema = z.record(z.union([z.string(), z.array(z.string())]));

// ── マップ・イベント（docs/08 §2.7 / §2.8）─────────────────────

const mapNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["start", "battle", "boss", "camp", "rest", "charm_encounter", "event", "onsen"]),
  label: z.string(),
  next: z.array(z.string()),
  textKey: z.string().optional(),
  enemyGroup: z.array(z.string()).optional(),
  eventId: z.string().optional(),
  onsenIds: z.array(z.string()).optional(),
  heal: z.number().int().positive().optional(),
});

export const mapDefSchema = z.object({
  area: z.string(),
  entry: z.string(),
  nodes: z.array(mapNodeSchema).nonempty(),
});

const eventOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start_charm_battle"), enemyId: z.string() }),
  z.object({ kind: z.literal("start_normal_battle"), enemyGroup: z.array(z.string()).nonempty() }),
  z.object({ kind: z.literal("heal"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("continue") }),
]);

export const eventDefSchema = z.object({
  id: z.string(),
  kind: z.enum(["charm_encounter", "companion_join", "rest", "secret_nearmiss"]),
  introKey: z.string(),
  choices: z.array(z.object({ labelKey: z.string(), outcome: eventOutcomeSchema })).nonempty(),
});

// 温泉イベント（docs/05 リメイク）。5段の選択式エロシーン（加点制・中断なし）。
const sextechPart = z.enum(["mi", "shinogi", "kissaki"]);
const onsenChoiceSchema = z.object({
  labelKey: z.string(),
  score: z.number().int().min(0),
  resultKey: z.string(),
  tag: z.string().optional(),
});
const onsenStageSchema = z.object({
  textKey: z.string(),
  choices: z.array(onsenChoiceSchema).min(2),
});
export const onsenEventSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  partnerSource: z.enum(["companion", "rescued"]),
  introKey: z.string(),
  stages: z.array(onsenStageSchema).nonempty(),
  threshold: z.number().int().positive(),
  rewardPart: sextechPart,
  rewardDivisor: z.number().int().positive(),
  leadOutcomeKey: z.string(),
  indulgentOutcomeKey: z.string(),
  multipliers: z.record(z.string(), z.number().positive()).optional(),
  minRescued: z.number().int().positive().optional(),
});

// 戦闘報酬（docs/03「戦闘報酬」・docs/08 §10 ドロップ候補）。
export const rewardsSchema = z.object({
  dropPool: z.array(z.string()).nonempty(), // 田舎で入手しうるカードID
});

// 野営地の施設（docs/03「野営地」「経済システム」）。在庫・価格・売却レートを外部化。
const shopStockSchema = z.object({
  cardId: z.string(),
  price: z.number().int().nonnegative(),
});
const shopDefSchema = z.object({
  id: z.string(),
  nameKey: z.string(),
  descKey: z.string(),
  kind: z.enum(["buy", "buy_sell", "buy_forget"]),
  stock: z.array(shopStockSchema),
  requiresCompanion: z.string().optional(),
});
export const shopsSchema = z.object({
  sellRatio: z.number().positive().max(1),
  shops: z.array(shopDefSchema).nonempty(),
});

export const contentSchema = z.object({
  combat: combatConfigSchema,
  swordStages: z.array(swordPartStagesSchema).length(3),
  cards: z.array(cardDefSchema).nonempty(),
  enemies: z.array(enemyDefSchema).nonempty(),
  sexCards: z.array(sexCardDefSchema).nonempty(),
  charmEnemies: z.array(charmEnemyDefSchema).nonempty(),
  maps: z.array(mapDefSchema).nonempty(),
  events: z.array(eventDefSchema).nonempty(),
  onsen: z.array(onsenEventSchema).nonempty(),
  companions: z.array(companionDefSchema).nonempty(),
  rewards: rewardsSchema,
  shops: shopsSchema,
  text: textSchema,
});

export type CombatConfig = z.infer<typeof combatConfigSchema>;
export type Content = z.infer<typeof contentSchema>;
export type TextData = z.infer<typeof textSchema>;
