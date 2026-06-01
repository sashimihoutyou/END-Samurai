import type { ContentDB } from "../core/content/loader.js";
import type { BattleEvent, BattleState } from "../core/model/battle-state.js";
import type { CharmBattleState, CharmEvent, SextechState } from "../core/model/charm.js";
import type { EventDef, MapDef, MapNode } from "../core/model/map.js";
import type { RunState } from "../core/model/run-state.js";
import { createRng, type Rng } from "../core/rng/rng.js";
import { canPlayCard, endTurn, hasTelegraphedPart, playCard, setBrace, startBattle } from "../core/rules/normal-battle.js";
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
  renderCamp,
  renderCharmIntro,
  renderCharmResult,
  renderEvent,
  renderGameOver,
  renderMap,
  renderNoraResult,
  renderOpening,
  renderResult,
  renderTitle,
} from "../ui/views.js";

// App層：画面遷移ステートマシン（docs/08 §6.1）。
// 状態は持つが、ゲームロジックは Core層に委譲する（UI/Appは Core を呼ぶだけ）。
// 流れ：Title → Opening → Area1導線 → 野犬戦 → お豊とろかし（加入）→【データ駆動マップ：田舎】
//   こんぼう山賊 →（分岐）→ 野営地 → 中間地点・葵とろかし（加入）→ 峠の手前 → 大しかばねボス → クリア。

export type ScreenName =
  | "title"
  | "opening"
  | "area1_lead"
  | "battle"
  | "nora_result"
  | "charm_intro"
  | "charm_result"
  | "map"
  | "event"
  | "camp"
  | "result"
  | "gameover";

const RUN_SEED = 0x5a3c19; // ラン全体の基準シード。各戦闘はノードIDから派生した決定論的シードを使う。

/** 文字列から決定論的な32bitシードを得る（FNV-1a）。Godot移植時も同手順で再現可能。 */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h ^ RUN_SEED) >>> 0;
}

export class Game {
  readonly db: ContentDB;
  private root: HTMLElement;

  screen: ScreenName = "title";
  page = 0; // ページ送り画面（opening / charm_intro / charm_result / event）の現在ページ

  run: RunState;
  battle: BattleState | null = null;
  charm: CharmBattleState | null = null;
  log: string[] = [];

  // ── 通常戦闘の画面コンテキスト（汎用化：野犬もマップ戦も同じ battle 画面で描く）──
  battleTitle = "";
  battleFlavorKey = "";
  battleHintKey = "";
  battleIsBoss = false;

  // ── マップ進行（田舎・固定手書き）──
  mapDef: MapDef | null = null;
  mapPos: string | null = null; // 現在地ノードID
  mapVisited: string[] = [];
  activeNodeId: string | null = null; // いま解決中のノード（戦闘/とろかし/イベント/野営地）。null＝プロローグ中
  mapNotice = ""; // マップ画面上部に出す直近の結果（「○○を退けた」等）
  currentEvent: EventDef | null = null;

  /** charm 画面を描画中か（battle 画面と区別するための内部フラグ）。 */
  screenCharm = false;
  /** charm UI：とどめ確認モードか（最終確認の1タップ） */
  charmTodomeArmed = false;
  /** いま戦っているとろかし相手の敵ID（画面タイトル・台詞・結果の出し分け）。 */
  charmEnemyDefId = "otoyo";
  /** 直近のとろかしバトルが処女喪失回（＝初回）か。終了台詞の出し分けに使う。docs/09 §4 */
  charmFirstTime = false;

  private battleRng: Rng = createRng(RUN_SEED);
  private charmRng: Rng = createRng(RUN_SEED);

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
    this.mapDef = null;
    this.mapPos = null;
    this.mapVisited = [];
    this.activeNodeId = null;
    this.mapNotice = "";
    this.currentEvent = null;
    this.screenCharm = false;
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

  // ── プロローグ：野犬戦 ──────────────────────────────────────

  beginNoraBattle(): void {
    this.activeNodeId = null; // プロローグ戦（マップ外）。勝利後は nora_result へ。
    this.battleTitle = "第1エリア・いんなか村周辺";
    this.battleFlavorKey = "battle.nora_inu.encounter";
    this.battleHintKey = "battle.nora.hint";
    this.battleIsBoss = false;
    this.startNormalBattle(["nora_inu"], hashSeed("prologue:nora"));
  }

