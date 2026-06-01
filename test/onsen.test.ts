import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { Game } from "../src/app/game.js";
import { choiceScore, maxOnsenScore, resolveOnsen } from "../src/core/rules/onsen.js";

function stubRoot(): HTMLElement {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}

const db = buildContent();

/** 各段で最高スコア（=相手の一番の好み）の選択肢indexを返す。 */
function favoritePicks(eventId: string): number[] {
  const ev = db.onsen.get(eventId)!;
  return ev.stages.map((st) => st.choices.reduce((best, c, i, a) => (c.score > a[best].score ? i : best), 0));
}
/** 各段で最低スコア（=off）の選択肢indexを返す。 */
function worstPicks(eventId: string): number[] {
  const ev = db.onsen.get(eventId)!;
  return ev.stages.map((st) => st.choices.reduce((w, c, i, a) => (c.score < a[w].score ? i : w), 0));
}

/** 温泉を1周プレイして結末まで進める（中断なし）。 */
function playThrough(game: Game, picks: number[]): void {
  const intro = (db.text["onsen.otoyo.intro"] as string[]).length;
  for (let i = 0; i < intro; i++) game.onsenIntroNext(intro);
  for (const idx of picks) {
    game.chooseOnsen(idx);
    expect(game.onsenPhase).toBe("choiceResult");
    game.onsenChoiceContinue();
  }
  expect(game.onsenPhase).toBe("outcome");
}

describe("温泉シーンの結末判定（純粋関数）", () => {
  const ev = db.onsen.get("onsen_otoyo")!;

  it("閾値以上は lead、未満は indulgent", () => {
    expect(resolveOnsen(ev, ev.threshold).outcome).toBe("lead");
    expect(resolveOnsen(ev, ev.threshold - 1).outcome).toBe("indulgent");
  });

  it("せっくすてく獲得はスコア比例（floor(score / rewardDivisor)）", () => {
    expect(resolveOnsen(ev, 10).sextechGain).toBe(Math.floor(10 / ev.rewardDivisor));
    expect(resolveOnsen(ev, 0).sextechGain).toBe(0);
    expect(resolveOnsen(ev, 10).sextechPart).toBe(ev.rewardPart);
  });

  it("いずれの結末も全回復する", () => {
    expect(resolveOnsen(ev, 10).fullHeal).toBe(true);
    expect(resolveOnsen(ev, 0).fullHeal).toBe(true);
  });

  it("5段構成で、最高スコアの総和が閾値を上回れる設計になっている", () => {
    for (const id of ["onsen_otoyo", "onsen_minna"]) {
      const e = db.onsen.get(id)!;
      expect(e.stages.length).toBe(5);
      expect(maxOnsenScore(e)).toBeGreaterThanOrEqual(e.threshold);
      // 全段offを選べば閾値に届かない（攻守逆転ルートに入れる）
      const minSum = e.stages.reduce((s, st) => s + Math.min(...st.choices.map((c) => c.score)), 0);
      expect(minSum).toBeLessThan(e.threshold);
    }
  });

  it("choiceScore は選択肢のスコアを返す", () => {
    expect(choiceScore(ev.stages[0], 0)).toBe(ev.stages[0].choices[0].score);
  });
});

describe("温泉イベントの配線（App層）", () => {
  it("救済者がいなければお豊、いれば複数人の温泉が選ばれる", () => {
    const solo = new Game(db, stubRoot());
    solo.enterMap();
    solo.run.companions = [{ id: "otoyo", affection: "mid" }];
    solo.run.rescuedCount = 0;
    solo.mapPos = "c_musume";
    solo.travelTo("c_onsen");
    expect(solo.onsenEvent?.id).toBe("onsen_otoyo");

    const group = new Game(db, stubRoot());
    group.enterMap();
    group.run.companions = [{ id: "otoyo", affection: "mid" }];
    group.run.rescuedCount = 2;
    group.mapPos = "c_musume";
    group.travelTo("c_onsen");
    expect(group.onsenEvent?.id).toBe("onsen_minna");
  });

  it("好みを当てきる（全段favorite）と lead・せっくすてく加算・全回復してマップへ戻る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.companions = [{ id: "otoyo", affection: "mid" }];
    game.run.rescuedCount = 0;
    game.run.hp = 5;
    game.run.sextech = { mi: 0, shinogi: 0, kissaki: 0 };
    game.mapPos = "c_musume";
    game.travelTo("c_onsen");

    const ev = db.onsen.get("onsen_otoyo")!;
    playThrough(game, favoritePicks("onsen_otoyo"));
    expect(game.onsenResult?.outcome).toBe("lead");
    expect(game.onsenScore).toBe(maxOnsenScore(ev));
    expect(game.run.sextech.shinogi).toBe(Math.floor(maxOnsenScore(ev) / ev.rewardDivisor));
    expect(game.run.hp).toBe(game.run.maxHp);

    const pages = (db.text["onsen.otoyo.lead"] as string[]).length;
    for (let i = 0; i < pages; i++) game.onsenOutcomeNext(pages);
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_onsen");
  });

  it("好みを外し続ける（全段off）と攻守逆転（indulgent）、せっくすてく0でも全回復する", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.companions = [{ id: "otoyo", affection: "mid" }];
    game.run.rescuedCount = 0;
    game.run.hp = 5;
    game.run.sextech = { mi: 0, shinogi: 0, kissaki: 0 };
    game.mapPos = "c_musume";
    game.travelTo("c_onsen");

    playThrough(game, worstPicks("onsen_otoyo"));
    expect(game.onsenScore).toBe(0);
    expect(game.onsenResult?.outcome).toBe("indulgent");
    expect(game.run.sextech.shinogi).toBe(0);
    expect(game.run.hp).toBe(game.run.maxHp); // それでも全回復
  });

  it("中断はなく、必ず5段すべて選び切る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.companions = [{ id: "otoyo", affection: "mid" }];
    game.run.rescuedCount = 0;
    game.mapPos = "c_musume";
    game.travelTo("c_onsen");
    const intro = (db.text["onsen.otoyo.intro"] as string[]).length;
    for (let i = 0; i < intro; i++) game.onsenIntroNext(intro);
    // 4段目まではoff（score0）を選んでも outcome に飛ばない
    for (let s = 0; s < 4; s++) {
      game.chooseOnsen(worstPicks("onsen_otoyo")[s]);
      game.onsenChoiceContinue();
      expect(game.onsenPhase).toBe("stage");
    }
    // 5段目で初めて結末へ
    game.chooseOnsen(0);
    game.onsenChoiceContinue();
    expect(game.onsenPhase).toBe("outcome");
  });
});
