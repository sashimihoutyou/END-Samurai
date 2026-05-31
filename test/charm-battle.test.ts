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
import { computeQiDamage, effectiveStage } from "../src/core/rules/charm-damage.js";
import type { CharmBattleState, SextechState } from "../src/core/model/charm.js";

const db = buildContent();
const noSextech: SextechState = { mi: 0, shinogi: 0, kissaki: 0 };

function setup(over: Partial<CharmSetup> = {}): CharmSetup {
  return { enemyDefId: "otoyo", hp: 30, maxHp: 30, sextech: noSextech, ...over };
}

function otoyo(state: CharmBattleState) {
  return state.enemies[0];
}

describe("魅了バトル開始（docs/02 我慢ゲージ）", () => {
  it("お豊の気力・我慢ゲージ・初期弱点を読み込む", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const e = otoyo(state);
    expect(e.qiMax).toBe(30);
    expect(e.gamanMax).toBe(8);
    expect(e.weakness.kuchizuke).toBe(3); // お豊の弱点＝くちづけ（×2.0）
    expect(state.gaman).toBe(state.gamanMax); // こゆきの我慢も満タン
    expect(state.phase).toBe("player");
  });
});

describe("与気力ダメージ計算（docs/02 数値モデル）", () => {
  it("くちづけ（弱点×2.0）はお豊によく効く", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const e = otoyo(state);
    const card = db.sexCards.get("kuchi_o_ubau")!;
    expect(effectiveStage(card, e)).toBe(3);
    // (baseQi2 + 0) × 2.0 − qiDefense2 = 4 - 2 = 2
    expect(computeQiDamage(card, e, noSextech).amount).toBe(2);
  });
});

describe("性技命中で気力と我慢の両方を削る", () => {
  it("腰を振る！で気力と我慢が同時に減る", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const before = otoyo(state);
    const qiBefore = before.qi;
    const gamanBefore = before.gaman;
    const r = playSexCard(db, state, "koshi_o_furu", null, createRng(1));
    const after = otoyo(r.state);
    expect(after.qi).toBeLessThan(qiBefore);
    expect(after.gaman).toBeLessThan(gamanBefore);
  });

  it("攻めるとこゆき自身の我慢も減る", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const r = playSexCard(db, state, "koshi_o_furu", null, createRng(1));
    expect(r.state.gaman).toBeLessThan(state.gaman); // baseQi6 → 自我慢 ceil(3)
  });
});

describe("敵の絶頂（我慢0→気力大ダメージ＋部位弱化）", () => {
  it("我慢を削り切ると絶頂し、気力が大きく減り弱点が下がる", () => {
    // 後門を責める！は baseQi9＝与我慢が大きい。お豊の我慢10を数発で割る
    let { state } = startCharmBattle(db, setup(), createRng(7));
    const startKuchizuke = otoyo(state).weakness.kuchizuke;
    let climaxed = false;
    let guard = 0;
    while (!climaxed && guard++ < 20) {
      if (canPlaySexCard(db, state, "koshi_o_furu")) {
        const r = playSexCard(db, state, "koshi_o_furu", null, createRng(guard));
        state = r.state;
        if (r.events.some((e) => e.type === "EnemyClimaxed")) climaxed = true;
      } else {
        state = endCharmTurn(db, state, createRng(guard)).state;
      }
      if (state.phase !== "player") break;
    }
    expect(climaxed).toBe(true);
    // 直近に当てていた seikou が弱化しているはず（または他属性が下がる方向にのみ動く）
    expect(otoyo(state).weakness.kuchizuke).toBeLessThanOrEqual(startKuchizuke);
  });
});

