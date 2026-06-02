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
  onsen: "温泉",
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
        <div>こゆき　HP ${game.run.hp}/${game.run.maxHp}　／　所持 ${game.run.zeni}銭</div>
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

  // 共通ヘッダ：直近の結果（買った・売った・休んだ）＋こゆきの状態と所持金。
  const head = `
    <h1>野営地 ― ${escapeHtml(node?.label ?? "")}</h1>
    ${game.campNotice ? `<p class="result-head">${escapeHtml(game.campNotice)}</p>` : ""}
    <div class="koyuki" style="margin:12px 0;">
      <div>こゆき　HP ${game.run.hp}/${game.run.maxHp}　／　所持 ${game.run.zeni}銭</div>
      <div class="sword">${swordLine(db, game.run.sword)}</div>
    </div>`;

  // ── 施設選択メニュー ──
  if (game.campView === "menu") {
    const restBtn = game.campRested
      ? `<button class="bigbtn" disabled>ひと晩休んだ（修繕・回復済み）</button>`
      : `<button id="rest" class="bigbtn">ひと晩休む（刀を完全修繕・衣を繕う・HP+5）</button>`;
    const shopBtns = game
      .campShops()
      .map((s) => `<button class="bigbtn shopbtn" data-shop="${s.id}">${escapeHtml(tLine(db, s.nameKey))}</button>`)
      .join("");
    root.innerHTML = `
      <div class="screen narration-screen">
        ${head}
        <p class="narration">${escapeHtml(text)}</p>
        <p class="hint">何をする？</p>
        <div class="map-choices">
          ${restBtn}
          ${shopBtns}
          <button id="leave" class="bigbtn">野営地を発つ</button>
        </div>
      </div>`;
    root.querySelector<HTMLButtonElement>("#rest")?.addEventListener("click", () => game.campRest());
    root.querySelectorAll<HTMLButtonElement>(".shopbtn").forEach((btn) =>
      btn.addEventListener("click", () => game.campOpen(btn.dataset.shop!)),
    );
    root.querySelector<HTMLButtonElement>("#leave")?.addEventListener("click", () => game.campLeave());
    return;
  }

  // ── 施設（鍛冶屋・行商人・道場）を開いている ──
  const shop = db.shops.shops.find((s) => s.id === game.campView);
  if (!shop) {
    game.campOpen("menu");
    return;
  }

  const buyList = shop.stock
    .map((it) => {
      const def = db.cards.get(it.cardId);
      const afford = game.run.zeni >= it.price;
      const sub = `AP ${def?.ap ?? "?"}${def?.uses != null ? `・${def.uses}回` : ""}`;
      return `<button class="bigbtn reward-card ${afford ? "" : "blind"}" data-buy="${it.cardId}" ${afford ? "" : "disabled"}>
        <span class="card-name">${escapeHtml(def?.name ?? it.cardId)}</span><br><span class="card-ap">${sub}　${it.price}銭</span>
      </button>`;
    })
    .join("");

  // 売却（行商人）／忘れる＝デッキ圧縮（道場）。
  let actionSection = "";
  if (shop.kind === "buy_sell") {
    const sellList = game
      .disposableDeck()
      .map((c) => {
        const def = db.cards.get(c.defId);
        return `<button class="bigbtn reward-card" data-sell="${c.uid}">
          <span class="card-name">${escapeHtml(def?.name ?? c.defId)}</span><br><span class="card-ap">売値 ${game.cardSellPrice(c.defId)}銭</span>
        </button>`;
      })
      .join("");
    actionSection = `<p class="hint">売る（持ち物を銭に換える）：</p>
      <div class="map-choices reward-choices">${sellList || `<p class="title-note">売れる物がない。</p>`}</div>`;
  } else if (shop.kind === "buy_forget") {
    const forgetList = game
      .disposableDeck()
      .map((c) => {
        const def = db.cards.get(c.defId);
        return `<button class="bigbtn reward-card" data-forget="${c.uid}">
          <span class="card-name">${escapeHtml(def?.name ?? c.defId)}</span><br><span class="card-ap">忘れる（圧縮）</span>
        </button>`;
      })
      .join("");
    actionSection = `<p class="hint">型を見直す（不要な技を忘れてデッキを締める・無償）：</p>
      <div class="map-choices reward-choices">${forgetList || `<p class="title-note">忘れられる技がない。</p>`}</div>`;
  }

  root.innerHTML = `
    <div class="screen narration-screen">
      ${head}
      <h2 style="margin:4px 0;">${escapeHtml(tLine(db, shop.nameKey))}</h2>
      <p class="narration">${escapeHtml(tLine(db, shop.descKey))}</p>
      <p class="hint">仕入れる（買う）：</p>
      <div class="map-choices reward-choices">${buyList}</div>
      ${actionSection}
      <button id="back" class="bigbtn">戻る</button>
    </div>`;
  root.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((btn) =>
    btn.addEventListener("click", () => game.campBuy(shop.id, btn.dataset.buy!)),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-sell]").forEach((btn) =>
    btn.addEventListener("click", () => game.campSell(btn.dataset.sell!)),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-forget]").forEach((btn) =>
    btn.addEventListener("click", () => game.campForget(btn.dataset.forget!)),
  );
  root.querySelector<HTMLButtonElement>("#back")?.addEventListener("click", () => game.campOpen("menu"));
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

