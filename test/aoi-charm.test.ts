import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import {
  canPlaySexCard,
  endCharmTurn,
  playSexCard,
  startCharmBattle,
  todomeReady,
  useTodome,
  type CharmSetup,
} from "../src/core/rules/charm-battle.js";
import { effectiveStage } from "../src/core/rules/charm-damage.js";
import { describeCharmEvent } from "../src/ui/charm-view.js";
import type { CharmBattleState, CharmEvent } from "../src/core/model/charm.js";

const db = buildContent();
function setup(over: Partial<CharmSetup> = {}): CharmSetup {
  return { enemyDefId: "aoi", hp: 40, maxHp: 40, sextech: { mi: 0, shinogi: 0, kissaki: 0 }, ...over };
}
function aoi(state: CharmBattleState) {
  return state.enemies[0];
}

describe("葵のとろかし戦（弱点：ほぐし×2.0／裏取り×1.5）", () => {
  it("初期弱点：ほぐし=3（×2.0）・裏取り=2（×1.5）・葵は経験済みで処女ではない", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const e = aoi(state);
    expect(e.weakness.hogushi).toBe(3);
    expect(e.weakness.uradori).toBe(2);
    expect(effectiveStage(db.sexCards.get("yubi_de_hogusu")!, e)).toBe(3); // ほぐし＝弱点
    expect(state.virgin).toBe(false);
    expect(db.charmEnemies.get("aoi")?.joinCompanionId).toBe("aoi");
  });

  it("ほぐし（×2.0弱点）を当てると弱点突きの固有リアクションが出る", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const r = playSexCard(db, state, "yubi_de_hogusu", null, createRng(1));
    const ev = r.events.find((e): e is Extract<CharmEvent, { type: "WeaknessReaction" }> => e.type === "WeaknessReaction");
    expect(ev?.enemyDefId).toBe("aoi");
    const line = describeCharmEvent(db, r.state, ev!);
    expect(line).toContain("葵「"); // お豊の台詞に化けない
  });

  it("狙い撃ち射精の台詞が葵専用になる（お豊の台詞に化けない）", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const r = playSexCard(db, state, "kuchi_ni_dasaseru", null, createRng(1));
    const ev = r.events.find((e): e is Extract<CharmEvent, { type: "Ejaculated" }> => e.type === "Ejaculated" && e.trigger === "self");
    expect(ev).toBeTruthy();
    const line = describeCharmEvent(db, r.state, ev!);
    expect(line).toContain("葵「");
    expect(line).not.toContain("お豊");
  });

  it("ほぐしで削り切り、とどめで葵が仲間に加わる（処女台詞は出ない）", () => {
    let { state } = startCharmBattle(db, setup({ hp: 80, maxHp: 80 }), createRng(7));
    let guard = 0;
    while (!aoi(state).defeated && guard++ < 120) {
      if (canPlaySexCard(db, state, "yubi_de_hogusu")) {
        state = playSexCard(db, state, "yubi_de_hogusu", null, createRng(guard)).state;
      } else {
        state = endCharmTurn(db, state, createRng(guard)).state;
      }
      if (state.phase !== "player") break;
    }
    expect(aoi(state).defeated).toBe(true);
    expect(todomeReady(state, null)).toBe(true);
    const r = useTodome(db, state, null, createRng(1));
    expect(r.state.phase).toBe("won");
    const td = r.events.find((e): e is Extract<CharmEvent, { type: "TodomeUsed" }> => e.type === "TodomeUsed");
    expect(td?.first).toBe(false); // 経験済み＝初挿入扱いではない
    expect(r.events.some((e) => e.type === "CompanionJoined" && e.companionId === "aoi")).toBe(true);
  });
});
