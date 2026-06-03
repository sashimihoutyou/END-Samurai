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

const SLOT_JP: Record<SwordPart, string> = { blade: "刃", tsuba: "鍔", tsuka: "柄" };

/** お豊の手入れパネル（打ち直し・パーツ交換、camp では購入も）。camp/道中で共用。docs/03「鍛冶屋」。 */
function smithyPanelHtml(game: Game, allowBuy: boolean): string {
  const db = game.db;
  const notice = game.smithNotice ? `<p class="result-head">${escapeHtml(game.smithNotice)}</p>` : "";

  // パーツ交換：所持予備パーツを部位ごとに列挙。
  const slots: SwordPart[] = ["blade", "tsuba", "tsuka"];
  const swapItems = slots
    .flatMap((slot) =>
      game.run.parts[slot].map(
        (stageId) =>
          `<button class="bigbtn reward-card" data-equip-slot="${slot}" data-equip-stage="${stageId}">
            <span class="card-name">${SLOT_JP[slot]}：${escapeHtml(game.stageName(slot, stageId))}</span><br><span class="card-ap">付け替える</span>
          </button>`,
      ),
    )
    .join("");
  const swapSection = `<p class="hint">パーツ交換（所持パーツを付け替え・無償）：</p>
    <div class="map-choices reward-choices">${swapItems || `<p class="title-note">付け替えられる予備パーツがない。</p>`}</div>`;

  let buySection = "";
  if (allowBuy) {
    const buyItems = db.shops.parts
      .map((p, idx) => {
        const afford = game.run.zeni >= p.price;
        return `<button class="bigbtn reward-card ${afford ? "" : "blind"}" data-buypart="${idx}" ${afford ? "" : "disabled"}>
          <span class="card-name">${SLOT_JP[p.slot]}：${escapeHtml(game.stageName(p.slot, p.stageId))}</span><br><span class="card-ap">${p.price}銭</span>
        </button>`;
      })
      .join("");
    buySection = `<p class="hint">パーツ購入（良い刃・鍔・柄を買い付け・有償）：</p>
      <div class="map-choices reward-choices">${buyItems}</div>`;
  }

  return `
    ${notice}
    <div class="koyuki" style="margin:8px 0;"><div class="sword">${swordLine(db, game.run.sword)}</div></div>
    <button id="repair" class="bigbtn">打ち直し（摩耗を等級まで回復・無償）</button>
    ${swapSection}
    ${buySection}`;
}

/** 手入れパネルのボタンに操作を結線する。 */
function bindSmithy(game: Game, root: HTMLElement, allowBuy: boolean): void {
  root.querySelector<HTMLButtonElement>("#repair")?.addEventListener("click", () => game.otoyoRepair());
  root.querySelectorAll<HTMLButtonElement>("[data-equip-slot]").forEach((btn) =>
    btn.addEventListener("click", () => game.otoyoEquip(btn.dataset.equipSlot as SwordPart, btn.dataset.equipStage!)),
  );
  if (allowBuy) {
    root.querySelectorAll<HTMLButtonElement>("[data-buypart]").forEach((btn) =>
      btn.addEventListener("click", () => game.otoyoBuyPart(Number(btn.dataset.buypart))),
    );
  }
}

