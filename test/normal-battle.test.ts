import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { canPlayCard, endTurn, playCard, startBattle, type BattleSetup } from "../src/core/rules/normal-battle.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

const db = buildContent();
const sword: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function setup(deck: CardInstance[]): BattleSetup {
  return { deck, sword, hp: 30, maxHp: 30, enemyDefIds: ["nora_inu"] };
}

function card(defId: string, n: number): CardInstance {
  return { uid: `${defId}-${n}`, defId };
}

describe("通常戦闘ターン構造（docs/01）", () => {
  it("戦闘開始：手札5枚・AP4・敵HP12", () => {
    const deck = [card("kiru", 1), card("kiru", 2), card("tsuku", 1), card("tsuku", 2), card("ukeru", 1), card("ukeru", 2), card("mikiru", 1)];
    const { state } = startBattle(db, setup(deck), createRng(1));
    expect(state.hand.length).toBe(5);
    expect(state.drawPile.length).toBe(2);
    expect(state.ap).toBe(4);
    expect(state.enemies[0].hp).toBe(12);
    expect(state.phase).toBe("player");
  });

  it("斬るでAPを2消費し、敵に6以上のダメージ（連撃で増えることはある）", () => {
    const deck = [card("kiru", 1)];
    const { state } = startBattle(db, setup(deck), createRng(42));
    expect(canPlayCard(db, state, "kiru-1")).toBe(true);
    const r = playCard(db, state, "kiru-1", null, createRng(42));
    expect(r.state.ap).toBe(2);
    expect(r.state.enemies[0].hp).toBeLessThanOrEqual(6);
    expect(r.state.hand.length).toBe(0);
    expect(r.state.discardPile.length).toBe(1);
  });

  it("入力stateは破壊されない（純粋関数）", () => {
    const deck = [card("kiru", 1)];
    const { state } = startBattle(db, setup(deck), createRng(7));
    const apBefore = state.ap;
    playCard(db, state, "kiru-1", null, createRng(7));
    expect(state.ap).toBe(apBefore); // 元のstateは不変
  });

  it("ターン終了で野犬が噛みつき、鍔基礎防御で1だけ通る・次ターンでAP回復", () => {
    const deck = [card("ukeru", 1), card("mikiru", 1)];
    const { state } = startBattle(db, setup(deck), createRng(3));
    expect(state.blockPool).toBe(3); // 鍔基礎防御3が毎ターン充填される（docs/01）
    const r = endTurn(db, state, createRng(3));
    expect(r.state.hp).toBe(29); // 30 - (噛みつき4 - 鍔基礎防御3)
    expect(r.state.turn).toBe(2);
    expect(r.state.ap).toBe(4);
    expect(r.state.phase).toBe("player");
  });

  it("受けるで防御値を積むと被ダメージを完全に防げる", () => {
    const deck = [card("ukeru", 1)];
    const { state } = startBattle(db, setup(deck), createRng(5));
    const afterBlock = playCard(db, state, "ukeru-1", null, createRng(5));
    expect(afterBlock.state.blockPool).toBe(6); // 鍔基礎防御3 ＋ 受ける3
    const r = endTurn(db, afterBlock.state, createRng(5));
    expect(r.state.hp).toBe(30); // 噛みつき4 < 防御値6 → 無傷
  });

  it("見切るで次の敵攻撃を完全回避する", () => {
    const deck = [card("mikiru", 1)];
    const { state } = startBattle(db, setup(deck), createRng(9));
    const dodge = playCard(db, state, "mikiru-1", null, createRng(9));
    expect(dodge.state.dodgeNext).toBe(true);
    const r = endTurn(db, dodge.state, createRng(9));
    expect(r.state.hp).toBe(30); // 回避
  });

  it("斬る2回（最低12ダメージ）で野犬を倒し勝利", () => {
    const deck = [card("kiru", 1), card("kiru", 2)];
    let { state } = startBattle(db, setup(deck), createRng(11));
    state = playCard(db, state, "kiru-1", null, createRng(11)).state;
    if (state.phase === "player") {
      state = playCard(db, state, "kiru-2", null, createRng(12)).state;
    }
    expect(state.phase).toBe("won");
    expect(state.enemies[0].hp).toBe(0);
  });

  it("攻撃せず放置すると、いずれ敗北する", () => {
    const deck = [card("ukeru", 1)];
    let { state } = startBattle(db, setup(deck), createRng(99));
    let guard = 0;
    while (state.phase === "player" && guard++ < 100) {
      state = endTurn(db, state, createRng(guard)).state;
    }
    expect(state.phase).toBe("lost");
    expect(state.enemies[0].hp).toBeGreaterThan(0); // 攻撃していないので敵は健在
  });
});

describe("コンテンツ検証", () => {
  it("buildContent は例外なくContentDBを構築する", () => {
    expect(() => buildContent()).not.toThrow();
    expect(db.cards.size).toBeGreaterThanOrEqual(4);
    expect(db.enemies.has("nora_inu")).toBe(true);
    expect(db.swordStages.size).toBe(3);
  });
});
