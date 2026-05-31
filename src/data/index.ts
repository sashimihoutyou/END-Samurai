import combat from "./combat-config.json";
import swordStages from "./sword-stages.json";
import cards from "./cards.json";
import enemies from "./enemies.json";
import { loadContent, type ContentDB } from "../core/content/loader.js";

// データ層：JSONを集約し、Core層の loadContent で検証して ContentDB を構築する。
// Core層はこのファイルに依存しない（依存方向は data → core の一方向）。
export function buildContent(): ContentDB {
  return loadContent({ combat, swordStages, cards, enemies });
}
