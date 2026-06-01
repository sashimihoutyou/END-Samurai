import type { ContentDB } from "../core/content/loader.js";
import type { BattleEvent, BattleState } from "../core/model/battle-state.js";
import type { CharmBattleState, CharmEvent, SextechState } from "../core/model/charm.js";
import type { RunState } from "../core/model/run-state.js";
import { createRng, type Rng } from "../core/rng/rng.js";
import { canPlayCard, endTurn, playCard, startBattle } from "../core/rules/normal-battle.js";
import {
  allocateSextech,
  autoAllocateSextech,
  canPlaySexCard,
  endCharmTurn,
  playSexCard,
  startCharmBattle,
  todomeReady,
  useTodome,
} from "../core/rules/charm-battle.js";
import { makeStarterDeck, makeStarterSword } from "./starter.js";
import { describeBattleEvent, renderBattle } from "../ui/battle-view.js";
import { describeCharmEvent, renderCharm } from "../ui/charm-view.js";
import {
  renderArea1Lead,
  renderCharmIntro,
  renderCharmResult,
  renderGameOver,
  renderNoraResult,
  renderOpening,
  renderTitle,
} from "../ui/views.js";

// App層：画面遷移ステートマシン（docs/08 §6.1）。
// 状態は持つが、ゲームロジックは Core層に委譲する（UI/Appは Core を呼ぶだけ）。
// 画面フロー：Title → Opening → Area1導線 → 野犬通常戦闘 → リザルト → お豊魅了バトル → リザルト（お豊加入）。

export type ScreenName =
  | "title"
  | "opening"
  | "area1_lead"
  | "battle"
  | "nora_result"
  | "charm_intro"
  | "charm_result"
  | "gameover";

const NORA_SEED = 0xc0ffee;
const CHARM_SEED = 0xb0ba;

export class Game {
  readonly db: ContentDB;
  private root: HTMLElement;

  screen: ScreenName = "title";
  page = 0; // ページ送り画面（opening / charm_intro / charm_result）の現在ページ

  run: RunState;
  battle: BattleState | null = null;
  charm: CharmBattleState | null = null;
  log: string[] = [];

  /** charm 画面を描画中か（battle 画面と区別するための内部フラグ）。 */
  screenCharm = false;
  /** charm UI：とどめ確認モードか（最終確認の1タップ） */
  charmTodomeArmed = false;
  /** 直近のとろかしバトルが処女喪失回（＝初回）か。終了台詞の出し分けに使う。docs/09 §4 */
  charmFirstTime = false;

  private battleRng: Rng = createRng(NORA_SEED);
  private charmRng: Rng = createRng(CHARM_SEED);

  constructor(db: ContentDB, root: HTMLElement) {
    this.db = db;
    this.root = root;
    this.run = this.freshRun();
  }

  private freshRun(): RunState {
    const base = this.db.combat.baseMaxHp;
    return {
      hp: base,
      maxHp: base,
      sword: makeStarterSword(),
      deck: makeStarterDeck(),
      companions: [],
      sextech: { mi: 0, shinogi: 0, kissaki: 0 },
      rescuedCount: 0,
      flags: {},
    };
  }

  // ── 画面遷移 ────────────────────────────────────────────────

  start(): void {
    this.render();
  }

  goTitle(): void {
    this.run = this.freshRun();
    this.battle = null;
    this.charm = null;
    this.log = [];
    this.page = 0;
    this.screen = "title";
    this.render();
  }

  beginOpening(): void {
    this.screen = "opening";
    this.page = 0;
    this.render();
  }

  /** ページ送り画面の「次へ」。終端に達したら onEnd を呼ぶ。 */
  nextPage(total: number, onEnd: () => void): void {
    if (this.page < total - 1) {
      this.page += 1;
      this.render();
    } else {
      onEnd();
    }
  }

  beginArea1Lead(): void {
    this.screen = "area1_lead";
    this.render();
  }

  beginNoraBattle(): void {
    this.battleRng = createRng(NORA_SEED);
    this.log = [];
    const started = startBattle(
      this.db,
      {
        deck: this.run.deck,
        sword: this.run.sword,
        hp: this.run.hp,
        maxHp: this.run.maxHp,
        enemyDefIds: ["nora_inu"],
      },
      this.battleRng,
    );
    this.battle = started.state;
    this.pushBattleEvents(started.events);
    this.screen = "battle";
    this.render();
  }

  beginCharmIntro(): void {
    this.screen = "charm_intro";
    this.page = 0;
    this.render();
  }

  beginCharmBattle(): void {
    this.charmRng = createRng(CHARM_SEED);
    this.log = [];
    // 処女喪失は永続フラグ。未喪失なら今回が処女喪失回＝初挿入専用台詞・初回終了台詞を出す。
    const virgin = !this.run.flags.otoyoDeflowered;
    this.charmFirstTime = virgin;
    const started = startCharmBattle(
      this.db,
      {
        enemyDefId: "otoyo",
        hp: this.run.hp,
        maxHp: this.run.maxHp,
        sextech: this.run.sextech,
        virgin,
      },
      this.charmRng,
    );
    this.charm = started.state;
    this.charmTodomeArmed = false;
    this.pushCharmEvents(started.events);
    this.screenCharm = true; // render() は screenCharm 優先で charm 画面を描く
    this.render();
  }

