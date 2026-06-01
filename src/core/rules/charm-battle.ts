import type {
  CharmBattleState,
  CharmEnemyInstance,
  CharmEvent,
  CharmStatusInstance,
  SexAttr,
  SexCardDef,
  SextechState,
} from "../model/charm.js";
import { WEAKNESS_MAX_STAGE } from "../model/charm.js";
import type { Rng } from "../rng/rng.js";
import type { CharmContentDB } from "../content/loader.js";
import {
  computeGamanDamage,
  computeGamanHeal,
  computeQiDamage,
  ejaculationDamage,
  primaryAttr,
  selfGamanCost,
  sextechDefense,
  sextechGamanBonus,
} from "./charm-damage.js";

// 魅了バトル（とろかし）のターン構造。docs/02「魅了バトルの基本ルール」/「我慢ゲージと絶頂・射精」。
// すべて純粋関数：入力 state は変更せず、新しい state ＋ 発生イベント配列を返す。乱数は注入する。

// 暫定値（docs/02。バランス検証で動かす前提）。
const SEXTECH_POINT_EVERY = 3; // 3ターンごとにポイント獲得
const KOYUKI_GAMAN_REGEN = 2; // こゆきの我慢の毎ターン自然回復（攻めっぱなしだと目減りする水準）
const ENEMY_GAMAN_REGEN = 2; // 敵の我慢の毎ターン自然回復
const GAMAN_MAX_DECAY = 1; // 絶頂・射精のたびに gamanMax が減る量（連続でイクほど早い）
const GAMAN_MAX_FLOOR = 4; // gamanMax の下限
const BASE_KOYUKI_GAMAN_MAX = 12; // こゆきの初期我慢上限（せっくすてくで増える）
const EJAC_HP_LOSS_RATIO = 0.3; // 暴発射精のHP減（maxHp比）
const EJAC_SELF_HP_LOSS = 3; // 狙い撃ち射精のHP減（小・固定）
const EJAC_ENEMY_QI_BONUS = 0; // 暴発時に敵気力へ入る小ダメージ（基本0＝不利）
const ENEMY_CLIMAX_QI_RATIO = 0.4; // 敵絶頂時に気力へ入る追加ダメージ（qiMax比）＝絶頂が気力を崩す主役

export interface CharmSetup {
  enemyDefId: string;
  hp: number;
  maxHp: number;
  sextech: SextechState;
  virgin?: boolean; // 相手が処女か（初挿入専用台詞・終了台詞の出し分け用。未指定=false＝経験済み）。docs/09 §4
}

/** 挿入をともなう性技の属性（初挿入専用台詞の発火対象）。前戯系（くちづけ・乳繰り・ほぐし）は含めない。 */
const PENETRATION_ATTRS: ReadonlySet<SexAttr> = new Set<SexAttr>(["seikou", "ushirodori", "matagari", "uradori"]);

function isPenetration(attr: SexAttr): boolean {
  return PENETRATION_ATTRS.has(attr);
}

interface Result {
  state: CharmBattleState;
  events: CharmEvent[];
}

function clone(state: CharmBattleState): CharmBattleState {
  return structuredClone(state);
}

function aliveEnemies(state: CharmBattleState): CharmEnemyInstance[] {
  return state.enemies.filter((e) => !e.defeated);
}

function makeEnemyInstance(db: CharmContentDB, defId: string, index: number): CharmEnemyInstance {
  const def = db.charmEnemies.get(defId);
  if (!def) throw new Error(`未知の魅了敵ID: ${defId}`);
  return {
    uid: `${defId}#${index}`,
    defId,
    name: def.name,
    qi: def.qi,
    qiMax: def.qi,
    gaman: def.gaman,
    gamanMax: def.gaman,
    qiDefense: def.qiDefense,
    weakness: { ...def.weakness },
    atkDebuff: 0,
    lastHitAttr: null,
    intents: def.intents,
    intentIndex: 0,
    defeated: false,
  };
}

function poisonTotal(statuses: CharmStatusInstance[]): number {
  return statuses.filter((s) => s.id === "poison").reduce((sum, s) => sum + s.x, 0);
}

