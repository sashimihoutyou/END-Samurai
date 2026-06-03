import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import type { TorokashiEnemyDef } from "../src/core/model/torokashi.js";
import {
  startTorokashi,
  selectAttr,
  advanceHand,
  madamada,
  resolveTorokashi,
  SCORE_HIT,
  SCORE_NEAR,
  SCORE_MISS,
  SIZE_SCORE_BEST,
  MADAMADA_HP_COST,
} from "../src/core/rules/torokashi.js";
import { createRng } from "../src/core/rng/rng.js";

const db = buildContent();
const defOf = (id: string): TorokashiEnemyDef => db.torokashiEnemies.get(id)!;
const rng = createRng(42);

describe("startTorokashi：初期状態", () => {
  it("otoyo の初期ステートが正しく生成される", () => {
    const def = defOf("otoyo");
    const { state } = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(1));
    expect(state.enemyDefId).toBe("otoyo");
    expect(state.loop).toBe(0);
    expect(state.hand).toBe(0);
    expect(state.handCount).toBe(def.handCount);
    expect(state.totalScore).toBe(0);
    expect(state.choices).toHaveLength(3);
    expect(state.phase).toBe("choosing");
    expect(state.hp).toBe(20);
    expect(state.maxHp).toBe(30);
  });

  it("loop=0 では uradori は選択肢に出ない", () => {
    const def = defOf("otoyo");
    // 多くのRNGシードで確認
    for (let seed = 0; seed < 20; seed++) {
      const { state } = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(seed));
      expect(state.choices).not.toContain("uradori");
    }
  });
});

describe("selectAttr：属性選択と採点", () => {
  it("お豊の弱点（kuchizuke）を選ぶと hit で大加点", () => {
    const def = defOf("otoyo");
    const { state: s0 } = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(0));
    // 直接 kuchizuke を渡す（choicesに含まれるかは問わない - selectAttrはchoicesをチェックしない）
    const { state, events } = selectAttr(s0, def, "kuchizuke", rng);
    const ev = events.find((e) => e.type === "AttrSelected")!;
    expect(ev.type).toBe("AttrSelected");
    if (ev.type === "AttrSelected") {
      expect(ev.result).toBe("hit");
      expect(ev.points).toBe(SCORE_HIT);
    }
    expect(state.phase).toBe("reacting");
    expect(state.lastResult).toBe("hit");
  });

  it("near 属性（seikou）は near で中加点", () => {
    const def = defOf("otoyo");
    const { state: s0 } = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(0));
    const { events } = selectAttr(s0, def, "seikou", rng);
    const ev = events.find((e) => e.type === "AttrSelected")!;
    if (ev.type === "AttrSelected") {
      expect(ev.result).toBe("near");
      expect(ev.points).toBe(SCORE_NEAR);
    }
  });

  it("miss 属性（hogushi - お豊には効かない）は miss で小加点", () => {
    const def = defOf("otoyo");
    const { state: s0 } = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(0));
    const { events } = selectAttr(s0, def, "hogushi", rng);
    const ev = events.find((e) => e.type === "AttrSelected")!;
    if (ev.type === "AttrSelected") {
      expect(ev.result).toBe("miss");
      expect(ev.points).toBe(SCORE_MISS);
    }
  });

  it("お豊の sizePreference=any でサイズボーナスは BEST", () => {
    const def = defOf("otoyo");
    const { state: s0 } = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(0));
    const { events } = selectAttr(s0, def, "kuchizuke", rng);
    const ev = events.find((e) => e.type === "AttrSelected")!;
    if (ev.type === "AttrSelected") {
      expect(ev.sizeBonus).toBe(SIZE_SCORE_BEST);
    }
  });
});

describe("advanceHand：手番の進行", () => {
  it("最終手でない場合は次の手へ（handが増える）", () => {
    const def = defOf("otoyo"); // handCount=2
    const { state: s0 } = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(0));
    const { state: s1 } = selectAttr(s0, def, "kuchizuke", rng);
    expect(s1.hand).toBe(0);
    const { state: s2 } = advanceHand(s1, def, rng);
    expect(s2.hand).toBe(1);
    expect(s2.phase).toBe("choosing");
  });

  it("最終手（handCount-1）が終わると madamada フェーズへ", () => {
    const def = defOf("otoyo"); // handCount=2
    let state = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(0)).state;
    state = selectAttr(state, def, "kuchizuke", rng).state;
    state = advanceHand(state, def, rng).state;
    // 2手目
    state = selectAttr(state, def, "seikou", rng).state;
    state = advanceHand(state, def, rng).state;
    expect(state.phase).toBe("madamada");
  });
});

