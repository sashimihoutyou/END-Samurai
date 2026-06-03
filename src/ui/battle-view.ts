import type { Game } from "../app/game.js";
import type { ContentDB } from "../core/content/loader.js";
import type { BattleEvent, BattleState, Costume } from "../core/model/battle-state.js";
import type { SwordPart } from "../core/model/sword.js";
import { cardApCost } from "../core/rules/damage.js";
import { canPlayCard } from "../core/rules/normal-battle.js";
import { escapeHtml, tLine } from "./text.js";

// 通常戦闘（HP戦）のDOM描画。Core層を呼ぶだけで状態は持たない。

const PART_NAME: Record<SwordPart, string> = { blade: "刀身", tsuba: "鍔", tsuka: "柄" };
const STATUS_NAME: Record<string, string> = { poison: "毒", bleed: "出血", stun: "気絶" };
const STATUS_ICON: Record<string, string> = { poison: "🟣", bleed: "🩸", stun: "😵" };
const COSTUME_LABEL: Record<Costume, string> = { normal: "", damaged: "　衣装[破損]", broken: "　衣装[大破]" };
const COMPANION_NAME: Record<string, string> = { otoyo: "お豊", aoi: "葵" };

/** 状態異常配列を「🩸2 🟣1」のように要約する。 */
function statusBadges(statuses: { id: string; x: number }[]): string {
  return statuses.map((s) => `${STATUS_ICON[s.id] ?? "✦"}${s.x}`).join(" ");
}

function stageDisplay(db: ContentDB, part: SwordPart, id: string): string {
  return db.swordStages.get(part)?.stages.find((s) => s.id === id)?.name ?? id;
}

export function describeBattleEvent(db: ContentDB, state: BattleState, ev: BattleEvent): string | null {
  const enemyName = (uid: string): string => state.enemies.find((e) => e.uid === uid)?.name ?? uid;
  switch (ev.type) {
    case "TurnStarted": return `── ターン${ev.turn} ──`;
    case "CardPlayed": return `▶ ${db.cards.get(ev.cardDefId)?.name ?? ev.cardDefId}`;
    case "DamageDealt": return `　${enemyName(ev.enemyUid)}に ${ev.amount} ダメージ${ev.ignoredDefense ? "（防御無視）" : ""}`;
    case "ComboTriggered": return `　⚡連撃！ ${enemyName(ev.enemyUid)}へ ${ev.amount}`;
    case "BlockGained": return `　防御値 +${ev.amount}`;
    case "DodgeArmed": return `　見切り構え（次の攻撃を回避）`;
    case "PartRepaired": return `　${PART_NAME[ev.part]}を修繕：${stageDisplay(db, ev.part, ev.from)}→${stageDisplay(db, ev.part, ev.to)}`;
    case "Healed": return `　HPを ${ev.amount} 回復`;
    case "EnemyDefeated": return `　✖ ${enemyName(ev.enemyUid)} を倒した`;
    case "EnemyActed": return `◀ ${enemyName(ev.enemyUid)} の行動`;
    case "DamageTaken":
      return ev.dodged ? `　見切り成功！ ダメージ回避` : `　こゆきに ${ev.amount - ev.blocked} ダメージ（${ev.blocked}を防御）`;
    case "PartDegraded": return `　💢 ${PART_NAME[ev.part]}が傷んだ：${stageDisplay(db, ev.part, ev.from)}→${stageDisplay(db, ev.part, ev.to)}`;
    case "PartDefended": return `　${PART_NAME[ev.part]}は守り切った`;
    case "Grabbed": return `　${enemyName(ev.enemyUid)}に掴まれた！（次のターンに攻撃して振りほどけ）`;
    case "GrabReleased": return `　掴みを振りほどいた`;
    case "PinnedDown": return `　💢 押し倒された……（防御半減・回避不可）`;
    case "EnemyDefenseDown": return `　🔨 ${enemyName(ev.enemyUid)}の守りを崩した（防御値 -${ev.amount}）`;
    case "StatusApplied": {
      const label = STATUS_NAME[ev.status];
      return ev.toKoyuki ? `　💢 こゆきは「${label}」を受けた（${ev.x}）` : `　${enemyName(ev.enemyUid ?? "")}に「${label}」を与えた（${ev.x}）`;
    }
    case "BleedTicked": return ev.enemyUid === null ? `　🩸 出血で ${ev.amount} ダメージ` : `　🩸 ${enemyName(ev.enemyUid)}に出血 ${ev.amount}`;
    case "StunSkipped": return `　😵 ${enemyName(ev.enemyUid)}は気絶して動けない`;
    case "CostumeChanged": return ev.to === "broken" ? `　👘💢 衣装が大破した……（防御-2・AP-1・連撃+5%）` : `　👘 衣装が破損した（防御-1）`;
    case "CompanionBuff": return `　🤝 ${COMPANION_NAME[ev.companionId] ?? ev.companionId}：${ev.label}`;
    case "HandUpgraded": return `　✨ ${db.cards.get(ev.fromCardId)?.name ?? ev.fromCardId} → ${db.cards.get(ev.toCardId)?.name ?? ev.toCardId}`;
    case "DegradeNullified": return `　🛡 ${PART_NAME[ev.part]}へのデバフを打ち直しで防いだ`;
    case "SynergyAmplified": return `　🔗 ${enemyName(ev.enemyUid)}は味方と連携して攻撃が鋭くなった（+${ev.amount}）`;
    case "ConcealNullified": return `　🛡 受け切って ${enemyName(ev.enemyUid)} の随伴効果を防いだ`;
    case "KoyukiReaction": return `　「${ev.reactionKey}」`;
    case "BattleWon": return `🎉 戦闘に勝利！`;
    case "BattleLost": return `💀 こゆきは倒れた……`;
  }
}