export function startCharmBattle(db: CharmContentDB, setup: CharmSetup, _rng: Rng): Result {
  const apMax = db.combat.baseAp;
  const gamanMax = BASE_KOYUKI_GAMAN_MAX + sextechGamanBonus(setup.sextech);
  const state: CharmBattleState = {
    kind: "charm",
    enemies: [makeEnemyInstance(db, setup.enemyDefId, 0)],
    hp: setup.hp,
    maxHp: setup.maxHp,
    gaman: gamanMax,
    gamanMax,
    ap: apMax,
    apMax,
    guard: 0,
    sextech: { ...setup.sextech },
    sextechPoints: 0,
    lastActionWasEnemy: false,
    virgin: setup.virgin ?? false,
    statuses: [],
    turn: 1,
    phase: "player",
  };
  return { state, events: [{ type: "TurnStarted", turn: 1 }] };
}

function sexCard(db: CharmContentDB, cardId: string): SexCardDef {
  const def = db.sexCards.get(cardId);
  if (!def) throw new Error(`未知の性技カードID: ${cardId}`);
  return def;
}

/** UIがカードの使用可否を事前判定するための述語。 */
export function canPlaySexCard(db: CharmContentDB, state: CharmBattleState, cardId: string): boolean {
  if (state.phase !== "player") return false;
  if (aliveEnemies(state).length === 0) return false;
  const def = db.sexCards.get(cardId);
  if (!def) return false;
  return state.ap >= def.ap;
}

function firstAliveTarget(state: CharmBattleState, targetUid: string | null): CharmEnemyInstance | undefined {
  const alive = aliveEnemies(state);
  if (targetUid) {
    const chosen = alive.find((e) => e.uid === targetUid);
    if (chosen) return chosen;
  }
  // 既定：最も気力の低い敵（docs/02「単体技は対象を1体選択」）
  return alive.reduce<CharmEnemyInstance | undefined>((lo, e) => (!lo || e.qi < lo.qi ? e : lo), undefined);
}

/** 指定属性の弱点段階を1下げる（絶頂・射精の精神的崩し）。docs/02「部位弱化」。 */
function degradeWeakness(enemy: CharmEnemyInstance, attr: SexAttr, amount: number, events: CharmEvent[]): void {
  if (enemy.weakness[attr] <= 0) return;
  enemy.weakness[attr] = Math.max(0, enemy.weakness[attr] - amount);
  events.push({ type: "WeaknessDown", enemyUid: enemy.uid, attr, newStage: enemy.weakness[attr] });
}

/** 敵の我慢0 → 絶頂（気力に追加ダメージ＋直近属性が弱化＋我慢再充填）。 */
function resolveEnemyClimax(enemy: CharmEnemyInstance, events: CharmEvent[]): void {
  const qiBonus = Math.floor(enemy.qiMax * ENEMY_CLIMAX_QI_RATIO);
  enemy.qi = Math.max(0, enemy.qi - qiBonus);
  events.push({ type: "EnemyClimaxed", enemyUid: enemy.uid, attr: enemy.lastHitAttr, qiBonus });
  if (enemy.lastHitAttr) degradeWeakness(enemy, enemy.lastHitAttr, 1, events);
  // 我慢上限が少し下がり、再充填（連続でイクほど早く次が来る）
  enemy.gamanMax = Math.max(GAMAN_MAX_FLOOR, enemy.gamanMax - GAMAN_MAX_DECAY);
  enemy.gaman = enemy.gamanMax;
  if (enemy.qi <= 0 && !enemy.defeated) {
    enemy.defeated = true;
    enemy.qi = 0;
    events.push({ type: "EnemyExhausted", enemyUid: enemy.uid });
    events.push({ type: "TodomeReady", enemyUid: enemy.uid });
  }
}

/** 敵の気力・我慢へダメージを与え、必要なら放心・絶頂を解決する。 */
function damageEnemy(enemy: CharmEnemyInstance, qiDmg: number, gamanDmg: number, attr: SexAttr | null, events: CharmEvent[]): void {
  if (attr) enemy.lastHitAttr = attr;
  if (qiDmg > 0) {
    enemy.qi = Math.max(0, enemy.qi - qiDmg);
  }
  if (gamanDmg > 0) {
    enemy.gaman = Math.max(0, enemy.gaman - gamanDmg);
    events.push({ type: "GamanDamageDealt", enemyUid: enemy.uid, amount: gamanDmg });
  }
  // 気力0（放心）を先に判定
  if (enemy.qi <= 0 && !enemy.defeated) {
    enemy.defeated = true;
    enemy.qi = 0;
    events.push({ type: "EnemyExhausted", enemyUid: enemy.uid });
    events.push({ type: "TodomeReady", enemyUid: enemy.uid });
    return;
  }
  // 我慢0 → 絶頂
  if (enemy.gaman <= 0 && !enemy.defeated) {
    resolveEnemyClimax(enemy, events);
  }
}

