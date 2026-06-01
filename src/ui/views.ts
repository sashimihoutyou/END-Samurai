import type { Game } from "../app/game.js";
import type { ContentDB } from "../core/content/loader.js";
import type { MapNode, NodeType } from "../core/model/map.js";
import type { SwordPart, SwordState } from "../core/model/sword.js";
import { escapeHtml, tLine, tLines } from "./text.js";

// テキスト送り・タイトル・マップ・イベント・野営地・リザルト等の画面描画。

function pageDots(current: number, total: number): string {
  let s = "";
  for (let i = 0; i < total; i++) s += i === current ? "●" : "○";
  return `<div class="dots">${s}</div>`;
}

function swordLine(db: ContentDB, sword: SwordState): string {
  const part = (p: SwordPart): string =>
    db.swordStages.get(p)?.stages.find((s) => s.id === sword[p])?.name ?? sword[p];
  return `刀身[${part("blade")}] 鍔[${part("tsuba")}] 柄[${part("tsuka")}]`;
}

function companionLine(game: Game): string {
  const role: Record<string, string> = { otoyo: "お豊（鍛冶屋）", aoi: "葵（師範）" };
  if (game.run.companions.length === 0) return "（なし）";
  return game.run.companions.map((c) => role[c.id] ?? c.id).join("、");
}