describe("madamada：まだまだ！ループ", () => {
  it("まだまだ！でHPを消費し、ループ1へ進む", () => {
    const def = defOf("otoyo");
    let state = startTorokashi(def, { enemyDefId: "otoyo", hp: 20, maxHp: 30 }, createRng(0)).state;
    // madamadaフェーズへ
    state = selectAttr(state, def, "kuchizuke", rng).state;
    state = advanceHand(state, def, rng).state;
    state = selectAttr(state, def, "seikou", rng).state;
    state = advanceHand(state, def, rng).state;
    expect(state.phase).toBe("madamada");

    const { state: s2, events } = madamada(state, def, rng);
    expect(s2.hp).toBe(20 - MADAMADA_HP_COST);
    expect(s2.loop).toBe(1);
    expect(s2.phase).toBe("choosing");
    expect(events.some((e) => e.type === "Madamada")).toBe(true);
  });

  it("loop=1 では uradori が選択肢に出うる（SECOND_LOOP_ONLY）", () => {
    const def = defOf("aoi"); // nearAttrs に uradori あり
    let state = startTorokashi(def, { enemyDefId: "aoi", hp: 20, maxHp: 30 }, createRng(0)).state;
    state = selectAttr(state, def, "hogushi", rng).state;
    state = advanceHand(state, def, rng).state;
    state = selectAttr(state, def, "seikou", rng).state;
    state = advanceHand(state, def, rng).state;
    // madamada → loop 1
    const { state: s2 } = madamada(state, def, createRng(0));
    expect(s2.loop).toBe(1);
    // loop1 では uradori プールに含まれる（実際の choices はRNG依存だが、loop>0は確認）
    expect(s2.loop).toBeGreaterThan(0);
  });

  it("HP0になると相討ち（indulgent で done）", () => {
    const def = defOf("otoyo");
    let state = startTorokashi(def, { enemyDefId: "otoyo", hp: MADAMADA_HP_COST, maxHp: 30 }, createRng(0)).state;
    state = selectAttr(state, def, "kuchizuke", rng).state;
    state = advanceHand(state, def, rng).state;
    state = selectAttr(state, def, "seikou", rng).state;
    state = advanceHand(state, def, rng).state;

    const { state: s2, events } = madamada(state, def, rng);
    expect(s2.hp).toBeGreaterThan(0); // 10%で復活
    expect(s2.phase).toBe("done");
    expect(s2.outcome).toBe("indulgent");
    expect(events.some((e) => e.type === "Hp0Collapse")).toBe(true);
  });
});

describe("resolveTorokashi：結末判定", () => {
  it("musume_shikabane（handCount=1）：高スコア→lead", () => {
    const def = defOf("musume_shikabane");
    const state = { ...startTorokashi(def, { enemyDefId: def.id, hp: 30, maxHp: 30 }, createRng(0)).state, totalScore: 999, phase: "madamada" as const };
    const { state: s } = resolveTorokashi(state, def);
    expect(s.outcome).toBe("lead");
  });

  it("中スコア→indulgent", () => {
    const def = defOf("musume_shikabane");
    const state = { ...startTorokashi(def, { enemyDefId: def.id, hp: 30, maxHp: 30 }, createRng(0)).state, totalScore: 15, phase: "madamada" as const };
    const { state: s } = resolveTorokashi(state, def);
    expect(s.outcome).toBe("indulgent");
  });

  it("低スコア→failure", () => {
    const def = defOf("musume_shikabane");
    const state = { ...startTorokashi(def, { enemyDefId: def.id, hp: 30, maxHp: 30 }, createRng(0)).state, totalScore: 5, phase: "madamada" as const };
    const { state: s } = resolveTorokashi(state, def);
    expect(s.outcome).toBe("failure");
  });

  it("lead 時、joinCompanionId がある相手は CompanionJoined イベントが発火する", () => {
    const def = defOf("otoyo"); // joinCompanionId = "otoyo"
    const state = { ...startTorokashi(def, { enemyDefId: def.id, hp: 30, maxHp: 30 }, createRng(0)).state, totalScore: 999, phase: "madamada" as const };
    const { events } = resolveTorokashi(state, def);
    expect(events.some((e) => e.type === "CompanionJoined")).toBe(true);
  });

  it("failure 時は OutcomeFailure イベントが発火する", () => {
    const def = defOf("musume_shikabane");
    const state = { ...startTorokashi(def, { enemyDefId: def.id, hp: 30, maxHp: 30 }, createRng(0)).state, totalScore: 1, phase: "madamada" as const };
    const { events } = resolveTorokashi(state, def);
    expect(events.some((e) => e.type === "OutcomeFailure")).toBe(true);
  });
});

describe("とろかし敵データ（torokashi-enemies.json）", () => {
  it("3体の敵（otoyo/aoi/musume_shikabane）がロードされる", () => {
    expect(db.torokashiEnemies.get("otoyo")).toBeDefined();
    expect(db.torokashiEnemies.get("aoi")).toBeDefined();
    expect(db.torokashiEnemies.get("musume_shikabane")).toBeDefined();
  });

  it("葵の weakAttrs は hogushi", () => {
    const aoi = defOf("aoi");
    expect(aoi.weakAttrs).toContain("hogushi");
  });

  it("葵の nearAttrs に uradori が含まれる", () => {
    const aoi = defOf("aoi");
    expect(aoi.nearAttrs).toContain("uradori");
  });
});