  private startNormalBattle(enemyDefIds: string[], seed: number): void {
    this.battleRng = createRng(seed);
    this.log = [];
    const started = startBattle(
      this.db,
      {
        deck: this.run.deck,
        sword: this.run.sword,
        hp: this.run.hp,
        maxHp: this.run.maxHp,
        enemyDefIds,
      },
      this.battleRng,
    );
    this.battle = started.state;
    this.pushBattleEvents(started.events);
    this.screen = "battle";
    this.render();
  }

  // ── プロローグ：お豊とろかし ────────────────────────────────

  beginCharmIntro(): void {
    this.screen = "charm_intro";
    this.page = 0;
    this.render();
  }

  /** とろかしバトル開始（プロローグお豊／道中の葵で共用）。 */
  beginCharmBattle(enemyDefId: string, virgin: boolean): void {
    this.charmEnemyDefId = enemyDefId;
    this.charmFirstTime = virgin; // 処女喪失回かどうか（葵は経験済み＝常に false）
    this.charmRng = createRng(hashSeed("charm:" + enemyDefId));
    this.log = [];
    const started = startCharmBattle(
      this.db,
      {
        enemyDefId,
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

  // ── マップ進行（田舎・固定手書き）──────────────────────────

  /** お豊加入後にマップへ入る（docs/08 §7 田舎マップ）。 */
  enterMap(): void {
    const def = this.db.maps.get("inaka");
    if (!def) throw new Error("マップ inaka が見つかりません");
    this.mapDef = def;
    this.mapPos = def.entry;
    this.mapVisited = [def.entry];
    this.activeNodeId = null;
    this.mapNotice = "";
    this.screen = "map";
    this.render();
  }

  findNode(id: string): MapNode | undefined {
    return this.mapDef?.nodes.find((n) => n.id === id);
  }

  /** 現在地ノード（マップ画面の起点）。 */
  currentNode(): MapNode | undefined {
    return this.mapPos ? this.findNode(this.mapPos) : undefined;
  }

  /** 次に進めるノード一覧。 */
  nextNodes(): MapNode[] {
    const cur = this.currentNode();
    if (!cur) return [];
    return cur.next.map((id) => this.findNode(id)).filter((n): n is MapNode => !!n);
  }

  /** 次のノードへ進む（戦闘・とろかし・イベント・野営地・休息へ分岐）。 */
  travelTo(nodeId: string): void {
    const node = this.findNode(nodeId);
    if (!node) return;
    this.activeNodeId = nodeId;
    this.mapNotice = "";
    switch (node.type) {
      case "battle":
      case "boss": {
        this.battleTitle = "第1エリア・いんなか村周辺";
        this.battleFlavorKey = `battle.${node.enemyGroup?.[0] ?? "generic"}.encounter`;
        this.battleHintKey = "battle.hint";
        this.battleIsBoss = node.type === "boss";
        this.startNormalBattle(node.enemyGroup ?? [], hashSeed("node:" + node.id));
        break;
      }
      case "charm_encounter":
      case "event": {
        const ev = node.eventId ? this.db.events.get(node.eventId) : undefined;
        if (!ev) {
          this.advanceTo(nodeId, "");
          return;
        }
        this.currentEvent = ev;
        this.page = 0;
        this.screen = "event";
        this.render();
        break;
      }
      case "camp": {
        this.screen = "camp";
        this.render();
        break;
      }
      case "rest": {
        const heal = node.heal ?? 0;
        const before = this.run.hp;
        this.run.hp = Math.min(this.run.maxHp, this.run.hp + heal);
        this.advanceTo(nodeId, `ひと息ついた（HP +${this.run.hp - before}）`);
        break;
      }
      default:
        this.advanceTo(nodeId, "");
    }
  }

  /** ノード解決後、そのノードを現在地にしてマップ画面へ戻る。 */
  private advanceTo(nodeId: string, notice: string): void {
    this.mapPos = nodeId;
    if (!this.mapVisited.includes(nodeId)) this.mapVisited.push(nodeId);
    this.activeNodeId = null;
    this.currentEvent = null;
    this.mapNotice = notice;
    this.screen = "map";
    this.render();
  }

  /** 野営地：お豊が刀を完全修繕し、ひと晩で小回復する。 */
  applyCamp(): void {
    if (!this.activeNodeId) return;
    this.run.sword = makeStarterSword(); // 全部位「新品同様」へ（完全修繕）
    this.run.hp = Math.min(this.run.maxHp, this.run.hp + 5);
    this.advanceTo(this.activeNodeId, "刀を研ぎ直し、傷を癒した");
  }

  /** イベントの選択肢を実行する。 */
  chooseEvent(index: number): void {
    const ev = this.currentEvent;
    if (!ev) return;
    const choice = ev.choices[index];
    if (!choice) return;
    const outcome = choice.outcome;
    switch (outcome.kind) {
      case "start_charm_battle":
        this.beginCharmBattle(outcome.enemyId, false); // 道中とろかしの相手（葵）は経験済み
        break;
      case "start_normal_battle":
        this.battleTitle = "第1エリア・いんなか村周辺";
        this.battleFlavorKey = `battle.${outcome.enemyGroup[0]}.encounter`;
        this.battleHintKey = "battle.hint";
        this.battleIsBoss = false;
        this.startNormalBattle(outcome.enemyGroup, hashSeed("event:" + ev.id));
        break;
      case "heal": {
        const before = this.run.hp;
        this.run.hp = Math.min(this.run.maxHp, this.run.hp + outcome.amount);
        this.advanceTo(this.activeNodeId ?? this.mapPos!, `回復した（HP +${this.run.hp - before}）`);
        break;
      }
      case "continue":
        this.advanceTo(this.activeNodeId ?? this.mapPos!, "");
        break;
    }
  }

  // ── 通常戦闘の操作 ──────────────────────────────────────────

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

  /** 部位狙い予告への対応（受ける／いなす）を設定する。docs/01「受け／いなし」。 */
  normalSetBrace(choice: "ukeru" | "inasu"): void {
    if (!this.battle) return;
    this.battle = setBrace(this.battle, choice);
    this.render();
  }

  /** 「受ける／いなす」選択を提示すべきか（狙撃型が部位を予告中）。 */
  battleShowBrace(): boolean {
    return !!this.battle && this.battle.phase === "player" && hasTelegraphedPart(this.battle);
  }

  private afterNormalUpdate(): void {
    if (!this.battle) return;
    if (this.battle.phase === "won") {
      this.run.hp = this.battle.hp; // HP・刀の状態をランへ引き継ぐ（1ラン通し）
      this.run.sword = this.battle.sword;
      if (this.activeNodeId === null) {
        this.screen = "nora_result"; // プロローグ野犬戦
      } else {
        const node = this.findNode(this.activeNodeId);
        if (node?.type === "boss") {
          this.screen = "result"; // 大しかばね撃破＝クリア
        } else {
          const names = this.battle.enemies.map((e) => e.name).join("・");
          this.advanceTo(this.activeNodeId, `${names}を退けた`);
          return;
        }
      }
    } else if (this.battle.phase === "lost") {
      this.gameOver();
      return;
    }
    this.render();
  }

  // ── とろかしバトルの操作 ────────────────────────────────────

  charmPlay(cardId: string): void {
    if (!this.charm || !canPlaySexCard(this.db, this.charm, cardId)) return;
    const r = playSexCard(this.db, this.charm, cardId, null, this.charmRng);
    this.charm = r.state;
    this.charmTodomeArmed = false;
    this.pushCharmEvents(r.events);
    if (this.charm.phase === "lost") {
      this.gameOver();
      return;
    }
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
      this.onCharmWon();
      return;
    }
    this.render();
  }

  /** とろかし勝利の共通処理：HP引き継ぎ・仲間加入・結果画面へ。 */
  private onCharmWon(): void {
    if (!this.charm) return;
    this.run.hp = this.charm.hp;
    const def = this.db.charmEnemies.get(this.charmEnemyDefId);
    const joinId = def?.joinCompanionId;
    if (joinId && !this.run.companions.some((c) => c.id === joinId)) {
      this.run.companions.push({ id: joinId, affection: "mid" });
    }
    if (joinId) this.run.flags[`${joinId}Joined`] = true;
    if (this.charmEnemyDefId === "otoyo") this.run.flags.otoyoDeflowered = true; // とどめ（中出し）で処女喪失を永続化
    this.beginCharmResult();
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

  /** とろかし結果画面の「次へ」終端で進む先（プロローグ＝マップへ／道中＝マップへ戻る）。 */
  afterCharmResult(): void {
    if (this.charmEnemyDefId === "otoyo") {
      this.enterMap(); // プロローグ完了→田舎マップへ
    } else if (this.activeNodeId) {
      const joined = this.db.charmEnemies.get(this.charmEnemyDefId)?.name ?? "仲間";
      this.advanceTo(this.activeNodeId, `${joined}が仲間に加わった`);
    } else {
      this.enterMap();
    }
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
      case "map": renderMap(this, this.root); break;
      case "event": renderEvent(this, this.root); break;
      case "camp": renderCamp(this, this.root); break;
      case "result": renderResult(this, this.root); break;
      case "gameover": renderGameOver(this, this.root); break;
    }
  }
}
