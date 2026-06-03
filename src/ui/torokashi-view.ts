import type { Game } from "../app/game.js";
import type { ContentDB } from "../core/content/loader.js";
import type { TorokashiState, TorokashiEvent, SexAttr } from "../core/model/torokashi.js";
import { escapeHtml, tLine } from "./text.js";

// とろかし流ミニゲームのDOM描画。docs/02「とろかし流ミニゲーム」。

const ATTR_LABEL: Record<SexAttr, string> = {
  kuchizuke: "くちづけ",
  hogushi: "ほぐし",
  seikou: "正攻",
  chichikuri: "乳繰り",
  ushirodori: "後ろ取り",
  uradori: "裏取り",
};

export function describeTorokashiEvent(db: ContentDB, _state: TorokashiState, ev: TorokashiEvent): string | null {
  switch (ev.type) {
    case "ChoicesPresented":
      return `── ループ${ev.loop + 1}・手${ev.hand + 1} ── 選択肢：${ev.choices.map((a) => ATTR_LABEL[a]).join("・")}`;
    case "AttrSelected": {
      const label = ATTR_LABEL[ev.attr];
      const resultText = ev.result === "hit" ? tLine(db, "torokashi.choice.hit") : ev.result === "near" ? tLine(db, "torokashi.choice.near") : tLine(db, "torokashi.choice.miss");
      return `▶ ${label}　${resultText}（+${ev.points + ev.sizeBonus}点）`;
    }
    case "LoopComplete":
      return `── ループ${ev.loop + 1}完了　累計 ${ev.totalScore}点 ──`;
    case "Madamada":
      return `まだまだ！（HP -${ev.hpCost}）`;
    case "Hp0Collapse":
      return tLine(db, "torokashi.hp0collapse");
    case "OutcomeLead":
      return `🎉 ${tLine(db, "torokashi.outcome.lead")}`;
    case "OutcomeIndulgent":
      return `${tLine(db, "torokashi.outcome.indulgent")}`;
    case "OutcomeFailure":
      return `${tLine(db, "torokashi.outcome.failure")}`;
    case "CompanionJoined":
      return null; // リザルト画面で描く
  }
}

export function renderTorokashi(game: Game, root: HTMLElement): void {
  const db = game.db;
  const t = game.torokashi;
  if (!t) return;

  const def = db.torokashiEnemies.get(t.enemyDefId);
  const enemyName = def?.name ?? t.enemyDefId;
  const hpPct = Math.max(0, (t.hp / t.maxHp) * 100);
  const hpCls = hpPct < 25 ? "low" : hpPct < 50 ? "warn" : "";

  let bodyHtml = "";

  if (t.phase === "choosing") {
    const btnHtml = t.choices
      .map(
        (attr) =>
          `<button class="bigbtn pink torokashi-attr" data-attr="${attr}">${escapeHtml(ATTR_LABEL[attr])}</button>`,
      )
      .join("");
    bodyHtml = `
      <p class="hint">どの手を選ぶ？</p>
      <div class="map-choices">${btnHtml}</div>`;
  } else if (t.phase === "reacting") {
    const attr = t.lastChoice ? ATTR_LABEL[t.lastChoice] : "";
    const resultKey =
      t.lastResult === "hit"
        ? "torokashi.choice.hit"
        : t.lastResult === "near"
          ? "torokashi.choice.near"
          : "torokashi.choice.miss";
    const enemyKey = t.lastResult && t.lastChoice
      ? `torokashi.${t.enemyDefId}.${t.lastResult === "miss" ? "miss" : t.lastResult === "hit" ? "hit" : "near"}`
      : "";
    const enemyLine = enemyKey && db.text[enemyKey] ? tLine(db, enemyKey) : "";
    bodyHtml = `
      <p class="narration">${escapeHtml(attr)}：${escapeHtml(tLine(db, resultKey))}</p>
      ${enemyLine ? `<p class="narration">${escapeHtml(enemyLine)}</p>` : ""}
      <button id="torokashi-next" class="bigbtn">続ける</button>`;
  } else if (t.phase === "madamada") {
    bodyHtml = `
      <p class="narration">${escapeHtml(tLine(db, "torokashi.madamada.prompt"))}</p>
      <p class="hint">まだまだ押すとHP -5。</p>
      <div class="map-choices">
        <button id="torokashi-madamada" class="bigbtn pink">まだまだ！（HP -5）</button>
        <button id="torokashi-finish" class="bigbtn">終わる</button>
      </div>`;
  } else if (t.phase === "done") {
    const outcomeKey = t.outcome === "lead"
      ? "torokashi.outcome.lead"
      : t.outcome === "indulgent"
        ? "torokashi.outcome.indulgent"
        : "torokashi.outcome.failure";
    bodyHtml = `
      <p class="result-head">${escapeHtml(tLine(db, outcomeKey))}</p>
      <button id="torokashi-done" class="bigbtn">次へ</button>`;
  }

  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>とろかし — ${escapeHtml(enemyName)}</h1>
      <div class="koyuki" style="margin:8px 0;">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px;">
          <span>HP <strong>${t.hp}</strong>/${t.maxHp}</span>
          <span>評価点 <strong>${t.totalScore}</strong></span>
          <span>ループ${t.loop + 1}・手${t.hand + 1}/${t.handCount}</span>
        </div>
        <div class="bar hp" style="margin:4px 0;"><span class="${hpCls}" style="width:${hpPct}%"></span></div>
      </div>
      ${bodyHtml}
      <pre class="log" id="torokashi-log" style="font-size:11px;">${escapeHtml(game.log.slice(-12).join("\n"))}</pre>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".torokashi-attr").forEach((btn) => {
    btn.addEventListener("click", () => game.torokashiSelect(btn.dataset.attr as SexAttr));
  });
  root.querySelector<HTMLButtonElement>("#torokashi-next")?.addEventListener("click", () => game.torokashiNext());
  root.querySelector<HTMLButtonElement>("#torokashi-madamada")?.addEventListener("click", () => game.torokashiMadamada());
  root.querySelector<HTMLButtonElement>("#torokashi-finish")?.addEventListener("click", () => game.torokashiFinish());
  root.querySelector<HTMLButtonElement>("#torokashi-done")?.addEventListener("click", () => game.afterTorokashiDone());

  const logEl = root.querySelector<HTMLPreElement>("#torokashi-log");
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}
