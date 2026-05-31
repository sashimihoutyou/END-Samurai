import type { Game } from "../app/game.js";
import type { ContentDB } from "../core/content/loader.js";
import type { CharmBattleState, CharmEvent, SextechState } from "../core/model/charm.js";
import { WEAKNESS_MAX_STAGE } from "../core/model/charm.js";
import { canPlaySexCard, todomeDamage } from "../core/rules/charm-battle.js";
import { sextechDefense, sextechPower } from "../core/rules/charm-damage.js";
import { escapeHtml, tLine, tPick } from "./text.js";

// 魅了バトル（とろかし）のDOM描画。docs/08 §6.2 のレイアウト思想（HPバーなし＝気力ゲージ）。

function enemyName(state: CharmBattleState, uid: string): string {
  return state.enemies.find((e) => e.uid === uid)?.name ?? uid;
}

function stageLabel(db: ContentDB, name: string, stage: number): string | null {
  if (stage >= WEAKNESS_MAX_STAGE) return tLine(db, "charm.stage.veryweak", { name });
  if (stage === 2) return tLine(db, "charm.stage.like", { name });
  if (stage === 0) return tLine(db, "charm.stage.calm", { name });
  return null; // 等倍は表示なし
}

export function describeCharmEvent(db: ContentDB, state: CharmBattleState, ev: CharmEvent): string | null {
  const nm = (uid: string): string => enemyName(state, uid);
  switch (ev.type) {
    case "TurnStarted": return `── ターン${ev.turn} ──`;
    case "SexCardPlayed": return `▶ ${db.sexCards.get(ev.cardId)?.name ?? ev.cardId}`;
    case "QiDamageDealt": {
      const label = ev.developable ? stageLabel(db, nm(ev.enemyUid), ev.stage) : null;
      return `　${nm(ev.enemyUid)}の気力に ${ev.amount} ダメージ${label ? `　${label}` : ""}`;
    }
    case "DevelopmentUp": return `　✦ ${nm(ev.enemyUid)}の弱点が育った……（開発）`;
    case "QiDefenseDown": return `　${nm(ev.enemyUid)}の気力防御 -${ev.amount}`;
    case "AtkDebuffApplied": return `　${nm(ev.enemyUid)}の攻めが弱まった`;
    case "AllStatsDown": return `　${nm(ev.enemyUid)}の全身から力が抜けた`;
    case "Healed": return `　こゆきはHPを ${ev.amount} 回復`;
    case "GuardChanged": return ev.amount >= 0 ? `　守り +${ev.amount}` : `　守り ${ev.amount}`;
    case "EnemyClimaxed": return `　${nm(ev.enemyUid)}は気力を使い果たした……（痙攣して放心）`;
    case "SextechPointGained": return tLine(db, "charm.sextech.gained");
    case "TodomeReady": return `　★ ${nm(ev.enemyUid)}に『とどめ！』を刺せる`;
    case "TodomeUsed": return ev.finisher ? `▶ とどめ！　——決着` : `▶ とどめ！（HP半分を消費）`;
    case "CompanionJoined": return null; // リザルト画面で描く
    case "EnemyActed": {
      const e = state.enemies.find((x) => x.uid === ev.enemyUid);
      const intent = e?.intents.find((i) => i.id === ev.intentId);
      return `◀ ${nm(ev.enemyUid)}：${escapeHtml(intent?.label ?? ev.intentId)}`;
    }
    case "KoyukiDamaged": return `　こゆきに ${ev.amount} ダメージ${ev.blocked > 0 ? `（${ev.blocked}軽減）` : ""}`;
    case "StatusApplied": return `　こゆきは「${ev.status}」を受けた`;
    case "WeaknessReaction": return tPick(db, `charm.reaction.${ev.enemyDefId}.${ev.attr}`) ?? null;
    case "BattleWon": return `🎉 とろかし、成功`;
    case "BattleLost": return `💀 こゆきは力尽きた……`;
  }
}

function sextechRow(label: string, value: number): string {
  return `${label}${value}`;
}

