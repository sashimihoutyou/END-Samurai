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
    expect(game.nextNodes().map((n) => n.id)).toEqual(["c_konbou"]);

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

  it("野営地はお豊が刀を完全修繕し、HPを小回復してマップへ戻る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.run.hp = 20;
    game.run.sword = { blade: "namakura", tsuba: "hibiware", tsuka: "yurumi" };
    game.travelTo("c_camp");
    expect(game.screen).toBe("camp");
    game.applyCamp();
    expect(game.screen).toBe("map");
    expect(game.run.sword).toEqual({ blade: "shinpin", tsuba: "shinpin", tsuka: "shinpin" });
    expect(game.run.hp).toBe(25); // +5
  });

  it("中間地点で葵と遭遇→とろかし→とどめで葵が加入し、マップへ戻る", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_aoi"); // イベント（葵遭遇）
    expect(game.screen).toBe("event");
    expect(game.currentEvent?.id).toBe("ev_aoi");

    game.chooseEvent(0); // 「とろかす…♡」
    expect(game.screenCharm).toBe(true);
    expect(game.charmEnemyDefId).toBe("aoi");
    expect(game.charm?.enemies[0].defId).toBe("aoi");

    // 気力0（放心）まで削った状態を作り、とどめで決着させる（収支ではなく配線の確認）。
    game.charm!.enemies[0].qi = 0;
    game.charm!.enemies[0].defeated = true;
    expect(game.charmIsTodomeReady()).toBe(true);
    game.charmTodome(); // 1タップ目：確認
    game.charmTodome(); // 2タップ目：実行→勝利
    expect(game.screen).toBe("charm_result");
    expect(game.run.companions.some((c) => c.id === "aoi")).toBe(true);
    expect(game.run.flags.aoiJoined).toBe(true);

    game.afterCharmResult();
    expect(game.screen).toBe("map");
    expect(game.mapPos).toBe("c_aoi");
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

  it("敗北すると即ゲームオーバー（とろかしの暴発でHP0）", () => {
    const game = new Game(db, stubRoot());
    game.enterMap();
    game.travelTo("c_aoi");
    game.chooseEvent(0);
    game.run.hp = 1;
    game.charm!.hp = 1;
    game.charm!.gaman = 0; // 次の四十八手で暴発しうる状態
    // 暴発でHP0→敗北になるまでターンを進める
    let guard = 0;
    while ((game.screen as string) !== "gameover" && guard++ < 30) {
      game.charmEndTurn();
    }
    expect(game.screen).toBe("gameover");
  });
});
