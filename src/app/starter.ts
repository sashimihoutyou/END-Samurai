import type { CardInstance } from "../core/model/card.js";
import type { SwordState } from "../core/model/sword.js";

// α版の初期デッキ・初期刀状態。docs/01「初期デッキ構成」/「刀の状態段階」に対応。
// 技7枚＋道具3枚＝10枚（斬る×2／突く×2／受ける×2／見切る×1／砥石×1／鍔の当て金×1／きずぐすり×1）。
// 巻き直しのひも（柄修繕）は初期デッキに含めない（序盤の柄デバフは野営地の完全修繕で賄う）。

let counter = 0;
function inst(defId: string, usesLeft?: number): CardInstance {
  counter += 1;
  return usesLeft != null ? { uid: `${defId}@${counter}`, defId, usesLeft } : { uid: `${defId}@${counter}`, defId };
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
    inst("toishi_no_kakera", 2),
    inst("tsuba_no_ategane", 2),
    inst("kizugusuri", 3),
  ];
}

export function makeStarterSword(): SwordState {
  return { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };
}
