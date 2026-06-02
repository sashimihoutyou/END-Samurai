import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { Game } from "../src/app/game.js";
import { choiceScore, effectiveScore, maxOnsenScore, resolveOnsen } from "../src/core/rules/onsen.js";
import type { OnsenEvent } from "../src/core/model/onsen.js";

function stubRoot(): HTMLElement {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}

const db = buildContent();
const evOf = (id: string): OnsenEvent => db.onsen.get(id)!;

/** 各段で最高実効スコア（=その相手の一番効く手）の選択肢indexを返す。 */
function favoritePicks(ev: OnsenEvent): number[] {
  return ev.stages.map((st) =>
    st.choices.reduce((best, c, i, a) => (effectiveScore(ev, c) > effectiveScore(ev, a[best]) ? i : best), 0),
  );
}
/** 各段で最低実効スコアの選択肢indexを返す。 */
function worstPicks(ev: OnsenEvent): number[] {
  return ev.stages.map((st) =>
    st.choices.reduce((w, c, i, a) => (effectiveScore(ev, c) < effectiveScore(ev, a[w]) ? i : w), 0),
  );
}

/** 温泉を1周プレイして結末まで進める（中断なし）。 */
function playThrough(game: Game, picks: number[]): void {
  const intro = (db.text[game.onsenEvent!.introKey] as string[]).length;
  for (let i = 0; i < intro; i++) game.onsenIntroNext(intro);
  for (const idx of picks) {
    game.chooseOnsen(idx);
    expect(game.onsenPhase).toBe("choiceResult");
    game.onsenChoiceContinue();
  }
  expect(game.onsenPhase).toBe("outcome");
}

function startOnsenWith(companions: string[], rescued: number): Game {
  const game = new Game(db, stubRoot());
  game.enterMap();
  game.run.companions = companions.map((id) => ({ id, affection: "mid" as const }));
  game.run.rescuedCount = rescued;
  game.run.hp = 5;
  game.run.sextech = { mi: 0, shinogi: 0, kissaki: 0 };
  game.mapPos = "c_musume";
  game.travelTo("c_onsen");
  return game;
}

describe("温泉シーンの結末判定（純粋関数）", () => {
  const ev = evOf("onsen_otoyo");

  it("閾値以上は lead、未満は indulgent", () => {
    expect(resolveOnsen(ev, ev.threshold).outcome).toBe("lead");
    expect(resolveOnsen(ev, ev.threshold - 1).outcome).toBe("indulgent");
  });

  it("せっくすてく獲得はスコア比例（floor(score / rewardDivisor)）", () => {
    expect(resolveOnsen(ev, 10).sextechGain).toBe(Math.floor(10 / ev.rewardDivisor));
    expect(resolveOnsen(ev, 0).sextechGain).toBe(0);
    expect(resolveOnsen(ev, 10).sextechPart).toBe(ev.rewardPart);
  });

  it("lead は全回復（fullHeal=true）、indulgent は部分回復（fullHeal=false）＝ミニゲームの懸け金", () => {
    expect(resolveOnsen(ev, ev.threshold).fullHeal).toBe(true);
    expect(resolveOnsen(ev, ev.threshold - 1).fullHeal).toBe(false);
  });

  it("全イベント5段構成で、最高スコアの総和が閾値を上回れる／全段最低だと閾値未満", () => {
    for (const id of ["onsen_otoyo", "onsen_aoi", "onsen_musume", "onsen_minna"]) {
      const e = evOf(id);
      expect(e.stages.length).toBe(5);
      expect(maxOnsenScore(e)).toBeGreaterThanOrEqual(e.threshold);
      const minSum = e.stages.reduce((s, st) => s + Math.min(...st.choices.map((c) => effectiveScore(e, c))), 0);
      expect(minSum).toBeLessThan(e.threshold);
    }
  });
});

