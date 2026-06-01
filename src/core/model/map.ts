// 固定手書きマップとイベントのモデル（docs/08 §2.7 マップ／§2.8 イベント）。
// α版は田舎1エリアの固定パターン（少数の分岐＋野営地＋ボス）を JSON で外部化し、
// App層（game.ts）がノードを辿って戦闘・とろかし・イベント・野営地・ボスへ分岐する。
// Core層の鉄則どおり、ここは型定義のみ（数値・接続はすべて data/map-inaka.json へ）。

export type NodeType =
  | "start" // 出立点（内容なし。next の選択だけを提示）
  | "battle" // 通常戦闘（HP戦）
  | "boss" // エリアボス（撃破でクリア）
  | "camp" // 野営地（お豊：刀の完全修繕＋小休息）
  | "rest" // 休息（HP回復のみ）
  | "charm_encounter" // とろかし遭遇（イベント経由でとろかし戦へ）
  | "event"; // 会話イベント（選択肢で分岐）

/** マップ1マス。type ごとに参照するペイロードが変わる（docs/08 §2.7）。 */
export interface MapNode {
  id: string;
  type: NodeType;
  /** マップ上の表示名／分岐タグ（docs/03「分岐タグ」）。 */
  label: string;
  /** 接続先ノードID（分岐）。空配列＝終端（ボス）。 */
  next: string[];
  /** ナレーション本文の参照キー（start/rest/camp/到着フレーバー）。 */
  textKey?: string;
  /** battle/boss：出現する敵ID配列（最大3体）。 */
  enemyGroup?: string[];
  /** event/charm_encounter：参照するイベントID。 */
  eventId?: string;
  /** rest：HP回復量。 */
  heal?: number;
}

export interface MapDef {
  area: string; // "inaka" 等
  entry: string; // 開始ノードID（type="start"）
  nodes: MapNode[];
}

/** イベントの選択結果（docs/08 §2.8 EventChoice.outcome）。 */
export type EventOutcome =
  | { kind: "start_charm_battle"; enemyId: string }
  | { kind: "start_normal_battle"; enemyGroup: string[] }
  | { kind: "heal"; amount: number }
  | { kind: "continue" }; // 何も起こさずマップへ戻る

export interface EventChoice {
  labelKey: string; // 選択肢ラベル（"とろかす…♡" 等）
  outcome: EventOutcome;
}

/** 会話イベント定義（docs/08 §2.8）。introKey はページ配列（text.json の string[]）。 */
export interface EventDef {
  id: string;
  kind: "charm_encounter" | "companion_join" | "rest" | "secret_nearmiss";
  introKey: string; // ナレーション（複数ページ）の参照キー
  choices: EventChoice[];
}
