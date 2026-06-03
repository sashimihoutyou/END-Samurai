import type { TorokashiEnemyDef, TorokashiState, TorokashiEvent, SexAttr, ChoiceResult, TorokashiOutcome, SizeCategory } from "../model/torokashi.js";
import { ALL_ATTRS, SECOND_LOOP_ONLY } from "../model/torokashi.js";
import type { Rng } from "../rng/rng.js";

// とろかし流ミニゲームのターン構造。docs/02「とろかし流ミニゲーム」。
// すべて純粋関数：入力 state は変更せず、新しい state ＋ 発生イベント配列を返す。乱数は注入する。

// 評価ポイント（暫定値）
export const SCORE_HIT = 10;
export const SCORE_NEAR = 5;
export const SCORE_MISS = 1;
export const SIZE_SCORE_BEST = 4;  // 好みの範囲内
export const SIZE_SCORE_LARGE = 2; // 大きすぎるが一応加点
export const MADAMADA_HP_COST = 5;
export const KOYUKI_SIZE: SizeCategory = "medium";

// 結末閾値は handCount × per-hand threshold で導出する。
// 1手=20/10、2手=40/20、3手=60/30（全hit+sizeでlead、nearのみで中間）
const LEAD_PER_HAND = 20;
const MIN_PER_HAND = 10;

function leadThreshold(handCount: number): number { return handCount * LEAD_PER_HAND; }
function minThreshold(handCount: number): number { return handCount * MIN_PER_HAND; }

export interface TorokashiSetup {
  enemyDefId: string;
  hp: number;
  maxHp: number;
}

function clone(s: TorokashiState): TorokashiState { return structuredClone(s); }

/** 提示する3択を生成する（回数依存フィルタ適用）。 */
export function makeChoices(_def: TorokashiEnemyDef, loop: number, rng: Rng): SexAttr[] {
  const pool = ALL_ATTRS.filter(a => loop > 0 || !SECOND_LOOP_ONLY.has(a));
  // Fisher-Yates shuffle して先頭3つを取る
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 3);
}

/** サイズボーナスを計算する（パッシブ加点）。 */
function sizeBonus(def: TorokashiEnemyDef): number {
  if (def.sizePreference === "any") return SIZE_SCORE_BEST;
  if (def.sizePreference === KOYUKI_SIZE) return SIZE_SCORE_BEST;
  // こゆきが相手の好みより大きい → そこそこ加点
  const sizes: SizeCategory[] = ["small", "medium", "large"];
  const kIdx = sizes.indexOf(KOYUKI_SIZE);
  const pIdx = sizes.indexOf(def.sizePreference);
  if (kIdx > pIdx) return SIZE_SCORE_LARGE;
  return 0;
}

/** 属性選択の結果を判定する。 */
function judgeChoice(def: TorokashiEnemyDef, attr: SexAttr): ChoiceResult {
  if (def.weakAttrs.includes(attr)) return "hit";
  if (def.nearAttrs.includes(attr)) return "near";
  return "miss";
}

function scoreForResult(result: ChoiceResult): number {
  if (result === "hit") return SCORE_HIT;
  if (result === "near") return SCORE_NEAR;
  return SCORE_MISS;
}

/** とろかし遭遇を開始する。 */
export function startTorokashi(
  def: TorokashiEnemyDef,
  setup: TorokashiSetup,
  rng: Rng
): { state: TorokashiState; events: TorokashiEvent[] } {
  const choices = makeChoices(def, 0, rng);
  const state: TorokashiState = {
    enemyDefId: def.id,
    loop: 0,
    hand: 0,
    handCount: def.handCount,
    totalScore: 0,
    choices,
    phase: "choosing",
    lastChoice: null,
    lastResult: null,
    outcome: null,
    hp: setup.hp,
    maxHp: setup.maxHp,
  };
  const events: TorokashiEvent[] = [
    { type: "ChoicesPresented", choices, loop: 0, hand: 0 },
  ];
  return { state, events };
}

