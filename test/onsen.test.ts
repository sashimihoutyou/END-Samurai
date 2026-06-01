import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { Game } from "../src/app/game.js";
import { isCorrectChoice, resolveOnsen } from "../src/core/rules/onsen.js";

function stubRoot(): HTMLElement {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}

const db = buildContent();

/** ある温泉イベントを、全段「正しい選択」で通すための各段の正解indexを返す。 */
function correctPicks(eventId: string): number[] {
  const ev = db.onsen.get(eventId)!;
  return ev.stages.map((st) => st.choices.findIndex((c) => c.correct));
}

describe("温泉シーンの結末判定（純粋関数）", () => {
  it("全段正解なら lead（せっくすてく獲得・全回復）", () => {
    const ev = db.onsen.get("onsen_otoyo")!;
    const r = resolveOnsen(ev, false);
    expect(r.outcome).toBe("lead");
    expect(r.sextechPart).toBe(ev.rewardPart);
    expect(r.sextechGain).toBe(ev.rewardPoints);
    expect(r.fullHeal).toBe(true);
  });

  it("誤りがあれば indulgent（せっくすてくなし・全回復）", () => {
    const ev = db.onsen.get("onsen_otoyo")!;
    const r = resolveOnsen(ev, true);
    expect(r.outcome).toBe("indulgent");
    expect(r.sextechGain).toBe(0);
    expect(r.fullHeal).toBe(true);
  });

  it("各段に正解の選択肢がちょうど存在する", () => {
    for (const id of ["onsen_otoyo", "onsen_minna"]) {
      const ev = db.onsen.get(id)!;
      for (const st of ev.stages) {
        const corrects = st.choices.filter((c) => c.correct).length;
        expect(corrects).toBe(1);
        const idx = st.choices.findIndex((c) => c.correct);
        expect(isCorrectChoice(st, idx)).toBe(true);
      }
    }
  });
});

describe("温泉イベントの配線（App層）", () => {
  it("救済者がいなければお豊との温泉、いれば複数人の温泉が選ばれる", () => {
    const solo = new Game(db, stubRoot());
    solo.enterMap();
    solo.run.companions = [{ id: "otoyo", affection: "mid" }];
    solo.run.rescuedCount = 0;
    solo.mapPos = "c_musume";
    solo.travelTo("c_onsen");
    expect(solo.screen).toBe("onsen");
    expect(solo.onsenEvent?.id).toBe("onsen_otoyo");

    const group = new Game(db, stubRoot());
    group.enterMap();
    group.run.companions = [{ id: "otoyo", affection: "mid" }];
    group.run.rescuedCount = 2; // 村娘を救済済み
    group.mapPos = "c_musume";
    group.travelTo("c_onsen");
    expect(group.onsenEvent?.id).toBe("onsen_minna");
  });

  it("全段正解で通すと、せっくすてくが増え全回復してマップへ戻る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.companions = [{ id: "otoyo", affection: "mid" }];
    game.run.rescuedCount = 0;
    game.run.hp = 5;
    game.run.sextech = { mi: 0, shinogi: 0, kissaki: 0 };
    game.mapPos = "c_musume";
    game.travelTo("c_onsen");

    // 導入を読み飛ばしてステージへ
    const intro = (db.text["onsen.otoyo.intro"] as string[]).length;
    for (let i = 0; i < intro; i++) game.onsenIntroNext(intro);
    expect(game.onsenPhase).toBe("stage");

    const picks = correctPicks("onsen_otoyo");
    for (const idx of picks) {
      game.chooseOnsen(idx);
      expect(game.onsenPhase).toBe("choiceResult");
      game.onsenChoiceContinue();
    }
    expect(game.onsenPhase).toBe("outcome");
    expect(game.onsenResult?.outcome).toBe("lead");
    expect(game.run.sextech.shinogi).toBe(1); // rewardPart=shinogi, +1
    expect(game.run.hp).toBe(game.run.maxHp); // 全回復

    const pages = (db.text["onsen.otoyo.lead"] as string[]).length;
    for (let i = 0; i < pages; i++) game.onsenOutcomeNext(pages);
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_onsen");
  });

  it("誤ると indulgent ルートへ即分岐し、せっくすてくは増えず全回復する", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.companions = [{ id: "otoyo", affection: "mid" }];
    game.run.rescuedCount = 0;
    game.run.hp = 5;
    game.run.sextech = { mi: 0, shinogi: 0, kissaki: 0 };
    game.mapPos = "c_musume";
    game.travelTo("c_onsen");
    const intro = (db.text["onsen.otoyo.intro"] as string[]).length;
    for (let i = 0; i < intro; i++) game.onsenIntroNext(intro);

    // 第1段で誤答（正解でないindex）を選ぶ
    const ev = db.onsen.get("onsen_otoyo")!;
    const wrong = ev.stages[0].choices.findIndex((c) => !c.correct);
    game.chooseOnsen(wrong);
    game.onsenChoiceContinue(); // 誤り → 即 indulgent 結末へ
    expect(game.onsenPhase).toBe("outcome");
    expect(game.onsenResult?.outcome).toBe("indulgent");
    expect(game.run.sextech.shinogi).toBe(0); // 獲得なし
    expect(game.run.hp).toBe(game.run.maxHp); // それでも全回復
  });
});
