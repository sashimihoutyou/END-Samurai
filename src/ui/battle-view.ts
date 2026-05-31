import type { Game } from "../app/game.js";
import type { ContentDB } from "../core/content/loader.js";
import type { BattleEvent, BattleState } from "../core/model/battle-state.js";
import type { SwordPart } from "../core/model/sword.js";
import { cardApCost } from "../core/rules/damage.js";
import { canPlayCard } from "../core/rules/normal-battle.js";
import { escapeHtml, tLine } from "./text.js";

// 通常戦闘（HP戦）のDOM描画。Core層を呼ぶだけで状態は持たない。

export function describeBattleEvent(db: ContentDB, state: BattleState, ev: BattleEvent): string | null {
  const enemyName = (uid: string): string => state.enemies.find((e) => e.uid === uid)?.name ?? uid;
  switch (ev.type) {
    case "TurnStarted": return `── ターン${ev.turn} ──`;
    case "CardPlayed": return `▶ ${db.cards.get(ev.cardDefId)?.name ?? ev.cardDefId}`;
    case "DamageDealt": return `　${enemyName(ev.enemyUid)}に ${ev.amount} ダメージ${ev.ignoredDefense ? "（防御無視）" : ""}`;
    case "ComboTriggered": return `　⚡連撃！ ${enemyName(ev.enemyUid)}へ ${ev.amount}`;
    case "BlockGained": return `　防御値 +${ev.amount}`;
    case "DodgeArmed": return `　見切り構え（次の攻撃を回避）`;
    case "EnemyDefeated": return `　✖ ${enemyName(ev.enemyUid)} を倒した`;
    case "EnemyActed": return `◀ ${enemyName(ev.enemyUid)} の行動`;
    case "DamageTaken":
      return ev.dodged ? `　見切り成功！ ダメージ回避` : `　こゆきに ${ev.amount - ev.blocked} ダメージ（${ev.blocked}を防御）`;
    case "KoyukiReaction": return `　「${ev.reactionKey}」`;
    case "BattleWon": return `🎉 戦闘に勝利！`;
    case "BattleLost": return `💀 こゆきは倒れた……`;
  }
}

function stageName(db: ContentDB, sword: BattleState["sword"], part: SwordPart): string {
  const id = sword[part];
  return db.swordStages.get(part)?.stages.find((s) => s.id === id)?.name ?? id;
}

function intentDamage(e: BattleState["enemies"][number]): string {
  const intent = e.intents[e.intentIndex];
  const dmg = intent.effects.reduce((s, x) => s + (x.kind === "damage" ? x.amount : 0), 0);
  return dmg > 0 ? `${dmg}ダメージ` : "―";
}

export function renderBattle(game: Game, root: HTMLElement): void {
  const db = game.db;
  const battle = game.battle;
  if (!battle) return;

  const enemiesHtml = battle.enemies
    .map((e) => {
      const alive = e.hp > 0;
      const intent = e.intents[e.intentIndex];
      return `<div class="enemy ${alive ? "" : "dead"}">
        <div class="enemy-name">${escapeHtml(e.name)}</div>
        <div class="enemy-hp">HP ${e.hp}/${e.maxHp}</div>
        <div class="bar"><span style="width:${(e.hp / e.maxHp) * 100}%"></span></div>
        ${alive ? `<div class="intent">予告: ${escapeHtml(intent.label)}（${intentDamage(e)}）</div>` : `<div class="intent">―</div>`}
      </div>`;
    })
    .join("");

  const handHtml = battle.hand
    .map((c) => {
      const def = db.cards.get(c.defId)!;
      const cost = cardApCost(db, def, battle.sword);
      const playable = canPlayCard(db, battle, c.uid);
      const flavor = def.flavorKey ? tLine(db, def.flavorKey) : "";
      return `<button class="card ${playable ? "" : "disabled"}" data-uid="${c.uid}" title="${escapeHtml(flavor)}" ${playable ? "" : "disabled"}>
        <div class="card-name">${escapeHtml(def.name)}</div>
        <div class="card-ap">AP ${cost}</div>
      </button>`;
    })
    .join("");

  root.innerHTML = `
    <h1>第1エリア・いんなか村周辺</h1>
    <p class="flavor">${escapeHtml(tLine(db, "battle.nora.encounter"))}</p>
    <div class="status">ターン ${battle.turn}　<span class="hint">${escapeHtml(tLine(db, "battle.nora.hint"))}</span></div>
    <div class="enemies">${enemiesHtml}</div>
    <div class="koyuki">
      <div>こゆき　HP ${battle.hp}/${battle.maxHp}　AP ${battle.ap}/${battle.apMax}　防御値 🛡${battle.blockPool}${battle.dodgeNext ? "　[見切り構え]" : ""}</div>
      <div class="sword">刀身[${stageName(db, battle.sword, "blade")}] 鍔[${stageName(db, battle.sword, "tsuba")}] 柄[${stageName(db, battle.sword, "tsuka")}]</div>
    </div>
    <div class="hand">${handHtml}</div>
    <div class="controls">
      <button id="endturn" ${battle.phase !== "player" ? "disabled" : ""}>ターン終了</button>
    </div>
    <pre class="log">${escapeHtml(game.log.slice(-14).join("\n"))}</pre>
  `;

  root.querySelectorAll<HTMLButtonElement>(".card").forEach((btn) => {
    btn.addEventListener("click", () => game.normalPlay(btn.dataset.uid!));
  });
  root.querySelector<HTMLButtonElement>("#endturn")?.addEventListener("click", () => game.normalEndTurn());
}