export function renderCharm(game: Game, root: HTMLElement): void {
  const db = game.db;
  const charm = game.charm;
  if (!charm) return;

  const sdef = sextechDefense(charm.sextech);
  const power = sextechPower(charm.sextech);
  const ready = game.charmIsTodomeReady();

  const enemiesHtml = charm.enemies
    .map((e) => {
      const pct = (e.qi / e.qiMax) * 100;
      return `<div class="enemy ${e.defeated ? "dead" : ""}">
        <div class="enemy-name">${escapeHtml(e.name)}</div>
        <div class="enemy-hp">気力 ${e.qi}/${e.qiMax}　気力防御 ${e.qiDefense}</div>
        <div class="bar charm"><span style="width:${pct}%"></span></div>
        <div class="intent">${e.defeated ? "放心して動けない……" : `次：${escapeHtml(e.intents[e.intentIndex].label)}`}</div>
      </div>`;
    })
    .join("");

  const handHtml = [...db.sexCards.values()]
    .map((def) => {
      const playable = canPlaySexCard(db, charm, def.id);
      const flavor = def.flavorKey ? tLine(db, def.flavorKey) : "";
      return `<button class="card sex ${playable ? "" : "disabled"}" data-card="${def.id}" title="${escapeHtml(flavor)}" ${playable ? "" : "disabled"}>
        <div class="card-name">${escapeHtml(def.name)}</div>
        <div class="card-ap">AP ${def.ap}・気力${def.baseQi}</div>
      </button>`;
    })
    .join("");

  // とどめ！ボタン
  const todomeClass = ready ? "todome ready" : "todome";
  const todomeText = game.charmTodomeArmed
    ? (ready ? "本当に？（もう一度で決着）" : "本当に？（HP半分を消費）")
    : (ready ? `${tLine(db, "charm.todome.label")}（決着！）` : `${tLine(db, "charm.todome.label")}（HP半分＋残AP / ${todomeDamage(charm)}）`);

  // せっくすてく割り振り
  const allocHtml =
    charm.sextechPoints > 0
      ? `<div class="sextech-alloc">
           ポイント:${charm.sextechPoints}　割り振り→
           <button class="alloc" data-part="mi">身</button>
           <button class="alloc" data-part="shinogi">鎬</button>
           <button class="alloc" data-part="kissaki">切先</button>
           <button id="auto">自動（威力寄り）</button>
         </div>`
      : "";

  root.innerHTML = `
    <h1>とろかし — お豊</h1>
    <p class="flavor pink">${escapeHtml(tLine(db, "charm.otoyo.start"))}</p>
    <div class="status"><span class="hint">${escapeHtml(tLine(db, "charm.hint"))}</span></div>
    <div class="enemies">${enemiesHtml}</div>
    <div class="koyuki charm">
      <div>こゆき　HP ${charm.hp}/${charm.maxHp}　AP ${charm.ap}/${charm.apMax}　守り 🛡${charm.guard}${sdef > 0 ? `(+${sdef})` : ""}</div>
      <div class="sword">もう一本の刀　${sextechRow("身", charm.sextech.mi)} / ${sextechRow("鎬", charm.sextech.shinogi)} / ${sextechRow("切先", charm.sextech.kissaki)}　［威力+${power}］</div>
    </div>
    ${allocHtml}
    <div class="hand">${handHtml}</div>
    <div class="controls">
      <button id="todome" class="${todomeClass}">${escapeHtml(todomeText)}</button>
      <button id="endturn" ${charm.phase !== "player" ? "disabled" : ""}>ターン終了</button>
    </div>
    <pre class="log">${escapeHtml(game.log.slice(-16).join("\n"))}</pre>
  `;

  root.querySelectorAll<HTMLButtonElement>(".card.sex").forEach((btn) => {
    btn.addEventListener("click", () => game.charmPlay(btn.dataset.card!));
  });
  root.querySelectorAll<HTMLButtonElement>(".alloc").forEach((btn) => {
    btn.addEventListener("click", () => game.charmAllocate(btn.dataset.part as keyof SextechState));
  });
  root.querySelector<HTMLButtonElement>("#auto")?.addEventListener("click", () => game.charmAuto());
  root.querySelector<HTMLButtonElement>("#todome")?.addEventListener("click", () => game.charmTodome());
  root.querySelector<HTMLButtonElement>("#endturn")?.addEventListener("click", () => game.charmEndTurn());
}