/** こゆきの我慢0 → 射精。trigger=self（狙い撃ち：敵を崩す）／enemy（暴発：HP大減）。戻り値＝この射精で敗北したか。 */
function resolveEjaculation(
  state: CharmBattleState,
  trigger: "self" | "enemy",
  attr: SexAttr | null,
  target: CharmEnemyInstance | null,
  finishToEnemy: number,
  events: CharmEvent[],
  selfHpLoss?: number,
): boolean {
  let hpLoss: number;
  if (trigger === "enemy") {
    // 暴発：主導権を奪われての射精。HP大減、敵への利得は小さい。
    hpLoss = Math.floor(state.maxHp * EJAC_HP_LOSS_RATIO);
    if (target && EJAC_ENEMY_QI_BONUS > 0) {
      damageEnemy(target, EJAC_ENEMY_QI_BONUS, 0, attr, events);
    }
  } else {
    // 狙い撃ち：能動射精。HP小減（カード指定があればそれ＝フェラ/パイズリ等は被ダメ大）。気力へは控えめ・敵の「我慢」に
    // 大ダメージを与えて絶頂を誘発し、絶頂経由で気力を崩す（即殺にはならない）＋部位弱化（呼び出し側で weaken_attr 処理）。
    hpLoss = selfHpLoss ?? EJAC_SELF_HP_LOSS;
    if (target) {
      const dmg = ejaculationDamage(finishToEnemy, state.sextech);
      damageEnemy(target, Math.floor(dmg / 3), dmg, attr, events);
    }
  }
  state.hp = Math.max(0, state.hp - hpLoss);
  events.push({
    type: "Ejaculated",
    trigger,
    attr,
    hpLoss,
    enemyUid: target ? target.uid : null,
  });
  // 我慢上限が少し下がり再充填（連続で出すほど早く次が来る）
  state.gamanMax = Math.max(GAMAN_MAX_FLOOR, state.gamanMax - GAMAN_MAX_DECAY);
  state.gaman = state.gamanMax;
  if (state.hp <= 0) {
    state.phase = "lost";
    events.push({ type: "BattleLost" });
    return true;
  }
  return false;
}

