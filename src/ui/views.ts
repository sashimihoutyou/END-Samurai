import type { Game } from "../app/game.js";
import { escapeHtml, tLine, tLines } from "./text.js";

// テキスト送り・タイトル・リザルト等の単純画面の描画。

function pageDots(current: number, total: number): string {
  let s = "";
  for (let i = 0; i < total; i++) s += i === current ? "●" : "○";
  return `<div class="dots">${s}</div>`;
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
    game.nextPage(pages.length, () => game.beginCharmBattle()),
  );
}

export function renderCharmResult(game: Game, root: HTMLElement): void {
  const db = game.db;
  // 終了台詞を出し分け：初回（処女喪失回）は加入イベント、再戦回は短い再戦台詞。docs/09 §4
  const pages = tLines(db, game.charmFirstTime ? "charm.result.join" : "charm.result.rematch");
  const last = game.page >= pages.length - 1;
  const footer = game.charmFirstTime
    ? `<p class="result-stat">仲間：お豊（鍛冶屋）／こゆき HP ${game.run.hp}/${game.run.maxHp}</p>
       <p class="title-note">——ここまでがα版プロローグ。お豊を連れて、こゆきの旅は続く。</p>`
    : `<p class="result-stat">お豊（鍛冶屋）／こゆき HP ${game.run.hp}/${game.run.maxHp}</p>`;
  root.innerHTML = `
    <div class="screen narration-screen">
      <h1>とろかし、成功</h1>
      <p class="narration">${escapeHtml(pages[game.page])}</p>
      ${pageDots(game.page, pages.length)}
      ${last ? footer : ""}
      <button id="next" class="bigbtn">${last ? "タイトルへ" : "次へ"}</button>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () =>
    game.nextPage(pages.length, () => game.goTitle()),
  );
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
