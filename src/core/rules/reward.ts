import type { Rng } from "../rng/rng.js";

// 戦闘報酬（docs/03「戦闘報酬」）。3枚提示し1枚を選ぶ（拒否可）。
// 中央枠はブラインド（内容非表示）。純粋関数：プールと注入rngのみで決まる。

export interface RewardOffer {
  cardIds: string[]; // 提示する3枚（プールが3未満ならその枚数）
  blindIndex: number; // 中央＝ブラインド枠のindex（内容を伏せる）
}

/** ドロップ候補から重複なく最大3枚を選ぶ。中央（index 1）をブラインドとする。 */
export function generateReward(pool: readonly string[], rng: Rng): RewardOffer {
  const cardIds = rng.shuffle(pool).slice(0, Math.min(3, pool.length));
  return { cardIds, blindIndex: cardIds.length >= 2 ? 1 : 0 };
}
