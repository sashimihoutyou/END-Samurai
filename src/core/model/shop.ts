// 野営地の施設（鍛冶屋・道場・行商人）の品揃え。docs/03「野営地」「経済システム」。
// データ駆動：在庫・価格・売却レートはすべて data/shops.json に外部化する。
// Core層の鉄則どおりここは型定義のみ（数値・接続はJSONへ）。

/** 施設の種別。買うだけ／買い＋売り／買い＋デッキ圧縮（道場の「忘れる」）。 */
export type ShopKind = "buy" | "buy_sell" | "buy_forget";

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

/** 経済まわりの設定一式（売却レート＋施設群）。 */
export interface ShopData {
  sellRatio: number; // 売値＝floor(カード価値 × sellRatio)
  shops: ShopDef[];
}