export function playSexCard(
  db: CharmContentDB,
  input: CharmBattleState,
  cardId: string,
  targetUid: string | null,
  _rng: Rng,
): Result {
  if (input.phase !== "player") throw new Error("プレイヤーターンではありません");
  const def = sexCard(db, cardId);
  const state = clone(input);
  if (state.ap < def.ap) throw new Error("APが足りません");
  const enemy = firstAliveTarget(state, targetUid);
  if (!enemy) throw new Error("対象がいません");

  const events: CharmEvent[] = [{ type: "SexCardPlayed", cardId }];
  state.ap -= def.ap;
  const attr = primaryAttr(def);

  const targetedFinish = def.effects.find((e) => e.kind === "targeted_finish");

  // 1) 与気力ダメージ（現在の弱点段階で計算）
  const { amount, stage } = computeQiDamage(def, enemy, state.sextech);
  const gamanDmg = computeGamanDamage(amount);
  events.push({ type: "QiDamageDealt", enemyUid: enemy.uid, amount, stage });
  damageEnemy(enemy, amount, gamanDmg, attr, events);

  // 命中リアクション（docs/09 台詞集）。初挿入＞弱点×2.0＞通常 の優先で1つだけ出す。
  const firstInsertion = state.virgin && isPenetration(attr);
  if (firstInsertion) {
    state.virgin = false; // 処女喪失。以後この戦闘では通常リアクションへ
    events.push({ type: "HitReaction", enemyDefId: enemy.defId, attr, first: true });
  } else if (stage >= WEAKNESS_MAX_STAGE) {
    // 弱点×2.0命中の固有リアクション（docs/02「弱点突かれリアクション」）
    events.push({ type: "WeaknessReaction", enemyDefId: enemy.defId, attr });
  } else {
    events.push({ type: "HitReaction", enemyDefId: enemy.defId, attr, first: false });
  }

  // 2) 付随効果
  for (const eff of def.effects) {
    switch (eff.kind) {
      case "qi_damage":
      case "double_defense_ref":
      case "targeted_finish":
        break; // 別処理
      case "qi_defense_down":
        enemy.qiDefense = Math.max(0, enemy.qiDefense - eff.amount);
        events.push({ type: "QiDefenseDown", enemyUid: enemy.uid, amount: eff.amount });
        break;
      case "heal_from_damage": {
        const heal = computeGamanHeal(amount, eff.ratio);
        if (heal > 0) {
          state.gaman = Math.min(state.gamanMax, state.gaman + heal);
          events.push({ type: "GamanRecovered", amount: heal });
        }
        break;
      }
      case "atk_debuff":
        enemy.atkDebuff += eff.amount;
        events.push({ type: "AtkDebuffApplied", enemyUid: enemy.uid, amount: eff.amount });
        break;
      case "weaken_attr":
        if (!enemy.defeated && enemy.lastHitAttr) degradeWeakness(enemy, enemy.lastHitAttr, eff.amount, events);
        break;
      case "guard_up":
        state.guard += eff.amount;
        events.push({ type: "GuardChanged", amount: eff.amount });
        break;
      case "guard_down":
        state.guard = Math.max(0, state.guard - eff.amount);
        events.push({ type: "GuardChanged", amount: -eff.amount });
        break;
    }
  }

  // 3) こゆき自身の我慢消費（高火力技ほど高ぶる）。狙い撃ち技は即0で能動射精。
  if (targetedFinish && targetedFinish.kind === "targeted_finish") {
    state.gaman = 0;
    state.lastActionWasEnemy = false;
    resolveEjaculation(state, "self", attr, enemy.defeated ? null : enemy, targetedFinish.gamanToEnemy, events, targetedFinish.selfHpLoss);
  } else {
    const cost = selfGamanCost(def);
    state.gaman = Math.max(0, state.gaman - cost);
    events.push({ type: "KoyukiGamanSelf", amount: cost });
    if (state.gaman <= 0) {
      // 自分の攻めで高ぶって暴発（不利な射精）。
      state.lastActionWasEnemy = false;
      resolveEjaculation(state, "enemy", attr, enemy.defeated ? null : enemy, 0, events);
    }
  }

  return { state, events };
}

function pickTodomeTarget(state: CharmBattleState, targetUid: string | null): CharmEnemyInstance | undefined {
  if (targetUid) {
    const chosen = state.enemies.find((e) => e.uid === targetUid);
    if (chosen) return chosen;
  }
  return state.enemies.find((e) => e.defeated);
}

/** とどめ！は敵の気力0（放心）でのみ使用可（docs/02）。 */
export function todomeReady(state: CharmBattleState, targetUid: string | null): boolean {
  const enemy = pickTodomeTarget(state, targetUid);
  return !!enemy && enemy.defeated;
}

/** 「とどめ！」：放心した敵にノーコストで確殺（docs/02「『とどめ！』カード仕様」）。お豊なら加入。 */
export function useTodome(
  db: CharmContentDB,
  input: CharmBattleState,
  targetUid: string | null,
  _rng: Rng,
): Result {
  if (input.phase !== "player") throw new Error("プレイヤーターンではありません");
  const state = clone(input);
  const enemy = pickTodomeTarget(state, targetUid);
  if (!enemy || !enemy.defeated) throw new Error("とどめは相手が気力0のときのみ使えます");

  // とどめ＝膣内中出し（docs/09 §6-1）＝挿入そのもの。処女のまま到達した場合はこの瞬間が初挿入＝処女喪失。
  const first = state.virgin;
  if (first) state.virgin = false;
  const events: CharmEvent[] = [{ type: "TodomeUsed", enemyUid: enemy.uid, first }];
  enemy.qi = 0;
  const def = db.charmEnemies.get(enemy.defId);
  if (def?.joinCompanionId) {
    events.push({ type: "CompanionJoined", companionId: def.joinCompanionId });
  }
  if (aliveEnemies(state).length === 0) {
    state.phase = "won";
    events.push({ type: "BattleWon" });
  }
  return { state, events };
}

