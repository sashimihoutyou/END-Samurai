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
import { generateReward, type RewardOffer } from "../core/rules/reward.js";
import { availableFusions, availableShops, isDisposable, matchFusion, sellPrice } from "../core/rules/shop.js";
import { effectiveScore, resolveOnsen } from "../core/rules/onsen.js";
import type { SwordPart } from "../core/model/sword.js";
import type { OnsenEvent, OnsenResult } from "../core/model/onsen.js";
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
  renderOnsen,
  renderOpening,
  renderResult,
  renderReward,
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
  | "reward"
  | "onsen"
  | "result"
  | "gameover";

/** 温泉シーンの進行フェーズ。 */
export type OnsenPhase = "intro" | "stage" | "choiceResult" | "outcome";

const RUN_SEED = 0x5a3c19; // ラン全体の基準シード。各戦闘はノードIDから派生した決定論的シードを使う。
const ONSEN_INDULGENT_RATIO = 0.6; // indulgent（蕩かされ）の回復上限＝最大HPの割合（docs/10「全回復のトレードオフ化」）。

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

  // ── 野営地ハブ（施設：鍛冶屋・道場・行商人）。docs/03「野営地」──
  campView = "menu"; // "menu" ＝施設選択／施設ID＝その店を開いている
  campRested = false; // この野営地でひと晩休んだか（回復の連打防止）
  campNotice = ""; // 施設での直近の結果（買った・売った・休んだ等）

  // ── 道中のお豊・簡易サービス（打ち直し・パーツ交換。戦闘中は不可）。docs/03「移動中の簡易サービス」──
  mapOtoyoOpen = false; // マップ画面でお豊の手入れパネルを開いているか
  smithNotice = ""; // 手入れ（打ち直し・付け替え）の直近の結果。camp/map で共用

  // ── 温泉イベント（docs/05 リメイク：複数段の選択式エロシーン）──
  onsenEvent: OnsenEvent | null = null;
  onsenPhase: OnsenPhase = "intro";
  onsenStageIndex = 0;
  onsenScore = 0; // 好みに沿った手の累計（閾値以上で lead）
  onsenLastResultKey = ""; // 直近の選択の反応テキスト
  onsenResult: OnsenResult | null = null; // 結末（lead/indulgent）
  private onsenReturnNode: string | null = null;

  // ── 戦闘報酬（docs/03）──
  rewardOffer: RewardOffer | null = null;
  rewardRevealed = false; // 中央ブラインド枠を開いたか
  private rewardReturnNode: string | null = null; // 報酬後に戻るノード
  private rewardNotice = ""; // 報酬後にマップへ出す結果文
  private cardSeq = 0; // 入手カードの個体ID採番

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
      swordGrade: makeStarterSword(), // 初期は全部位「新品同様」が装備パーツの等級
      parts: { blade: [], tsuba: [], tsuka: [] },
      costume: "normal",
      deck: makeStarterDeck(),
      companions: [],
      sextech: { mi: 0, shinogi: 0, kissaki: 0 },
      rescuedCount: 0,
      zeni: 0,
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
    this.campView = "menu";
    this.campRested = false;
    this.campNotice = "";
    this.mapOtoyoOpen = false;
    this.smithNotice = "";
    this.rewardOffer = null;
    this.rewardReturnNode = null;
    this.onsenEvent = null;
    this.onsenResult = null;
    this.onsenReturnNode = null;
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
        costume: this.run.costume,
        companions: this.run.companions,
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
        // 野営地ハブを開く（施設選択メニュー）。ひと晩の休息はこの野営地で1回まで。
        this.campView = "menu";
        this.campRested = false;
        this.campNotice = "";
        this.screen = "camp";
        this.render();
        break;
      }
      case "onsen": {
        const ev = this.pickOnsen(node.onsenIds ?? [], nodeId);
        if (!ev) {
          this.advanceTo(nodeId, "湯は冷めていた……（相手がいない）");
          return;
        }
        this.beginOnsen(ev, nodeId);
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

  // ── 野営地ハブ（施設）─────────────────────────────────────────

  /** いま利用できる施設（葵がいなければ道場は出ない）。docs/03「野営地」。 */
  campShops() {
    return availableShops(this.db, this.run.companions);
  }

  /** ひと晩休む：お豊が刀を打ち直し（等級まで回復）＋衣を繕い、ひと晩で小回復する（この野営地で1回）。 */
  campRest(): void {
    if (this.campRested) return;
    this.run.sword = { ...this.run.swordGrade }; // 摩耗を装備パーツの等級まで戻す（打ち直し）
    this.run.costume = "normal"; // 衣装も繕う（docs/05「野営地の鍛冶屋で衣装修繕」）
    const before = this.run.hp;
    this.run.hp = Math.min(this.run.maxHp, this.run.hp + 5);
    this.campRested = true;
    this.campNotice = `刀を打ち直し、衣を繕い、傷を癒した（HP +${this.run.hp - before}）`;
    this.render();
  }

  /** 施設を開く／メニューへ戻る（view="menu"）。 */
  campOpen(view: string): void {
    this.campView = view;
    this.campNotice = "";
    this.render();
  }

  /** 施設の在庫を1つ買う（銭が足りなければ何もしない）。 */
  campBuy(shopId: string, cardId: string): void {
    const shop = this.db.shops.shops.find((s) => s.id === shopId);
    const item = shop?.stock.find((i) => i.cardId === cardId);
    const def = item ? this.db.cards.get(cardId) : undefined;
    if (!shop || !item || !def) return;
    if (this.run.zeni < item.price) {
      this.campNotice = "銭が足りない……";
      this.render();
      return;
    }
    this.run.zeni -= item.price;
    this.cardSeq += 1;
    const inst = def.uses != null
      ? { uid: `${cardId}@buy${this.cardSeq}`, defId: cardId, usesLeft: def.uses }
      : { uid: `${cardId}@buy${this.cardSeq}`, defId: cardId };
    this.run.deck.push(inst);
    this.campNotice = `${def.name}を仕入れた（-${item.price}銭）`;
    this.render();
  }

  /** デッキの1枚を売る（行商人）。売値＝Core層 sellPrice。 */
  campSell(cardUid: string): void {
    const idx = this.run.deck.findIndex((c) => c.uid === cardUid);
    if (idx < 0) return;
    const inst = this.run.deck[idx];
    if (!isDisposable(this.db, inst)) return; // 仲間アクティブは売れない
    const price = sellPrice(this.db, inst.defId);
    const name = this.db.cards.get(inst.defId)?.name ?? inst.defId;
    this.run.deck.splice(idx, 1);
    this.run.zeni += price;
    this.campNotice = `${name}を売った（+${price}銭）`;
    this.render();
  }

  /** いま実行できる融合レシピのインデックス（デッキが入力を満たすもの）。UI用。 */
  fusableRecipes(): number[] {
    return availableFusions(this.db, this.run.deck);
  }

  /**
   * 道場（葵）：既存の型2枚を融合し、新しい技1枚を閃く（デッキ圧縮＋強化）。無償。docs/03「道場」。
   * 入力カードをデッキから消費し、結果カードを1枚加える。
   */
  campFuse(recipeIndex: number): void {
    const recipe = this.db.shops.fusions[recipeIndex];
    if (!recipe) return;
    const consumeUids = matchFusion(this.run.deck, recipe);
    if (!consumeUids) return; // 入力が揃っていない
    this.run.deck = this.run.deck.filter((c) => !consumeUids.includes(c.uid));
    const def = this.db.cards.get(recipe.result);
    this.cardSeq += 1;
    const inst = def?.uses != null
      ? { uid: `${recipe.result}@fuse${this.cardSeq}`, defId: recipe.result, usesLeft: def.uses }
      : { uid: `${recipe.result}@fuse${this.cardSeq}`, defId: recipe.result };
    this.run.deck.push(inst);
    const flavor = recipe.flavorKey && typeof this.db.text[recipe.flavorKey] === "string"
      ? (this.db.text[recipe.flavorKey] as string)
      : "";
    const inNames = recipe.inputs.map((id) => this.db.cards.get(id)?.name ?? id).join("＋");
    this.campNotice = flavor || `${inNames}から「${def?.name ?? recipe.result}」を閃いた！`;
    this.render();
  }

  // ── お豊の刀パーツ（打ち直し・パーツ交換・パーツ購入）。docs/03「鍛冶屋」──

  /** 刀部位の段階表示名。UI用。 */
  stageName(slot: SwordPart, stageId: string): string {
    return this.db.swordStages.get(slot)?.stages.find((s) => s.id === stageId)?.name ?? stageId;
  }

  /** 打ち直し（無償）：摩耗した刀を、装備パーツの等級まで戻す。camp/道中で共用。 */
  otoyoRepair(): void {
    this.run.sword = { ...this.run.swordGrade };
    this.smithNotice = "刀を打ち直した（摩耗を等級まで戻した）";
    this.render();
  }

  /**
   * パーツ交換（無償・道中可・戦闘中不可）：所持パーツを装備に付け替える。
   * いま装備中の等級パーツは所持品へ戻り、選んだパーツが装備（現在状態も新品の等級に）。
   */
  otoyoEquip(slot: SwordPart, stageId: string): void {
    const inv = this.run.parts[slot];
    const idx = inv.indexOf(stageId);
    if (idx < 0) return; // 所持していない
    inv.splice(idx, 1);
    inv.push(this.run.swordGrade[slot]); // 外したパーツは等級のまま所持品へ戻る（摩耗は残らない）
    this.run.swordGrade[slot] = stageId;
    this.run.sword[slot] = stageId; // 付けたてなので現在状態も等級
    this.smithNotice = `${slot === "blade" ? "刃" : slot === "tsuba" ? "鍔" : "柄"}を「${this.stageName(slot, stageId)}」に付け替えた`;
    this.render();
  }

  /** パーツ購入（有料）：お豊が良いパーツを買い付けて所持品に加える（現地買い付けのため有償）。 */
  otoyoBuyPart(partIndex: number): void {
    const part = this.db.shops.parts[partIndex];
    if (!part) return;
    if (this.run.zeni < part.price) {
      this.smithNotice = "銭が足りない……";
      this.render();
      return;
    }
    this.run.zeni -= part.price;
    this.run.parts[part.slot].push(part.stageId);
    this.smithNotice = `「${this.stageName(part.slot, part.stageId)}」を買い付けた（-${part.price}銭）。付け替えで装備できる`;
    this.render();
  }

  /** 道中（マップ画面）でお豊の手入れパネルを開く／閉じる。戦闘中は呼ばれない。 */
  openMapOtoyo(): void {
    this.mapOtoyoOpen = true;
    this.smithNotice = "";
    this.render();
  }
  closeMapOtoyo(): void {
    this.mapOtoyoOpen = false;
    this.smithNotice = "";
    this.render();
  }

  /** 売却・処分できるデッキ個体（仲間アクティブを除く）。UI用。 */
  disposableDeck() {
    return this.run.deck.filter((c) => isDisposable(this.db, c));
  }

  /** カードの売値（UI表示用）。 */
  cardSellPrice(defId: string): number {
    return sellPrice(this.db, defId);
  }

  /** 野営地を発つ。 */
  campLeave(): void {
    if (!this.activeNodeId) return;
    this.advanceTo(this.activeNodeId, "野営地を発った");
  }

  // ── 温泉イベント（複数段の選択式エロシーン）────────────────────

  /**
   * 出現条件を満たす温泉イベントから1つを抽選する。
   * その時いる仲間（加入済み companion）と、救済した村娘（単独＝minRescued1／複数＝同2）が
   * 候補になり、誰が来るかはランダム。決定論のためノードIDと救済人数からシードを派生させる。
   */
  private pickOnsen(ids: string[], nodeId: string): OnsenEvent | null {
    const pool = ids
      .map((id) => this.db.onsen.get(id))
      .filter((ev): ev is OnsenEvent => {
        if (!ev) return false;
        if (ev.partnerSource === "rescued") return this.run.rescuedCount >= (ev.minRescued ?? 1);
        return this.run.companions.some((c) => c.id === ev.partnerId);
      });
    if (pool.length === 0) return null;
    const rng = createRng(hashSeed(`onsen:${nodeId}:${this.run.rescuedCount}`));
    return pool[rng.int(pool.length)];
  }

  private beginOnsen(ev: OnsenEvent, returnNode: string): void {
    this.onsenEvent = ev;
    this.onsenReturnNode = returnNode;
    this.onsenPhase = "intro";
    this.onsenStageIndex = 0;
    this.onsenScore = 0;
    this.onsenLastResultKey = "";
    this.onsenResult = null;
    this.page = 0;
    this.screen = "onsen";
    this.render();
  }

  /** 現在の温泉ステージ。 */
  onsenStage() {
    return this.onsenEvent?.stages[this.onsenStageIndex];
  }

  /** 導入ページ送りの「次へ」終端でステージへ。 */
  onsenIntroNext(total: number): void {
    if (this.page < total - 1) {
      this.page += 1;
      this.render();
      return;
    }
    this.onsenPhase = "stage";
    this.page = 0;
    this.render();
  }

  /** ステージの選択肢を選ぶ。スコアを加算し、反応を見せる（中断はしない）。 */
  chooseOnsen(choiceIndex: number): void {
    const ev = this.onsenEvent;
    const stage = this.onsenStage();
    const choice = stage?.choices[choiceIndex];
    if (!ev || !choice) return;
    this.onsenScore += effectiveScore(ev, choice);
    this.onsenLastResultKey = choice.resultKey;
    this.onsenPhase = "choiceResult";
    this.render();
  }

  /** 選択の反応を見たあと、次段へ進む。最終段なら結末へ。 */
  onsenChoiceContinue(): void {
    const ev = this.onsenEvent;
    if (!ev) return;
    const lastStage = this.onsenStageIndex >= ev.stages.length - 1;
    if (lastStage) {
      this.applyOnsenOutcome();
    } else {
      this.onsenStageIndex += 1;
      this.onsenPhase = "stage";
    }
    this.render();
  }

  /** 結末を確定し、せっくすてく加算（スコア比例）・全回復を適用する（1回だけ）。 */
  private applyOnsenOutcome(): void {
    const ev = this.onsenEvent;
    if (!ev) return;
    const result = resolveOnsen(ev, this.onsenScore);
    this.onsenResult = result;
    if (result.sextechGain > 0) {
      this.run.sextech[result.sextechPart] += result.sextechGain;
    }
    if (result.fullHeal) {
      // lead：主導できた褒美として全回復＋刀打ち直し＋衣を整える。
      this.run.hp = this.run.maxHp;
      this.run.sword = { ...this.run.swordGrade }; // 刀も打ち直し（装備パーツの等級まで）
      this.run.costume = "normal";
    } else {
      // indulgent：蕩かされて回復は中途半端。最大HPの ONSEN_INDULGENT_RATIO まで（下回っている時だけ引き上げ）。
      // 刀の打ち直しは入らない＝ミニゲームの出来が刀メンテにも響く（docs/10「全回復のトレードオフ化」）。
      const floor = Math.floor(this.run.maxHp * ONSEN_INDULGENT_RATIO);
      this.run.hp = Math.max(this.run.hp, floor);
      this.run.costume = "normal"; // 湯で衣だけは整う
    }
    this.onsenPhase = "outcome";
    this.page = 0;
  }

  /** 結末テキストのページ送り。終端で湯から上がってマップへ。 */
  onsenOutcomeNext(total: number): void {
    if (this.page < total - 1) {
      this.page += 1;
      this.render();
      return;
    }
    const node = this.onsenReturnNode;
    const gained = (this.onsenResult?.sextechGain ?? 0) > 0;
    const notice =
      this.onsenResult?.outcome === "lead"
        ? `湯あがり、自信と経験を積んだ（全回復＋刀の打ち直し）${gained ? "／せっくすてく獲得" : ""}`
        : `湯あがり、すっかり蕩かされた（回復は中途半端）${gained ? "／せっくすてく獲得" : ""}`;
    this.onsenEvent = null;
    this.onsenResult = null;
    this.onsenReturnNode = null;
    if (node) this.advanceTo(node, notice);
    else this.enterMap();
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
      this.run.hp = this.battle.hp; // HP・刀・衣装の状態をランへ引き継ぐ（1ラン通し）
      this.run.sword = this.battle.sword;
      this.run.costume = this.battle.costume;
      // 撃破した敵の懸賞金（銭）を獲得（docs/03「経済システム」）。
      const bounty = this.battle.enemies.reduce((sum, e) => sum + (this.db.enemies.get(e.defId)?.bounty ?? 0), 0);
      this.run.zeni += bounty;
      if (this.activeNodeId === null) {
        this.screen = "nora_result"; // プロローグ野犬戦
      } else {
        const node = this.findNode(this.activeNodeId);
        // エリート撃破の永続報酬：最大HPを上げ、増えたぶんを回復（docs/10「ランの成長曲線」）。
        let growth = "";
        if (node?.maxHpReward) {
          this.run.maxHp += node.maxHpReward;
          this.run.hp += node.maxHpReward;
          growth = `／胆力がついた（最大HP +${node.maxHpReward}）`;
        }
        if (node?.type === "boss") {
          this.screen = "result"; // 大しかばね撃破＝クリア
        } else {
          const names = this.battle.enemies.map((e) => e.name).join("・");
          const suffix = bounty > 0 ? `（+${bounty}銭）` : "";
          this.offerReward(this.activeNodeId, `${names}を退けた${suffix}${growth}`); // 戦闘報酬（3択）→マップ
          return;
        }
      }
    } else if (this.battle.phase === "lost") {
      this.gameOver();
      return;
    }
    this.render();
  }

  // ── 戦闘報酬（3択）────────────────────────────────────────────

  /** 通常戦闘勝利後、ドロップ候補から3枚提示する（docs/03「戦闘報酬」）。 */
  private offerReward(returnNode: string, notice: string): void {
    this.rewardOffer = generateReward(this.db.rewards.dropPool, this.battleRng);
    this.rewardRevealed = false;
    this.rewardReturnNode = returnNode;
    this.rewardNotice = notice;
    this.screen = "reward";
    this.render();
  }

  /** 報酬カードの中身（ブラインド枠はrevealするまで非表示）。UI用。 */
  rewardCardName(index: number): string | null {
    const id = this.rewardOffer?.cardIds[index];
    if (!id) return null;
    if (index === this.rewardOffer!.blindIndex && !this.rewardRevealed) return null; // ブラインド
    return this.db.cards.get(id)?.name ?? id;
  }

  /** ブラインド枠を開く（1タップ目）。 */
  revealReward(): void {
    if (!this.rewardOffer) return;
    this.rewardRevealed = true;
    this.render();
  }

  /** 提示カードの1枚をデッキへ加える。 */
  chooseReward(index: number): void {
    const id = this.rewardOffer?.cardIds[index];
    if (!id) return;
    if (index === this.rewardOffer!.blindIndex && !this.rewardRevealed) {
      this.revealReward(); // ブラインドは一度開いてから選ぶ
      return;
    }
    const def = this.db.cards.get(id);
    this.cardSeq += 1;
    const inst = def?.uses != null
      ? { uid: `${id}@drop${this.cardSeq}`, defId: id, usesLeft: def.uses }
      : { uid: `${id}@drop${this.cardSeq}`, defId: id };
    this.run.deck.push(inst);
    const name = def?.name ?? id;
    this.finishReward(`${this.rewardNotice}（${name}を入手）`);
  }

  /** 報酬を受け取らずに進む（デッキ膨張防止）。 */
  skipReward(): void {
    this.finishReward(this.rewardNotice);
  }

  private finishReward(notice: string): void {
    const node = this.rewardReturnNode;
    this.rewardOffer = null;
    this.rewardReturnNode = null;
    if (node) this.advanceTo(node, notice);
    else this.enterMap();
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
      // 仲間アクティブカードをデッキへ固定投入（docs/03・08 §9「常にデッキに固定投入」）。
      const activeId = this.db.companions.get(joinId)?.activeCardId;
      if (activeId && !this.run.deck.some((c) => c.defId === activeId)) {
        this.cardSeq += 1;
        this.run.deck.push({ uid: `${activeId}@comp${this.cardSeq}`, defId: activeId });
      }
    }
    if (joinId) this.run.flags[`${joinId}Joined`] = true;
    else this.run.rescuedCount += 1; // 加入しない相手（むすめしかばね等）は「とどめ！」＝救済者カウント+1（docs/04「救済者システム」）
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
      const def = this.db.charmEnemies.get(this.charmEnemyDefId);
      // 加入する相手（葵）は仲間化、加入しない相手（むすめしかばね）は救済者として人間に戻る。
      const notice = def?.joinCompanionId
        ? `${def.name}が仲間に加わった`
        : `${def?.name ?? "相手"}を救った（救済者 +1）`;
      this.advanceTo(this.activeNodeId, notice);
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
      case "reward": renderReward(this, this.root); break;
      case "onsen": renderOnsen(this, this.root); break;
      case "result": renderResult(this, this.root); break;
      case "gameover": renderGameOver(this, this.root); break;
    }
  }
}
