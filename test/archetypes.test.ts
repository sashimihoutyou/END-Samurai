import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { endTurn, playCard, startBattle, type BattleSetup } from "../src/core/rules/normal-battle.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

// 設計済み6アーキタイプのうち、残り3型（timed/concealed/synergy）の挙動を検証する。
// これで cyclic・sniper・random_intent（既存）と合わせて全6型が出そろう。

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function card(defId: string, n: number): CardInstance {
  return { uid: `${defId}-${n}`, defId };
}
function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return { deck: [card("kiru", 1)], sword: { ...shinpin }, hp: 60, maxHp: 60, enemyDefIds: ["nora_inu"], ...over };
}

describe("時限型（自爆しかばね）", () => {
  it("fuse ぶん溜めてから大技を確定発動し、自壊する（放置すると食らう）", () => {
    const def = db.enemies.get("jibaku_shikabane")!;
    expect(def.archetype).toBe("timed");
    let { state } = startBattle(db, setup({ deck: [card("ukeru", 1)], enemyDefIds: ["jibaku_shikabane"], hp: 60, maxHp: 60 }), createRng(1));
    expect(state.enemies[0].fuse).toBe(def.fuse);
    // 溜め中は予告が「膨れる」＝0ダメージ。最後のターンに自爆が発動。
    let detonated = false;
    let selfKilled = false;
    let guard = 0;
    let prevHp = state.hp;
    while (state.phase === "player" && guard++ < 10) {
      prevHp = state.hp;
      const r = endTurn(db, state, createRng(guard));
      state = r.state;
      if (r.events.some((e) => e.type === "EnemyActed" && e.intentId === "jibaku")) detonated = true;
      if (state.enemies[0].hp <= 0 && detonated) selfKilled = true;
      if (detonated) break;
    }
    expect(detonated).toBe(true);
    expect(selfKilled).toBe(true); // 大技後に自壊
    expect(state.hp).toBeLessThan(prevHp); // 自爆ダメージを食らった
  });

  it("溜めきる前に倒せば自爆を防げる（レース）", () => {
    // 高火力で素早く削る：HP15を斬る×3で落とす（AP無視でテスト）。
    let { state } = startBattle(db, setup({ deck: [card("kiru", 1), card("kiru", 2), card("kiru", 3)], enemyDefIds: ["jibaku_shikabane"] }), createRng(1));
    for (const c of ["kiru-1", "kiru-2", "kiru-3"]) {
      if (state.phase !== "player") break;
      state.ap = 99;
      const inst = state.hand.find((h) => h.defId === "kiru" && h.uid === c) ?? state.hand.find((h) => h.defId === "kiru");
      if (!inst) break;
      state = playCard(db, state, inst.uid, null, createRng(1)).state;
    }
    expect(state.enemies[0].hp).toBe(0);
    expect(state.phase).toBe("won"); // 自爆させずに撃破
  });
});

describe("隠匿型（くびなししかばね）", () => {
  it("毎ターン随伴効果は1つだけ・効果種別は伏せるが、受け切れば随伴は無効", () => {
    const def = db.enemies.get("kubinashi_shikabane")!;
    expect(def.archetype).toBe("concealed");
    expect(def.intents[0].concealEffect).toBe(true);

    // 受け切る：防御値を厚くして damage(5) を完封 → 随伴無効（ConcealNullified）。
    let { state } = startBattle(db, setup({ deck: [card("ukeru", 1), card("ukeru", 2)], enemyDefIds: ["kubinashi_shikabane"] }), createRng(3));
    state = playCard(db, state, "ukeru-1", null, createRng(3)).state;
    state = playCard(db, state, "ukeru-2", null, createRng(3)).state; // 防御値 3+3+3=9 ≥ 5
    const r = endTurn(db, state, createRng(3));
    expect(r.events.some((e) => e.type === "ConcealNullified")).toBe(true);
    // 随伴は一切入っていない（こゆきに状態異常なし・掴みなし・部位低下なし）。
    expect(r.state.statuses.length).toBe(0);
    expect(r.state.grabbedBy).toBe(null);
    expect(r.state.sword.tsuba).toBe("shinpin");
  });

  it("受け切れないと、候補のうち1種類だけの随伴が入る（複数同時には入らない）", () => {
    let { state } = startBattle(db, setup({ deck: [card("kiru", 1)], enemyDefIds: ["kubinashi_shikabane"], hp: 60, maxHp: 60 }), createRng(2));
    state.blockPool = 0; // 5ダメージ貫通＝随伴が発生しうる
    const r = endTurn(db, state, createRng(2));
    // 付与された随伴の種類数を数える（状態異常＋掴み＋部位低下）。隠匿は毎ターン1つだけ。
    const statusKinds = new Set(r.state.statuses.map((s) => s.id)).size;
    const grabbed = r.state.grabbedBy ? 1 : 0;
    const partDown = r.state.sword.tsuba !== "shinpin" ? 1 : 0;
    expect(statusKinds + grabbed + partDown).toBe(1); // ちょうど1種類
    expect(r.events.some((e) => e.type === "ConcealNullified")).toBe(false);
  });
});

describe("連携型（群れしかばね）", () => {
  it("味方が生存している間は与ダメージにボーナスが乗る", () => {
    let { state } = startBattle(db, setup({ deck: [card("kiru", 1)], enemyDefIds: ["mure_shikabane", "mure_shikabane"], hp: 60, maxHp: 60 }), createRng(1));
    state.blockPool = 0; // 素通しで被ダメを観測
    const r = endTurn(db, state, createRng(1));
    // 2体とも味方あり＝各 3+5=8。EnemyActed→SynergyAmplified が出る。
    expect(r.events.some((e) => e.type === "SynergyAmplified" && e.amount === 5)).toBe(true);
    expect(r.state.hp).toBe(60 - 8 - 8); // 連携2体ぶん
  });

  it("片割れを倒すと、残りは連携ボーナスを失って弱体化する", () => {
    let { state } = startBattle(db, setup({ deck: [card("kiru", 1)], enemyDefIds: ["mure_shikabane", "mure_shikabane"], hp: 60, maxHp: 60 }), createRng(1));
    state.enemies[1].hp = 0; // 片方を倒した状態
    state.blockPool = 0;
    const r = endTurn(db, state, createRng(1));
    expect(r.events.some((e) => e.type === "SynergyAmplified")).toBe(false); // 味方がいない＝ボーナスなし
    expect(r.state.hp).toBe(60 - 3); // 素の3ダメージのみ
  });
});

describe("全6アーキタイプがコンテンツに存在する", () => {
  it("cyclic / sniper / random_intent / timed / concealed / synergy が出そろっている", () => {
    const present = new Set(Array.from(db.enemies.values()).map((e) => e.archetype));
    for (const a of ["cyclic", "sniper", "random_intent", "timed", "concealed", "synergy"]) {
      expect(present.has(a as never)).toBe(true);
    }
  });
});
