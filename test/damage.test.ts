import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import {
  baseDefense,
  bladeAttackPower,
  cardApCost,
  computeAttackDamage,
  computeFixedDamage,
} from "../src/core/rules/damage.js";
import type { SwordState } from "../src/core/model/sword.js";

const db = buildContent();
const shinpin: SwordState = { blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" };

describe("与ダメージ計算式（docs/01 戦闘の数値モデル）", () => {
  it("新品刀・プール±0の刀身攻撃力は基礎6", () => {
    expect(bladeAttackPower(db, shinpin, 0)).toBe(6);
  });

  it("斬る（×1.0・敵防御0）= 6", () => {
    const power = bladeAttackPower(db, shinpin, 0);
    expect(computeAttackDamage(power, 1.0, 0, false)).toBe(6);
  });

  it("突く（×0.6・敵防御0）= 3（floorは倍率の後）", () => {
    const power = bladeAttackPower(db, shinpin, 0);
    expect(computeAttackDamage(power, 0.6, 0, false)).toBe(3);
  });

  it("切れ味低下で袈裟斬り（×1.5）= 7", () => {
    const sword: SwordState = { ...shinpin, blade: "kireaji_teika" };
    const power = bladeAttackPower(db, sword, 0); // 6 + (-1) = 5
    expect(computeAttackDamage(power, 1.5, 0, false)).toBe(7); // floor(7.5)
  });

  it("防御値5の敵に新品斬る = 下限1", () => {
    const power = bladeAttackPower(db, shinpin, 0);
    expect(computeAttackDamage(power, 1.0, 5, false)).toBe(1);
  });

  it("柄打ち（固定3・防御無視）は防御値を無視して3", () => {
    expect(computeFixedDamage(3, 5, true)).toBe(3);
  });

  it("脂弾きの刀身攻撃力は +2（ステータス表に準拠）", () => {
    const sword: SwordState = { ...shinpin, blade: "abura_hajiki" };
    expect(bladeAttackPower(db, sword, 0)).toBe(8);
  });
});

describe("基礎防御とAPコスト", () => {
  it("新品鍔の基礎防御 = 3", () => {
    expect(baseDefense(db, shinpin)).toBe(3);
  });

  it("鍔なしで基礎防御0（下限）", () => {
    expect(baseDefense(db, { ...shinpin, tsuba: "tsuba_nashi" })).toBe(0);
  });

  it("斬るのAPコストは新品で2", () => {
    expect(cardApCost(db, db.cards.get("kiru")!, shinpin)).toBe(2);
  });

  it("脂弾き＋一体化で斬るのAPは-2され下限1", () => {
    const sword: SwordState = { blade: "abura_hajiki", tsuba: "shinpin", tsuka: "ittaika" };
    expect(cardApCost(db, db.cards.get("kiru")!, sword)).toBe(1); // max(1, 2-1-1)
  });
});
