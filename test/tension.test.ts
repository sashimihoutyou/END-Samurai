import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { Game } from "../src/app/game.js";
import { createRng } from "../src/core/rng/rng.js";
import { endTurn, playCard, startBattle, type BattleSetup } from "../src/core/rules/normal-battle.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

// docs/10「緊張の設計」で導入した3つの仕組みを検証する。
//  1. 刃の摩耗：斬り続けると刀身がじわじわ鈍る（長丁場のメンテ駆け引き）。
//  2. ボスの刃削り：大しかばねのぶちかましを防げないと刀身が落ちる（climaxの競争）。
//  3. ランの成長曲線：エリート撃破で最大HPが永続的に伸びる。

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function stubRoot(): HTMLElement {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}
function card(defId: string, n: number): CardInstance {
  return { uid: `${defId}-${n}`, defId };
}
function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return { deck: [card("kiru", 1)], sword: { ...shinpin }, hp: 60, maxHp: 60, enemyDefIds: ["oo_shikabane"], ...over };
}

describe("刃の摩耗（docs/10）", () => {
  it("設定どおり、規定回数だけ斬ると刀身が1段階鈍る", () => {
    const per = db.combat.bladeWearPerHits;
    expect(per).toBeGreaterThan(0);
    const deck = Array.from({ length: per }, (_, i) => card("kiru", i + 1));
    // 敵ターンを挟まず（摩耗だけを観測）、APを満たして同一ターンで per 回斬る。敵は大しかばね＝高HPで倒れない。
    let { state } = startBattle(db, setup({ deck, enemyDefIds: ["oo_shikabane"] }), createRng(1));
    let degraded = false;
    for (let i = 0; i < per; i++) {
      state.ap = 99; // AP制約を外して同一ターンで斬り続ける（摩耗の発火条件＝斬撃回数のみを見る）
      const uid = state.hand.find((c) => c.defId === "kiru")!.uid;
      const r = playCard(db, state, uid, null, createRng(1));
      state = r.state;
      if (r.events.some((e) => e.type === "PartDegraded" && e.part === "blade")) degraded = true;
    }
    expect(degraded).toBe(true);
    expect(state.sword.blade).toBe("kireaji_teika"); // 新品同様(2) → 切れ味低下(1)
  });

  it("雑魚を数手で倒すぶんには摩耗しない（短い戦闘は無傷）", () => {
    // 斬る2回で野犬（HP12）を倒す＝閾値(5)未満なので摩耗イベントは出ない。
    let { state } = startBattle(db, setup({ deck: [card("kiru", 1), card("kiru", 2)], enemyDefIds: ["nora_inu"] }), createRng(11));
    const r1 = playCard(db, state, "kiru-1", null, createRng(11));
    expect(r1.events.some((e) => e.type === "PartDegraded")).toBe(false);
    expect(r1.state.sword.blade).toBe("shinpin");
  });
});

describe("ボスの刃削り（大しかばね・ぶちかまし）", () => {
  it("ぶちかましを受け切れない（貫通する）と刀身が削れる", () => {
    // ぶちかまし intent を直接据えて、防御を捨てた状態で受ける＝貫通させる。
    let { state } = startBattle(db, setup({ deck: [card("ukeru", 1)], enemyDefIds: ["oo_shikabane"], hp: 60, maxHp: 60 }), createRng(2));
    const idx = state.enemies[0].intents.findIndex((it) => it.id === "buchikamashi");
    state.enemies[0].intentIndex = idx;
    state.blockPool = 0; // 11ダメージが素通り＝貫通
    const r = endTurn(db, state, createRng(2));
    expect(r.events.some((e) => e.type === "PartDegraded" && e.part === "blade")).toBe(true);
    expect(r.state.sword.blade).toBe("kireaji_teika");
  });

  it("ぶちかましも見切れば（回避）刃は守られる", () => {
    let { state } = startBattle(db, setup({ deck: [card("mikiru", 1)], enemyDefIds: ["oo_shikabane"], hp: 60, maxHp: 60 }), createRng(2));
    const idx = state.enemies[0].intents.findIndex((it) => it.id === "buchikamashi");
    state.enemies[0].intentIndex = idx;
    state = playCard(db, state, "mikiru-1", null, createRng(2)).state; // 見切る
    const r = endTurn(db, state, createRng(2));
    expect(r.state.sword.blade).toBe("shinpin"); // 守られた
  });
});

describe("ランの成長曲線（エリート撃破で最大HP+）", () => {
  it("亡霊武者を倒すと最大HPが永続的に伸び、その分回復する", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.mapPos = "c_camp1";
    const beforeMax = game.run.maxHp;
    const reward = db.maps.get("inaka")!.nodes.find((n) => n.id === "c_elite")!.maxHpReward!;
    expect(reward).toBeGreaterThan(0);
    game.travelTo("c_elite");
    game.battle!.hp = 10; // 削られた状態で撃破する（戦闘のHPがランへ引き継がれる）
    game.battle!.enemies.forEach((e) => (e.hp = 0));
    game.normalEndTurn();
    expect(game.run.maxHp).toBe(beforeMax + reward);
    expect(game.run.hp).toBe(10 + reward); // 引き継いだHPに、増えた最大HPぶんを上乗せ回復
    expect(game.screen).toBe("reward");
  });
});