function stageName(db: ContentDB, sword: BattleState["sword"], part: SwordPart): string {
  return stageDisplay(db, part, sword[part]);
}

function intentSummary(e: BattleState["enemies"][number]): string {
  const intent = e.intents[e.intentIndex];
  const dmg = intent.effects.reduce((s, x) => s + (x.kind === "damage" ? x.amount : 0), 0);
  const parts: string[] = [dmg > 0 ? `${dmg}ダメージ` : "―"];
  // 隠匿型：随伴効果は伏せる（数値は表示・効果種別は「？」）。docs/01「隠匿型」。
  if (intent.concealEffect) parts.push("随伴：？");
  // 時限型：大技までの残りターンを警告表示。docs/01「時限型」。
  if (e.archetype === "timed" && e.fuse != null) {
    parts.push(e.intentIndex === e.intents.length - 1 ? "⚠発動！" : `あと${e.fuse}ターンで発動`);
  }
  return parts.join("／");
}

export function renderBattle(game: Game, root: HTMLElement): void {
  const db = game.db;
  const battle = game.battle;
  if (!battle) return;

  const enemiesHtml = battle.enemies
    .map((e) => {
      const alive = e.hp > 0;
      const intent = e.intents[e.intentIndex];
      const grabbing = battle.grabbedBy === e.uid;
      const badges = statusBadges(e.statuses);
      const hpPct = Math.max(0, (e.hp / e.maxHp) * 100);
      const hpCls = hpPct < 25 ? "low" : hpPct < 50 ? "warn" : "";
      return `<div class="enemy ${alive ? "" : "dead"}">
        <div class="enemy-name">${escapeHtml(e.name)}${e.defense > 0 ? `　<span class="badge gold">🛡${e.defense}</span>` : ""}${grabbing ? `　<span class="badge red">掴み</span>` : ""}</div>
        <div class="enemy-hp">HP <strong>${e.hp}</strong>/${e.maxHp}${badges ? `　${badges}` : ""}</div>
        <div class="bar hp"><span class="${hpCls}" style="width:${hpPct}%"></span></div>
        ${alive ? `<div class="intent">予告: ${escapeHtml(intent.label)}（${intentSummary(e)}）</div>` : `<div class="intent dead-mark">― 討ち取った ―</div>`}
      </div>`;
    })
    .join("");

  const handHtml = battle.hand
    .map((c) => {
      const def = db.cards.get(c.defId)!;
      const cost = cardApCost(db, def, battle.sword, battle.costume, battle.apDiscount);
      const playable = canPlayCard(db, battle, c.uid);
      const flavor = def.flavorKey ? tLine(db, def.flavorKey) : "";
      const uses = def.uses != null ? `・残${c.usesLeft ?? def.uses}` : "";
      const cls = def.category === "item" ? "item" : def.category === "companion_active" ? "companion" : "";
      const used = def.category === "companion_active" && battle.companionUsed.includes(def.id) ? "・使用済" : "";
      const apPips = Array.from({ length: battle.apMax }, (_, i) =>
        `<span class="ap-pip ${i < cost ? "filled" : ""}"></span>`
      ).join("");
      return `<button class="card ${cls} ${playable ? "" : "disabled"}" data-uid="${c.uid}" title="${escapeHtml(flavor)}" ${playable ? "" : "disabled"}>
        <div class="card-name">${escapeHtml(def.name)}</div>
        <div class="card-ap"><span class="ap-pips">${apPips}</span> AP${cost}${uses}${used}</div>
      </button>`;
    })
    .join("");

  // 部位狙い予告（狙撃型）のとき、敵行動の前に「受ける／いなす」を提示する。
  const braceHtml = game.battleShowBrace()
    ? `<div class="brace">
         <span class="hint">⚔ 部位狙いの予告！　受ける（固める）か、いなす（被ダメ+50%で部位を確定で守る）か：</span>
         <button class="brace-btn ${battle.braceChoice === "ukeru" ? "on" : ""}" data-brace="ukeru">受ける</button>
         <button class="brace-btn ${battle.braceChoice === "inasu" ? "on" : ""}" data-brace="inasu">いなす</button>
       </div>`
    : "";

  const koyukiHpPct = Math.max(0, (battle.hp / battle.maxHp) * 100);
  const koyukiHpCls = koyukiHpPct < 25 ? "low" : koyukiHpPct < 50 ? "warn" : "";
  const koyukiApPips = Array.from({ length: battle.apMax }, (_, i) =>
    `<span class="ap-pip ${i < battle.ap ? "filled" : ""}"></span>`
  ).join("");
  const koyukiBadges: string[] = [];
  if (battle.blockPool > 0) koyukiBadges.push(`<span class="badge gold">🛡${battle.blockPool}</span>`);
  if (battle.dodgeNext) koyukiBadges.push(`<span class="badge blue">見切り</span>`);
  if (battle.grabbedBy) koyukiBadges.push(`<span class="badge red">掴まれ中</span>`);
  const koyukiStatusBadge = statusBadges(battle.statuses);
  if (koyukiStatusBadge) koyukiBadges.push(koyukiStatusBadge);

  root.innerHTML = `
    <h1>${escapeHtml(game.battleTitle)}${game.battleIsBoss ? `　<span class="badge red">ボス戦</span>` : ""}</h1>
    <p class="flavor">${escapeHtml(tLine(db, game.battleFlavorKey))}</p>
    <div class="status">
      <span>ターン <strong>${battle.turn}</strong></span>
      <span class="hint">${escapeHtml(tLine(db, game.battleHintKey))}</span>
    </div>
    <div class="enemies">${enemiesHtml}</div>
    <div class="koyuki">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span><strong>こゆき</strong></span>
        <span>HP <strong>${battle.hp}</strong>/${battle.maxHp}</span>
        <span>AP <span class="ap-pips">${koyukiApPips}</span> ${battle.ap}/${battle.apMax}</span>
        ${koyukiBadges.join(" ")}
      </div>
      <div class="bar hp" style="margin:5px 0 3px;"><span class="${koyukiHpCls}" style="width:${koyukiHpPct}%"></span></div>
      <div class="sword">刀身[${stageName(db, battle.sword, "blade")}]　鍔[${stageName(db, battle.sword, "tsuba")}]　柄[${stageName(db, battle.sword, "tsuka")}]${COSTUME_LABEL[battle.costume]}</div>
    </div>
    ${braceHtml}
    <p class="hint" style="margin-bottom:6px;">手札（クリックで使用）</p>
    <div class="hand">${handHtml}</div>
    <div class="controls">
      <button id="endturn" ${battle.phase !== "player" ? "disabled" : ""}>ターン終了</button>
    </div>
    <pre class="log" id="battle-log">${escapeHtml(game.log.slice(-16).join("\n"))}</pre>
  `;

  root.querySelectorAll<HTMLButtonElement>(".card").forEach((btn) => {
    btn.addEventListener("click", () => game.normalPlay(btn.dataset.uid!));
  });
  root.querySelectorAll<HTMLButtonElement>(".brace-btn").forEach((btn) => {
    btn.addEventListener("click", () => game.normalSetBrace(btn.dataset.brace as "ukeru" | "inasu"));
  });
  root.querySelector<HTMLButtonElement>("#endturn")?.addEventListener("click", () => game.normalEndTurn());

  // ログを常に最下行まで自動スクロール
  const logEl = root.querySelector<HTMLPreElement>("#battle-log");
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}
