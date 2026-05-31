import { buildContent } from "../data/index.js";
import { Game } from "./game.js";

// エントリ：コンテンツを構築し、画面遷移ステートマシン（Game）を起動するだけの薄い層。
// ゲームロジックは Core層（src/core）、画面遷移は App層（game.ts）、描画は UI層（src/ui）。

const db = buildContent();
const root = document.getElementById("app");
if (!root) throw new Error("#app が見つかりません");

const game = new Game(db, root);
game.start();
