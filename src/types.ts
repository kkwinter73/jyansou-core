// 共有型。ドメイン設計は docs-hub/docs/design/core-domain-design.md を参照。

/** 牌種 0..33。数牌は数字順、字牌は風→三元。 */
export type TileKind = number;

export type Suit = 'm' | 'p' | 's' | 'z'; // z = 字牌(honor)

/** 起家からの相対席。 */
export type Seat = 0 | 1 | 2 | 3;

export type Wind = 'E' | 'S' | 'W' | 'N';

/** 物理牌（牌山の1枚）。赤ドラ識別のため red と一意 id を持つ。 */
export interface Tile {
  kind: TileKind; // 0..33
  red: boolean; // 赤5 (aka dora)
  id: number; // 0..135 一意
}

/** 枚数ベクトル: 長さ34、各種の枚数(0..4)。和了判定/向聴計算のコア表現。 */
export type Counts = number[];

export const NUM_KINDS = 34;
export const TILES_PER_KIND = 4;
