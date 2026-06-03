// とろかし流ミニゲームのモデル。docs/02「とろかし流ミニゲーム」に対応。
// カード・ゲージ管理なし。1〜3択の選択→評価ポイント→結末。

export type SexAttr =
  | "kuchizuke"   // くちづけ
  | "hogushi"     // ほぐし
  | "seikou"      // 正攻
  | "chichikuri"  // 乳繰り
  | "ushirodori"  // 後ろ取り
  | "uradori";    // 裏取り（2回目以降限定）

export const ALL_ATTRS: SexAttr[] = ["kuchizuke", "hogushi", "seikou", "chichikuri", "ushirodori", "uradori"];

/** 2回目以降でしか出現しない属性。docs/02「回数依存選択肢」。 */
export const SECOND_LOOP_ONLY: ReadonlySet<SexAttr> = new Set<SexAttr>(["uradori"]);

export type SizeCategory = "small" | "medium" | "large";
export type SizePreference = "small" | "medium" | "large" | "any";

/** とろかし遭遇の手数（遭遇種別ごと）。 */
export type HandCount = 1 | 2 | 3;

/** とろかし敵の定義。 */
export interface TorokashiEnemyDef {
  id: string;
  name: string;
  weakAttrs: SexAttr[];        // 弱点属性（hit: 大加点）
  nearAttrs: SexAttr[];        // 許容属性（near: 中加点）
  sizePreference: SizePreference; // 好みのサイズ
  handCount: HandCount;        // 1遭遇の手数
  hintKey: string;             // 遭遇前のヒントテキストキー
  joinCompanionId?: string;    // とろかし完了で仲間加入
}

export type ChoiceResult = "hit" | "near" | "miss";
export type TorokashiOutcome = "lead" | "indulgent" | "failure";

export interface TorokashiState {
  enemyDefId: string;
  loop: number;          // 何回目のループか（0=初回）
  hand: number;          // 現在の手番（0-indexed）
  handCount: number;     // このループの総手数
  totalScore: number;    // この遭遇の累積評価ポイント
  choices: SexAttr[];    // 現在提示中の3択
  phase: "choosing" | "reacting" | "madamada" | "done";
  lastChoice: SexAttr | null;
  lastResult: ChoiceResult | null;
  outcome: TorokashiOutcome | null;
  hp: number;
  maxHp: number;
}

export type TorokashiEvent =
  | { type: "ChoicesPresented"; choices: SexAttr[]; loop: number; hand: number }
  | { type: "AttrSelected"; attr: SexAttr; result: ChoiceResult; points: number; sizeBonus: number }
  | { type: "LoopComplete"; loop: number; totalScore: number }
  | { type: "Madamada"; hpCost: number; hpAfter: number }
  | { type: "Hp0Collapse"; hpAfter: number }  // HP0相討ち → HP10%復活
  | { type: "OutcomeLead" }
  | { type: "OutcomeIndulgent"; hpCost: number }
  | { type: "OutcomeFailure" }   // 通常戦闘へ移行
  | { type: "CompanionJoined"; companionId: string };
