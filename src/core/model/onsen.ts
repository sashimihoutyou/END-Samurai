// 温泉イベント（docs/05「温泉イベント」リメイク）。
// こゆきの入浴中に仲間／救済者が現れ、5段の選択でセックスへ。中断はなく必ず完走する。
//  - 各段で相手の「好み」に近い手を選ぶほど加点（favorite=2 / acceptable=1 / off=0）。
//  - 反応テキストの濃淡で好みを暗示する（メタな説明はしない）。
//  - 合計が閾値以上 → 相手が気絶するまで絶頂、こゆきが自信と経験を積む（lead）。
//  - 閾値未満 → 攻守逆転し、お豊（相手）主導でこゆきが蕩かされる（indulgent）。
//  - せっくすてく獲得はスコア比例（floor(score / rewardDivisor)）。いずれも温泉ゆえ全回復。
// Core層の鉄則どおり、ここは型のみ（本文・数値は data/onsen.json へ外部化）。

import type { SextechState } from "./charm.js";

/** 出現条件：相手が誰として現れるか（加入仲間／救済したモブ）。 */
export type OnsenPartnerSource = "companion" | "rescued";

export interface OnsenChoice {
  labelKey: string; // 選択肢ラベル（行為の選択）
  score: number; // この相手がどれだけ好むか（0=off / 1=acceptable / 2=favorite）
  resultKey: string; // 選択後に出す行為＋反応テキスト（濃淡で好みを暗示）
  tag?: string; // 性感補正タグ（例 "foreplay" / "cowgirl" / "anal"）。event.multipliers と対応。
}

export interface OnsenStage {
  textKey: string; // この段の問いかけ（どう始める／何をする 等）
  choices: OnsenChoice[];
}

export interface OnsenEvent {
  id: string;
  partnerId: string; // 相手（companion=otoyo/aoi、rescued=救済モブ）
  partnerSource: OnsenPartnerSource;
  introKey: string; // 導入ナレーション（string[]＝複数ページ可）
  stages: OnsenStage[]; // 5段の行為（順に解決・中断なし）
  threshold: number; // lead に必要な合計スコア
  rewardPart: keyof SextechState; // 伸びるせっくすてく部位（身/鎬/切先）
  rewardDivisor: number; // せっくすてく加算 = floor(totalScore / rewardDivisor)
  leadOutcomeKey: string; // 成功（気絶絶頂・自信と経験）テキスト（string[]）
  indulgentOutcomeKey: string; // 未達（攻守逆転・全回復）テキスト（string[]）
  multipliers?: Record<string, number>; // 性感補正（タグ→倍率）。例 葵: {foreplay:2, cowgirl:1.5, anal:1.5}
  minRescued?: number; // partnerSource="rescued" 時、出現に必要な救済人数（既定1。複数人=2）
}

/** 温泉シーンの結末（純粋関数 resolveOnsen の戻り値）。 */
export interface OnsenResult {
  outcome: "lead" | "indulgent";
  score: number; // 合計スコア
  sextechPart: keyof SextechState; // 伸びる部位
  sextechGain: number; // せっくすてく加算（スコア比例）
  fullHeal: boolean; // 全回復＋刀打ち直しか（lead のみ true。indulgent は部分回復）。docs/10
}

