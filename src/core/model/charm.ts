// 魅了バトル（とろかし）のモデル。docs/02「魅了バトル」/ docs/08「§2.6 性技カード」「§3.2 BattleState（charm）」に対応。
// 通常戦闘（HP戦）とは完全に独立した別レイヤー（docs/02「位置づけと基本思想」）。
// 数値モデルは rules/charm-damage.ts に集約し、本ファイルは型のみを定義する（値はハードコードしない）。

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
/** 同属性をこの回数当てると弱点段階が1上がる（docs/02「開発システム」）。 */
export const DEVELOP_HITS_PER_STAGE = 3;

export function weaknessMultiplier(stage: number): number {
  const clamped = Math.max(0, Math.min(WEAKNESS_MAX_STAGE, stage));
  return WEAKNESS_MULTIPLIERS[clamped];
}

/** 性技カードの効果（docs/08 §2.6 SexEffect ＋ 守り増減）。 */
export type SexEffect =
  | { kind: "qi_damage" } // 基本（与気力ダメージ）
  | { kind: "qi_defense_down"; amount: number } // ほぐし：敵の気力防御を低下
  | { kind: "heal_from_damage"; ratio: number } // 乳繰り：与ダメ依存でこゆきHP回復（係数<1.0）
  | { kind: "atk_debuff"; amount: number } // くちづけ：敵の四十八手ダメージを低下
  | { kind: "double_defense_ref" } // 裏取り：敵の気力防御×2参照
  | { kind: "all_stats_down"; amount: number } // 裏取り貫通時：全ステダウン
  | { kind: "guard_up"; amount: number } // またがり：こゆきの守りを上げる
  | { kind: "guard_down"; amount: number }; // 後ろ取り：こゆきの守りを下げる（ハイリスク）

/** 性技カード定義（docs/08 §2.6）。属性は裏管理。 */
export interface SexCardDef {
  id: string;
  name: string; // 表示名（属性は出さない）
  attrs: SexAttr[]; // 単一（基本8種）or 複合（α対象外）
  ap: number;
  baseQi: number; // カード基礎気力ダメージ
  target: "single" | "all";
  effects: SexEffect[];
  developable: boolean; // 単体技=true（開発の主役）/ 複合・複数技=false
  flavorKey?: string;
}

/** 魅了敵の行動（四十八手）。docs/02「四十八手」。 */
export type CharmEnemyEffect =
  | { kind: "damage"; amount: number } // こゆきへのダメージ
  | { kind: "apply_status"; status: string; x: number } // 毒/出血/掴み（Phase後続で拡張）
  | { kind: "self_climax"; qi: number }; // 絶頂：自身の気力を消費して行動をパス

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
  qi: number; // 気力（HPバーではなく気力ゲージ）
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
  qiDefense: number;
  weakness: Record<SexAttr, number>; // 開発で上昇（可変）
  development: Record<SexAttr, number>; // 属性ごとの命中回数
  atkDebuff: number; // くちづけ累積（四十八手ダメージ軽減）
  allStatsDown: number; // 裏取り貫通の全ステダウン累積
  intents: CharmIntentDef[];
  intentIndex: number;
  defeated: boolean; // 気力0で痙攣放置（戦線離脱）
}

/** こゆきの状態異常（魅了バトル中）。 */
export interface CharmStatusInstance {
  id: string;
  x: number;
  turns: number;
}

/** もう一本の刀（せっくすてく）。docs/02「せっくすてく」。 */
export interface SextechState {
  mi: number; // 身：威力＋連撃
  shinogi: number; // 鎬：防御＋威力
  kissaki: number; // 切先：連撃＋防御
}

export type CharmPhase = "player" | "enemy" | "won" | "lost";

export interface CharmBattleState {
  kind: "charm";
  enemies: CharmEnemyInstance[];
  hp: number;
  maxHp: number;
  ap: number;
  apMax: number;
  guard: number; // 守り（ターンで消費する四十八手ダメージ軽減プール）
  sextech: SextechState;
  sextechPoints: number; // 未割り振りポイント
  tedomeHits: number; // 「突いた回数」（とどめ！の上乗せ）
  statuses: CharmStatusInstance[];
  turn: number;
  phase: CharmPhase;
}

/** UI層が再生する魅了バトルのイベント列（描画方法は持たない）。 */
export type CharmEvent =
  | { type: "TurnStarted"; turn: number }
  | { type: "SexCardPlayed"; cardId: string }
  | { type: "QiDamageDealt"; enemyUid: string; amount: number; stage: number; developable: boolean }
  | { type: "DevelopmentUp"; enemyUid: string; attr: SexAttr; newStage: number }
  | { type: "QiDefenseDown"; enemyUid: string; amount: number }
  | { type: "AtkDebuffApplied"; enemyUid: string; amount: number }
  | { type: "AllStatsDown"; enemyUid: string; amount: number }
  | { type: "Healed"; amount: number }
  | { type: "GuardChanged"; amount: number }
  | { type: "EnemyClimaxed"; enemyUid: string } // 気力0で離脱
  | { type: "SextechPointGained"; total: number }
  | { type: "TodomeReady"; enemyUid: string }
  | { type: "TodomeUsed"; enemyUid: string; finisher: boolean }
  | { type: "CompanionJoined"; companionId: string }
  | { type: "EnemyActed"; enemyUid: string; intentId: string }
  | { type: "KoyukiDamaged"; amount: number; blocked: number }
  | { type: "StatusApplied"; status: string; x: number }
  | { type: "WeaknessReaction"; enemyDefId: string; attr: SexAttr } // 弱点×2.0命中の固有リアクション
  | { type: "BattleWon" }
  | { type: "BattleLost" };
