import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { endTurn, playCard, startBattle, type BattleSetup } from "../src/core/rules/normal-battle.js";
import type { CardInstance } from "../src/core/model/card.js";
import type { SwordState } from "../src/core/model/sword.js";

// docs/10「テストで見つけた改善箇所」で追加した、構築軸（出血/攻撃積み/居合）と
// 予告ランダム型（random_intent）の検証。設計どおりに「育つ・読めない」を担保する。

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

function card(defId: string, n: number): CardInstance {
  return { uid: `${defId}-${n}`, defId };
}
function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return { deck: [card("kiru", 1)], sword: { ...shinpin }, hp: 30, maxHp: 30, enemyDefIds: ["nora_inu"], ...over };
}

describe("構築軸：出血付与（斬り裂く）", () => {
  it("斬り裂くは敵に出血を重ね、ターン終了時に出血DoTが入る", () => {
    const { state } = startBattle(db, setup({ deck: [card("kirisaku", 1)] }), createRng(1));
    const r = playCard(db, state, "kirisaku-1", null, createRng(1));
    const enemy = r.state.enemies[0];
    // 攻撃 floor(6*0.6)=3 が通り、出血x3が付く。
    expect(enemy.statuses.some((s) => s.id === "bleed" && s.x === 3)).toBe(true);
    const hpAfterAttack = enemy.hp;
    const end = endTurn(db, r.state, createRng(1));
    expect(end.events.some((e) => e.type === "BleedTicked" && e.enemyUid === enemy.uid && e.amount === 3)).toBe(true);
    expect(end.state.enemies[0].hp).toBe(hpAfterAttack - 3); // 出血で追加3
  });
});

describe("構築軸：攻撃積み（正眼の構え）", () => {
  it("正眼の構えは戦闘中ずっと攻撃力を底上げする（積める）", () => {
    const { state } = startBattle(db, setup({ deck: [card("seigan", 1), card("seigan", 2), card("kiru", 3)] }), createRng(1));
    // 素の斬る＝6ダメージ。正眼を2回積むと攻撃力+4 → 斬る=10ダメージ。
    let s = playCard(db, state, "seigan-1", null, createRng(1)).state;
    s = playCard(db, s, "seigan-2", null, createRng(1)).state;
    expect(s.bonusPools.attack).toBe(4);
    const before = s.enemies[0].hp;
    s = playCard(db, s, "kiru-3", null, createRng(1)).state;
    expect(before - s.enemies[0].hp).toBe(10); // (6+4)*1.0
  });
});

describe("構築軸：払い出し（居合）", () => {
  it("居合は前ターン未行動でのみ撃てる大ダメージ技", () => {
    // 行動済みのターンは撃てない。
    const { state } = startBattle(db, setup({ deck: [card("kiru", 1), card("iai", 2)] }), createRng(1));
    const acted = playCard(db, state, "kiru-1", null, createRng(1)).state;
    expect(() => playCard(db, acted, "iai-2", null, createRng(1))).toThrow();
    // 何もせずターンを送れば、次ターンは未行動で撃てる。
    const fresh = startBattle(db, setup({ deck: [card("iai", 1)] }), createRng(2));
    const next = endTurn(db, fresh.state, createRng(2)).state; // turn1 未行動でターン終了
    const r = playCard(db, next, "iai-1", null, createRng(2));
    // 攻撃 floor(6*2.0)=12（防御0）。
    expect(next.enemies[0].hp - r.state.enemies[0].hp).toBe(12);
  });
});

describe("予告ランダム型（random_intent）", () => {
  it("亡霊武者・大しかばねは予告ランダム型として読み込める", () => {
    expect(db.enemies.get("akuryo_musha")?.archetype).toBe("random_intent");
    expect(db.enemies.get("oo_shikabane")?.archetype).toBe("random_intent");
    expect(db.enemies.get("oo_shikabane")?.isBoss).toBe(true);
  });

  it("表示中の予告＝この敵ターンに実行される行動（予告とのズレがない）", () => {
    let { state } = startBattle(db, setup({ enemyDefIds: ["oo_shikabane"], hp: 60, maxHp: 60 }), createRng(7));
    for (let i = 0; i < 5 && state.phase === "player"; i++) {
      const telegraphed = state.enemies[0].intents[state.enemies[0].intentIndex].id;
      const r = endTurn(db, state, createRng(7 + i)); // rngはターンごとに変えて抽選を揺らす
      const acted = r.events.find((e) => e.type === "EnemyActed");
      expect(acted && acted.type === "EnemyActed" && acted.intentId).toBe(telegraphed);
      state = r.state;
      if (state.phase !== "player") break;
    }
  });
});

describe("コンテンツ：構築軸とエリートが配線されている", () => {
  it("ドロップ候補に新しい構築カードが含まれる", () => {
    for (const id of ["kirisaku", "seigan", "iai"]) expect(db.rewards.dropPool).toContain(id);
  });
  it("田舎マップに任意の強敵分岐（旧戦場跡）がある", () => {
    const map = db.maps.get("inaka")!;
    const elite = map.nodes.find((n) => n.id === "c_elite");
    expect(elite?.enemyGroup).toEqual(["akuryo_musha"]);
    const camp1 = map.nodes.find((n) => n.id === "c_camp1")!;
    expect(camp1.next).toContain("c_elite");
  });
});
