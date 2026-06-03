import combat from "./combat-config.json";
import swordStages from "./sword-stages.json";
import cards from "./cards.json";
import enemies from "./enemies.json";
import torokashiEnemies from "./torokashi-enemies.json";
import maps from "./maps.json";
import events from "./events.json";
import onsen from "./onsen.json";
import companions from "./companions.json";
import rewards from "./rewards.json";
import shops from "./shops.json";
import text from "./text.json";
import { loadContent, type ContentDB } from "../core/content/loader.js";

// データ層：JSONを集約し、Core層の loadContent で検証して ContentDB を構築する。
// Core層はこのファイルに依存しない（依存方向は data → core の一方向）。
export function buildContent(): ContentDB {
  return loadContent({ combat, swordStages, cards, enemies, torokashiEnemies, maps, events, onsen, companions, rewards, shops, text });
}