export function renderTitle(game: Game, root: HTMLElement): void {
  const db = game.db;
  root.innerHTML = `
    <div class="screen title-screen">
      <p class="title-sub" style="margin-bottom:12px;font-size:12px;letter-spacing:4px;color:#6f655a;">— α版 —</p>
      <h1 class="title-main" style="font-size:28px;line-height:1.5;">${escapeHtml(tLine(db, "title.main"))}</h1>
      <p class="title-sub">${escapeHtml(tLine(db, "title.sub"))}</p>
      <div style="margin-top:40px;max-width:280px;margin-left:auto;margin-right:auto;">
        <button id="start" class="bigbtn">${escapeHtml(tLine(db, "title.start"))}</button>
      </div>
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

export function renderTorokashiIntro(game: Game, root: HTMLElement): void {
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
    game.nextPage(pages.length, () => game.beginTorokashi("otoyo")),
  );
}

export function renderTorokashiResult(game: Game, root: HTMLElement): void {
  const db = game.db;
  const defId = game.torokashiEnemyDefId;
  // 終了台詞・加入文・進む先を相手別に出し分ける。
  let pages: string[];
  let footer: string;
  let lastLabel: string;
  if (defId === "otoyo") {
    pages = tLines(db, "charm.result.join");
    footer = `<p class="result-stat">仲間：${escapeHtml(companionLine(game))}／こゆき HP ${game.run.hp}/${game.run.maxHp}</p>
       <p class="title-note">——プロローグはここまで。お豊を連れて、こゆきの旅が始まる。</p>`;
    lastLabel = "旅に出る";
  } else if (db.torokashiEnemies.get(defId)?.joinCompanionId) {
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
    game.nextPage(pages.length, () => game.afterTorokashiDone()),
  );
}

const NODE_TAG: Record<NodeType, string> = {
  start:            "出立",
  battle:           "⚔ 戦闘",
  boss:             "💀 ボス",
  camp:             "🏕 野営地",
  rest:             "🌿 休息",
  charm_encounter:  "💕 遭遇",
  event:            "📜 出来事",
  onsen:            "♨ 温泉",
};

export function renderMap(game: Game, root: HTMLElement): void {
  const db = game.db;
  const cur = game.currentNode();

  // 道中のお豊・簡易サービス（打ち直し・パーツ交換。戦闘中は不可＝マップ上でのみ）。docs/03「移動中の簡易サービス」。
  if (game.mapOtoyoOpen) {
    root.innerHTML = `
      <div class="screen narration-screen">
        <h1>お豊の手入れ ― ${escapeHtml(cur?.label ?? "道中")}</h1>
        <p class="narration">お豊「刀、貸しなさい。……研ぎ直すだけならタダよ。手持ちのパーツの付け替えも、見てあげる」</p>
        ${smithyPanelHtml(game, false)}
        <button id="back" class="bigbtn">道に戻る</button>
      </div>`;
    bindSmithy(game, root, false);
    root.querySelector<HTMLButtonElement>("#back")?.addEventListener("click", () => game.closeMapOtoyo());
    return;
  }

  const nexts = game.nextNodes();
  const intro = cur?.type === "start" && cur.textKey ? `<p class="narration">${escapeHtml(tLine(db, cur.textKey))}</p>` : "";
  const notice = game.mapNotice ? `<p class="result-head">${escapeHtml(game.mapNotice)}</p>` : "";

  const choices = nexts
    .map(
      (n: MapNode) =>
        `<button class="bigbtn mapnode" data-node="${n.id}"><span class="node-tag ${n.type}">${NODE_TAG[n.type]}</span> ${escapeHtml(n.label)}</button>`,
    )
    .join("");

  const goal = nexts.length === 0 ? `<p class="title-note">この先はもう無い。</p>` : "";

  // お豊が同行していれば、道中でも刀の手入れ（打ち直し・パーツ交換）を頼める。
  const otoyoHere = game.run.companions.some((c) => c.id === "otoyo");
  const otoyoBtn = otoyoHere
    ? `<button id="otoyo" class="bigbtn">お豊に刀を診てもらう（打ち直し・パーツ交換）</button>`
    : "";

  const hpPct = Math.max(0, (game.run.hp / game.run.maxHp) * 100);
  const hpCls = hpPct < 25 ? "low" : hpPct < 50 ? "warn" : "";
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>田舎・道中　― ${escapeHtml(cur?.label ?? "")}</h1>
      ${notice}
      ${intro}
      <div class="koyuki" style="margin:10px 0;">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px;">
          <span><strong>こゆき</strong></span>
          <span>HP <strong>${game.run.hp}</strong>/${game.run.maxHp}</span>
          <span>💰 ${game.run.zeni}銭</span>
        </div>
        <div class="bar hp" style="margin:4px 0;"><span class="${hpCls}" style="width:${hpPct}%"></span></div>
        <div class="sword">${swordLine(db, game.run.sword)}</div>
        <div class="sword">仲間：${escapeHtml(companionLine(game))}</div>
      </div>
      ${otoyoBtn}
      <p class="hint" style="margin-top:14px;">進む先を選ぶ：</p>
      <div class="map-choices">${choices}</div>
      ${goal}
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#otoyo")?.addEventListener("click", () => game.openMapOtoyo());
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

  const campHpPct = Math.max(0, (game.run.hp / game.run.maxHp) * 100);
  const campHpCls = campHpPct < 25 ? "low" : campHpPct < 50 ? "warn" : "";
  const head = `
    <h1>野営地 ― ${escapeHtml(node?.label ?? "")}</h1>
    ${game.campNotice ? `<p class="result-head">${escapeHtml(game.campNotice)}</p>` : ""}
    <div class="koyuki" style="margin:10px 0;">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px;">
        <span><strong>こゆき</strong></span>
        <span>HP <strong>${game.run.hp}</strong>/${game.run.maxHp}</span>
        <span>💰 ${game.run.zeni}銭</span>
      </div>
      <div class="bar hp" style="margin:4px 0;"><span class="${campHpCls}" style="width:${campHpPct}%"></span></div>
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

  const buyLabel = shop.kind === "buy_fuse" ? "技を習う（月謝）：" : shop.kind === "smithy" ? "手入れ道具を仕入れる：" : "仕入れる（買う）：";
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

  // 鍛冶屋＝お豊の手入れパネル（打ち直し・パーツ交換・パーツ購入）を上に置く。
  const smithySection = shop.kind === "smithy" ? smithyPanelHtml(game, true) : "";

  // 行商人＝売却／道場＝融合（2枚→1枚）。
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
  } else if (shop.kind === "buy_fuse") {
    const fusable = game.fusableRecipes();
    const fuseList = db.shops.fusions
      .map((f, i) => {
        const ok = fusable.includes(i);
        const inN = f.inputs.map((id) => db.cards.get(id)?.name ?? id).join("＋");
        const outN = db.cards.get(f.result)?.name ?? f.result;
        return `<button class="bigbtn reward-card ${ok ? "" : "blind"}" data-fuse="${i}" ${ok ? "" : "disabled"}>
          <span class="card-name">${escapeHtml(inN)} → ${escapeHtml(outN)}</span><br><span class="card-ap">${ok ? "閃く（2枚を融合）" : "素材が足りない"}</span>
        </button>`;
      })
      .join("");
    actionSection = `<p class="hint">型を見直す（既存の技2枚から、新しい技を閃く・無償）：</p>
      <div class="map-choices reward-choices">${fuseList || `<p class="title-note">閃ける組み合わせがない。</p>`}</div>`;
  }

  root.innerHTML = `
    <div class="screen narration-screen">
      ${head}
      <h2 style="margin:4px 0;">${escapeHtml(tLine(db, shop.nameKey))}</h2>
      <p class="narration">${escapeHtml(tLine(db, shop.descKey))}</p>
      ${smithySection}
      <p class="hint">${buyLabel}</p>
      <div class="map-choices reward-choices">${buyList}</div>
      ${actionSection}
      <button id="back" class="bigbtn">戻る</button>
    </div>`;
  if (shop.kind === "smithy") bindSmithy(game, root, true);
  root.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((btn) =>
    btn.addEventListener("click", () => game.campBuy(shop.id, btn.dataset.buy!)),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-sell]").forEach((btn) =>
    btn.addEventListener("click", () => game.campSell(btn.dataset.sell!)),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-fuse]").forEach((btn) =>
    btn.addEventListener("click", () => game.campFuse(Number(btn.dataset.fuse))),
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
  const gain = game.onsenResult?.sizaGain ?? 0;
  const pages = tLines(db, lead ? ev.leadOutcomeKey : ev.indulgentOutcomeKey);
  const last = game.page >= pages.length - 1;
  const footer = last
    ? `<p class="result-stat">こゆき HP ${game.run.hp}/${game.run.maxHp}${lead ? "（全回復）" : ""}${gain > 0 ? "　／　寸法の心得+1" : ""}</p>`
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
