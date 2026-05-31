import type {
  CharmBattleState,
  CharmEnemyInstance,
  CharmEvent,
  CharmStatusInstance,
  SexAttr,
  SexCardDef,
  SextechState,
} from "../model/charm.js";
import {
  DEVELOP_HITS_PER_STAGE,
  WEAKNESS_MAX_STAGE,
} from "../model/charm.js";
import type { Rng } from "../rng/rng.js";
import type { CharmContentDB } from "../content/loader.js";
import {
  computeHeal,
  computeQiDamage,
  primaryAttr,
  sextechDefense,
  sextechDevAccelRate,
} from "./charm-damage.js";

// 魅了バトル（とろかし）のターン構造。docs/02「魅了バトルの基本ルール」/ docs/08 §5「魅了バトル（最小実装）」。
// すべて純粋関数：入力 state は変更せず、新しい state ＋ 発生イベント配列を返す。乱数は注入する。

// 「とどめ！」仕様（docs/02「『とどめ！』カード仕様」）。暫定値。
const TODOME_BASE = 8;
const TODOME_HIT_CAP = 8; // 「突いた回数」上乗せの上限（フィニッシュ膨張防止）
const SEXTECH_POINT_EVERY = 3; // 3ターンごとにポイント獲得

export interface CharmSetup {
  enemyDefId: string;
  hp: number;
  maxHp: number;
  sextech: SextechState;
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
    qiDefense: def.qiDefense,
    weakness: { ...def.weakness },
    development: {
      kuchizuke: 0,
      hogushi: 0,
      chichikuri: 0,
      seikou: 0,
      ushirodori: 0,
      matagari: 0,
      uradori: 0,
    },
    atkDebuff: 0,
    allStatsDown: 0,
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
  const state: CharmBattleState = {
    kind: "charm",
    enemies: [makeEnemyInstance(db, setup.enemyDefId, 0)],
    hp: setup.hp,
    maxHp: setup.maxHp,
    ap: apMax,
    apMax,
    guard: 0,
    sextech: { ...setup.sextech },
    sextechPoints: 0,
    tedomeHits: 0,
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

function applyDevelopment(
  enemy: CharmEnemyInstance,
  attr: SexAttr,
  extraHits: number,
  events: CharmEvent[],
): void {
  if (enemy.weakness[attr] >= WEAKNESS_MAX_STAGE) return; // 頭打ち
  enemy.development[attr] += 1 + extraHits;
  while (enemy.development[attr] >= DEVELOP_HITS_PER_STAGE && enemy.weakness[attr] < WEAKNESS_MAX_STAGE) {
    enemy.development[attr] -= DEVELOP_HITS_PER_STAGE;
    enemy.weakness[attr] += 1;
    events.push({ type: "DevelopmentUp", enemyUid: enemy.uid, attr, newStage: enemy.weakness[attr] });
  }
  if (enemy.weakness[attr] >= WEAKNESS_MAX_STAGE) enemy.development[attr] = 0;
}

export function playSexCard(
  db: CharmContentDB,
  input: CharmBattleState,
  cardId: string,
  targetUid: string | null,
  rng: Rng,
): Result {
  if (input.phase !== "player") throw new Error("プレイヤーターンではありません");
  const def = sexCard(db, cardId);
  const state = clone(input);
  if (state.ap < def.ap) throw new Error("APが足りません");
  const enemy = firstAliveTarget(state, targetUid);
  if (!enemy) throw new Error("対象がいません");

  const events: CharmEvent[] = [{ type: "SexCardPlayed", cardId }];
  state.ap -= def.ap;
  state.tedomeHits += 1; // 「突いた回数」

  // 1) 与気力ダメージ（現在の弱点段階で計算）
  const { amount, stage } = computeQiDamage(def, enemy, state.sextech);
  enemy.qi = Math.max(0, enemy.qi - amount);
  events.push({ type: "QiDamageDealt", enemyUid: enemy.uid, amount, stage, developable: def.developable });

  // 弱点×2.0命中の固有リアクション（docs/02「弱点突かれリアクション」）
  if (stage >= WEAKNESS_MAX_STAGE && def.developable) {
    events.push({ type: "WeaknessReaction", enemyDefId: enemy.defId, attr: primaryAttr(def) });
  }

  // 2) 開発（単体技のみ。連撃＝せっくすてくで加速）
  if (def.developable) {
    const accel = rng.chance(sextechDevAccelRate(state.sextech)) ? 1 : 0;
    applyDevelopment(enemy, primaryAttr(def), accel, events);
  }

  // 3) 付随効果
  for (const eff of def.effects) {
    switch (eff.kind) {
      case "qi_damage":
      case "double_defense_ref":
        break; // 1) で処理済み
      case "qi_defense_down":
        enemy.qiDefense = Math.max(0, enemy.qiDefense - eff.amount);
        events.push({ type: "QiDefenseDown", enemyUid: enemy.uid, amount: eff.amount });
        break;
      case "heal_from_damage": {
        const heal = computeHeal(amount, eff.ratio);
        if (heal > 0) {
          state.hp = Math.min(state.maxHp, state.hp + heal);
          events.push({ type: "Healed", amount: heal });
        }
        break;
      }
      case "atk_debuff":
        enemy.atkDebuff += eff.amount;
        events.push({ type: "AtkDebuffApplied", enemyUid: enemy.uid, amount: eff.amount });
        break;
      case "all_stats_down":
        if (amount > 0) {
          enemy.qiDefense = Math.max(0, enemy.qiDefense - eff.amount);
          enemy.allStatsDown += eff.amount;
          events.push({ type: "AllStatsDown", enemyUid: enemy.uid, amount: eff.amount });
        }
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

  // 気力0＝痙攣放置（戦線離脱）。撃破には「とどめ！」が必要（docs/02）。
  if (enemy.qi <= 0 && !enemy.defeated) {
    enemy.defeated = true;
    enemy.qi = 0;
    events.push({ type: "EnemyClimaxed", enemyUid: enemy.uid });
  }
  if (todomeIsFinisherFor(state, enemy)) {
    events.push({ type: "TodomeReady", enemyUid: enemy.uid });
  }

  return { state, events };
}

/** 「とどめ！」の与気力ダメージ ＝ 基礎 ＋ 突いた回数（上限） ＋ せっくすてく威力。 */
export function todomeDamage(state: CharmBattleState): number {
  return TODOME_BASE + Math.min(state.tedomeHits, TODOME_HIT_CAP) + state.sextech.mi + state.sextech.shinogi;
}

function todomeIsFinisherFor(state: CharmBattleState, enemy: CharmEnemyInstance): boolean {
  return enemy.defeated || enemy.qi <= 0 || todomeDamage(state) >= enemy.qi;
}

/** UIが「とどめ！」のフィニッシュ可否を判定する。 */
export function todomeReady(state: CharmBattleState, targetUid: string | null): boolean {
  const enemy = pickTodomeTarget(state, targetUid);
  return enemy ? todomeIsFinisherFor(state, enemy) : false;
}

function pickTodomeTarget(state: CharmBattleState, targetUid: string | null): CharmEnemyInstance | undefined {
  if (targetUid) {
    const chosen = state.enemies.find((e) => e.uid === targetUid);
    if (chosen) return chosen;
  }
  // 気力0で離脱済みの敵を最優先（救済＝とどめ対象）。なければ最も気力が低い敵。
  const climaxed = state.enemies.find((e) => e.defeated);
  if (climaxed) return climaxed;
  return state.enemies.reduce<CharmEnemyInstance | undefined>((lo, e) => (!lo || e.qi < lo.qi ? e : lo), undefined);
}

/**
 * 「とどめ！」（docs/02「『とどめ！』カード仕様」）。
 * フィニッシャー成立時はノーコストで撃破。非成立時は「現在HPの半分＋残りAP全部」を払って気力を削る。
 */
export function useTodome(
  db: CharmContentDB,
  input: CharmBattleState,
  targetUid: string | null,
  _rng: Rng,
): Result {
  if (input.phase !== "player") throw new Error("プレイヤーターンではありません");
  const state = clone(input);
  const enemy = pickTodomeTarget(state, targetUid);
  if (!enemy) throw new Error("対象がいません");

  const events: CharmEvent[] = [];
  const finisher = todomeIsFinisherFor(state, enemy);

  if (finisher) {
    // フィニッシャー：ノーコストで撃破
    enemy.qi = 0;
    enemy.defeated = true;
    events.push({ type: "TodomeUsed", enemyUid: enemy.uid, finisher: true });
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

  // 割合コスト版：現在HPの半分＋残りAP全部。最低HP保証（HP1以下にならない）。
  const cost = Math.floor(state.hp / 2);
  state.hp -= cost; // 残りHP ＝ ceil(hp/2) ≧ 1
  state.ap = 0;
  const dmg = todomeDamage(state);
  enemy.qi = Math.max(0, enemy.qi - dmg);
  events.push({ type: "TodomeUsed", enemyUid: enemy.uid, finisher: false });
  events.push({ type: "QiDamageDealt", enemyUid: enemy.uid, amount: dmg, stage: 1, developable: false });
  if (enemy.qi <= 0 && !enemy.defeated) {
    enemy.defeated = true;
    events.push({ type: "EnemyClimaxed", enemyUid: enemy.uid });
    events.push({ type: "TodomeReady", enemyUid: enemy.uid });
  }
  return { state, events };
}

/** せっくすてくポイントを1部位へ割り振る（docs/02「せっくすてくポイント割り振り」）。 */
export function allocateSextech(input: CharmBattleState, part: keyof SextechState): CharmBattleState {
  if (input.sextechPoints <= 0) return input;
  const state = clone(input);
  state.sextechPoints -= 1;
  state.sextech[part] += 1;
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
      if (eff.kind === "damage") {
        const raw = Math.max(0, eff.amount - enemy.atkDebuff);
        const guardUse = Math.min(state.guard, raw);
        state.guard -= guardUse;
        const afterGuard = raw - guardUse;
        const taken = Math.max(0, afterGuard - sextechDefense(state.sextech));
        state.hp = Math.max(0, state.hp - taken);
        events.push({ type: "KoyukiDamaged", amount: taken, blocked: raw - taken });
      } else if (eff.kind === "apply_status") {
        state.statuses.push({ id: eff.status, x: eff.x, turns: 3 });
        events.push({ type: "StatusApplied", status: eff.status, x: eff.x });
      } else if (eff.kind === "self_climax") {
        enemy.qi = Math.max(0, enemy.qi - eff.qi);
        if (enemy.qi <= 0 && !enemy.defeated) {
          enemy.defeated = true;
          events.push({ type: "EnemyClimaxed", enemyUid: enemy.uid });
          events.push({ type: "TodomeReady", enemyUid: enemy.uid });
        }
      }
    }

    enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intents.length;

    if (state.hp <= 0) {
      state.phase = "lost";
      events.push({ type: "BattleLost" });
      return { state, events };
    }
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
  state.phase = "player";

  // 3ターンごとにせっくすてくポイント獲得（docs/02）
  if (state.turn % SEXTECH_POINT_EVERY === 0) {
    state.sextechPoints += 1;
    events.push({ type: "SextechPointGained", total: state.sextechPoints });
  }

  events.push({ type: "TurnStarted", turn: state.turn });
  return { state, events };
}
