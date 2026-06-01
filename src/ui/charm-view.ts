import type { Game } from "../app/game.js";
import type { ContentDB } from "../core/content/loader.js";
import type { CharmBattleState, CharmEvent, SextechState } from "../core/model/charm.js";
import { WEAKNESS_MAX_STAGE } from "../core/model/charm.js";
import { canPlaySexCard } from "../core/rules/charm-battle.js";
import { sextechDefense, sextechPower } from "../core/rules/charm-damage.js";
import { escapeHtml, tLine, tPick } from "./text.js";

// 魅了バトル（とろかし）のDOM描画。docs/02「我慢ゲージと絶頂・射精」。
// 敵：気力ゲージ＋我慢ゲージ／こゆき：HP・AP・我慢ゲージ・守り を左右対称に表示。

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
    case "SexCardPlayed": {
      const card = db.sexCards.get(ev.cardId);
      const head = `▶ ${card?.name ?? ev.cardId}`;
      // 性技ごとの相手リアクション（docs/09 サンプル台詞集 §3）。属性は裏管理なのでログには出さず台詞だけ拾う。
      const attr = card?.attrs[0];
      const target = state.enemies.find((e) => !e.defeated) ?? state.enemies[0];
      const react = attr && target ? tPick(db, `charm.hit.${target.defId}.${attr}`) : undefined;
      return react ? `${head}\n　${react}` : head;
    }
    case "QiDamageDealt": {
      const e = state.enemies.find((x) => x.uid === ev.enemyUid);
      const label = e ? stageLabel(db, nm(ev.enemyUid), ev.stage) : null;
      return `　${nm(ev.enemyUid)}の気力に ${ev.amount}${label ? `　${label}` : ""}`;
    }
    case "GamanDamageDealt": return `　${nm(ev.enemyUid)}の我慢を ${ev.amount} 削った`;
    case "EnemyClimaxed": {
      const e = state.enemies.find((x) => x.uid === ev.enemyUid);
      const line = e ? tPick(db, `charm.climax.${e.defId}`) : null;
      return `　💥 ${line ?? `${nm(ev.enemyUid)}は達してしまった……`}（気力 -${ev.qiBonus}）`;
    }
    case "WeaknessDown": return `　${nm(ev.enemyUid)}の感じる場所が、ひとつ脆くなった`;
    case "QiDefenseDown": return `　${nm(ev.enemyUid)}の気力防御 -${ev.amount}`;
    case "AtkDebuffApplied": return `　${nm(ev.enemyUid)}の攻めが弱まった`;
    case "GamanRecovered": return `　こゆきは少し落ち着いた（我慢 +${ev.amount}）`;
    case "KoyukiGamanSelf": return ev.amount > 0 ? `　こゆきも高ぶってきた（我慢 -${ev.amount}）` : null;
    case "KoyukiGamanDamaged": return `　こゆきの我慢を ${ev.amount} 削られた${ev.blocked > 0 ? `（${ev.blocked}軽減）` : ""}`;
    case "Ejaculated":
      return ev.trigger === "self"
        ? tPick(db, ev.attr ? `charm.ejac.self.${ev.attr}` : "charm.ejac.self.generic") ?? `▶ こゆきは狙って放った（HP -${ev.hpLoss}）`
        : tPick(db, "charm.ejac.burst") ?? `💢 こゆきは堪えきれず暴発した……（HP -${ev.hpLoss}）`;
    case "GuardChanged": return ev.amount >= 0 ? `　守り +${ev.amount}` : `　守り ${ev.amount}`;
    case "EnemyExhausted": return `　${nm(ev.enemyUid)}は気力を使い果たした……（放心）`;
    case "SextechPointGained": return tLine(db, "charm.sextech.gained");
    case "TodomeReady": return `　★ ${nm(ev.enemyUid)}に『とどめ！』を刺せる`;
    case "TodomeUsed": {
      const e = state.enemies.find((x) => x.uid === ev.enemyUid);
      const line = e ? tPick(db, `charm.todome.${e.defId}`) : null;
      return line ? `▶ とどめ！\n　${line}` : `▶ とどめ！　——決着`;
    }
    case "CompanionJoined": return null; // リザルト画面で描く
    case "EnemyActed": {
      const e = state.enemies.find((x) => x.uid === ev.enemyUid);
      const intent = e?.intents.find((i) => i.id === ev.intentId);
      const base = `◀ ${nm(ev.enemyUid)}：${escapeHtml(intent?.label ?? ev.intentId)}`;
      const taunt = e ? tPick(db, `charm.taunt.${e.defId}`) : null;
      return taunt ? `${base}\n　${taunt}` : base;
    }
    case "StatusApplied": return `　こゆきは「${ev.status}」を受けた`;
    case "WeaknessReaction": return tPick(db, `charm.reaction.${ev.enemyDefId}.${ev.attr}`) ?? null;
    case "BattleWon": return `🎉 とろかし、成功`;
    case "BattleLost": return `💀 こゆきは力尽きた……`;
  }
}

