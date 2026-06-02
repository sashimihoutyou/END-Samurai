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

  it("道場でカードを忘れるとデッキが縮む（無償）", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.companions.push({ id: "aoi", affection: "mid" });
    game.travelTo("c_camp1");
    game.run.zeni = 0;
    const target = game.run.deck.find((c) => c.defId === "tsuku")!;
    const before = game.run.deck.length;
    game.campForget(target.uid);
    expect(game.run.deck.length).toBe(before - 1);
    expect(game.run.zeni).toBe(0); // 無償
  });

  it("仲間アクティブカードは売却・処分の対象外", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    // 葵のアクティブ「型稽古」をデッキに入れる。
    game.run.deck.push({ uid: "kata_keiko@test", defId: "kata_keiko" });
    expect(game.disposableDeck().some((c) => c.defId === "kata_keiko")).toBe(false);
    const before = game.run.deck.length;
    game.campSell("kata_keiko@test");
    game.campForget("kata_keiko@test");
    expect(game.run.deck.length).toBe(before); // 何も起きない
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
