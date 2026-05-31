import type { CardDef, CardInstance } from "../model/card.js";
import type { EnemyInstance } from "../model/enemy.js";
import type { SwordState } from "../model/sword.js";
import type { BattleEvent, BattleState } from "../model/battle-state.js";
import type { Rng } from "../rng/rng.js";
import { getStage, type ContentDB } from "../content/loader.js";
import {
  bladeAttackPower,
  cardApCost,
  comboRate,
  computeAttackDamage,
  computeFixedDamage,
} from "./damage.js";

// 通常戦闘（HP戦）のターン構造。docs/01「ターン構造」に対応。
// すべて純粋関数：入力 state は変更せず、新しい state ＋ 発生イベント配列を返す。
// 乱数は rng として注入する（グローバル乱数を呼ばない）。

const COMBO_RATE_CAP = 0.3; // 連撃率ボーナスの上限（docs/01）。柄基礎20%と合算で総≈50%

export interface BattleSetup {
  deck: CardInstance[];
  sword: SwordState;
  hp: number;
  maxHp: number;
  enemyDefIds: string[];
}

interface Result {
  state: BattleState;
  events: BattleEvent[];
}

function clone(state: BattleState): BattleState {
  return structuredClone(state);
}

function aliveEnemies(state: BattleState): EnemyInstance[] {
  return state.enemies.filter((e) => e.hp > 0);
}

function makeEnemyInstance(db: ContentDB, defId: string, index: number): EnemyInstance {
  const def = db.enemies.get(defId);
  if (!def) throw new Error(`未知の敵ID: ${defId}`);
  return {
    uid: `${defId}#${index}`,
    defId,
    name: def.name,
    hp: def.hp,
    maxHp: def.hp,
    defense: def.defense,
    archetype: def.archetype,
    intents: def.intents,
    intentIndex: 0,
  };
}

/** 山札から手札上限まで補充する（山札が尽きたら捨て札をシャッフルして戻す）。 */
function drawToHandLimit(state: BattleState, db: ContentDB, rng: Rng): void {
  const limit = db.combat.handLimit;
  while (state.hand.length < limit) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      state.drawPile = rng.shuffle(state.discardPile);
      state.discardPile = [];
    }
    const card = state.drawPile.shift();
    if (!card) break;
    state.hand.push(card);
  }
}

export function startBattle(db: ContentDB, setup: BattleSetup, rng: Rng): Result {
  const apMax = db.combat.baseAp;
  const state: BattleState = {
    kind: "normal",
    enemies: setup.enemyDefIds.map((id, i) => makeEnemyInstance(db, id, i)),
    hand: [],
    drawPile: rng.shuffle(setup.deck),
    discardPile: [],
    ap: apMax,
    apMax,
    blockPool: 0,
    bonusPools: { attack: 0, defense: 0, comboRate: 0 },
    hp: setup.hp,
    maxHp: setup.maxHp,
    sword: setup.sword,
    turn: 1,
    actedThisTurn: false,
    dodgeNext: false,
    phase: "player",
  };
  drawToHandLimit(state, db, rng);
  return { state, events: [{ type: "TurnStarted", turn: 1 }] };
}

function cardDef(db: ContentDB, inst: CardInstance): CardDef {
  const def = db.cards.get(inst.defId);
  if (!def) throw new Error(`未知のカードID: ${inst.defId}`);
  return def;
}

function meetsRequirements(db: ContentDB, def: CardDef, state: BattleState): boolean {
  if (!def.requirements) return true;
  for (const req of def.requirements) {
    if (req.kind === "no_action_last_turn") {
      if (state.actedThisTurn) return false;
    } else if (req.kind === "blade_stage_at_least") {
      const current = getStage(db, "blade", state.sword.blade).order;
      const needed = getStage(db, "blade", req.stage).order;
      if (current < needed) return false;
    }
  }
  return true;
}

/** UIがカードの使用可否を事前判定するための述語。 */
export function canPlayCard(db: ContentDB, state: BattleState, cardUid: string): boolean {
  if (state.phase !== "player") return false;
  const inst = state.hand.find((c) => c.uid === cardUid);
  if (!inst) return false;
  const def = cardDef(db, inst);
  if (state.ap < cardApCost(db, def, state.sword)) return false;
  return meetsRequirements(db, def, state);
}

function autoTarget(state: BattleState): string | null {
  const alive = aliveEnemies(state);
  if (alive.length === 0) return null;
  // 既定：最もHPが低い敵（docs/01「ターゲティング・単体」）
  return alive.reduce((lo, e) => (e.hp < lo.hp ? e : lo)).uid;
}

function applyDamage(state: BattleState, enemyUid: string, amount: number, events: BattleEvent[], ignoredDefense: boolean): void {
  const enemy = state.enemies.find((e) => e.uid === enemyUid);
  if (!enemy || enemy.hp <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - amount);
  events.push({ type: "DamageDealt", enemyUid, amount, ignoredDefense });
  if (enemy.hp === 0) events.push({ type: "EnemyDefeated", enemyUid });
}