export function renderCharm(game: Game, root: HTMLElement): void {
  const db = game.db;
  const charm = game.charm;
  if (!charm) return;

  const sdef = sextechDefense(charm.sextech);
  const power = sextechPower(charm.sextech);

  const enemiesHtml = charm.enemies
    .map((e) => {
      const qiPct = (e.qi / e.qiMax) * 100;
      const gamanPct = (e.gaman / e.gamanMax) * 100;
      return `<div class="enemy ${e.defeated ? "dead" : ""}">
        <div class="enemy-name">${escapeHtml(e.name)}</div>
        <div class="enemy-hp">気力 ${e.qi}/${e.qiMax}　気力防御 ${e.qiDefense}</div>
        <div class="bar charm"><span style="width:${qiPct}%"></span></div>
        <div class="enemy-hp">我慢 ${e.gaman}/${e.gamanMax}</div>
        <div class="bar gaman"><span style="width:${gamanPct}%"></span></div>
        <div class="intent">${e.defeated ? "放心して動けない……" : `次：${escapeHtml(e.intents[e.intentIndex].label)}`}</div>
      </div>`;
    })
    .join("");

  const handHtml = [...db.sexCards.values()]
    .map((def) => {
      const playable = canPlaySexCard(db, charm, def.id);
      const flavor = def.flavorKey ? tLine(db, def.flavorKey) : "";
      const isFinish = def.effects.some((e) => e.kind === "targeted_finish");
      return `<button class="card sex ${isFinish ? "finish" : ""} ${playable ? "" : "disabled"}" data-card="${def.id}" title="${escapeHtml(flavor)}" ${playable ? "" : "disabled"}>
        <div class="card-name">${escapeHtml(def.name)}</div>
        <div class="card-ap">AP ${def.ap}・気力${def.baseQi}</div>
      </button>`;
    })
    .join("");

  const ready = game.charmIsTodomeReady();
  const todomeClass = ready ? "todome ready" : "todome disabled";
  const todomeText = game.charmTodomeArmed
    ? "本当に？（もう一度で決着）"
    : ready
      ? `${tLine(db, "charm.todome.label")}（決着！）`
      : `${tLine(db, "charm.todome.label")}（相手が放心したら）`;

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

  const gamanPct = (charm.gaman / charm.gamanMax) * 100;

  root.innerHTML = `
    <h1>とろかし — お豊</h1>
    <p class="flavor pink">${escapeHtml(tLine(db, "charm.otoyo.start"))}</p>
    <div class="status"><span class="hint">${escapeHtml(tLine(db, "charm.hint"))}</span></div>
    <div class="enemies">${enemiesHtml}</div>
    <div class="koyuki charm">
      <div>こゆき　HP ${charm.hp}/${charm.maxHp}　AP ${charm.ap}/${charm.apMax}　守り 🛡${charm.guard}${sdef > 0 ? `(+${sdef})` : ""}</div>
      <div class="enemy-hp">我慢 ${charm.gaman}/${charm.gamanMax}</div>
      <div class="bar gaman koyuki-gaman"><span style="width:${gamanPct}%"></span></div>
      <div class="sword">もう一本の刀　身${charm.sextech.mi} / 鎬${charm.sextech.shinogi} / 切先${charm.sextech.kissaki}　［威力+${power}］</div>
    </div>
    ${allocHtml}
    <div class="hand">${handHtml}</div>
    <div class="controls">
      <button id="todome" class="${todomeClass}" ${ready ? "" : "disabled"}>${escapeHtml(todomeText)}</button>
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