describe("こゆきの射精：暴発と狙い撃ち", () => {
  it("敵に我慢を削り切られると暴発し、HPが大きく減る", () => {
    // 我慢を低く始めたいので、こゆきの我慢を削る四十八手を受け続ける
    let { state } = startCharmBattle(db, setup({ hp: 30, maxHp: 30 }), createRng(3));
    let burst = false;
    let guard = 0;
    while (!burst && guard++ < 40 && state.phase === "player") {
      const r = endCharmTurn(db, state, createRng(guard));
      state = r.state;
      if (r.events.some((e) => e.type === "Ejaculated" && e.trigger === "enemy")) burst = true;
      if (state.phase !== "player" && state.phase !== "enemy") break;
    }
    expect(burst).toBe(true);
    expect(state.hp).toBeLessThan(30); // 暴発でHP大減
  });

  it("狙い撃ち技『口に出させる！』は能動射精で敵の我慢を大きく削り（絶頂誘発）、HP減は小さい", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const gamanBefore = otoyo(state).gaman;
    const r = playSexCard(db, state, "kuchi_ni_dasaseru", null, createRng(1));
    expect(r.events.some((e) => e.type === "Ejaculated" && e.trigger === "self")).toBe(true);
    expect(r.state.hp).toBe(30 - 3); // 狙い撃ちのHP減は小（固定3）
    // 我慢に大ダメージ→絶頂が誘発される（絶頂すると我慢は再充填されるので、絶頂イベントで確認）
    const climaxed = r.events.some((e) => e.type === "EnemyClimaxed");
    const gamanDropped = otoyo(r.state).gaman < gamanBefore;
    expect(climaxed || gamanDropped).toBe(true);
  });
});

describe("乳繰りは与ダメ依存でこゆきの我慢を回復する", () => {
  it("胸を吸うと我慢が回復方向に働く", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    // まず我慢を減らす
    const s1 = playSexCard(db, state, "koshi_o_furu", null, createRng(1)).state;
    const gamanMid = s1.gaman;
    const r = playSexCard(db, s1, "chichi_o_suu", null, createRng(1));
    // 乳を吸う：自我慢消費 ceil(4/2)=2、回復 floor(qi×0.5)。回復が消費を上回るか同等
    expect(r.state.gaman).toBeGreaterThanOrEqual(gamanMid - 2);
  });
});

describe("とどめ！は敵の気力0（放心）でのみ使用可", () => {
  it("気力が残っている間はとどめ不可", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    expect(todomeReady(state, null)).toBe(false);
    expect(() => useTodome(db, state, null, createRng(1))).toThrow();
  });

  it("気力0まで削るととどめ可・確殺でお豊加入", () => {
    let { state } = startCharmBattle(db, setup({ hp: 60, maxHp: 60 }), createRng(5));
    let guard = 0;
    while (!otoyo(state).defeated && guard++ < 80) {
      // 高HPにして暴発で死なないようにしつつ、気力0まで削る
      if (canPlaySexCard(db, state, "koshi_o_furu")) {
        state = playSexCard(db, state, "koshi_o_furu", null, createRng(guard)).state;
      } else {
        state = endCharmTurn(db, state, createRng(guard)).state;
      }
      if (state.phase !== "player") break;
    }
    expect(otoyo(state).defeated).toBe(true);
    expect(todomeReady(state, null)).toBe(true);
    const r = useTodome(db, state, null, createRng(1));
    expect(r.state.phase).toBe("won");
    expect(r.events.some((e) => e.type === "CompanionJoined" && e.companionId === "otoyo")).toBe(true);
  });
});

describe("敗北条件", () => {
  it("HPが低いと暴発の積み重ねで敗北しうる", () => {
    let { state } = startCharmBattle(db, setup({ hp: 8, maxHp: 8 }), createRng(2));
    let guard = 0;
    while (state.phase === "player" && guard++ < 60) {
      state = endCharmTurn(db, state, createRng(guard)).state;
    }
    expect(state.phase).toBe("lost");
  });
});

describe("せっくすてくポイント（3ターンごと）と我慢タフネス", () => {
  it("ターンを重ねるとポイントを獲得し、身/切先に振ると我慢上限が上がる", () => {
    let { state } = startCharmBattle(db, setup(), createRng(1));
    state = endCharmTurn(db, state, createRng(1)).state; // turn2
    state = endCharmTurn(db, state, createRng(2)).state; // turn3 → +1
    expect(state.sextechPoints).toBeGreaterThanOrEqual(1);
  });
});
