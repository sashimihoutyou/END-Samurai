import { buildContent } from "../data/index.js";
import { createRng } from "../core/rng/rng.js";
import { canPlayCard, endTurn, playCard, startBattle } from "../core/rules/normal-battle.js";
import { cardApCost } from "../core/rules/damage.js";
import type { BattleEvent, BattleState } from "../core/model/battle-state.js";
import { makeStarterDeck, makeStarterSword } from "./starter.js";

// α版 Phase 1 の最小UI（DOM）。UI層はCore層を呼ぶだけで、ゲームロジックは持たない。
// 「斬る／突く／受ける／見切る」で野犬1体と戦える最小ループを実機確認するための足場。

const db = buildContent();
const rng = createRng(Date.now() % 0x7fffffff);

let battle: BattleState;
const log: string[] = [];

function newRun(): void {
  log.length = 0;
  const started = startBattle(
    db,
    {
      deck: makeStarterDeck(),
      sword: makeStarterSword(),
      hp: db.combat.baseMaxHp,
      maxHp: db.combat.baseMaxHp,
      enemyDefIds: ["nora_inu"],
    },
    rng,
  );
  battle = started.state;
  pushEvents(started.events);
  render();
}

function describe(ev: BattleEvent): string {
  switch (ev.type) {
    case "TurnStarted": return `── ターン${ev.turn} ──`;
    case "CardPlayed": return `▶ ${db.cards.get(ev.cardDefId)?.name ?? ev.cardDefId} を使用`;
    case "DamageDealt": return `  ${enemyName(ev.enemyUid)}に ${ev.amount} ダメージ${ev.ignoredDefense ? "（防御無視）" : ""}`;
    case "ComboTriggered": return `  ⚡連撃！ ${enemyName(ev.enemyUid)}へ`;
    case "BlockGained": return `  防御値 +${ev.amount}`;
    case "DodgeArmed": return `  見切り構え（次の攻撃を回避）`;
    case "EnemyDefeated": return `  ✖ ${enemyName(ev.enemyUid)} を倒した`;
    case "EnemyActed": return `◀ ${enemyName(ev.enemyUid)} の行動`;
    case "DamageTaken":
      return ev.dodged ? `  見切り成功！ ダメージ回避` : `  こゆきに ${ev.amount - ev.blocked} ダメージ（${ev.blocked}を防御）`;
    case "KoyukiReaction": return `  「${ev.reactionKey}」`;
    case "BattleWon": return `🎉 戦闘に勝利！`;
    case "BattleLost": return `💀 こゆきは倒れた……`;
  }
}

function enemyName(uid: string): string {
  return battle.enemies.find((e) => e.uid === uid)?.name ?? uid;
}

function pushEvents(events: BattleEvent[]): void {
  for (const ev of events) log.push(describe(ev));
}

function onPlay(cardUid: string): void {
  if (!canPlayCard(db, battle, cardUid)) return;
  const r = playCard(db, battle, cardUid, null, rng);
  battle = r.state;
  pushEvents(r.events);
  render();
}

function onEndTurn(): void {
  if (battle.phase !== "player") return;
  const r = endTurn(db, battle, rng);
  battle = r.state;
  pushEvents(r.events);
  render();
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  const enemiesHtml = battle.enemies
    .map((e) => {
      const intent = e.intents[e.intentIndex];
      const alive = e.hp > 0;
      return `<div class="enemy ${alive ? "" : "dead"}">
        <div class="enemy-name">${e.name}</div>
        <div class="enemy-hp">HP ${e.hp}/${e.maxHp}</div>
        <div class="bar"><span style="width:${(e.hp / e.maxHp) * 100}%"></span></div>
        ${alive ? `<div class="intent">予告: ${intent.label}（${intentDamage(e.intentIndex, e)}）</div>` : `<div class="intent">―</div>`}
      </div>`;
    })
    .join("");

  const handHtml = battle.hand
    .map((c) => {
      const def = db.cards.get(c.defId)!;
      const cost = cardApCost(db, def, battle.sword);
      const playable = canPlayCard(db, battle, c.uid);
      return `<button class="card ${playable ? "" : "disabled"}" data-uid="${c.uid}" ${playable ? "" : "disabled"}>
        <div class="card-name">${def.name}</div>
        <div class="card-ap">AP ${cost}</div>
      </button>`;
    })
    .join("");

  const status = battle.phase === "won" ? "🎉 勝利" : battle.phase === "lost" ? "💀 敗北" : `ターン ${battle.turn}`;
  const over = battle.phase === "won" || battle.phase === "lost";

  app.innerHTML = `
    <h1>サムライこゆき — α版 Phase 1</h1>
    <div class="status">${status}</div>
    <div class="enemies">${enemiesHtml}</div>
    <div class="koyuki">
      <div>こゆき　HP ${battle.hp}/${battle.maxHp}　AP ${battle.ap}/${battle.apMax}　防御値 🛡${battle.blockPool}${battle.dodgeNext ? "　[見切り構え]" : ""}</div>
      <div class="sword">刀身[${stageName("blade")}] 鍔[${stageName("tsuba")}] 柄[${stageName("tsuka")}]</div>
    </div>
    <div class="hand">${handHtml}</div>
    <div class="controls">
      <button id="endturn" ${over || battle.phase !== "player" ? "disabled" : ""}>ターン終了</button>
      <button id="restart">${over ? "もう一度" : "最初から"}</button>
    </div>
    <pre class="log">${log.slice(-14).join("\n")}</pre>
  `;

  app.querySelectorAll<HTMLButtonElement>(".card").forEach((btn) => {
    btn.addEventListener("click", () => onPlay(btn.dataset.uid!));
  });
  document.getElementById("endturn")?.addEventListener("click", onEndTurn);
  document.getElementById("restart")?.addEventListener("click", newRun);
}

function intentDamage(_index: number, e: BattleState["enemies"][number]): string {
  const intent = e.intents[e.intentIndex];
  const dmg = intent.effects.filter((x) => x.kind === "damage").reduce((s, x) => s + (x.kind === "damage" ? x.amount : 0), 0);
  return dmg > 0 ? `${dmg}ダメージ` : "―";
}

function stageName(part: "blade" | "tsuba" | "tsuka"): string {
  const id = battle.sword[part];
  return db.swordStages.get(part)?.stages.find((s) => s.id === id)?.name ?? id;
}

newRun();
