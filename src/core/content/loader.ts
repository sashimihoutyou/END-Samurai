import type { CardDef } from "../model/card.js";
import type { EnemyDef } from "../model/enemy.js";
import type { SwordPart, SwordPartStages, SwordStage } from "../model/sword.js";
import { contentSchema, type CombatConfig, type Content } from "./schema.js";

// JSONを型へ流し込み、IDで引ける索引を備えたコンテンツDBを構築する。
// loadContent はバリデーション済みの生データを受け取る純粋関数（I/Oを持たない）。

export interface ContentDB {
  combat: CombatConfig;
  cards: ReadonlyMap<string, CardDef>;
  enemies: ReadonlyMap<string, EnemyDef>;
  swordStages: ReadonlyMap<SwordPart, SwordPartStages>;
}

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

  return { combat: parsed.combat, cards, enemies, swordStages };
}

/** 指定部位の段階定義を引く。未知のIDはエラー（フェイルファスト）。 */
export function getStage(db: ContentDB, part: SwordPart, stageId: string): SwordStage {
  const partStages = db.swordStages.get(part);
  if (!partStages) throw new Error(`未知の刀部位: ${part}`);
  const stage = partStages.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`部位 ${part} に段階「${stageId}」が存在しません`);
  return stage;
}
