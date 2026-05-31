import type { CardInstance } from "../core/model/card.js";
import type { SwordState } from "../core/model/sword.js";

// α版の初期デッキ・初期刀状態。docs/01「初期デッキ構成」/「刀の状態段階」に対応。
// Phase 1 は技カードのみ（道具カードは後続フェーズで追加）。

let counter = 0;
function inst(defId: string): CardInstance {
  counter += 1;
  return { uid: `${defId}@${counter}`, defId };
}

export function makeStarterDeck(): CardInstance[] {
  return [
    inst("kiru"),
    inst("kiru"),
    inst("tsuku"),
    inst("tsuku"),
    inst("ukeru"),
    inst("ukeru"),
    inst("mikiru"),
  ];
}

export function makeStarterSword(): SwordState {
  return { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };
}
