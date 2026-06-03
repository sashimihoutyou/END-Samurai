import type { CardDef, CardInstance } from "../model/card.js";
import type { EnemyInstance } from "../model/enemy.js";
import type { StatusId, StatusInstance } from "../model/status.js";
import type { SwordPart, SwordState } from "../model/sword.js";
import type { BattleEvent, BattleState, Costume } from "../model/battle-state.js";
import type { Rng } from "../rng/rng.js";
import { getStage, type ContentDB } from "../content/loader.js";
import {
  baseDefense,
  bladeAttackPower,
  cardApCost,
  comboRate,
  computeAttackDamage,
  computeFixedDamage,
  costumeComboBonus,
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
  costume?: Costume; // 衣装破損段階（省略時 normal）。docs/05
  companions?: { id: string; affection: "low" | "mid" | "high" }[]; // 同行仲間（戦闘開始時パッシブ）。docs/03
}

const AFFECTION_DEFENSE: Record<"low" | "mid" | "high", number> = { low: 1, mid: 2, high: 3 };
const AFFECTION_UPGRADE_COUNT: Record<"low" | "mid" | "high", number> = { low: 1, mid: 1, high: 2 };

/** 状態異常を付与する。毒＝magnitude非スタック・持続リセット／出血＝スタック加算（docs/01「状態異常」）。 */
function addStatus(list: StatusInstance[], id: StatusId, x: number): void {
  if (id === "bleed") {
    const cur = list.find((s) => s.id === "bleed");
    if (cur) cur.x += x;
    else list.push({ id, x, turns: Number.MAX_SAFE_INTEGER }); // 出血はxの自然減衰で消える（持続ターン無制限）
  } else if (id === "poison") {
    const cur = list.find((s) => s.id === "poison");
    if (cur) {
      cur.x = Math.max(cur.x, x);
      cur.turns = 3; // 持続リセット
    } else {
      list.push({ id, x, turns: 3 });
    }
  } else {
    // 気絶：次の自分の行動を1回スキップ
    list.push({ id: "stun", x: 1, turns: 1 });
  }
}

function poisonTotal(list: StatusInstance[]): number {
  return list.filter((s) => s.id === "poison").reduce((sum, s) => sum + s.x, 0);
}

/** 出血DoTを処理し、与えたダメージを返す（xを半減し、0は除去）。防御無視（docs/01）。 */
function tickBleed(list: StatusInstance[]): number {
  let dmg = 0;
  for (const s of list) if (s.id === "bleed") dmg += s.x;
  if (dmg === 0) return 0;
  for (const s of list) if (s.id === "bleed") s.x = Math.floor(s.x / 2);
  return dmg;
}

function removeDeadStatuses(list: StatusInstance[]): StatusInstance[] {
  return list.filter((s) => !(s.id === "bleed" && s.x <= 0));
}

/** 衣装破損の段階進行（docs/05）。HPに通った被ダメが現在HPの30%以上で1段進む。 */
function escalateCostume(state: BattleState, hpBefore: number, hpLoss: number, events: BattleEvent[]): void {
  if (hpLoss <= 0 || hpLoss < Math.ceil(hpBefore * 0.3)) return;
  if (state.costume === "normal") {
    state.costume = "damaged";
    events.push({ type: "CostumeChanged", to: "damaged" });
  } else if (state.costume === "damaged") {
    state.costume = "broken";
    events.push({ type: "CostumeChanged", to: "broken" });
  }
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
    statuses: [],
    fuse: def.fuse, // timed：溜めターン（undefined＝非時限）
  };
}