/** せっくすてくポイントを1部位へ割り振る（docs/02「せっくすてくポイント割り振り」）。 */
export function allocateSextech(input: CharmBattleState, part: keyof SextechState): CharmBattleState {
  if (input.sextechPoints <= 0) return input;
  const state = clone(input);
  state.sextechPoints -= 1;
  state.sextech[part] += 1;
  // 我慢タフネス（身・切先）を上げたら gamanMax にも反映
  const newMax = BASE_KOYUKI_GAMAN_MAX + sextechGamanBonus(state.sextech);
  const diff = newMax - state.gamanMax;
  state.gamanMax = newMax;
  if (diff > 0) state.gaman += diff;
  return state;
}

/** 自動割り振り（既定＝威力寄り：身→鎬→切先）。docs/02「自動割り振りボタン」。 */
export function autoAllocateSextech(input: CharmBattleState): CharmBattleState {
  let state = input;
  while (state.sextechPoints > 0) {
    state = allocateSextech(state, "mi");
  }
  return state;
}

export function endCharmTurn(_db: CharmContentDB, input: CharmBattleState, _rng: Rng): Result {
  if (input.phase !== "player") throw new Error("プレイヤーターンではありません");
  const state = clone(input);
  const events: CharmEvent[] = [];
  state.phase = "enemy";

  for (const enemy of state.enemies) {
    if (enemy.defeated) continue;
    const intent = enemy.intents[enemy.intentIndex];
    events.push({ type: "EnemyActed", enemyUid: enemy.uid, intentId: intent.id });

    for (const eff of intent.effects) {
      if (eff.kind === "gaman_attack") {
        // 四十八手はこゆきの「我慢」を削る（守り＋せっくすてく守りで軽減）。
        const raw = Math.max(0, eff.amount - enemy.atkDebuff);
        const guardUse = Math.min(state.guard, raw);
        state.guard -= guardUse;
        const afterGuard = raw - guardUse;
        const taken = Math.max(0, afterGuard - sextechDefense(state.sextech));
        state.gaman = Math.max(0, state.gaman - taken);
        events.push({ type: "KoyukiGamanDamaged", amount: taken, blocked: raw - taken });
        if (state.gaman <= 0) {
          // 敵に削り切られての暴発（不利な射精）。
          state.lastActionWasEnemy = true;
          const lost = resolveEjaculation(state, "enemy", null, enemy, 0, events);
          if (lost) return { state, events };
        }
      } else if (eff.kind === "apply_status") {
        state.statuses.push({ id: eff.status, x: eff.x, turns: 3 });
        events.push({ type: "StatusApplied", status: eff.status, x: eff.x });
      }
    }

    enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intents.length;
  }

  // 出血（防御無視DoT・ターン終了時）。docs/01「出血」。
  let bleed = 0;
  for (const s of state.statuses) if (s.id === "bleed") bleed += s.x;
  if (bleed > 0) {
    state.hp = Math.max(0, state.hp - bleed);
    for (const s of state.statuses) if (s.id === "bleed") s.x = Math.floor(s.x / 2);
    if (state.hp <= 0) {
      state.phase = "lost";
      events.push({ type: "BattleLost" });
      return { state, events };
    }
  }
  state.statuses = state.statuses.filter((s) => !(s.id === "bleed" && s.x <= 0));

  // 次ターン開始フェイズ
  state.turn += 1;
  for (const s of state.statuses) s.turns -= 1;
  state.statuses = state.statuses.filter((s) => s.turns > 0);
  state.ap = Math.max(0, state.apMax - poisonTotal(state.statuses)); // 毒＝AP低下
  state.guard = 0;

  // 我慢の自然回復（消耗型＋一部回復。docs/02）。
  state.gaman = Math.min(state.gamanMax, state.gaman + KOYUKI_GAMAN_REGEN);
  for (const enemy of state.enemies) {
    if (enemy.defeated) continue;
    enemy.gaman = Math.min(enemy.gamanMax, enemy.gaman + ENEMY_GAMAN_REGEN);
  }

  state.phase = "player";

  // 3ターンごとにせっくすてくポイント獲得（docs/02）
  if (state.turn % SEXTECH_POINT_EVERY === 0) {
    state.sextechPoints += 1;
    events.push({ type: "SextechPointGained", total: state.sextechPoints });
  }

  events.push({ type: "TurnStarted", turn: state.turn });
  return { state, events };
}
