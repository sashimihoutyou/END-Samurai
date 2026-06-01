import type { OnsenEvent, OnsenResult, OnsenStage } from "../model/onsen.js";

// 温泉シーンの結末判定（純粋関数）。App層は段を進めながら誤りの有無だけを記録し、
// 結末の適用（せっくすてく加算・全回復）は本結果に従う。Godot移植時も同じ判定を流用できる。

/** その段でidx番の選択肢が正しい一手か。 */
export function isCorrectChoice(stage: OnsenStage, choiceIndex: number): boolean {
  return stage.choices[choiceIndex]?.correct === true;
}

/**
 * 全段を正しく通せば lead（相手を先にイカせてせっくすてく獲得）。
 * 途中で誤れば indulgent（ねっとり全回復・せっくすてくなし）。いずれも温泉ゆえ全回復する。
 */
export function resolveOnsen(event: OnsenEvent, erred: boolean): OnsenResult {
  if (erred) {
    return { outcome: "indulgent", sextechGain: 0, fullHeal: true };
  }
  return {
    outcome: "lead",
    sextechPart: event.rewardPart,
    sextechGain: event.rewardPoints,
    fullHeal: true,
  };
}