export function renderTitle(game: Game, root: HTMLElement): void {
  const db = game.db;
  root.innerHTML = `
    <div class="screen title-screen">
      <h1 class="title-main">${escapeHtml(tLine(db, "title.main"))}</h1>
      <p class="title-sub">${escapeHtml(tLine(db, "title.sub"))}</p>
      <button id="start" class="bigbtn">${escapeHtml(tLine(db, "title.start"))}</button>
      <p class="title-note">${escapeHtml(tLine(db, "title.note"))}</p>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#start")?.addEventListener("click", () => game.beginOpening());
}

export function renderOpening(game: Game, root: HTMLElement): void {
  const db = game.db;
  const pages = tLines(db, "opening.pages");
  const last = game.page >= pages.length - 1;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>プロローグ</h1>
      <p class="narration">${escapeHtml(pages[game.page])}</p>
      ${pageDots(game.page, pages.length)}
      <button id="next" class="bigbtn">${last ? "村を出る" : "次へ"}</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () =>
    game.nextPage(pages.length, () => game.beginArea1Lead()),
  );
}

export function renderArea1Lead(game: Game, root: HTMLElement): void {
  const db = game.db;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>第1エリア・いんなか村周辺</h1>
      <p class="narration">${escapeHtml(tLine(db, "area1.lead"))}</p>
      <button id="go" class="bigbtn">先へ進む</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#go")?.addEventListener("click", () => game.beginNoraBattle());
}

export function renderNoraResult(game: Game, root: HTMLElement): void {
  const db = game.db;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>戦闘終了</h1>
      <p class="result-head">🎉 野犬を退けた</p>
      <p class="narration">${escapeHtml(tLine(db, "result.nora.win"))}</p>
      <p class="result-stat">こゆき HP ${game.run.hp}/${game.run.maxHp}</p>
      <p class="narration">${escapeHtml(tLine(db, "result.nora.lead"))}</p>
      <button id="next" class="bigbtn">ふり返る</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () => game.beginCharmIntro());
}

export function renderCharmIntro(game: Game, root: HTMLElement): void {
  const db = game.db;
  const pages = tLines(db, "charm.otoyo.intro");
  const last = game.page >= pages.length - 1;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>お豊との再会</h1>
      <p class="narration">${escapeHtml(pages[game.page])}</p>
      ${pageDots(game.page, pages.length)}
      <button id="next" class="bigbtn ${last ? "pink" : ""}">${last ? escapeHtml(tLine(db, "charm.otoyo.optin")) : "次へ"}</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () =>
    game.nextPage(pages.length, () => game.beginCharmBattle("otoyo", !game.run.flags.otoyoDeflowered)),
  );
}

export function renderCharmResult(game: Game, root: HTMLElement): void {
  const db = game.db;
  const defId = game.charmEnemyDefId;
  // 終了台詞・加入文・進む先を相手別に出し分ける。
  let pages: string[];
  let footer: string;
  let lastLabel: string;
  if (defId === "otoyo") {
    // 初回（処女喪失回）は加入イベント、再戦回は短い再戦台詞。docs/09 §4
    pages = tLines(db, game.charmFirstTime ? "charm.result.join" : "charm.result.rematch");
    footer = game.charmFirstTime
      ? `<p class="result-stat">仲間：${escapeHtml(companionLine(game))}／こゆき HP ${game.run.hp}/${game.run.maxHp}</p>
         <p class="title-note">——プロローグはここまで。お豊を連れて、こゆきの旅が始まる。</p>`
      : `<p class="result-stat">お豊（鍛冶屋）／こゆき HP ${game.run.hp}/${game.run.maxHp}</p>`;
    lastLabel = "旅に出る";
  } else if (db.charmEnemies.get(defId)?.joinCompanionId) {
    // 加入する相手（葵）：仲間加入リザルト。
    pages = tLines(db, `charm.result.${defId}.join`);
    footer = `<p class="result-stat">仲間：${escapeHtml(companionLine(game))}／こゆき HP ${game.run.hp}/${game.run.maxHp}</p>`;
    lastLabel = "旅を続ける";
  } else {
    // 加入しない相手（むすめしかばね）：人間に戻し、救済者としてカウント。
    pages = tLines(db, `charm.result.${defId}.rescue`);
    footer = `<p class="result-stat">救済者：${game.run.rescuedCount}人／こゆき HP ${game.run.hp}/${game.run.maxHp}</p>`;
    lastLabel = "旅を続ける";
  }
  const last = game.page >= pages.length - 1;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>とろかし、成功</h1>
      <p class="narration">${escapeHtml(pages[game.page])}</p>
      ${pageDots(game.page, pages.length)}
      ${last ? footer : ""}
      <button id="next" class="bigbtn">${last ? lastLabel : "次へ"}</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () =>
    game.nextPage(pages.length, () => game.afterCharmResult()),
  );
}

const NODE_TAG: Record<NodeType, string> = {
  start: "出立",
  battle: "戦闘",
  boss: "ボス",
  camp: "野営地",
  rest: "休息",
  charm_encounter: "遭遇",
  event: "イベント",
};

export function renderMap(game: Game, root: HTMLElement): void {
  const db = game.db;
  const cur = game.currentNode();
  const nexts = game.nextNodes();
  const intro = cur?.type === "start" && cur.textKey ? `<p class="narration">${escapeHtml(tLine(db, cur.textKey))}</p>` : "";
  const notice = game.mapNotice ? `<p class="result-head">${escapeHtml(game.mapNotice)}</p>` : "";

  const choices = nexts
    .map(
      (n: MapNode) =>
        `<button class="bigbtn mapnode" data-node="${n.id}"><span class="node-tag">${NODE_TAG[n.type]}</span> ${escapeHtml(n.label)}</button>`,
    )
    .join("");

  const goal = nexts.length === 0 ? `<p class="title-note">この先はもう無い。</p>` : "";

  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>田舎・道中　― ${escapeHtml(cur?.label ?? "")}</h1>
      ${notice}
      ${intro}
      <div class="koyuki" style="margin:12px 0;">
        <div>こゆき　HP ${game.run.hp}/${game.run.maxHp}</div>
        <div class="sword">${swordLine(db, game.run.sword)}</div>
        <div class="sword">仲間：${escapeHtml(companionLine(game))}　／　せっくすてく 身${game.run.sextech.mi}・鎬${game.run.sextech.shinogi}・切先${game.run.sextech.kissaki}</div>
      </div>
      <p class="hint">進む先を選ぶ：</p>
      <div class="map-choices">${choices}</div>
      ${goal}
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".mapnode").forEach((btn) => {
    btn.addEventListener("click", () => game.travelTo(btn.dataset.node!));
  });
}

export function renderEvent(game: Game, root: HTMLElement): void {
  const db = game.db;
  const ev = game.currentEvent;
  if (!ev) return;
  const node = game.activeNodeId ? game.findNode(game.activeNodeId) : undefined;
  const title = node?.label ?? "遭遇";
  const pages = tLines(db, ev.introKey);
  const last = game.page >= pages.length - 1;
  const choices = last
    ? ev.choices
        .map((c, i) => `<button class="bigbtn pink" data-choice="${i}">${escapeHtml(tLine(db, c.labelKey))}</button>`)
        .join("")
    : `<button id="next" class="bigbtn">次へ</button>`;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>${escapeHtml(title)}</h1>
      <p class="narration">${escapeHtml(pages[game.page])}</p>
      ${pageDots(game.page, pages.length)}
      <div class="map-choices">${choices}</div>
    </div>
  `;
  if (last) {
    root.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((btn) => {
      btn.addEventListener("click", () => game.chooseEvent(Number(btn.dataset.choice)));
    });
  } else {
    root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () => {
      game.page += 1;
      game.render();
    });
  }
}

