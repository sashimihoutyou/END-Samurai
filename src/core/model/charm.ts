// 魅了バトル（とろかし）のモデル。docs/02「魅了バトル」に対応。
// 通常戦闘（HP戦）とは完全に独立した別レイヤー（docs/02「位置づけと基本思想」）。
// 数値モデルは rules/charm-damage.ts に集約し、本ファイルは型のみを定義する（値はハードコードしない）。
//
// ■ 再設計（両者「我慢ゲージ」）の要点（docs/02「我慢ゲージと絶頂・射精」）:
//   - 敵もこゆきも「気力/HP（長期）」と「我慢（短期・絶頂用）」の二層ゲージを持つ。
//   - 性技命中で敵の気力＋我慢を削る。敵の我慢0で「絶頂」＝気力に追加大ダメージ＋その属性が1段弱化。
//   - こゆきの我慢0で「射精」。暴発（敵に削られて0）=HP大減・不利／狙い撃ち（自分の技で0）=敵に大ダメージ＋デバフ。
//   - 旧「開発システム（同属性3回で+1）」は廃止。弱点段階は「絶頂・射精させられた部位が1段弱くなる」方向にのみ動く。
//   - 「とどめ！」は敵の気力0（放心）でのみ使用可・ノーコスト確殺。

/** 性技の属性（裏管理・UIには表示しない）。docs/02「属性7種」。 */
export type SexAttr =
  | "kuchizuke" // くちづけ
  | "hogushi" // ほぐし
  | "chichikuri" // 乳繰り
  | "seikou" // 正攻
  | "ushirodori" // 後ろ取り
  | "matagari" // またがり
  | "uradori"; // 裏取り

/** 弱点段階の倍率テーブル（docs/02「弱点段階と倍率」）。index 0..3 が段階。 */
export const WEAKNESS_MULTIPLIERS = [0.5, 1.0, 1.5, 2.0] as const;
export const WEAKNESS_MAX_STAGE = WEAKNESS_MULTIPLIERS.length - 1;

export function weaknessMultiplier(stage: number): number {
  const clamped = Math.max(0, Math.min(WEAKNESS_MAX_STAGE, stage));
  return WEAKNESS_MULTIPLIERS[clamped];
}

/** 性技カードの効果（docs/02・08）。 */
export type SexEffect =
  | { kind: "qi_damage" } // 基本（与気力＋与我慢ダメージ）
  | { kind: "qi_defense_down"; amount: number } // ほぐし：敵の気力防御を低下
  | { kind: "heal_from_damage"; ratio: number } // 乳繰り：与ダメ依存でこゆきの我慢を回復（係数<1.0）
  | { kind: "atk_debuff"; amount: number } // くちづけ：敵の四十八手ダメージを低下
  | { kind: "double_defense_ref" } // 裏取り：敵の気力防御×2参照
  | { kind: "weaken_attr"; amount: number } // 精神デバフ：最後に当てた属性を弱化（汚し・主導権）
  | { kind: "guard_up"; amount: number } // またがり：こゆきの守りを上げる
  | { kind: "guard_down"; amount: number } // 後ろ取り：こゆきの守りを下げる（ハイリスク）
  | { kind: "targeted_finish"; gamanToEnemy: number; selfHpLoss?: number }; // 狙い撃ち射精：こゆき我慢を即0にし、能動射精で敵を崩す（selfHpLoss=この射精でこゆきが負うHP。フェラ/パイズリ等「自分の被ダメが大きい射精技」用。未指定は既定値）

/** 性技カード定義（docs/08 §2.6）。属性は裏管理。 */
export interface SexCardDef {
  id: string;
  name: string; // 表示名（属性は出さない）
  attrs: SexAttr[]; // 単一（基本8種）or 複合
  ap: number;
  baseQi: number; // カード基礎気力ダメージ
  target: "single" | "all";
  effects: SexEffect[];
  flavorKey?: string;
}

/** 魅了敵の行動（四十八手）。docs/02「四十八手」。被ダメージは「我慢」へ入る（守りで軽減）。 */
export type CharmEnemyEffect =
  | { kind: "gaman_attack"; amount: number } // こゆきの我慢を削る（四十八手の本体）
  | { kind: "apply_status"; status: string; x: number }; // 毒/出血/掴み（後続拡張）

export interface CharmIntentDef {
  id: string;
  label: string; // 行動予告テキスト
  icon: string;
  effects: CharmEnemyEffect[];
}

