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
import type { CharmEnemyInstance, SextechState } from "../src/core/model/charm.js";

const db = buildContent();
const noSextech: SextechState = { mi: 0, shinogi: 0, kissaki: 0 };

function setup(): CharmSetup {
  return { enemyDefId: "otoyo", hp: 30, maxHp: 30, sextech: noSextech };
}

function otoyo(state: ReturnType<typeof startCharmBattle>["state"]): CharmEnemyInstance {
  return state.enemies[0];
}

describe("魅了バトル開始（docs/02・08 §5）", () => {
  it("お豊の気力ゲージ・初期弱点を読み込む", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const e = otoyo(state);
    expect(e.qiMax).toBe(22);
    expect(e.weakness.kuchizuke).toBe(3); // お豊の弱点＝くちづけ（×2.0）
    expect(state.phase).toBe("player");
    expect(state.ap).toBe(4);
  });
});

describe("与気力ダメージ計算（docs/02 数値モデル）", () => {
  it("くちづけ（弱点×2.0）はお豊によく効く", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const e = otoyo(state);
    const card = db.sexCards.get("kuchi_o_ubau")!;
    expect(effectiveStage(card, e)).toBe(3);
    // (baseQi2 + 0) × 2.0 − qiDefense1 = 4 - 1 = 3
    expect(computeQiDamage(card, e, noSextech).amount).toBe(3);
  });

  it("裏取り（×2参照）は素では通りにくい", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const e = otoyo(state);
    const card = db.sexCards.get("koumon_o_semeru")!;
    // 後門：baseQi9 × 0.5(ushirodori弱点0=×0.5) ... uradori段階0 → ×0.5。floor(9×0.5)=4、qiDefense1×2=2 → 2
    const { amount } = computeQiDamage(card, e, noSextech);
    expect(amount).toBeLessThan(card.baseQi);
  });
});

describe("開発システム（同属性3回で弱点段階+1）", () => {
  it("等倍属性を3回突くと弱点段階が1上がる", () => {
    let { state } = startCharmBattle(db, setup(), createRng(123));
    // 腰を振る！＝正攻（seikou）。お豊の正攻は段階1（等倍）スタート
    expect(otoyo(state).weakness.seikou).toBe(1);
    for (let i = 0; i < 3; i++) {
      const r = playSexCard(db, state, "koshi_o_furu", null, createRng(0)); // 連撃加速なしseed
      state = r.state;
      if (state.phase !== "player") break;
      // APを戻す（テスト都合：ターンをまたがず連続発火させたいので endTurn 経由）
      state = endCharmTurn(db, state, createRng(0)).state;
    }
    expect(otoyo(state).weakness.seikou).toBeGreaterThanOrEqual(2);
  });
});

describe("ほぐし→気力防御デバフ→裏取り貫通", () => {
  it("ほぐしで気力防御が下がる", () => {
    const { state } = startCharmBattle(db, setup(), createRng(1));
    const before = otoyo(state).qiDefense;
    const r = playSexCard(db, state, "yubi_de_hogusu", null, createRng(1));
    expect(otoyo(r.state).qiDefense).toBe(before - 1);
  });
});

describe("乳繰りの与ダメ依存回復", () => {
  it("HPが減った状態で乳を吸うと回復する", () => {
    const s = setup();
    s.hp = 20;
    const { state } = startCharmBattle(db, s, createRng(1));
    const r = playSexCard(db, state, "chichi_o_suu", null, createRng(1));
    expect(r.state.hp).toBeGreaterThan(20); // 与ダメ×0.4 の回復
    expect(r.state.hp).toBeLessThanOrEqual(s.maxHp);
  });
});

describe("とどめ！（docs/02 カード仕様）", () => {
  it("気力0でフィニッシャー成立・ノーコストで撃破＆お豊加入イベント", () => {
    let { state } = startCharmBattle(db, setup(), createRng(1));
    // 気力を強制的に0付近へ：くちづけを撃ち続ける
    let guard = 0;
    while (otoyo(state).qi > 0 && guard++ < 50) {
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

  it("割合コスト版とどめはHPを半分払い、HP1以下にはならない", () => {
    const s = setup();
    s.hp = 10;
    const { state } = startCharmBattle(db, s, createRng(1));
    // 気力満タンなので非フィニッシャー（todomeDamage < qi のはず）
    const r = useTodome(db, state, null, createRng(1));
    expect(r.state.hp).toBe(5); // 10 - floor(10/2)
    expect(r.state.hp).toBeGreaterThanOrEqual(1);
    expect(r.state.ap).toBe(0);
  });
});

describe("敗北条件", () => {
  it("こゆきのHPが0になると敗北", () => {
    const s = setup();
    s.hp = 2;
    let { state } = startCharmBattle(db, s, createRng(1));
    let guard = 0;
    while (state.phase === "player" && guard++ < 50) {
      state = endCharmTurn(db, state, createRng(guard)).state;
    }
    expect(state.phase).toBe("lost");
  });
});

describe("せっくすてくポイント（3ターンごと）", () => {
  it("ターンを重ねるとポイントを獲得する", () => {
    let { state } = startCharmBattle(db, setup(), createRng(1));
    state = endCharmTurn(db, state, createRng(1)).state; // turn2
    state = endCharmTurn(db, state, createRng(2)).state; // turn3 → +1
    expect(state.sextechPoints).toBeGreaterThanOrEqual(1);
  });
});
