import type { CardDef, CardInstance } from "../model/card.js";
import type { EnemyInstance } from "../model/enemy.js";
import type { SwordPart, SwordState } from "../model/sword.js";
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
    sword: { ...setup.sword },
    turn: 1,
    actedThisTurn: false,
    dodgeNext: false,
    grabbedBy: null,
    pinned: false,
    braceChoice: "ukeru",
    phase: "player",
  };
  drawToHandLimit(state, db, rng);
  return { state, events: [{ type: "TurnStarted", turn: 1 }] };
}

// ── 刀部位の段階操作（修繕・部位デバフ）──────────────────────────
// 段階は order（低→高）で並ぶ。低下＝order-1（下限0）、回復＝order+1（cap段階まで・上限は最高段階）。

function stageIdByOrder(db: ContentDB, part: SwordPart, order: number): string | null {
  const stages = db.swordStages.get(part)?.stages;
  return stages?.find((s) => s.order === order)?.id ?? null;
}

/** 部位を1段階低下させる。下限ならnull（変化なし）。 */
function degradePart(db: ContentDB, sword: SwordState, part: SwordPart): { from: string; to: string } | null {
  const cur = getStage(db, part, sword[part]);
  const toId = stageIdByOrder(db, part, cur.order - 1);
  if (!toId) return null;
  const from = sword[part];
  sword[part] = toId;
  return { from, to: toId };
}

/** 部位を1段階回復させる。cap段階（指定時）と最高段階を超えては戻せない。変化なしならnull。 */
function repairPart(db: ContentDB, sword: SwordState, part: SwordPart, capId?: string): { from: string; to: string } | null {
  const cur = getStage(db, part, sword[part]);
  const capOrder = capId ? getStage(db, part, capId).order : Infinity;
  if (cur.order >= capOrder) return null; // すでにcap以上＝低レア道具では戻せない
  const toId = stageIdByOrder(db, part, cur.order + 1);
  if (!toId) return null;
  const from = sword[part];
  sword[part] = toId;
  return { from, to: toId };
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
  // 掴んできた敵を攻撃すると掴みを振りほどく（docs/01「掴み・実行者が攻撃されると解除」）。
  if (state.grabbedBy === enemyUid) {
    state.grabbedBy = null;
    events.push({ type: "GrabReleased", enemyUid });
  }
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
  const state = clone(input);
  const inst = state.hand.find((c) => c.uid === cardUid);
  if (!inst) throw new Error(`手札にカードがありません: ${cardUid}`);
  const def = cardDef(db, inst);

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
      case "repair_part": {
        const r = repairPart(db, state.sword, effect.part, effect.cap);
        if (r) events.push({ type: "PartRepaired", part: effect.part, from: r.from, to: r.to });
        break;
      }
      case "heal": {
        const before = state.hp;
        state.hp = Math.min(state.maxHp, state.hp + effect.amount);
        events.push({ type: "Healed", amount: state.hp - before });
        break;
      }
    }
  }

  // 使用済みカードの後始末。道具（uses持ち）は回数を1減らし、残れば捨て札へ・0なら破棄（デッキから消滅）。
  state.hand = state.hand.filter((c) => c.uid !== cardUid);
  if (def.uses != null) {
    const left = (inst.usesLeft ?? def.uses) - 1;
    if (left > 0) {
      inst.usesLeft = left;
      state.discardPile.push(inst);
    }
    // left<=0：破棄（discardPileにもdrawPileにも戻さない）
  } else {
    state.discardPile.push(inst);
  }

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

  // 前ターンに掴まれたまま振りほどけなかった→押し倒し（この敵ターンは防御値半減・完全回避不可）。docs/01「掴み」。
  if (state.grabbedBy) {
    const grabber = state.enemies.find((e) => e.uid === state.grabbedBy);
    if (grabber && grabber.hp > 0) {
      state.pinned = true;
      state.dodgeNext = false;
      state.blockPool = Math.floor(state.blockPool / 2);
      events.push({ type: "PinnedDown" });
    }
    state.grabbedBy = null;
  }

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const intent = enemy.intents[enemy.intentIndex];
    events.push({ type: "EnemyActed", enemyUid: enemy.uid, intentId: intent.id });

    const telegraph = intent.telegraphPart ?? null;
    // いなす：狙われた部位を確定で守る代わりに被ダメ+50%（docs/01「部位狙いへの受け／いなし」）。
    const inasu = telegraph != null && state.braceChoice === "inasu";

    let rawDamage = 0;
    for (const eff of intent.effects) if (eff.kind === "damage") rawDamage += eff.amount;
    const damage = inasu ? Math.ceil(rawDamage * 1.5) : rawDamage;

    let dodged = false;
    let penetrated = false;
    if (damage > 0) {
      if (state.dodgeNext) {
        state.dodgeNext = false;
        dodged = true;
        events.push({ type: "DamageTaken", amount: damage, blocked: 0, dodged: true });
      } else {
        const blocked = Math.min(state.blockPool, damage);
        state.blockPool -= blocked;
        const hpLoss = damage - blocked;
        state.hp = Math.max(0, state.hp - hpLoss);
        penetrated = hpLoss > 0;
        events.push({ type: "DamageTaken", amount: damage, blocked, dodged: false });
      }
    }

    for (const eff of intent.effects) {
      if (eff.kind === "degrade_part") {
        // 予告型デバフは確定だが、いなす／受け切り（防御値≧被ダメ）／回避で守れる（docs/01「部位デバフの発生確率」）。
        const safe = (inasu && telegraph === eff.part) || dodged || (damage > 0 && !penetrated);
        if (safe) {
          events.push({ type: "PartDefended", part: eff.part });
        } else {
          const d = degradePart(db, state.sword, eff.part);
          if (d) events.push({ type: "PartDegraded", part: eff.part, from: d.from, to: d.to });
        }
      } else if (eff.kind === "grab") {
        state.grabbedBy = enemy.uid;
        events.push({ type: "Grabbed", enemyUid: enemy.uid });
      }
      // apply_status（毒/出血/気絶）は本ロスター（田舎の柄狙い・掴み・ボス）では未使用。後続フェーズで追加。
    }

    // 周期型・狙撃型：次の予告へ進める。
    if (enemy.archetype === "cyclic" || enemy.archetype === "sniper") {
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
  state.pinned = false;
  state.braceChoice = "ukeru";
  drawToHandLimit(state, db, rng);
  state.phase = "player";
  events.push({ type: "TurnStarted", turn: state.turn });
  return { state, events };
}

/** 部位狙い予告（狙撃型）への対応選択を設定する（docs/01「受け／いなし」）。プレイヤーターンのみ。 */
export function setBrace(input: BattleState, choice: "ukeru" | "inasu"): BattleState {
  if (input.phase !== "player") return input;
  const state = clone(input);
  state.braceChoice = choice;
  return state;
}

/** 現在の予告に部位狙い（狙撃型）が含まれるか＝「受け／いなす」選択を提示すべきか。 */
export function hasTelegraphedPart(state: BattleState): boolean {
  return aliveEnemies(state).some((e) => e.intents[e.intentIndex]?.telegraphPart != null);
}