export function renderCamp(game: Game, root: HTMLElement): void {
  const db = game.db;
  const node = game.activeNodeId ? game.findNode(game.activeNodeId) : undefined;
  const text = node?.textKey ? tLine(db, node.textKey) : tLine(db, "map.inaka.camp");
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>野営地</h1>
      <p class="narration">${escapeHtml(text)}</p>
      <div class="koyuki" style="margin:12px 0;">
        <div class="sword">${swordLine(db, game.run.sword)}</div>
      </div>
      <p class="hint">お豊が刀を完全修繕（全部位を「新品同様」へ）し、破れた衣も繕ってくれる＋ひと晩の休息（HP+5）。</p>
      <button id="camp" class="bigbtn">刀と衣を直して進む</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#camp")?.addEventListener("click", () => game.applyCamp());
}

export function renderReward(game: Game, root: HTMLElement): void {
  const db = game.db;
  const offer = game.rewardOffer;
  if (!offer) return;
  const cards = offer.cardIds
    .map((id, i) => {
      const name = game.rewardCardName(i);
      const blind = i === offer.blindIndex && name === null;
      const def = db.cards.get(id);
      const flavor = !blind && def?.flavorKey ? tLine(db, def.flavorKey) : "";
      const label = blind ? "？？？（ブラインド）" : escapeHtml(name ?? id);
      const sub = blind ? "中身は開けてのお楽しみ" : `AP ${def?.ap ?? "?"}${def?.uses != null ? `・${def.uses}回` : ""}`;
      return `<button class="bigbtn reward-card ${blind ? "blind" : ""}" data-reward="${i}" title="${escapeHtml(flavor)}">
        <span class="card-name">${label}</span><br><span class="card-ap">${sub}</span>
      </button>`;
    })
    .join("");
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>戦利品</h1>
      <p class="narration">${escapeHtml(tLine(db, "reward.lead"))}</p>
      <div class="map-choices reward-choices">${cards}</div>
      <button id="skip" class="bigbtn">受け取らない</button>
    </div>
  `;
  root.querySelectorAll<HTMLButtonElement>(".reward-card").forEach((btn) => {
    btn.addEventListener("click", () => game.chooseReward(Number(btn.dataset.reward)));
  });
  root.querySelector<HTMLButtonElement>("#skip")?.addEventListener("click", () => game.skipReward());
}

export function renderResult(game: Game, root: HTMLElement): void {
  const db = game.db;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1 class="title-main">クリア</h1>
      <p class="result-head">🎉 大しかばねを討ち取った</p>
      <p class="narration">${escapeHtml(tLine(db, "result.boss.win"))}</p>
      <p class="result-stat">仲間：${escapeHtml(companionLine(game))}</p>
      <p class="result-stat">救済者：${game.run.rescuedCount}人　／　こゆき HP ${game.run.hp}/${game.run.maxHp}</p>
      <p class="title-note">${escapeHtml(tLine(db, "result.boss.lead"))}</p>
      <button id="next" class="bigbtn">タイトルへ</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () => game.goTitle());
}

export function renderGameOver(game: Game, root: HTMLElement): void {
  const db = game.db;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1 class="gameover">${escapeHtml(tLine(db, "gameover.title"))}</h1>
      <button id="retry" class="bigbtn">${escapeHtml(tLine(db, "gameover.retry"))}</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#retry")?.addEventListener("click", () => game.goTitle());
}
