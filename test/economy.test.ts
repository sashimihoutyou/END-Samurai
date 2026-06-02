import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { Game } from "../src/app/game.js";

// 通貨（銭）と野営地の施設（鍛冶屋・行商人・道場）の配線を検証する。
// 数値バランスではなく「撃破で銭が増える／買うと減る／売ると増える／圧縮できる」配線が目的。

function stubRoot(): HTMLElement {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}

const db = buildContent();

describe("通貨（銭）", () => {
  it("通常戦闘に勝つと敵の懸賞金（銭）を得る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    expect(game.run.zeni).toBe(0);
    game.travelTo("c_konbou"); // こんぼう山賊（bounty 12）
    game.battle!.enemies.forEach((e) => (e.hp = 0));
    game.normalEndTurn();
    expect(game.screen).toBe("reward");
    expect(game.run.zeni).toBe(12);
  });

  it("複数体の懸賞金は合算される", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.mapPos = "c_camp2";
    game.travelTo("c_pack"); // よろめくしかばね(8)＋こんぼう山賊(12)
    game.battle!.enemies.forEach((e) => (e.hp = 0));
    game.normalEndTurn();
    expect(game.run.zeni).toBe(20);
  });
});

describe("野営地の施設", () => {
  it("鍛冶屋でカードを買うとデッキに加わり、銭が減る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_camp1");
    game.run.zeni = 30;
    const before = game.run.deck.length;
    game.campBuy("blacksmith", "toishi_no_kakera"); // 10銭
    expect(game.run.deck.length).toBe(before + 1);
    expect(game.run.zeni).toBe(20);
    expect(game.run.deck.some((c) => c.defId === "toishi_no_kakera")).toBe(true);
  });

  it("銭が足りなければ買えない", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_camp1");
    game.run.zeni = 5;
    const before = game.run.deck.length;
    game.campBuy("blacksmith", "toishi_no_kakera"); // 10銭
    expect(game.run.deck.length).toBe(before);
    expect(game.run.zeni).toBe(5);
  });

  it("行商人にカードを売ると銭が増え、デッキから消える", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_camp1");
    game.run.zeni = 0;
    const target = game.run.deck.find((c) => c.defId === "kiru")!; // value 8 → 売値 4
    const before = game.run.deck.length;
    game.campSell(target.uid);
    expect(game.run.deck.length).toBe(before - 1);
    expect(game.run.deck.some((c) => c.uid === target.uid)).toBe(false);
    expect(game.run.zeni).toBe(4);
  });

  it("道場は葵が加入するまで利用できず、加入後に現れる", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    expect(game.campShops().map((s) => s.id)).not.toContain("dojo");
    game.run.companions.push({ id: "aoi", affection: "mid" });
    expect(game.campShops().map((s) => s.id)).toContain("dojo");
  });

  it("道場で型2枚を融合すると新しい技1枚を閃く（デッキ -1・無償）", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.companions.push({ id: "aoi", affection: "mid" });
    game.travelTo("c_camp1");
    game.run.zeni = 0;
    // 斬る＋斬る → 袈裟斬り（初期デッキに斬る×2）。
    const recipeIdx = db.shops.fusions.findIndex((f) => f.result === "kesagiri");
    expect(game.fusableRecipes()).toContain(recipeIdx);
    const before = game.run.deck.length;
    const kiruBefore = game.run.deck.filter((c) => c.defId === "kiru").length;
    game.campFuse(recipeIdx);
    expect(game.run.deck.length).toBe(before - 1); // 2枚消費・1枚追加
    expect(game.run.deck.filter((c) => c.defId === "kiru").length).toBe(kiruBefore - 2);
    expect(game.run.deck.some((c) => c.defId === "kesagiri")).toBe(true);
    expect(game.run.zeni).toBe(0); // 無償
  });

  it("素材が揃っていない融合はできない", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    // 斬るを全て取り除くと、斬る系レシピは実行不能になる。
    game.run.deck = game.run.deck.filter((c) => c.defId !== "kiru");
    const kesagiriIdx = db.shops.fusions.findIndex((f) => f.result === "kesagiri");
    expect(game.fusableRecipes()).not.toContain(kesagiriIdx);
    const before = game.run.deck.length;
    game.campFuse(kesagiriIdx);
    expect(game.run.deck.length).toBe(before); // 何も起きない
  });

  it("仲間アクティブカードは売却の対象外", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    // 葵のアクティブ「型稽古」をデッキに入れる。
    game.run.deck.push({ uid: "kata_keiko@test", defId: "kata_keiko" });
    expect(game.disposableDeck().some((c) => c.defId === "kata_keiko")).toBe(false);
    const before = game.run.deck.length;
    game.campSell("kata_keiko@test");
    expect(game.run.deck.length).toBe(before); // 何も起きない
  });
});

describe("お豊の刀パーツ（在庫＋付け替え）", () => {
  it("パーツ購入で所持品に加わり銭が減る（購入だけでは装備されない）", () => {
    const game = new Game(db, stubRoot());
    game.run.zeni = 100;
    const idx = db.shops.parts.findIndex((p) => p.slot === "blade" && p.stageId === "kireaji_ryoko");
    const price = db.shops.parts[idx].price;
    game.otoyoBuyPart(idx);
    expect(game.run.parts.blade).toContain("kireaji_ryoko");
    expect(game.run.zeni).toBe(100 - price);
    expect(game.run.swordGrade.blade).toBe("shinpin"); // まだ装備は新品同様
  });

  it("銭が足りなければパーツを買えない", () => {
    const game = new Game(db, stubRoot());
    game.run.zeni = 5;
    const idx = db.shops.parts.findIndex((p) => p.slot === "blade" && p.stageId === "kireaji_ryoko");
    game.otoyoBuyPart(idx);
    expect(game.run.parts.blade).toHaveLength(0);
    expect(game.run.zeni).toBe(5);
  });

  it("パーツ交換で装備等級が上がり、外したパーツは所持品へ戻る", () => {
    const game = new Game(db, stubRoot());
    game.run.parts.blade.push("kireaji_ryoko");
    game.otoyoEquip("blade", "kireaji_ryoko");
    expect(game.run.swordGrade.blade).toBe("kireaji_ryoko");
    expect(game.run.sword.blade).toBe("kireaji_ryoko"); // 付けたては等級そのもの
    expect(game.run.parts.blade).not.toContain("kireaji_ryoko"); // 在庫から外れた
    expect(game.run.parts.blade).toContain("shinpin"); // 元の刃が在庫へ戻る
  });

  it("打ち直しは摩耗を装備パーツの等級まで戻す", () => {
    const game = new Game(db, stubRoot());
    game.run.parts.blade.push("kireaji_ryoko");
    game.otoyoEquip("blade", "kireaji_ryoko"); // 等級＝切れ味良好
    game.run.sword.blade = "namakura"; // 戦闘で摩耗した想定
    game.otoyoRepair();
    expect(game.run.sword.blade).toBe("kireaji_ryoko"); // 等級まで戻る（超えない）
    expect(game.run.sword.tsuba).toBe("shinpin"); // 他部位は等級（新品同様）
  });

  it("『ひと晩休む』は同じ野営地で一度きり", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_camp1");
    game.run.hp = 10;
    game.campRest();
    expect(game.run.hp).toBe(15);
    game.campRest(); // 二度目は無効
    expect(game.run.hp).toBe(15);
  });
});
