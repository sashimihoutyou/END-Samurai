import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { endTurn, playCard, startBattle, type BattleSetup } from "../src/core/rules/normal-battle.js";
import { generateReward } from "../src/core/rules/reward.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function card(defId: string, n: number, usesLeft?: number): CardInstance {
  return usesLeft != null ? { uid: `${defId}-${n}`, defId, usesLeft } : { uid: `${defId}-${n}`, defId };
}
function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return { deck: [card("kiru", 1)], sword: { ...shinpin }, hp: 30, maxHp: 30, enemyDefIds: ["nora_inu"], ...over };
}

describe("戦闘報酬（docs/03）", () => {
  it("ドロップ候補から重複なく3枚を選び、中央をブラインドにする", () => {
    const offer = generateReward(db.rewards.dropPool, createRng(1));
    expect(offer.cardIds.length).toBe(3);
    expect(new Set(offer.cardIds).size).toBe(3); // 重複なし
    offer.cardIds.forEach((id) => expect(db.rewards.dropPool).toContain(id));
    expect(offer.blindIndex).toBe(1);
  });

  it("同じシードなら同じ提示（決定論）", () => {
    const a = generateReward(db.rewards.dropPool, createRng(123));
    const b = generateReward(db.rewards.dropPool, createRng(123));
    expect(a.cardIds).toEqual(b.cardIds);
  });
});

describe("崩し・自傷（docs/01）", () => {
  it("崩し打ちは対象の防御値を下げる（下限0・戦闘中持続）", () => {
    const { state } = startBattle(db, setup({ deck: [card("kuzushi_uchi", 1)] }), createRng(1));
    state.enemies[0].defense = 5;
    const r = playCard(db, state, "kuzushi_uchi-1", null, createRng(1));
    expect(r.state.enemies[0].defense).toBe(3); // 5 - 2
    expect(r.events.some((e) => e.type === "EnemyDefenseDown" && e.amount === 2)).toBe(true);
  });

  it("柄打ちは固定3ダメージ（防御無視）＋自分の柄を1段階低下", () => {
    const { state } = startBattle(db, setup({ deck: [card("tsuka_uchi", 1)] }), createRng(1));
    state.enemies[0].defense = 10; // 防御無視を確認
    const r = playCard(db, state, "tsuka_uchi-1", null, createRng(1));
    expect(r.state.sword.tsuka).toBe("yurumi"); // shinpin → 緩み
    expect(r.events.some((e) => e.type === "PartDegraded" && e.part === "tsuka")).toBe(true);
    expect(r.state.enemies[0].hp).toBe(12 - 3); // 固定3が防御を貫通
  });
});

describe("状態異常（docs/01）", () => {
  it("出血はターン終了時にXダメージ＋Xを半減（防御無視DoT）", () => {
    const { state } = startBattle(db, setup({ deck: [card("kiru", 1)], enemyDefIds: ["nora_inu"] }), createRng(1));
    state.statuses.push({ id: "bleed", x: 3, turns: Number.MAX_SAFE_INTEGER });
    const r = endTurn(db, state, createRng(1)); // 野犬 噛みつき4 ＋ 出血3
    expect(r.state.hp).toBe(30 - 4 - 3);
    expect(r.events.some((e) => e.type === "BleedTicked" && e.enemyUid === null && e.amount === 3)).toBe(true);
    const bleed = r.state.statuses.find((s) => s.id === "bleed");
    expect(bleed?.x).toBe(1); // 3 → 1（半減）
  });

  it("毒は次ターンのAPを低下させる", () => {
    const { state } = startBattle(db, setup({ deck: [card("kiru", 1)] }), createRng(1));
    state.statuses.push({ id: "poison", x: 2, turns: 3 });
    const r = endTurn(db, state, createRng(1));
    expect(r.state.ap).toBe(4 - 2); // 規定AP4から毒2を減算
  });

  it("気絶した敵はそのターン行動をスキップする", () => {
    const { state } = startBattle(db, setup({ deck: [card("kiru", 1)] }), createRng(1));
    state.enemies[0].statuses.push({ id: "stun", x: 1, turns: 1 });
    const r = endTurn(db, state, createRng(1));
    expect(r.events.some((e) => e.type === "StunSkipped")).toBe(true);
    expect(r.events.some((e) => e.type === "DamageTaken")).toBe(false);
    expect(r.state.hp).toBe(30); // 攻撃されていない
  });

  it("むすめしかばね（通常戦）は出血を付与する", () => {
    // idx0 = 爪を立てる（damage3 ＋ 出血2）。受け切れなければ出血が入る。
    const { state } = startBattle(db, setup({ deck: [card("kiru", 1)], enemyDefIds: ["musume_shikabane"] }), createRng(1));
    const r = endTurn(db, state, createRng(1));
    expect(r.events.some((e) => e.type === "StatusApplied" && e.status === "bleed" && e.toKoyuki)).toBe(true);
  });
});