/** timed（時限型）の予告位置：残り溜めが1以下なら大技（最終intent）、まだ溜め中なら溜め（intents[0]）。 */
function timedIntentIndex(enemy: EnemyInstance): number {
  return (enemy.fuse ?? 1) <= 1 ? enemy.intents.length - 1 : 0;
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
    // デッキ個体を複製して持ち込む（葵パッシブの一時置換・回数消費が run.deck を汚さないように）。
    drawPile: rng.shuffle(setup.deck).map((c) => ({ ...c })),
    discardPile: [],
    ap: apMax,
    apMax,
    blockPool: baseDefense(db, setup.sword, setup.costume ?? "normal"), // 鍔基礎防御＋衣装補正を毎ターンの防御プールに充填（docs/01「鍔の基礎防御値＋積んだ防御値」）
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
    statuses: [],
    costume: setup.costume ?? "normal",
    apDiscount: 0,
    degradeShield: 0,
    companionUsed: [],
    attackHits: 0,
    phase: "player",
  };
  // 予告の初期化（表示される予告＝この敵ターンに実行される行動。予告とのズレを作らない）。
  for (const e of state.enemies) {
    if (e.archetype === "random_intent") e.intentIndex = rng.int(e.intents.length); // 予告ランダム型：抽選
    else if (e.archetype === "timed") e.intentIndex = timedIntentIndex(e); // 時限型：溜め/大技の別
  }
  drawToHandLimit(state, db, rng);
  const events: BattleEvent[] = [{ type: "TurnStarted", turn: 1 }];
  applyCompanionPassives(db, state, setup.companions ?? [], events);
  return { state, events };
}

