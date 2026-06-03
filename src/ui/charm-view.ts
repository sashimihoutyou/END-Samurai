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
    case "SexCardPlayed": return `▶ ${db.sexCards.get(ev.cardId)?.name ?? ev.cardId}`;
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
    case "Ejaculated": {
      if (ev.trigger !== "self") {
        return tPick(db, "charm.ejac.burst") ?? `💢 こゆきは堪えきれず暴発した……（HP -${ev.hpLoss}）`;
      }
      // 狙い撃ち射精は敵別の台詞を優先（敵別→敵別generic→属性別（旧お豊）→汎用）。
      const defId = state.enemies[0]?.defId;
      const line =
        (ev.attr && defId ? tPick(db, `charm.ejac.self.${defId}.${ev.attr}`) : undefined) ??
        (defId ? tPick(db, `charm.ejac.self.${defId}.generic`) : undefined) ??
        (ev.attr ? tPick(db, `charm.ejac.self.${ev.attr}`) : undefined) ??
        tPick(db, "charm.ejac.self.generic");
      return line ?? `▶ こゆきは狙って放った（HP -${ev.hpLoss}）`;
    }
    case "GuardChanged": return ev.amount >= 0 ? `　守り +${ev.amount}` : `　守り ${ev.amount}`;
    case "EnemyExhausted": return `　${nm(ev.enemyUid)}は気力を使い果たした……（放心）`;
    case "SextechPointGained": return tLine(db, "charm.sextech.gained");
    case "TodomeReady": return `　★ ${nm(ev.enemyUid)}に『とどめ！』を刺せる`;
    case "TodomeUsed": {
      const e = state.enemies.find((x) => x.uid === ev.enemyUid);
      // 処女喪失を兼ねるとどめは初回専用台詞（初めて＋中出し）。無ければ通常とどめ台詞へフォールバック。
      const line = e
        ? (ev.first ? tPick(db, `charm.todome.${e.defId}.first`) : undefined) ?? tPick(db, `charm.todome.${e.defId}`)
        : null;
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
    case "HitReaction": {
      // 性技ごとの相手リアクション（docs/09 §3）。初挿入は専用台詞（§4）→ 属性別が無ければ汎用へフォールバック。
      const line = ev.first
        ? tPick(db, `charm.firstinsert.${ev.enemyDefId}.${ev.attr}`) ?? tPick(db, `charm.firstinsert.${ev.enemyDefId}.generic`)
        : tPick(db, `charm.hit.${ev.enemyDefId}.${ev.attr}`);
      return line ? `　${line}` : null;
    }
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
      const qiPct = Math.max(0, (e.qi / e.qiMax) * 100);
      const gamanPct = Math.max(0, (e.gaman / e.gamanMax) * 100);
      const qiLow = qiPct < 30;
      return `<div class="charm-enemy ${e.defeated ? "dead" : ""}">
        <div class="enemy-name">${escapeHtml(e.name)}${e.qiDefense > 0 ? `　<span class="badge gold">気力防御${e.qiDefense}</span>` : ""}</div>
        <div class="enemy-hp">気力 <strong>${e.qi}</strong>/${e.qiMax}${qiLow ? `　<span class="badge pink">もうすぐ…</span>` : ""}</div>
        <div class="bar charm" style="height:10px;"><span style="width:${qiPct}%"></span></div>
        <div class="enemy-hp" style="margin-top:5px;">我慢 <strong>${e.gaman}</strong>/${e.gamanMax}</div>
        <div class="bar gaman"><span style="width:${gamanPct}%"></span></div>
        <div class="intent">${e.defeated ? "💫 放心して動けない……" : `次：${escapeHtml(e.intents[e.intentIndex].label)}`}</div>
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
  const foeName = charm.enemies[0]?.name ?? "";
  const foeDefId = charm.enemies[0]?.defId ?? "";

  const charmHpPct = Math.max(0, (charm.hp / charm.maxHp) * 100);
  const charmHpCls = charmHpPct < 25 ? "low" : charmHpPct < 50 ? "warn" : "";
  const charmApPips = Array.from({ length: charm.apMax }, (_, i) =>
    `<span class="ap-pip ${i < charm.ap ? "filled" : ""}"></span>`
  ).join("");

  root.innerHTML = `
    <h1>とろかし — ${escapeHtml(foeName)}</h1>
    <p class="flavor pink">${escapeHtml(tLine(db, `charm.${foeDefId}.start`))}</p>
    <div class="status"><span class="hint">${escapeHtml(tLine(db, "charm.hint"))}</span></div>
    <div class="charm-enemies">${enemiesHtml}</div>
    <div class="koyuki charm">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px;">
        <span><strong>こゆき</strong></span>
        <span>HP <strong>${charm.hp}</strong>/${charm.maxHp}</span>
        <span>AP <span class="ap-pips">${charmApPips}</span> ${charm.ap}/${charm.apMax}</span>
        <span class="badge gold">🛡守り${charm.guard}${sdef > 0 ? `+${sdef}` : ""}</span>
      </div>
      <div class="bar hp" style="margin:4px 0 6px;"><span class="${charmHpCls}" style="width:${charmHpPct}%"></span></div>
      <div class="enemy-hp">我慢 <strong>${charm.gaman}</strong>/${charm.gamanMax}</div>
      <div class="bar gaman koyuki-gaman" style="height:8px;"><span style="width:${gamanPct}%"></span></div>
      <div class="sword" style="margin-top:5px;">もう一本の刀　身${charm.sextech.mi}・鎬${charm.sextech.shinogi}・切先${charm.sextech.kissaki}　［威力+${power}］</div>
    </div>
    ${allocHtml}
    <p class="hint" style="margin-bottom:6px;">性技（クリックで使用）</p>
    <div class="hand">${handHtml}</div>
    <div class="controls">
      <button id="todome" class="${todomeClass}" ${ready ? "" : "disabled"}>${escapeHtml(todomeText)}</button>
      <button id="endturn" ${charm.phase !== "player" ? "disabled" : ""}>ターン終了</button>
    </div>
    <pre class="log" id="charm-log">${escapeHtml(game.log.slice(-16).join("\n"))}</pre>
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

  const charmLog = root.querySelector<HTMLPreElement>("#charm-log");
  if (charmLog) charmLog.scrollTop = charmLog.scrollHeight;
}
