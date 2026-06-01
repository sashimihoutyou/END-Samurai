import type { CardDef } from "../model/card.js";
import type { EnemyDef } from "../model/enemy.js";
import type { CharmEnemyDef, SexCardDef } from "../model/charm.js";
import type { EventDef, MapDef } from "../model/map.js";
import type { SwordPart, SwordPartStages, SwordStage } from "../model/sword.js";
import { contentSchema, type CombatConfig, type Content, type TextData } from "./schema.js";

// JSONを型へ流し込み、IDで引ける索引を備えたコンテンツDBを構築する。
// loadContent はバリデーション済みの生データを受け取る純粋関数（I/Oを持たない）。

export interface ContentDB {
  combat: CombatConfig;
  cards: ReadonlyMap<string, CardDef>;
  enemies: ReadonlyMap<string, EnemyDef>;
  swordStages: ReadonlyMap<SwordPart, SwordPartStages>;
  sexCards: ReadonlyMap<string, SexCardDef>;
  charmEnemies: ReadonlyMap<string, CharmEnemyDef>;
  maps: ReadonlyMap<string, MapDef>;
  events: ReadonlyMap<string, EventDef>;
  rewards: { dropPool: string[] };
  text: TextData;
}

/** 魅了バトルのルールが必要とするコンテンツの部分集合（ContentDB が満たす）。 */
export type CharmContentDB = Pick<ContentDB, "combat" | "sexCards" | "charmEnemies">;

/** 任意のオブジェクト（importしたJSON群）を検証し、ContentDBを返す。 */
export function loadContent(raw: unknown): ContentDB {
  const parsed: Content = contentSchema.parse(raw);

  const cards = new Map<string, CardDef>();
  for (const c of parsed.cards) {
    if (cards.has(c.id)) throw new Error(`重複するカードID: ${c.id}`);
    cards.set(c.id, c as CardDef);
  }

  const enemies = new Map<string, EnemyDef>();
  for (const e of parsed.enemies) {
    if (enemies.has(e.id)) throw new Error(`重複する敵ID: ${e.id}`);
    enemies.set(e.id, e as EnemyDef);
  }

  const swordStages = new Map<SwordPart, SwordPartStages>();
  for (const sp of parsed.swordStages) {
    swordStages.set(sp.part, sp as SwordPartStages);
    if (!sp.stages.some((s) => s.id === sp.baseStageId)) {
      throw new Error(`部位 ${sp.part} の baseStageId「${sp.baseStageId}」が stages に存在しません`);
    }
  }

  const sexCards = new Map<string, SexCardDef>();
  for (const c of parsed.sexCards) {
    if (sexCards.has(c.id)) throw new Error(`重複する性技カードID: ${c.id}`);
    sexCards.set(c.id, c as SexCardDef);
  }

  const charmEnemies = new Map<string, CharmEnemyDef>();
  for (const e of parsed.charmEnemies) {
    if (charmEnemies.has(e.id)) throw new Error(`重複する魅了敵ID: ${e.id}`);
    charmEnemies.set(e.id, e as CharmEnemyDef);
  }

  const maps = new Map<string, MapDef>();
  for (const m of parsed.maps) {
    if (maps.has(m.area)) throw new Error(`重複するマップエリア: ${m.area}`);
    const ids = new Set(m.nodes.map((n) => n.id));
    if (!ids.has(m.entry)) throw new Error(`マップ ${m.area} の entry「${m.entry}」が nodes に存在しません`);
    for (const node of m.nodes) {
      for (const nx of node.next) {
        if (!ids.has(nx)) throw new Error(`マップ ${m.area} のノード ${node.id} の接続先「${nx}」が存在しません`);
      }
    }
    maps.set(m.area, m as MapDef);
  }

  const events = new Map<string, EventDef>();
  for (const e of parsed.events) {
    if (events.has(e.id)) throw new Error(`重複するイベントID: ${e.id}`);
    events.set(e.id, e as EventDef);
  }

  // ドロップ候補IDがカードとして存在するか検証（スキーマずれの早期検出）。
  for (const id of parsed.rewards.dropPool) {
    if (!cards.has(id)) throw new Error(`報酬ドロップ候補のカードID「${id}」が cards に存在しません`);
  }

  return { combat: parsed.combat, cards, enemies, swordStages, sexCards, charmEnemies, maps, events, rewards: parsed.rewards, text: parsed.text };
}

/** 指定部位の段階定義を引く。未知のIDはエラー（フェイルファスト）。 */
export function getStage(db: ContentDB, part: SwordPart, stageId: string): SwordStage {
  const partStages = db.swordStages.get(part);
  if (!partStages) throw new Error(`未知の刀部位: ${part}`);
  const stage = partStages.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`部位 ${part} に段階「${stageId}」が存在しません`);
  return stage;
}