  beginCharmResult(): void {
    this.screen = "charm_result";
    this.page = 0;
    this.screenCharm = false;
    this.render();
  }

  gameOver(): void {
    this.screen = "gameover";
    this.screenCharm = false;
    this.render();
  }

  // ── 通常戦闘（野犬）操作 ────────────────────────────────────

  normalPlay(cardUid: string): void {
    if (!this.battle || !canPlayCard(this.db, this.battle, cardUid)) return;
    const r = playCard(this.db, this.battle, cardUid, null, this.battleRng);
    this.battle = r.state;
    this.pushBattleEvents(r.events);
    this.afterNormalUpdate();
  }

  normalEndTurn(): void {
    if (!this.battle || this.battle.phase !== "player") return;
    const r = endTurn(this.db, this.battle, this.battleRng);
    this.battle = r.state;
    this.pushBattleEvents(r.events);
    this.afterNormalUpdate();
  }

  private afterNormalUpdate(): void {
    if (!this.battle) return;
    if (this.battle.phase === "won") {
      this.run.hp = this.battle.hp; // HPを引き継ぐ（1ラン通し）
      this.screen = "nora_result";
    } else if (this.battle.phase === "lost") {
      this.gameOver();
      return;
    }
    this.render();
  }

  // ── 魅了バトル（お豊）操作 ──────────────────────────────────

  charmPlay(cardId: string): void {
    if (!this.charm || !canPlaySexCard(this.db, this.charm, cardId)) return;
    const r = playSexCard(this.db, this.charm, cardId, null, this.charmRng);
    this.charm = r.state;
    this.charmTodomeArmed = false;
    this.pushCharmEvents(r.events);
    this.render();
  }

  charmTodome(): void {
    if (!this.charm) return;
    if (!this.charmIsTodomeReady()) return; // とどめは相手が放心（気力0）のときのみ
    // 1タップ目は確認、2タップ目で実行。
    if (!this.charmTodomeArmed) {
      this.charmTodomeArmed = true;
      this.render();
      return;
    }
    const r = useTodome(this.db, this.charm, null, this.charmRng);
    this.charm = r.state;
    this.charmTodomeArmed = false;
    this.pushCharmEvents(r.events);
    if (this.charm.phase === "won") {
      this.run.hp = this.charm.hp;
      if (!this.run.companions.some((c) => c.id === "otoyo")) {
        this.run.companions.push({ id: "otoyo", affection: "mid" });
      }
      this.run.flags.otoyoJoined = true;
      this.run.flags.otoyoDeflowered = true; // とどめ（中出し）で処女喪失を永続化。次回以降は再戦台詞へ
      this.beginCharmResult();
      return;
    }
    this.render();
  }

  charmEndTurn(): void {
    if (!this.charm || this.charm.phase !== "player") return;
    const r = endCharmTurn(this.db, this.charm, this.charmRng);
    this.charm = r.state;
    this.charmTodomeArmed = false;
    this.pushCharmEvents(r.events);
    if (this.charm.phase === "lost") {
      this.gameOver();
      return;
    }
    this.render();
  }

  charmAllocate(part: keyof SextechState): void {
    if (!this.charm) return;
    this.charm = allocateSextech(this.charm, part);
    this.run.sextech = this.charm.sextech;
    this.render();
  }

  charmAuto(): void {
    if (!this.charm) return;
    this.charm = autoAllocateSextech(this.charm);
    this.run.sextech = this.charm.sextech;
    this.render();
  }

  charmIsTodomeReady(): boolean {
    return this.charm ? todomeReady(this.charm, null) : false;
  }

  // ── ログ整形 ────────────────────────────────────────────────

  private pushBattleEvents(events: BattleEvent[]): void {
    if (!this.battle) return;
    for (const ev of events) {
      const line = describeBattleEvent(this.db, this.battle, ev);
      if (line) this.log.push(line);
    }
  }

  private pushCharmEvents(events: CharmEvent[]): void {
    if (!this.charm) return;
    for (const ev of events) {
      const line = describeCharmEvent(this.db, this.charm, ev);
      if (line) this.log.push(line);
    }
  }

  // ── 描画ディスパッチ ────────────────────────────────────────

  render(): void {
    if (this.screenCharm) {
      renderCharm(this, this.root);
      return;
    }
    switch (this.screen) {
      case "title": renderTitle(this, this.root); break;
      case "opening": renderOpening(this, this.root); break;
      case "area1_lead": renderArea1Lead(this, this.root); break;
      case "battle": renderBattle(this, this.root); break;
      case "nora_result": renderNoraResult(this, this.root); break;
      case "charm_intro": renderCharmIntro(this, this.root); break;
      case "charm_result": renderCharmResult(this, this.root); break;
      case "gameover": renderGameOver(this, this.root); break;
    }
  }
}
