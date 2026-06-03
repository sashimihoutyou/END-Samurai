import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { Game } from "../src/app/game.js";

// App層（game.ts）の画面遷移・マップ進行の配線を、DOMスタブで検証する。
// 戦闘の収支ではなく「ノードを辿る／とろかしで加入する／野営地で修繕する／ボスでクリアへ」の配線が目的。

function stubRoot(): HTMLElement {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}

const db = buildContent();

describe("マップ進行の配線（田舎）", () => {
  it("お豊加入後にマップへ入り、開始地点から山賊戦へ進める", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("start");
    expect(game.nextNodes().map((n) => n.id)).toEqual(["c_konbou", "c_kemono"]);

    game.travelTo("c_konbou");
    expect(game.screen).toBe("battle");
    expect(game.activeNodeId).toBe("c_konbou");
    expect(game.battle?.enemies[0].defId).toBe("konbou_sanzoku");
    expect(game.battleIsBoss).toBe(false);
  });

  it("休息ノードはHPを回復してマップへ戻る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.hp = 10;
    game.mapPos = "c_konbou"; // 分岐元へ（次に c_rest を選べる）
    game.travelTo("c_rest");
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_rest");
    expect(game.run.hp).toBe(18); // +8
  });

  it("野営地で『ひと晩休む』とお豊が刀を完全修繕し、HPを小回復する（留まる）", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.hp = 20;
    game.run.sword = { blade: "namakura", tsuba: "hibiware", tsuka: "yurumi" };
    game.run.costume = "broken";
    game.travelTo("c_camp1");
    expect(game.screen).toBe("camp");
    game.campRest();
    expect(game.run.sword).toEqual({ blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" });
    expect(game.run.costume).toBe("normal"); // 衣も繕われる
    expect(game.run.hp).toBe(25); // +5
    expect(game.screen).toBe("camp"); // 休んでも野営地に留まり、施設を使える
    expect(game.campRested).toBe(true);

    game.campLeave();
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_camp1");
  });

  it("中間地点で葵と遭遇→とろかし→lead で葵が加入し、マップへ戻る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_aoi"); // イベント（葵遭遇）
    expect(game.screen).toBe("event");
    expect(game.currentEvent?.id).toBe("ev_aoi");

    game.chooseEvent(0); // 「とろかす…♡」
    expect(game.torokashi).not.toBeNull();
    expect(game.torokashiEnemyDefId).toBe("aoi");

    // スコアを閾値以上に直接設定してresolution
    game.torokashi!.totalScore = 999;
    game.torokashi!.phase = "madamada";
    game.torokashiFinish();
    expect(game.screen).toBe("torokashi_result");
    expect(game.run.companions.some((c) => c.id === "aoi")).toBe(true);
    expect(game.run.flags.aoiJoined).toBe(true);

    game.afterTorokashiDone();
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_aoi");
  });

  it("むすめしかばね遭遇は「斬る！／とろかす…♡」の二択を提示する", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.mapPos = "c_aoi";
    game.travelTo("c_musume");
    expect(game.screen).toBe("event");
    expect(game.currentEvent?.id).toBe("ev_musume");
    expect(game.currentEvent?.choices).toHaveLength(2);
  });

  it("「斬る！」を選ぶと通常戦闘（むすめしかばね）が始まる", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.mapPos = "c_aoi";
    game.travelTo("c_musume");
    game.chooseEvent(0); // 斬る！
    expect(game.screen).toBe("battle");
    expect(game.torokashi).toBeNull();
    expect(game.battle?.enemies[0].defId).toBe("musume_shikabane");
  });

  it("「とろかす…♡」→lead で救済者+1（加入はしない）、マップへ戻る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.mapPos = "c_aoi";
    game.travelTo("c_musume");
    game.chooseEvent(1); // とろかす…♡
    expect(game.torokashi).not.toBeNull();
    expect(game.torokashiEnemyDefId).toBe("musume_shikabane");

    const before = game.run.rescuedCount;
    game.torokashi!.totalScore = 999;
    game.torokashi!.phase = "madamada";
    game.torokashiFinish();
    expect(game.screen).toBe("torokashi_result");
    expect(game.run.rescuedCount).toBe(before + 1);
    expect(game.run.companions.length).toBe(0); // むすめしかばねは加入しない

    game.afterTorokashiDone();
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_musume");
  });

  it("通常戦闘に勝つと戦利品（報酬3択）画面になり、選ぶとデッキに加わる", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_konbou");
    expect(game.screen).toBe("battle");
    game.battle!.enemies.forEach((e) => (e.hp = 0)); // 撃破状態にする
    game.normalEndTurn();
    expect(game.screen).toBe("reward");
    expect(game.rewardOffer).not.toBeNull();
    const before = game.run.deck.length;
    game.chooseReward(0); // 左枠（非ブラインド）を選ぶ
    expect(game.run.deck.length).toBe(before + 1);
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_konbou");
  });

  it("報酬は受け取らずに進める（デッキ膨張防止）", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_konbou");
    game.battle!.enemies.forEach((e) => (e.hp = 0));
    game.normalEndTurn();
    const before = game.run.deck.length;
    game.skipReward();
    expect(game.run.deck.length).toBe(before);
    expect(game.screen).toBe("map");
  });

  it("中央ブラインド枠は1回開いてから選ぶ", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_konbou");
    game.battle!.enemies.forEach((e) => (e.hp = 0));
    game.normalEndTurn();
    const before = game.run.deck.length;
    const blind = game.rewardOffer!.blindIndex;
    expect(game.rewardCardName(blind)).toBeNull(); // 伏せられている
    game.chooseReward(blind); // 1タップ目＝開く
    expect(game.rewardRevealed).toBe(true);
    expect(game.screen).toBe("reward");
    expect(game.rewardCardName(blind)).not.toBeNull();
    game.chooseReward(blind); // 2タップ目＝入手
    expect(game.run.deck.length).toBe(before + 1);
    expect(game.screen).toBe("map");
  });

  it("ボスノードはボス戦として開始する", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.mapPos = "c_pack";
    game.travelTo("c_boss");
    expect(game.screen).toBe("battle");
    expect(game.battleIsBoss).toBe(true);
    expect(game.battle?.enemies[0].defId).toBe("oo_shikabane");
  });

  it("通常戦闘でHP0かつlost判定になるとゲームオーバー（gameOverを直接呼ぶ）", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_konbou");
    expect(game.screen).toBe("battle");
    // game.gameOver() が正しく gameover 画面を表示するか確認
    game.gameOver();
    expect(game.screen).toBe("gameover");
  });
});