/** 魅了敵の定義（docs/08 §2.3 を魅了用に対応）。 */
export interface CharmEnemyDef {
  id: string;
  name: string;
  qi: number; // 気力（長期ゲージ。0で放心→とどめ可）
  gaman: number; // 我慢（短期ゲージ。0で絶頂）
  qiDefense: number; // 気力防御（与気力ダメージを実数値減算）
  /** 属性ごとの初期弱点段階（docs/02「名前持ちキャラの初期弱点段階」）。 */
  weakness: Record<SexAttr, number>;
  intents: CharmIntentDef[];
  /** お豊・モモコ等：撃破=救済者ではなく仲間加入（docs/05「加入イベント」）。 */
  joinCompanionId?: string;
}

/** 戦闘中の魅了敵個体。 */
export interface CharmEnemyInstance {
  uid: string;
  defId: string;
  name: string;
  qi: number;
  qiMax: number;
  gaman: number;
  gamanMax: number; // 絶頂のたびにわずかに減る（連続でイクほど早く崩れる）
  qiDefense: number;
  weakness: Record<SexAttr, number>; // 絶頂・射精で低下（可変）
  atkDebuff: number; // くちづけ累積（四十八手ダメージ軽減）
  lastHitAttr: SexAttr | null; // 直近に命中した属性（絶頂時の弱化部位判定用）
  intents: CharmIntentDef[];
  intentIndex: number;
  defeated: boolean; // 気力0で放心（戦線離脱）
}

/** こゆきの状態異常（魅了バトル中）。 */
export interface CharmStatusInstance {
  id: string;
  x: number;
  turns: number;
}

/** もう一本の刀（せっくすてく）。docs/02「せっくすてく」。 */
export interface SextechState {
  mi: number; // 身：威力＋我慢の強さ
  shinogi: number; // 鎬：威力＋守り
  kissaki: number; // 切先：守り＋我慢の強さ
}

export type CharmPhase = "player" | "enemy" | "won" | "lost";

export interface CharmBattleState {
  kind: "charm";
  enemies: CharmEnemyInstance[];
  hp: number;
  maxHp: number;
  gaman: number; // こゆきの我慢（短期。0で射精）
  gamanMax: number; // 射精のたびにわずかに減る
  ap: number;
  apMax: number;
  guard: number; // 守り（四十八手の我慢被ダメを軽減するプール。ターンで消費）
  sextech: SextechState;
  sextechPoints: number; // 未割り振りポイント
  lastActionWasEnemy: boolean; // 直近に我慢を0へ追い込んだのが敵か（射精の暴発/狙い撃ち判定）
  virgin: boolean; // 相手が処女か（初挿入専用台詞の出し分け用。初挿入で false に。docs/09 §4）
  statuses: CharmStatusInstance[];
  turn: number;
  phase: CharmPhase;
}

/** UI層が再生する魅了バトルのイベント列（描画方法は持たない）。 */
export type CharmEvent =
  | { type: "TurnStarted"; turn: number }
  | { type: "SexCardPlayed"; cardId: string }
  | { type: "QiDamageDealt"; enemyUid: string; amount: number; stage: number }
  | { type: "GamanDamageDealt"; enemyUid: string; amount: number } // 敵の我慢を削った
  | { type: "EnemyClimaxed"; enemyUid: string; attr: SexAttr | null; qiBonus: number } // 敵が絶頂
  | { type: "WeaknessDown"; enemyUid: string; attr: SexAttr; newStage: number } // 部位が1段弱化
  | { type: "QiDefenseDown"; enemyUid: string; amount: number }
  | { type: "AtkDebuffApplied"; enemyUid: string; amount: number }
  | { type: "GamanRecovered"; amount: number } // こゆきの我慢回復（乳繰り等）
  | { type: "KoyukiGamanDamaged"; amount: number; blocked: number } // こゆきの我慢を削られた
  | { type: "KoyukiGamanSelf"; amount: number } // 自分の攻めで我慢が高ぶった
  | { type: "Ejaculated"; trigger: "self" | "enemy"; attr: SexAttr | null; hpLoss: number; enemyUid: string | null } // こゆき射精
  | { type: "GuardChanged"; amount: number }
  | { type: "EnemyExhausted"; enemyUid: string } // 気力0で放心
  | { type: "SextechPointGained"; total: number }
  | { type: "TodomeReady"; enemyUid: string }
  | { type: "TodomeUsed"; enemyUid: string; first: boolean } // first=この とどめ（中出し）が初挿入＝処女喪失を兼ねる
  | { type: "CompanionJoined"; companionId: string }
  | { type: "EnemyActed"; enemyUid: string; intentId: string }
  | { type: "StatusApplied"; status: string; x: number }
  | { type: "WeaknessReaction"; enemyDefId: string; attr: SexAttr } // 弱点×2.0命中の固有リアクション
  | { type: "HitReaction"; enemyDefId: string; attr: SexAttr; first: boolean } // 性技命中の相手リアクション（first=初挿入専用 docs/09 §3・§4）
  | { type: "BattleWon" }
  | { type: "BattleLost" };
