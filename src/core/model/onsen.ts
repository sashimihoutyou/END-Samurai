// 温泉イベント（docs/05「温泉イベント」リメイク）。
// こゆきの入浴中に仲間／救済者が現れ、複数段の選択でセックスへ。
//  - 正しい選択を通し切る → 相手を先にイカせる → せっくすてく獲得（成功＝lead）。
//  - どこかで誤ると → たっぷりねっとり相互に達して全回復（indulgent）。懲罰はない。
// Core層の鉄則どおり、ここは型のみ（本文・数値は data/onsen.json へ外部化）。

import type { SextechState } from "./charm.js";

/** 出現条件：相手が誰として現れるか（加入仲間／救済したモブ）。 */
export type OnsenPartnerSource = "companion" | "rescued";

export interface OnsenChoice {
  labelKey: string; // 選択肢ラベル
  correct: boolean; // 相手を先へ追い込む正しい一手か
  resultKey: string; // 選択直後に出す短い反応テキスト
}

export interface OnsenStage {
  textKey: string; // この段のナレーション
  choices: OnsenChoice[];
}

export interface OnsenEvent {
  id: string;
  partnerId: string; // 相手（companion=otoyo/aoi、rescued=救済モブ）
  partnerSource: OnsenPartnerSource;
  introKey: string; // 導入ナレーション（string[]＝複数ページ可）
  stages: OnsenStage[]; // 会話＝行為の段（順に解決）
  rewardPart: keyof SextechState; // 成功時に伸びるせっくすてく部位（身/鎬/切先）
  rewardPoints: number; // 成功時のせっくすてく加算
  leadOutcomeKey: string; // 成功（相手を先にイカせた）テキスト
  indulgentOutcomeKey: string; // 失敗（ねっとり全回復）テキスト（string[]＝長文複数段）
}

/** 温泉シーンの結末（純粋関数 resolveOnsen の戻り値）。 */
export interface OnsenResult {
  outcome: "lead" | "indulgent";
  sextechPart?: keyof SextechState; // lead時に伸びる部位
  sextechGain: number; // lead時のせっくすてく加算（indulgentは0）
  fullHeal: boolean; // 全回復するか（温泉なので両結末で true）
}