/** 戦闘開始時の仲間パッシブ（docs/03「仲間スキル」）。お豊＝防御値＋／葵＝手札の技を上位化。 */
function applyCompanionPassives(
  db: ContentDB,
  state: BattleState,
  companions: { id: string; affection: "low" | "mid" | "high" }[],
  events: BattleEvent[],
): void {
  for (const c of companions) {
    const def = db.companions.get(c.id);
    if (!def) continue;
    if (def.passive === "battle_start_defense") {
      // 鍛えの目：戦闘開始1ターン目のみ防御プールに加算（毎ターン再充填には含めない）。
      const amount = AFFECTION_DEFENSE[c.affection];
      state.blockPool += amount;
      events.push({ type: "CompanionBuff", companionId: c.id, label: `鍛えの目：防御値+${amount}` });
    } else if (def.passive === "battle_start_upgrade") {
      // 見取り稽古：手札の技カードを1ランク上へ一時置換（affectionで枚数）。
      let remaining = AFFECTION_UPGRADE_COUNT[c.affection];
      for (const inst of state.hand) {
        if (remaining <= 0) break;
        const cd = db.cards.get(inst.defId);
        if (cd?.category === "skill" && cd.upgradeId && db.cards.has(cd.upgradeId)) {
          const from = inst.defId;
          inst.defId = cd.upgradeId; // この戦闘限り（run.deck の個体は別物なので残らない）
          events.push({ type: "HandUpgraded", fromCardId: from, toCardId: inst.defId });
          remaining -= 1;
        }
      }
      events.push({ type: "CompanionBuff", companionId: c.id, label: "見取り稽古" });
    }
  }
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

/**
 * 刃の摩耗（docs/10「刀メンテを緊張の核に」）：斬撃のたびにカウントし、閾値（bladeWearPerHits）に
 * 達したら刀身を1段階鈍らせる。雑魚は数手で倒れるため発動せず、長丁場（エリート・ボス）でじわじわ効く。
 * 自分の「使用」による摩耗なので、敵デバフ用の打ち直し盾（degradeShield）では防げない。
 */
function wearBlade(db: ContentDB, state: BattleState, events: BattleEvent[]): void {
  const per = db.combat.bladeWearPerHits;
  if (per <= 0) return;
  state.attackHits += 1;
  if (state.attackHits < per) return;
  state.attackHits = 0;
  const d = degradePart(db, state.sword, "blade");
  if (d) events.push({ type: "PartDegraded", part: "blade", from: d.from, to: d.to });
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
  // 仲間アクティブは1戦闘1回（使用後はその戦闘中グレーアウト）。docs/03。
  if (def.category === "companion_active" && state.companionUsed.includes(def.id)) return false;
  if (state.ap < cardApCost(db, def, state.sword, state.costume, state.apDiscount)) return false;
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
  // 連撃率ボーナス＝プール＋衣装大破(+5%)。上限COMBO_RATE_CAP（docs/01）。柄基礎と合算後さらに0.5で頭打ち。
  const bonus = Math.min(state.bonusPools.comboRate + costumeComboBonus(state.costume), COMBO_RATE_CAP);
  const rate = Math.min(comboRate(db, state.sword, bonus), 0.5);
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

  if (def.category === "companion_active" && state.companionUsed.includes(def.id)) {
    throw new Error("この仲間アクティブはこの戦闘で使用済みです");
  }
  const cost = cardApCost(db, def, state.sword, state.costume, state.apDiscount);
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
        wearBlade(db, state, events); // 斬るたびに刃が摩耗（閾値で1段階鈍る）。docs/10「刃の摩耗」
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
        // 防御値ボーナス（お豊パッシブ・打ち直し）は毎ターンの防御プール充填に含むため、ここでは二重加算しない。
        state.blockPool += effect.amount;
        events.push({ type: "BlockGained", amount: effect.amount });
        break;
      }
      case "buff_attack": {
        state.bonusPools.attack += effect.amount;
        events.push({ type: "CompanionBuff", companionId: def.id, label: `攻撃力+${effect.amount}` });
        break;
      }
      case "buff_defense": {
        state.bonusPools.defense += effect.amount;
        state.blockPool += effect.amount; // このターン分も即時反映
        events.push({ type: "CompanionBuff", companionId: def.id, label: `防御値+${effect.amount}` });
        break;
      }
      case "buff_combo": {
        state.bonusPools.comboRate += effect.amount;
        events.push({ type: "CompanionBuff", companionId: def.id, label: `連撃率+${Math.round(effect.amount * 100)}%` });
        break;
      }
      case "ap_discount": {
        state.apDiscount += effect.amount;
        events.push({ type: "CompanionBuff", companionId: def.id, label: `技のAP-${effect.amount}` });
        break;
      }
      case "nullify_degrade": {
        state.degradeShield += effect.count;
        events.push({ type: "CompanionBuff", companionId: def.id, label: `刀デバフ無効化×${effect.count}` });
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
      case "enemy_defense_down": {
        // 崩し（docs/01「崩し」）：対象の防御値を実数値で下げる（下限0・この戦闘中持続）。
        for (const t of resolveAttackTargets(state, def.target, targetUid)) {
          const before = t.defense;
          t.defense = Math.max(0, t.defense - effect.amount);
          if (t.defense !== before) events.push({ type: "EnemyDefenseDown", enemyUid: t.uid, amount: before - t.defense });
        }
        break;
      }
      case "self_degrade": {
        // 自傷コスト（柄打ち・捨て身）：自分の指定部位を低下させる。
        const times = effect.stages ?? 1;
        for (let i = 0; i < times; i++) {
          const d = degradePart(db, state.sword, effect.part);
          if (d) events.push({ type: "PartDegraded", part: effect.part, from: d.from, to: d.to });
        }
        break;
      }
      case "apply_status": {
        // 出血・気絶等の付与（toTarget=敵へ／false=こゆきへ）。経過処理は endTurn。
        if (effect.toTarget) {
          for (const t of resolveAttackTargets(state, def.target, targetUid)) {
            addStatus(t.statuses, effect.status, effect.x);
            events.push({ type: "StatusApplied", status: effect.status, x: effect.x, toKoyuki: false, enemyUid: t.uid });
          }
        } else {
          addStatus(state.statuses, effect.status, effect.x);
          events.push({ type: "StatusApplied", status: effect.status, x: effect.x, toKoyuki: true, enemyUid: null });
        }
        break;
      }
    }
  }

  // 使用済みカードの後始末。
  state.hand = state.hand.filter((c) => c.uid !== cardUid);
  if (def.category === "companion_active") {
    // 仲間アクティブ：この戦闘では再使用不可（捨て札にも山札にも戻さない＝再ドローされない）。
    // 戦闘終了後は run.deck 側の個体が残るため自然にデッキへ戻る（docs/03「戦闘後デッキ復帰」）。
    state.companionUsed.push(def.id);
  } else if (def.uses != null) {
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
    // 気絶：この敵は行動をスキップ（予告は進めない＝次ターンに同じ予告を実行）。docs/01「気絶」。
    const stun = enemy.statuses.find((s) => s.id === "stun");
    if (stun) {
      enemy.statuses = enemy.statuses.filter((s) => s.id !== "stun");
      events.push({ type: "StunSkipped", enemyUid: enemy.uid });
      continue;
    }
    const intent = enemy.intents[enemy.intentIndex];
    events.push({ type: "EnemyActed", enemyUid: enemy.uid, intentId: intent.id });

    const telegraph = intent.telegraphPart ?? null;
    // いなす：狙われた部位を確定で守る代わりに被ダメ+50%（docs/01「部位狙いへの受け／いなし」）。
    const inasu = telegraph != null && state.braceChoice === "inasu";

    let rawDamage = 0;
    for (const eff of intent.effects) if (eff.kind === "damage") rawDamage += eff.amount;
    // 連携型（docs/01「連携型」）：生存している味方が1体でもいる間は与ダメージにボーナス。
    // 味方を倒せば無力化される＝「どの敵から処理するか」のターゲティング判断を作る。
    if (enemy.archetype === "synergy") {
      const def = db.enemies.get(enemy.defId);
      const hasAlly = aliveEnemies(state).some((e) => e.uid !== enemy.uid);
      if (def?.synergyBonus && hasAlly) {
        rawDamage += def.synergyBonus;
        events.push({ type: "SynergyAmplified", enemyUid: enemy.uid, amount: def.synergyBonus });
      }
    }
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
        const hpBefore = state.hp;
        state.hp = Math.max(0, state.hp - hpLoss);
        penetrated = hpLoss > 0;
        events.push({ type: "DamageTaken", amount: damage, blocked, dodged: false });
        // 衣装破損：1回の被ダメージ（HPに通った分）が現在HPの30%以上なら段階が進む（docs/05）。
        escalateCostume(state, hpBefore, hpLoss, events);
      }
    }

    // 適用する随伴効果。隠匿型（docs/01「隠匿型／くびなし」）は複数候補から1つだけを抽選し、
    // 効果種別を伏せて出す（数値は表示）。それ以外は予告どおり全効果を適用する。
    let effectsToApply = intent.effects.filter((e) => e.kind !== "damage");
    if (intent.concealEffect && effectsToApply.length > 0) {
      effectsToApply = [effectsToApply[rng.int(effectsToApply.length)]];
    }
    // 隠匿型のフェアネス保証：受け切る（防御値≧被ダメ）／回避できれば随伴効果は無効。
    const concealSafe = dodged || (damage > 0 && !penetrated);
    if (intent.concealEffect && effectsToApply.length > 0 && concealSafe) {
      events.push({ type: "ConcealNullified", enemyUid: enemy.uid });
    } else {
      for (const eff of effectsToApply) {
        if (eff.kind === "degrade_part") {
          // 予告型デバフは確定だが、いなす／受け切り（防御値≧被ダメ）／回避で守れる（docs/01「部位デバフの発生確率」）。
          const safe = (inasu && telegraph === eff.part) || dodged || (damage > 0 && !penetrated);
          if (safe) {
            events.push({ type: "PartDefended", part: eff.part });
          } else if (state.degradeShield > 0) {
            // 打ち直し（お豊アクティブ）の盾で1回無効化（docs/03）。
            state.degradeShield -= 1;
            events.push({ type: "DegradeNullified", part: eff.part });
          } else {
            const d = degradePart(db, state.sword, eff.part);
            if (d) events.push({ type: "PartDegraded", part: eff.part, from: d.from, to: d.to });
          }
        } else if (eff.kind === "grab") {
          state.grabbedBy = enemy.uid;
          events.push({ type: "Grabbed", enemyUid: enemy.uid });
        } else if (eff.kind === "apply_status") {
          // 状態異常付与（毒/出血/気絶）。受け切り（防御値≧被ダメ）・回避で無効化（docs/01「防御値≧被ダメージ→デバフ無効」）。
          const safe = dodged || (damage > 0 && !penetrated);
          if (!safe) {
            addStatus(state.statuses, eff.status, eff.x);
            events.push({ type: "StatusApplied", status: eff.status, x: eff.x, toKoyuki: true, enemyUid: null });
          }
        }
      }
    }

    // 周期型・狙撃型：次の予告へ進める。
    if (enemy.archetype === "cyclic" || enemy.archetype === "sniper") {
      enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intents.length;
    } else if (enemy.archetype === "random_intent") {
      // 予告ランダム型：次ターンの予告を抽選し直す（実行後に確定＝次の予告表示と一致）。
      enemy.intentIndex = rng.int(enemy.intents.length);
    } else if (enemy.archetype === "timed") {
      // 時限型（docs/01「時限型」）：溜め中は fuse を減らし、最終intent＝大技を発動したら自壊／リセット。
      const detonationIndex = enemy.intents.length - 1;
      const def = db.enemies.get(enemy.defId);
      if (enemy.intentIndex === detonationIndex) {
        if (def?.selfDestruct) {
          enemy.hp = 0; // 大技を放って自壊（自爆しかばね）
          events.push({ type: "EnemyDefeated", enemyUid: enemy.uid });
        } else {
          enemy.fuse = def?.fuse ?? 1; // 溜め直してループ
        }
      } else {
        enemy.fuse = (enemy.fuse ?? 1) - 1; // 溜め進行
      }
      if (enemy.hp > 0) enemy.intentIndex = timedIntentIndex(enemy); // 次ターンの予告（溜め/大技）を更新
    }

    if (state.hp <= 0) {
      state.phase = "lost";
      events.push({ type: "BattleLost" });
      return { state, events };
    }
  }

  // ── 終了フェイズ：状態異常の経過処理（docs/01「ターン構造・終了フェイズ」）──
  // 出血（防御無視DoT）：敵→こゆきの順に処理。xは半減して消える。
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const dmg = tickBleed(enemy.statuses);
    if (dmg > 0) {
      enemy.hp = Math.max(0, enemy.hp - dmg);
      events.push({ type: "BleedTicked", enemyUid: enemy.uid, amount: dmg });
      if (enemy.hp === 0) events.push({ type: "EnemyDefeated", enemyUid: enemy.uid });
    }
    enemy.statuses = removeDeadStatuses(enemy.statuses);
  }
  const koyukiBleed = tickBleed(state.statuses);
  if (koyukiBleed > 0) {
    state.hp = Math.max(0, state.hp - koyukiBleed);
    events.push({ type: "BleedTicked", enemyUid: null, amount: koyukiBleed });
  }
  state.statuses = removeDeadStatuses(state.statuses);

  if (state.hp <= 0) {
    state.phase = "lost";
    events.push({ type: "BattleLost" });
    return { state, events };
  }
  if (aliveEnemies(state).length === 0) {
    state.phase = "won";
    events.push({ type: "BattleWon" });
    return { state, events };
  }

  // 終了→次ターン開始フェイズ
  state.turn += 1;
  // 毒：APを規定値から低下（こゆきの行動リソース攻撃。docs/01「毒」）。
  state.ap = Math.max(0, state.apMax - poisonTotal(state.statuses));
  state.blockPool = baseDefense(db, state.sword, state.costume) + state.bonusPools.defense; // 鍔基礎防御＋衣装補正＋防御ボーナス（お豊/打ち直し）を毎ターン再充填
  state.actedThisTurn = false;
  state.pinned = false;
  state.braceChoice = "ukeru";
  // 毒・気絶の持続ターンを経過させ、切れたものを除去（出血はxの自然減衰で除去済み）。
  for (const s of state.statuses) if (s.id !== "bleed") s.turns -= 1;
  state.statuses = state.statuses.filter((s) => s.id === "bleed" || s.turns > 0);
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
