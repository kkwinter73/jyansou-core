// 符計算（Phase 3）。設計: yaku-scoring-design.md。
import type { TileKind, Wind } from './types.js';
import { isYaochu } from './tiles.js';
import type { ParsedMeld, WaitType } from './decompose.js';

const DRAGONS: readonly TileKind[] = [31, 32, 33];
const WIND_KIND: Record<Wind, TileKind> = { E: 27, S: 28, W: 29, N: 30 };

export interface FuInput {
  melds: ParsedMeld[]; // 全4面子
  pair: TileKind;
  waitType: WaitType;
  byTsumo: boolean;
  menzen: boolean;
  seatWind: Wind;
  roundWind: Wind;
  pinfu: boolean;
  chiitoitsu: boolean;
}

/** 符を計算（10符単位に切り上げ済み）。七対子=25、平和は20(ツモ)/30(ロン)。 */
export function computeFu(a: FuInput): number {
  if (a.chiitoitsu) return 25;
  if (a.pinfu) return a.byTsumo ? 20 : 30;

  let fu = 20; // 副底
  if (a.menzen && !a.byTsumo) fu += 10; // 門前ロン加符
  if (a.byTsumo) fu += 2; // ツモ符

  for (const m of a.melds) {
    if (m.kind === 'kotsu') {
      const yao = isYaochu(m.tile);
      fu += m.concealed ? (yao ? 8 : 4) : yao ? 4 : 2;
    } else if (m.kind === 'kantsu') {
      const yao = isYaochu(m.tile);
      fu += m.concealed ? (yao ? 32 : 16) : yao ? 16 : 8;
    }
  }

  // 雀頭（役牌。連風牌は 2+2=4）
  const seatK = WIND_KIND[a.seatWind];
  const roundK = WIND_KIND[a.roundWind];
  if (DRAGONS.includes(a.pair)) fu += 2;
  if (a.pair === seatK) fu += 2;
  if (a.pair === roundK) fu += 2;

  // 待ち
  if (a.waitType === 'kanchan' || a.waitType === 'penchan' || a.waitType === 'tanki') fu += 2;

  fu = Math.ceil(fu / 10) * 10;
  // 非平和の最低符は30（喰い平和形ロンの20符を含めて繰り上げ）
  return Math.max(fu, 30);
}
