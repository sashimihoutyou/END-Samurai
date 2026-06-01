import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import {
  endTurn,
  hasTelegraphedPart,
  playCard,
  setBrace,
  startBattle,
  type BattleSetup,
} from "../src/core/rules/normal-battle.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function card(defId: string, n: number, usesLeft?: number): CardInstance {
  return usesLeft != null ? { uid: `${defId}-${n}`, defId, usesLeft } : { uid: `${defId}-${n}` , defId };
}
function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return { deck: [card("kiru", 1)], sword: { ...shinpin }, hp: 30, maxHp: 30, enemyDefIds: ["nora_inu"], ...over };
}

describe("狙撃型の部位狙い（こんぼう山賊・柄狙い）", () => {
  it("受け切れない部位狙いを通常処理すると柄が1段階低下する", () => {
    const { state } = startBattle(db, setup({ enemyDefIds: ["konbou_sanzoku"] }), createRng(1));
    expect(hasTelegraphedPart(state)).toBe(true); // 初手予告＝鈍器ふりかぶり（柄狙い）
    const r = endTurn(db, state, createRng(1)); // 何もせずに受ける（既定）
    expect(r.state.sword.tsuka).toBe("yurumi"); // shinpin(2) → 緩み(1)
    expect(r.events.some((e) => e.type === "PartDegraded" && e.part === "tsuka")).toBe(true);
    expect(r.state.hp).toBe(25); // 5ダメージ
  });

  it("受ける（防御値≧被ダメ）で受け切れば柄は守られる", () => {
    const deck = [card("ukeru", 1), card("ukeru", 2)];
    let { state } = startBattle(db, setup({ deck, enemyDefIds: ["konbou_sanzoku"] }), createRng(2));
    state = playCard(db, state, "ukeru-1", null, createRng(2)).state;
    state = playCard(db, state, "ukeru-2", null, createRng(2)).state; // 防御値6 ≥ 被ダメ5
    const r = endTurn(db, state, createRng(2));
    expect(r.state.sword.tsuka).toBe("shinpin"); // 守り切った
    expect(r.events.some((e) => e.type === "PartDefended" && e.part === "tsuka")).toBe(true);
    expect(r.state.hp).toBe(30);
  });

  it("いなすと柄は確定で守られるが、被ダメが+50%になる", () => {
    let { state } = startBattle(db, setup({ enemyDefIds: ["konbou_sanzoku"] }), createRng(3));
    state = setBrace(state, "inasu");
    const r = endTurn(db, state, createRng(3));
    expect(r.state.sword.tsuka).toBe("shinpin"); // 部位は守られる
    expect(r.state.hp).toBe(30 - 8); // ceil(5 * 1.5) = 8
  });
});

describe("掴み（よろめくしかばね・大しかばね）", () => {
  // よろめくしかばね：idx0=よろめき（dmg2）/ idx1=むぎゅう（掴み）。2ターン目に掴んでくる。
  function reachGrab() {
    let { state } = startBattle(db, setup({ deck: [card("kiru", 1), card("kiru", 2), card("kiru", 3)], enemyDefIds: ["yoromeku_shikabane"], hp: 40, maxHp: 40 }), createRng(5));
    state = endTurn(db, state, createRng(5)).state; // turn1: よろめき
    const grab = endTurn(db, state, createRng(5)); // turn2: むぎゅう（掴み）
    return grab;
  }

  it("掴まれると grabbedBy が立つ", () => {
    const grab = reachGrab();
    expect(grab.events.some((e) => e.type === "Grabbed")).toBe(true);
    expect(grab.state.grabbedBy).toBe(grab.state.enemies[0].uid);
  });

  it("振りほどけないまま敵ターンを迎えると押し倒される", () => {
    const grab = reachGrab();
    const pin = endTurn(db, grab.state, createRng(5)); // 攻撃せずターン終了
    expect(pin.events.some((e) => e.type === "PinnedDown")).toBe(true);
  });

  it("掴んできた敵を攻撃すると振りほどける（押し倒しを防ぐ）", () => {
    const grab = reachGrab();
    const kiruUid = grab.state.hand.find((c) => c.defId === "kiru")!.uid;
    const atk = playCard(db, grab.state, kiruUid, null, createRng(5));
    expect(atk.events.some((e) => e.type === "GrabReleased")).toBe(true);
    expect(atk.state.grabbedBy).toBe(null);
    const r = endTurn(db, atk.state, createRng(5));
    expect(r.events.some((e) => e.type === "PinnedDown")).toBe(false);
  });
});

