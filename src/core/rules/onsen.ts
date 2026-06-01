import type { OnsenEvent, OnsenResult, OnsenStage } from "../model/onsen.js";

// 温泉シーンの結末判定（純粋関数）。App層は5段すべてを選ばせ（中断なし）、各選択の
// score を加算してから本関数で結末を決める。Godot移植時も同じ判定を流用できる。

/** その段でidx番の選択肢のスコア（0=off / 1=acceptable / 2=favorite）。 */
export function choiceScore(stage: OnsenStage, choiceIndex: number): number {
  return stage.choices[choiceIndex]?.score ?? 0;
}

/** 全段で得られる最大スコア（各段の最高スコアの総和）。 */
export function maxOnsenScore(event: OnsenEvent): number {
  return event.stages.reduce((sum, st) => sum + Math.max(...st.choices.map((c) => c.score)), 0);
}

/**
 * 合計スコアが閾値以上なら lead（相手が気絶するまで絶頂・こゆきが自信と経験を積む）、
 * 未満なら indulgent（攻守逆転・相手主導で蕩かされる）。せっくすてく獲得はスコア比例。
 * いずれの結末も温泉ゆえ全回復する。
 */
export function resolveOnsen(event: OnsenEvent, totalScore: number): OnsenResult {
  const score = Math.max(0, totalScore);
  return {
    outcome: score >= event.threshold ? "lead" : "indulgent",
    score,
    sextechPart: event.rewardPart,
    sextechGain: Math.floor(score / event.rewardDivisor),
    fullHeal: true,
  };
}
