// 通常戦闘（HP戦）の状態異常モデル。docs/01「状態異常」に対応。
// 数値（毒X=1・出血X=3 等）は data 側に持ち、ここでは型のみ定義する。
//
//  - 毒（poison）  ：毎ターンAPをX低下（こゆき側の行動リソース攻撃。docs/01「毒＝実質こゆき専用」）。
//  - 出血（bleed） ：ターン終了時にXダメージ＋Xを半減（防御無視DoT）。こゆき・敵の双方に付与可。
//  - 気絶（stun）  ：次の自分の行動を1回スキップ。
//  - 掴み（grab）  ：既存の grabbedBy 機構で別途処理（StatusInstance では扱わない）。

export type StatusId = "poison" | "bleed" | "stun";

/** 状態異常の個体（こゆき側／敵側それぞれが配列で保持）。 */
export interface StatusInstance {
  id: StatusId;
  x: number; // 強度（毒=AP低下量／出血=DoT量）
  turns: number; // 残り持続ターン（毒など。出血は x の自然減衰で消える）
}
