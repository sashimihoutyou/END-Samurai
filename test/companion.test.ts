import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { canPlayCard, endTurn, playCard, startBattle, type BattleSetup } from "../src/core/rules/normal-battle.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function card(defId: string, n: number): CardInstance {
  return { uid: `${defId}-${n}`, defId };
}
function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return { deck: [card("kiru", 1)], sword: { ...shinpin }, hp: 30, maxHp: 30, enemyDefIds: ["nora_inu"], ...over };
}

describe("仲間パッシブ（docs/03）", () => {
  it("お豊『鍛えの目』：戦闘開始時に防御値が上がる（好感度比例）", () => {
    const { state } = startBattle(db, setup({ companions: [{ id: "otoyo", affection: "high" }] }), createRng(1));
    expect(state.bonusPools.defense).toBe(3); // high=3
    expect(state.blockPool).toBe(3 + 3); // 鍔基礎防御3 ＋ ボーナス3
  });

  it("葵『見取り稽古』：手札の技を1ランク上へ一時置換（run.deckは汚さない）", () => {
    const deck = [card("kiru", 1)];
    const { state, events } = startBattle(db, setup({ deck, companions: [{ id: "aoi", affection: "mid" }] }), createRng(1));
    expect(state.hand[0].defId).toBe("kesagiri"); // 斬る → 袈裟斬り（upgradeId）
    expect(events.some((e) => e.type === "HandUpgraded" && e.toCardId === "kesagiri")).toBe(true);
    expect(deck[0].defId).toBe("kiru"); // 元のデッキ個体は不変（戦闘限りの置換）
  });
});

describe("仲間アクティブ（docs/03）", () => {
  it("打ち直し：攻撃+2・防御+2・刀デバフ無効化を付与し、1戦闘1回で使用済みになる", () => {
    const { state } = startBattle(db, setup({ deck: [card("uchinaoshi", 1)] }), createRng(1));
    const r = playCard(db, state, "uchinaoshi-1", null, createRng(1));
    expect(r.state.bonusPools.attack).toBe(2);
    expect(r.state.bonusPools.defense).toBe(2);
    expect(r.state.degradeShield).toBe(1);
    expect(r.state.companionUsed).toContain("uchinaoshi");
    // 捨て札にも山札にも戻らない（この戦闘では再ドローされない）
    const anywhere =
      r.state.hand.concat(r.state.drawPile, r.state.discardPile).some((c) => c.defId === "uchinaoshi");
    expect(anywhere).toBe(false);
  });

  it("打ち直しの盾は、こんぼう山賊の柄狙いデバフを1回無効化する", () => {
    const { state } = startBattle(db, setup({ deck: [card("uchinaoshi", 1)], enemyDefIds: ["konbou_sanzoku"] }), createRng(1));
    const after = playCard(db, state, "uchinaoshi-1", null, createRng(1)).state;
    after.blockPool = 0; // 防御を使い切った状況にして、貫通＝本来なら柄が低下する場面を作る
    const r = endTurn(db, after, createRng(1)); // 鈍器ふりかぶり（柄狙い）が貫通
    expect(r.events.some((e) => e.type === "DegradeNullified" && e.part === "tsuka")).toBe(true);
    expect(r.state.sword.tsuka).toBe("shinpin"); // 守られた
  });

  it("型稽古：技カードのAP-1（最低1）", () => {
    const { state } = startBattle(db, setup({ deck: [card("kata_keiko", 1), card("kiru", 1)] }), createRng(1));
    const after = playCard(db, state, "kata_keiko-1", null, createRng(1)).state;
    expect(after.apDiscount).toBe(1);
    expect(after.bonusPools.comboRate).toBeCloseTo(0.1);
    // 斬る(基本2)が1で撃てる
    const kiru = after.hand.find((c) => c.defId === "kiru");
    expect(kiru).toBeDefined();
    // AP1まで減っていても斬る(実効1)は撃てる
    after.ap = 1;
    expect(canPlayCard(db, after, kiru!.uid)).toBe(true);
  });
});