describe("葵の性感補正（前戯×2・騎乗位×1.5・アナル×1.5）", () => {
  const aoi = evOf("onsen_aoi");

  it("前戯タグの実効スコアは基礎の2倍になる", () => {
    const tease = aoi.stages[0].choices.find((c) => c.tag === "foreplay" && c.score === 2)!;
    expect(effectiveScore(aoi, tease)).toBe(4);
  });

  it("騎乗位は1.5倍（2→3）、アナルは1.5倍（1→2）に丸められる", () => {
    const cowgirl = aoi.stages[3].choices.find((c) => c.tag === "cowgirl")!;
    expect(effectiveScore(aoi, cowgirl)).toBe(3);
    const anal = aoi.stages[3].choices.find((c) => c.tag === "anal")!;
    expect(effectiveScore(aoi, anal)).toBe(2);
  });

  it("タグなしの行為は補正を受けない", () => {
    const plain = aoi.stages[3].choices.find((c) => !c.tag)!;
    expect(effectiveScore(aoi, plain)).toBe(plain.score);
  });

  it("補正のないお豊は基礎スコアのまま（choiceScore＝score）", () => {
    const otoyo = evOf("onsen_otoyo");
    expect(choiceScore(otoyo, otoyo.stages[0], 0)).toBe(otoyo.stages[0].choices[0].score);
  });
});

describe("温泉の相手抽選（その時いる仲間＋救済村娘からランダム）", () => {
  it("候補が1人だけなら確定で出る（お豊／葵／村娘単独）", () => {
    expect(startOnsenWith(["otoyo"], 0).onsenEvent?.id).toBe("onsen_otoyo");
    expect(startOnsenWith(["aoi"], 0).onsenEvent?.id).toBe("onsen_aoi");
    expect(startOnsenWith([], 1).onsenEvent?.id).toBe("onsen_musume"); // 複数人は救済2人から
  });

  it("救済2人・仲間なしなら、村娘単独か複数人のどちらかが出る", () => {
    const id = startOnsenWith([], 2).onsenEvent?.id;
    expect(["onsen_musume", "onsen_minna"]).toContain(id);
  });

  it("仲間2人＋救済2人なら、4候補のいずれかが抽選される", () => {
    const id = startOnsenWith(["otoyo", "aoi"], 2).onsenEvent?.id;
    expect(["onsen_otoyo", "onsen_aoi", "onsen_musume", "onsen_minna"]).toContain(id);
  });

  it("候補がいなければ温泉は発生せずマップへ戻る", () => {
    const game = startOnsenWith([], 0);
    expect(game.screen).toBe("map");
    expect(game.onsenEvent).toBeNull();
  });
});

describe("温泉イベントの進行（App層）", () => {
  it("好みを当てきる（全段favorite）と lead・せっくすてく加算・全回復してマップへ戻る", () => {
    const game = startOnsenWith(["aoi"], 0);
    const ev = evOf("onsen_aoi");
    playThrough(game, favoritePicks(ev));
    expect(game.onsenResult?.outcome).toBe("lead");
    expect(game.onsenScore).toBe(maxOnsenScore(ev));
    expect(game.run.sextech.kissaki).toBe(Math.floor(maxOnsenScore(ev) / ev.rewardDivisor));
    expect(game.run.hp).toBe(game.run.maxHp);

    const pages = (db.text["onsen.aoi.lead"] as string[]).length;
    for (let i = 0; i < pages; i++) game.onsenOutcomeNext(pages);
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_onsen");
  });

  it("好みを外し続ける（全段off）と攻守逆転（indulgent）、回復は中途半端（最大HPの6割まで）", () => {
    const game = startOnsenWith(["otoyo"], 0); // run.hp は 5 から
    playThrough(game, worstPicks(evOf("onsen_otoyo")));
    expect(game.onsenScore).toBe(0);
    expect(game.onsenResult?.outcome).toBe("indulgent");
    expect(game.run.sextech.shinogi).toBe(0);
    // 蕩かされて回復は中途半端：最大HP30の6割=18までしか戻らない（全回復しない）。
    expect(game.run.hp).toBe(Math.floor(game.run.maxHp * 0.6));
    expect(game.run.hp).toBeLessThan(game.run.maxHp);
  });

  it("中断はなく、必ず5段すべて選び切る", () => {
    const game = startOnsenWith(["otoyo"], 0);
    const intro = (db.text["onsen.otoyo.intro"] as string[]).length;
    for (let i = 0; i < intro; i++) game.onsenIntroNext(intro);
    const worst = worstPicks(evOf("onsen_otoyo"));
    for (let s = 0; s < 4; s++) {
      game.chooseOnsen(worst[s]);
      game.onsenChoiceContinue();
      expect(game.onsenPhase).toBe("stage");
    }
    game.chooseOnsen(0);
    game.onsenChoiceContinue();
    expect(game.onsenPhase).toBe("outcome");
  });
});
