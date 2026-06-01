import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { endTurn, startBattle, type BattleSetup } from "../src/core/rules/normal-battle.js";
import {
  baseDefense,
  cardApCost,
  costumeComboBonus,
  costumeDefensePenalty,
} from "../src/core/rules/damage.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function card(defId: string, n: number): CardInstance {
  return { uid: `${defId}-${n}`, defId };
}
function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return { deck: [card("kiru", 1)], sword: { ...shinpin }, hp: 30, maxHp: 30, enemyDefIds: ["oo_shikabane"], ...over };
}

describe("衣装破損の補正値（docs/05）", () => {
  it("破損で鍔基礎防御-1、大破で-2（下限0）", () => {
    expect(baseDefense(db, shinpin, "normal")).toBe(3);
    expect(baseDefense(db, shinpin, "damaged")).toBe(2);
    expect(baseDefense(db, shinpin, "broken")).toBe(1);
    expect(costumeDefensePenalty("broken")).toBe(2);
  });

  it("大破で技カードのAP-1（最低1）、連撃率+5%", () => {
    expect(cardApCost(db, db.cards.get("kiru")!, shinpin, "broken")).toBe(1); // 2 - 1
    expect(costumeComboBonus("broken")).toBe(0.05);
    expect(costumeComboBonus("damaged")).toBe(0);
  });

  it("戦闘開始時の防御プールは鍔基礎防御＋衣装補正で充填される", () => {
    const normal = startBattle(db, setup({ costume: "normal" }), createRng(1)).state;
    const broken = startBattle(db, setup({ costume: "broken" }), createRng(1)).state;
    expect(normal.blockPool).toBe(3);
    expect(broken.blockPool).toBe(1); // 3 - 2
  });
});

describe("衣装破損の段階進行（docs/05・現在HPの30%以上の被ダメで進む）", () => {
  it("大ダメージで通常→破損になる", () => {
    // 大しかばね 打撃7、HP10。鍔3で4通る ≧ ceil(10*0.3)=3 → 破損。
    const { state } = startBattle(db, setup({ hp: 10, maxHp: 30, costume: "normal" }), createRng(1));
    const r = endTurn(db, state, createRng(1));
    expect(r.state.costume).toBe("damaged");
    expect(r.events.some((e) => e.type === "CostumeChanged" && e.to === "damaged")).toBe(true);
  });

  it("破損状態でさらに大ダメージを受けると大破になる", () => {
    const { state } = startBattle(db, setup({ hp: 10, maxHp: 30, costume: "damaged" }), createRng(1));
    const r = endTurn(db, state, createRng(1));
    expect(r.state.costume).toBe("broken");
    expect(r.events.some((e) => e.type === "CostumeChanged" && e.to === "broken")).toBe(true);
  });

  it("小ダメージ（現在HPの30%未満）では破損しない", () => {
    // HP満タン30 → 閾値9。打撃7は鍔3で4しか通らず 4<9 → 破損しない。
    const { state } = startBattle(db, setup({ hp: 30, maxHp: 30, costume: "normal" }), createRng(1));
    const r = endTurn(db, state, createRng(1));
    expect(r.state.costume).toBe("normal");
  });
});
