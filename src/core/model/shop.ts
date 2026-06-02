// 野営地の施設（鍛冶屋・道場・行商人）とお豊の刀パーツ／葵の融合。
// docs/03「野営地」「経済システム」、docs/01「刀の状態段階」。
// データ駆動：在庫・価格・パーツ・融合レシピはすべて data/shops.json に外部化する。
// Core層の鉄則どおりここは型定義のみ（数値・接続はJSONへ）。

import type { SwordPart } from "./sword.js";

/** 施設の種別。
 * - buy: 買うだけ
 * - buy_sell: 買い＋売り（行商人）
 * - buy_fuse: 買い＋融合（道場・葵：2枚→1枚の閃き）
 * - smithy: 鍛冶屋（お豊）：消耗品の購入＋打ち直し・パーツ交換・パーツ購入 */
export type ShopKind = "buy" | "buy_sell" | "buy_fuse" | "smithy";

/** 1品目（カードIDと買値）。 */
export interface ShopStock {
  cardId: string;
  price: number; // 銭での買値
}

/** 1施設の定義。requiresCompanion 指定時、その仲間が同行していなければ利用不可（道場＝葵）。 */
export interface ShopDef {
  id: string;
  nameKey: string; // 施設名の参照キー（text.json）
  descKey: string; // 説明文の参照キー
  kind: ShopKind;
  stock: ShopStock[];
  requiresCompanion?: string;
}

/** お豊が買い付けてくる刀パーツ（良い刃・鍔・柄）。購入で所持品に加わり、付け替えで装備する。 */
export interface ShopPart {
  slot: SwordPart; // blade / tsuba / tsuka
  stageId: string; // その部位の段階ID（新品同様より上の良品を想定）
  price: number; // 銭での買値（現地で買い付けるため有料）
}

/** 葵の道場での融合レシピ：既存の型2枚を消費し、新しい技1枚を閃く（デッキ圧縮＋強化）。 */
export interface FusionRecipe {
  inputs: [string, string]; // 消費するカードのdefId（順不同。同IDの重複可）
  result: string; // 入手するカードのdefId
  flavorKey?: string; // 閃きのフレーバー（text.json）
}

/** 経済まわりの設定一式（売却レート＋施設群＋お豊のパーツ＋葵の融合）。 */
export interface ShopData {
  sellRatio: number; // 売値＝floor(カード価値 × sellRatio)
  parts: ShopPart[];
  fusions: FusionRecipe[];
  shops: ShopDef[];
}