describe("道具カード（修繕・回復・回数）", () => {
  it("砥石のかけらは刀身を1段階回復する（cap：切れ味低下まで）", () => {
    const sword: SwordState = { ...shinpin, blade: "namakura" };
    const { state } = startBattle(db, setup({ deck: [card("toishi_no_kakera", 1, 2)], sword }), createRng(1));
    const r = playCard(db, state, "toishi_no_kakera-1", null, createRng(1));
    expect(r.state.sword.blade).toBe("kireaji_teika"); // なまくら(0)→切れ味低下(1)
    expect(r.events.some((e) => e.type === "PartRepaired" && e.part === "blade")).toBe(true);
    expect(r.state.discardPile.find((c) => c.defId === "toishi_no_kakera")?.usesLeft).toBe(1); // 回数1減
  });

  it("回復上限（cap）を超えては戻せない", () => {
    // 刀身が新品同様（2）なら、cap=切れ味低下（1）の砥石では戻せない（変化なし・イベントも出ない）。
    const { state } = startBattle(db, setup({ deck: [card("toishi_no_kakera", 1, 2)], sword: { ...shinpin } }), createRng(1));
    const r = playCard(db, state, "toishi_no_kakera-1", null, createRng(1));
    expect(r.state.sword.blade).toBe("shinpin");
    expect(r.events.some((e) => e.type === "PartRepaired")).toBe(false);
  });

  it("きずぐすりはHPを回復する（最大HP上限）", () => {
    const { state } = startBattle(db, setup({ deck: [card("kizugusuri", 1, 3)], hp: 20, maxHp: 30 }), createRng(1));
    const r = playCard(db, state, "kizugusuri-1", null, createRng(1));
    expect(r.state.hp).toBe(25);
    expect(r.events.some((e) => e.type === "Healed" && e.amount === 5)).toBe(true);
  });

  it("残り回数0の道具は破棄される（デッキから消滅）", () => {
    const sword: SwordState = { ...shinpin, blade: "namakura" };
    const { state } = startBattle(db, setup({ deck: [card("toishi_no_kakera", 1, 1)], sword }), createRng(1));
    const r = playCard(db, state, "toishi_no_kakera-1", null, createRng(1));
    const stillThere =
      r.state.discardPile.some((c) => c.defId === "toishi_no_kakera") ||
      r.state.drawPile.some((c) => c.defId === "toishi_no_kakera") ||
      r.state.hand.some((c) => c.defId === "toishi_no_kakera");
    expect(stillThere).toBe(false); // 破棄された
  });
});

describe("コンテンツ：マップ・イベント・ボス", () => {
  it("田舎マップ・葵イベント・新規敵が読み込める", () => {
    expect(db.maps.has("inaka")).toBe(true);
    expect(db.events.has("ev_aoi")).toBe(true);
    expect(db.enemies.has("konbou_sanzoku")).toBe(true);
    expect(db.enemies.has("yoromeku_shikabane")).toBe(true);
    expect(db.enemies.get("oo_shikabane")?.isBoss).toBe(true);
  });

  it("entry から ボス（c_boss）まで到達できる", () => {
    const map = db.maps.get("inaka")!;
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const stack = [map.entry];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const nx of byId.get(id)!.next) stack.push(nx);
    }
    expect(seen.has("c_boss")).toBe(true);
    expect(byId.get("c_boss")!.type).toBe("boss");
  });

  it("こんぼう山賊（柄狙い）でなければターゲット部位予告は出ない", () => {
    const { state } = startBattle(db, setup({ enemyDefIds: ["nora_inu"] }), createRng(1));
    expect(hasTelegraphedPart(state)).toBe(false);
  });
});