export function renderOnsen(game: Game, root: HTMLElement): void {
  const db = game.db;
  const ev = game.onsenEvent;
  if (!ev) return;

  // 導入：ページ送り
  if (game.onsenPhase === "intro") {
    const pages = tLines(db, ev.introKey);
    const last = game.page >= pages.length - 1;
    root.innerHTML = `
      <div class="screen narration-screen onsen">
        <h1>♨ 山あいの湯けむり</h1>
        <p class="narration">${escapeHtml(pages[game.page])}</p>
        ${pageDots(game.page, pages.length)}
        <button id="next" class="bigbtn pink">${last ? "湯に身を沈める" : "次へ"}</button>
      </div>`;
    root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () => game.onsenIntroNext(pages.length));
    return;
  }

  // 各段の選択
  if (game.onsenPhase === "stage") {
    const stage = game.onsenStage()!;
    const choices = stage.choices
      .map((c, i) => `<button class="bigbtn pink" data-choice="${i}">${escapeHtml(tLine(db, c.labelKey))}</button>`)
      .join("");
    root.innerHTML = `
      <div class="screen narration-screen onsen">
        <h1>♨ 湯けむりのなか</h1>
        <p class="narration">${escapeHtml(tLine(db, stage.textKey))}</p>
        <p class="hint">どうする？</p>
        <div class="map-choices">${choices}</div>
      </div>`;
    root.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((btn) => {
      btn.addEventListener("click", () => game.chooseOnsen(Number(btn.dataset.choice)));
    });
    return;
  }

  // 選択の反応
  if (game.onsenPhase === "choiceResult") {
    root.innerHTML = `
      <div class="screen narration-screen onsen">
        <h1>♨ 湯けむりのなか</h1>
        <p class="narration">${escapeHtml(tLine(db, game.onsenLastResultKey))}</p>
        <button id="next" class="bigbtn pink">続ける</button>
      </div>`;
    root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () => game.onsenChoiceContinue());
    return;
  }

  // 結末（lead / indulgent）：ページ送り
  const lead = game.onsenResult?.outcome === "lead";
  const gain = game.onsenResult?.sextechGain ?? 0;
  const pages = tLines(db, lead ? ev.leadOutcomeKey : ev.indulgentOutcomeKey);
  const last = game.page >= pages.length - 1;
  const footer = last
    ? `<p class="result-stat">せっくすてく 身${game.run.sextech.mi}・鎬${game.run.sextech.shinogi}・切先${game.run.sextech.kissaki}${gain > 0 ? `（+${gain}）` : ""}　／　こゆき HP ${game.run.hp}/${game.run.maxHp}（全回復）</p>`
    : "";
  root.innerHTML = `
    <div class="screen narration-screen onsen">
      <h1>${lead ? "♨ 気を遣るまで、蕩かしきった" : "♨ 攻守逆転、たっぷり蕩かされて"}</h1>
      <p class="narration">${escapeHtml(pages[game.page])}</p>
      ${pageDots(game.page, pages.length)}
      ${footer}
      <button id="next" class="bigbtn">${last ? "湯から上がる" : "次へ"}</button>
    </div>`;
  root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () => game.onsenOutcomeNext(pages.length));
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
