import type { OnsenChoice, OnsenEvent, OnsenResult, OnsenStage } from "../model/onsen.js";

// 温泉シーンの結末判定（純粋関数）。App層は5段すべてを選ばせ（中断なし）、各選択の
// 実効スコアを加算してから本関数で結末を決める。Godot移植時も同じ判定を流用できる。

/**
 * 選択の実効スコア。基礎スコア（その相手の好み 0/1/2）に、相手固有の性感補正
 * （タグ→倍率）を掛ける。例：葵は前戯×2・騎乗位×1.5・アナル×1.5。補正なしは×1。
 */
export function effectiveScore(event: OnsenEvent, choice: OnsenChoice): number {
  const mult = choice.tag ? (event.multipliers?.[choice.tag] ?? 1) : 1;
  return Math.round(choice.score * mult);
}

/** その段でidx番の選択肢の実効スコア。 */
export function choiceScore(event: OnsenEvent, stage: OnsenStage, choiceIndex: number): number {
  const choice = stage.choices[choiceIndex];
  return choice ? effectiveScore(event, choice) : 0;
}

/** 全段で得られる最大スコア（各段の最高実効スコアの総和）。閾値設計の基準。 */
export function maxOnsenScore(event: OnsenEvent): number {
  return event.stages.reduce(
    (sum, st) => sum + Math.max(...st.choices.map((c) => effectiveScore(event, c))),
    0,
  );
}

/**
 * 合計スコアが閾値以上なら lead（相手が気絶するまで絶頂・こゆきが自信と経験を積む）、
 * 未満なら indulgent（攻守逆転・相手主導で蕩かされる）。せっくすてく獲得はスコア比例。
 *
 * 回復はミニゲームの懸け金（docs/10「全回復のトレードオフ化」）：
 *  - lead → fullHeal=true（全回復＋刀の打ち直し）。主導できた褒美。
 *  - indulgent → fullHeal=false（蕩かされて回復は中途半端＝App層で部分回復のみ）。
 */
export function resolveOnsen(event: OnsenEvent, totalScore: number): OnsenResult {
  const score = Math.max(0, totalScore);
  const lead = score >= event.threshold;
  return {
    outcome: lead ? "lead" : "indulgent",
    score,
    sizaGain: lead ? event.sizaGain : 0,
    fullHeal: lead,
  };
}
