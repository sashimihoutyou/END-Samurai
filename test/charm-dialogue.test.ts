import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { playSexCard, startCharmBattle, useTodome, type CharmSetup } from "../src/core/rules/charm-battle.js";
import { describeCharmEvent } from "../src/ui/charm-view.js";
import type { CharmEvent } from "../src/core/model/charm.js";

// docs/09「お豊 とろかせ台詞集」のα版取り込み確認。
// §3 性技別リアクション・§4 初挿入専用台詞・終了台詞の処女喪失/再戦の出し分けを保証する。

const db = buildContent();
function setup(over: Partial<CharmSetup> = {}): CharmSetup {
  return { enemyDefId: "otoyo", hp: 30, maxHp: 30, sextech: { mi: 0, shinogi: 0, kissaki: 0 }, ...over };
}

function reactionLine(state: ReturnType<typeof startCharmBattle>["state"], events: CharmEvent[]): string | null {
  // 命中系イベント（HitReaction / WeaknessReaction）の描画結果を1つ拾う。
  for (const ev of events) {
    if (ev.type === "HitReaction" || ev.type === "WeaknessReaction") {
      return describeCharmEvent(db, state, ev);
    }
  }
  return null;
}

describe("docs/09 §3 性技別リアクション", () => {
  it("全ての性技カードに、お豊の性技別リアクション台詞データが存在する", () => {
    for (const card of db.sexCards.values()) {
      const lines = db.text[`charm.hit.otoyo.${card.attrs[0]}`];
      expect(Array.isArray(lines) && lines.length > 0, `${card.id} に charm.hit.otoyo.${card.attrs[0]} が無い`).toBe(true);
    }
  });

  it("経験済みお豊に性技を当てると、必ずお豊のリアクション台詞が出る", () => {
    for (const card of db.sexCards.values()) {
      const { state } = startCharmBattle(db, setup({ virgin: false }), createRng(1));
      const r = playSexCard(db, state, card.id, null, createRng(1));
      const line = reactionLine(r.state, r.events);
      expect(line, `${card.id} のリアクションが出ていない`).toContain("お豊「");
    }
  });
});

describe("docs/09 §4 初挿入専用台詞（処女フラグ）", () => {
  it("処女お豊に初めて挿入系の性技を当てると、初挿入専用台詞が出て処女フラグが下りる", () => {
    const { state } = startCharmBattle(db, setup({ virgin: true }), createRng(1));
    expect(state.virgin).toBe(true);
    const r = playSexCard(db, state, "koshi_o_furu", null, createRng(1)); // 腰を振る！＝正攻（挿入系）
    const hit = r.events.find((e): e is Extract<CharmEvent, { type: "HitReaction" }> => e.type === "HitReaction");
    expect(hit?.first).toBe(true);
    expect(r.state.virgin).toBe(false); // 処女喪失
    const line = describeCharmEvent(db, r.state, hit!);
    const pool = db.text["charm.firstinsert.otoyo.seikou"] as string[]; // §4 専用台詞プールから引かれている
    expect(pool.some((l) => line!.includes(l))).toBe(true);
  });

  it("前戯系（くちづけ）では処女フラグは下りない", () => {
    const { state } = startCharmBattle(db, setup({ virgin: true }), createRng(1));
    const r = playSexCard(db, state, "kuchi_o_ubau", null, createRng(1)); // くちづけ＝前戯
    expect(r.state.virgin).toBe(true);
    expect(r.events.some((e) => e.type === "HitReaction" && e.first)).toBe(false);
  });

  it("経験済みなら挿入系でも初挿入台詞は出ない（通常リアクション）", () => {
    const { state } = startCharmBattle(db, setup({ virgin: false }), createRng(1));
    const r = playSexCard(db, state, "koshi_o_furu", null, createRng(1));
    const hit = r.events.find((e): e is Extract<CharmEvent, { type: "HitReaction" }> => e.type === "HitReaction");
    expect(hit?.first).toBe(false);
  });

  it("全ての挿入系属性に初挿入専用台詞か汎用フォールバックが用意されている", () => {
    for (const attr of ["seikou", "ushirodori", "matagari", "uradori"] as const) {
      const has = db.text[`charm.firstinsert.otoyo.${attr}`] ?? db.text["charm.firstinsert.otoyo.generic"];
      expect(Array.isArray(has) && has.length > 0, `${attr} の初挿入台詞が無い`).toBe(true);
    }
  });
});

describe("とどめ＝初挿入の扱い（前戯のみでとどめに到達した場合）", () => {
  function readyTodome(virgin: boolean) {
    const { state } = startCharmBattle(db, setup({ virgin }), createRng(1));
    state.enemies[0].qi = 0; // 気力0＝放心（とどめ可）まで削った状態を再現
    state.enemies[0].defeated = true;
    return state;
  }

  it("処女のままとどめに到達すると、とどめが初挿入を兼ね処女フラグが下りる＋初回専用台詞", () => {
    const state = readyTodome(true);
    const r = useTodome(db, state, null, createRng(1));
    const td = r.events.find((e): e is Extract<CharmEvent, { type: "TodomeUsed" }> => e.type === "TodomeUsed");
    expect(td?.first).toBe(true);
    expect(r.state.virgin).toBe(false); // とどめ（中出し）で処女喪失
    const line = describeCharmEvent(db, r.state, td!);
    const pool = db.text["charm.todome.otoyo.first"] as string[]; // 初回専用とどめ台詞から引かれている
    expect(pool.some((l) => line!.includes(l))).toBe(true);
  });

  it("経験済みなら通常のとどめ台詞（初回専用は出ない）", () => {
    const state = readyTodome(false);
    const r = useTodome(db, state, null, createRng(1));
    const td = r.events.find((e): e is Extract<CharmEvent, { type: "TodomeUsed" }> => e.type === "TodomeUsed");
    expect(td?.first).toBe(false);
    const line = describeCharmEvent(db, r.state, td!);
    expect(line).toContain("お豊「");
  });

  it("初回専用とどめ台詞データが存在する", () => {
    const lines = db.text["charm.todome.otoyo.first"];
    expect(Array.isArray(lines) && lines.length > 0).toBe(true);
  });
});

describe("終了台詞の処女喪失回／再戦回の出し分け", () => {
  it("初回（charm.result.join）と再戦（charm.result.rematch）が別データとして存在し内容が異なる", () => {
    const join = db.text["charm.result.join"];
    const rematch = db.text["charm.result.rematch"];
    expect(Array.isArray(join) && join.length > 0).toBe(true);
    expect(Array.isArray(rematch) && rematch.length > 0).toBe(true);
    expect(JSON.stringify(join)).not.toBe(JSON.stringify(rematch));
  });
});