function tryCombo(db: ContentDB, state: BattleState, lastTargetUid: string, basePower: number, multiplier: number, events: BattleEvent[], rng: Rng): void {
  const rate = Math.min(comboRate(db, state.sword, Math.min(state.bonusPools.comboRate, COMBO_RATE_CAP)), 0.5);
  if (!rng.chance(rate)) return;
  // 対象：最後に攻撃した敵。倒していたら最も左の生存敵へオートターゲット（docs/01）。
  let target = state.enemies.find((e) => e.uid === lastTargetUid && e.hp > 0);
  if (!target) target = aliveEnemies(state)[0];
  if (!target) return;
  // 火力は元攻撃の半分（端数切捨）・防御無視
  const comboDmg = computeAttackDamage(basePower, multiplier / 2, target.defense, true);
  events.push({ type: "ComboTriggered", enemyUid: target.uid, amount: comboDmg });
  applyDamage(state, target.uid, comboDmg, events, true);
}

export function playCard(db: ContentDB, input: BattleState, cardUid: string, targetUid: string | null, rng: Rng): Result {
  if (input.phase !== "player") throw new Error("プレイヤーターンではありません");
  const inst = input.hand.find((c) => c.uid === cardUid);
  if (!inst) throw new Error(`手札にカードがありません: ${cardUid}`);
  const def = cardDef(db, inst);

  const state = clone(input);
  const cost = cardApCost(db, def, state.sword);
  if (state.ap < cost) throw new Error("APが足りません");
  if (!meetsRequirements(db, def, state)) throw new Error("使用条件を満たしていません");

  const events: BattleEvent[] = [{ type: "CardPlayed", cardDefId: def.id, cardUid }];
  state.ap -= cost;
  state.actedThisTurn = true;

  for (const effect of def.effects) {
    switch (effect.kind) {
      case "attack": {
        const targets = resolveAttackTargets(state, def.target, targetUid);
        const power = bladeAttackPower(db, state.sword, state.bonusPools.attack);
        let last: string | null = null;
        for (const t of targets) {
          const dmg = computeAttackDamage(power, effect.multiplier, t.defense, effect.ignoreDefense ?? false);
          applyDamage(state, t.uid, dmg, events, effect.ignoreDefense ?? false);
          last = t.uid;
        }
        if (last) tryCombo(db, state, last, power, effect.multiplier, events, rng);
        break;
      }
      case "fixed_damage": {
        const targets = resolveAttackTargets(state, def.target, targetUid);
        for (const t of targets) {
          const dmg = computeFixedDamage(effect.amount, t.defense, effect.ignoreDefense ?? false);
          applyDamage(state, t.uid, dmg, events, effect.ignoreDefense ?? false);
        }
        break;
      }
      case "block": {
        state.blockPool += effect.amount + state.bonusPools.defense;
        events.push({ type: "BlockGained", amount: effect.amount + state.bonusPools.defense });
        break;
      }
      case "dodge_next": {
        state.dodgeNext = true;
        events.push({ type: "DodgeArmed" });
        break;
      }
    }
  }

  // 使用済みカードを捨て札へ（道具の回数処理は後続フェーズ）
  state.hand = state.hand.filter((c) => c.uid !== cardUid);
  state.discardPile.push(inst);

  if (aliveEnemies(state).length === 0) {
    state.phase = "won";
    events.push({ type: "BattleWon" });
  }
  return { state, events };
}

function resolveAttackTargets(state: BattleState, target: CardDef["target"], targetUid: string | null): EnemyInstance[] {
  const alive = aliveEnemies(state);
  if (target === "all" || target === "self_aoe") return alive;
  if (target === "pierce") return alive.slice(0, 2);
  // single（self は攻撃対象を取らないので呼ばれない想定）
  const chosen = targetUid ?? autoTarget(state);
  const enemy = alive.find((e) => e.uid === chosen);
  return enemy ? [enemy] : [];
}

export function endTurn(db: ContentDB, input: BattleState, rng: Rng): Result {
  if (input.phase !== "player") throw new Error("プレイヤーターンではありません");
  const state = clone(input);
  const events: BattleEvent[] = [];
  state.phase = "enemy";

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const intent = enemy.intents[enemy.intentIndex];
    events.push({ type: "EnemyActed", enemyUid: enemy.uid, intentId: intent.id });

    for (const effect of intent.effects) {
      if (effect.kind === "damage") {
        if (state.dodgeNext) {
          state.dodgeNext = false;
          events.push({ type: "DamageTaken", amount: effect.amount, blocked: 0, dodged: true });
        } else {
          const blocked = Math.min(state.blockPool, effect.amount);
          state.blockPool -= blocked;
          const hpLoss = effect.amount - blocked;
          state.hp = Math.max(0, state.hp - hpLoss);
          events.push({ type: "DamageTaken", amount: effect.amount, blocked, dodged: false });
        }
      }
      // apply_status / degrade_part / grab は後続フェーズ（Phase 2・3）で実装
    }

    // 周期型：次の予告へ進める（cyclic 以外は後続フェーズ）
    if (enemy.archetype === "cyclic") {
      enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intents.length;
    }

    if (state.hp <= 0) {
      state.phase = "lost";
      events.push({ type: "BattleLost" });
      return { state, events };
    }
  }

  // 終了→次ターン開始フェイズ
  state.turn += 1;
  state.ap = state.apMax;
  state.blockPool = 0;
  state.actedThisTurn = false;
  drawToHandLimit(state, db, rng);
  state.phase = "player";
  events.push({ type: "TurnStarted", turn: state.turn });
  return { state, events };
}