/** 選択肢を選ぶ（choosing → reacting）。 */
export function selectAttr(
  state: TorokashiState,
  def: TorokashiEnemyDef,
  attr: SexAttr,
  _rng: Rng
): { state: TorokashiState; events: TorokashiEvent[] } {
  if (state.phase !== "choosing") return { state, events: [] };
  const s = clone(state);
  const result = judgeChoice(def, attr);
  const points = scoreForResult(result);
  const bonus = sizeBonus(def);
  s.totalScore += points + bonus;
  s.lastChoice = attr;
  s.lastResult = result;
  s.phase = "reacting";
  const events: TorokashiEvent[] = [
    { type: "AttrSelected", attr, result, points, sizeBonus: bonus },
  ];
  return { state: s, events };
}

/** リアクションを確認し、次の手へ進む（reacting → choosing or madamada）。 */
export function advanceHand(
  state: TorokashiState,
  def: TorokashiEnemyDef,
  rng: Rng
): { state: TorokashiState; events: TorokashiEvent[] } {
  if (state.phase !== "reacting") return { state, events: [] };
  const s = clone(state);
  const events: TorokashiEvent[] = [];

  const nextHand = s.hand + 1;
  if (nextHand < s.handCount) {
    // 次の手へ
    s.hand = nextHand;
    s.choices = makeChoices(def, s.loop, rng);
    s.phase = "choosing";
    events.push({ type: "ChoicesPresented", choices: s.choices, loop: s.loop, hand: s.hand });
  } else {
    // このループの最終手が終わった → まだまだ！ or 結末
    events.push({ type: "LoopComplete", loop: s.loop, totalScore: s.totalScore });
    s.phase = "madamada";
  }
  return { state: s, events };
}

/** まだまだ！を押す（madamada → choosing 次ループ）。 */
export function madamada(
  state: TorokashiState,
  def: TorokashiEnemyDef,
  rng: Rng
): { state: TorokashiState; events: TorokashiEvent[] } {
  if (state.phase !== "madamada") return { state, events: [] };
  const s = clone(state);
  const events: TorokashiEvent[] = [];

  const hpCost = MADAMADA_HP_COST;
  s.hp = Math.max(0, s.hp - hpCost);
  events.push({ type: "Madamada", hpCost, hpAfter: s.hp });

  if (s.hp <= 0) {
    // HP0相討ち：HP10%で復活
    const reviveHp = Math.max(1, Math.floor(s.maxHp * 0.1));
    s.hp = reviveHp;
    events.push({ type: "Hp0Collapse", hpAfter: reviveHp });
    // 相討ちは強制的にindulgent扱いで終了
    s.outcome = "indulgent";
    s.phase = "done";
    events.push({ type: "OutcomeIndulgent", hpCost: 0 });
    return { state: s, events };
  }

  // 次ループへ
  s.loop += 1;
  s.hand = 0;
  s.choices = makeChoices(def, s.loop, rng);
  s.phase = "choosing";
  events.push({ type: "ChoicesPresented", choices: s.choices, loop: s.loop, hand: s.hand });
  return { state: s, events };
}

/** 結末を決定する（madamada → done）。 */
export function resolveTorokashi(
  state: TorokashiState,
  def: TorokashiEnemyDef
): { state: TorokashiState; events: TorokashiEvent[] } {
  if (state.phase !== "madamada") return { state, events: [] };
  const s = clone(state);
  const events: TorokashiEvent[] = [];

  const lead = leadThreshold(s.handCount);
  const min = minThreshold(s.handCount);

  let outcome: TorokashiOutcome;
  if (s.totalScore >= lead) {
    outcome = "lead";
  } else if (s.totalScore >= min) {
    outcome = "indulgent";
  } else {
    outcome = "failure";
  }

  s.outcome = outcome;
  s.phase = "done";

  if (outcome === "lead") {
    events.push({ type: "OutcomeLead" });
    if (def.joinCompanionId) {
      events.push({ type: "CompanionJoined", companionId: def.joinCompanionId });
    }
  } else if (outcome === "indulgent") {
    const hpCost = Math.floor(s.maxHp * 0.2); // indulgent: 最大HPの20%を消費（暫定）
    s.hp = Math.max(1, s.hp - hpCost);
    events.push({ type: "OutcomeIndulgent", hpCost });
    if (def.joinCompanionId) {
      events.push({ type: "CompanionJoined", companionId: def.joinCompanionId });
    }
  } else {
    events.push({ type: "OutcomeFailure" });
  }

  return { state: s, events };
}
