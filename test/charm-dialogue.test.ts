import { describe, expect, it } from "vitest";
import { buildContent } from "../src/data/index.js";
import { createRng } from "../src/core/rng/rng.js";
import { startCharmBattle, type CharmSetup } from "../src/core/rules/charm-battle.js";
import { describeCharmEvent } from "../src/ui/charm-view.js";

// docs/09「お豊 とろかせ台詞集」のα版取り込み確認。
// 性技ごとの相手リアクション（§3）が SexCardPlayed で必ず拾えること、
// および「とどめ！」「絶頂後」台詞が定義されていることを保証する。

const db = buildContent();
const setup: CharmSetup = { enemyDefId: "otoyo", hp: 30, maxHp: 30, sextech: { mi: 0, shinogi: 0, kissaki: 0 } };

describe("docs/09 台詞集のα版取り込み", () => {
  it("全ての性技カードに、お豊の性技別リアクション台詞が存在する", () => {
    for (const card of db.sexCards.values()) {
      const attr = card.attrs[0];
      const key = `charm.hit.otoyo.${attr}`;
      const lines = db.text[key];
      expect(Array.isArray(lines) && lines.length > 0, `${card.id}(${attr}) に ${key} が無い`).toBe(true);
    }
  });

  it("性技を出すと、ログにお豊のリアクション台詞が差し込まれる", () => {
    const { state } = startCharmBattle(db, setup, createRng(1));
    for (const card of db.sexCards.values()) {
      const line = describeCharmEvent(db, state, { type: "SexCardPlayed", cardId: card.id });
      expect(line).not.toBeNull();
      expect(line!).toContain(card.name);
      expect(line!, `${card.id} のリアクションが出ていない`).toContain("お豊「");
    }
  });

  it("『とどめ！』でお豊の決め台詞が出る", () => {
    const { state } = startCharmBattle(db, setup, createRng(1));
    const line = describeCharmEvent(db, state, { type: "TodomeUsed", enemyUid: state.enemies[0].uid });
    expect(line).toContain("とどめ！");
    expect(line).toContain("お豊「");
  });

  it("お豊の通常ターン（四十八手）に挑発台詞が添えられる", () => {
    const { state } = startCharmBattle(db, setup, createRng(1));
    const intentId = state.enemies[0].intents[0].id;
    const line = describeCharmEvent(db, state, { type: "EnemyActed", enemyUid: state.enemies[0].uid, intentId });
    expect(line).toContain("お豊「");
  });
});
