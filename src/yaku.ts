// 役判定（Phase 2）。設計: yaku-scoring-design.md。
// 入力の和了形に対し、全分解×待ち解釈を評価し、高点法（翻最大）で1つを採る。
// 符・点数は Phase 3（ここでは fu=null）。
import type { Counts, TileKind, Wind } from './types.js';
import { isYaochu, isHonor } from './tiles.js';
import { isChiitoitsu, isKokushi } from './win.js';
import {
  decomposeStandard,
  interpretWaits,
  type ParsedMeld,
  type Interpretation,
  type WaitType,
} from './decompose.js';
import { DEFAULT_RULE, type RuleConfig } from './rule.js';

export interface CalledMeld {
  type: 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan';
  tile: TileKind; // chi: 最小牌, その他: 構成牌
}

export interface WinInput {
  /** 純手牌の枚数ベクトル（和了牌を含む）。長さ34。副露牌は含めない。 */
  concealed: Counts;
  called?: CalledMeld[];
  winTile: TileKind;
  byTsumo: boolean;
  seatWind: Wind;
  roundWind: Wind;
  riichi?: boolean;
  doubleRiichi?: boolean;
  ippatsu?: boolean;
  rinshan?: boolean; // 嶺上開花（ツモ）
  chankan?: boolean; // 槍槓（ロン）
  haitei?: boolean; // 海底摸月（ツモ）
  houtei?: boolean; // 河底撈魚（ロン）
  tenhou?: boolean; // 天和
  chiihou?: boolean; // 地和
  doraIndicators?: TileKind[];
  uraIndicators?: TileKind[];
  redCount?: number; // 赤ドラ枚数（手牌+副露）
  rule?: RuleConfig;
}

export interface YakuHan {
  name: string;
  han: number;
}

export interface WinResult {
  yaku: YakuHan[]; // 通常役（役満成立時は空）
  yakuman: YakuHan[]; // 役満（han に倍数 1 or 2）
  yakumanTotal: number; // 役満倍数合計（0=非役満）
  han: number; // 通常時の翻合計（役+ドラ）。役満時は 0
  fu: number | null; // Phase 3
  dora: { dora: number; aka: number; ura: number };
  menzen: boolean;
  waitType: WaitType;
}

const WIND_KIND: Record<Wind, TileKind> = { E: 27, S: 28, W: 29, N: 30 };
const DRAGONS: readonly TileKind[] = [31, 32, 33];
const WINDS: readonly TileKind[] = [27, 28, 29, 30];
const GREEN: readonly TileKind[] = [19, 20, 21, 23, 25, 32]; // 2s3s4s6s8s 發

function meldTiles(m: ParsedMeld): TileKind[] {
  if (m.kind === 'shuntsu') return [m.tile, m.tile + 1, m.tile + 2];
  return Array(m.kind === 'kantsu' ? 4 : 3).fill(m.tile);
}
const isTriplet = (m: ParsedMeld) => m.kind === 'kotsu' || m.kind === 'kantsu';

function calledToParsed(c: CalledMeld): ParsedMeld {
  switch (c.type) {
    case 'chi':
      return { kind: 'shuntsu', tile: c.tile, concealed: false, fromCall: true };
    case 'pon':
      return { kind: 'kotsu', tile: c.tile, concealed: false, fromCall: true };
    case 'minkan':
    case 'kakan':
      return { kind: 'kantsu', tile: c.tile, concealed: false, fromCall: true };
    case 'ankan':
      return { kind: 'kantsu', tile: c.tile, concealed: true, fromCall: true };
  }
}

function buildUsed(counts: Counts, called: CalledMeld[]): Counts {
  const used = counts.slice();
  for (const c of called) for (const t of meldTiles(calledToParsed(c))) used[t]++;
  return used;
}

function doraOf(ind: TileKind): TileKind {
  if (ind < 27) {
    const s = Math.floor(ind / 9);
    const n = ind % 9;
    return s * 9 + ((n + 1) % 9);
  }
  if (ind < 31) return 27 + ((ind - 27 + 1) % 4);
  return 31 + ((ind - 31 + 1) % 3);
}
function countDora(used: Counts, indicators: TileKind[]): number {
  let n = 0;
  for (const ind of indicators) n += used[doraOf(ind)];
  return n;
}

interface StructuralResult {
  yaku: YakuHan[];
  yakuman: YakuHan[];
}

/** 1つの解釈（4面子+雀頭+待ち）に対する構造的な役（文脈非依存）を判定する。 */
function detectStructural(
  interp: Interpretation,
  used: Counts,
  menzen: boolean,
  input: WinInput,
  rule: RuleConfig,
): StructuralResult {
  const { melds, pair, waitType } = interp;
  const yaku: YakuHan[] = [];
  const yakuman: YakuHan[] = [];
  const han = (name: string, h: number) => yaku.push({ name, han: h });
  const ym = (name: string, mult: number) =>
    yakuman.push({ name, han: rule.doubleYakuman ? mult : 1 });

  const shuntsu = melds.filter((m) => m.kind === 'shuntsu');
  const triplets = melds.filter(isTriplet);
  const kantsuCount = melds.filter((m) => m.kind === 'kantsu').length;
  const concealedTriplets = triplets.filter((m) => m.concealed).length;
  const dragonTriplets = triplets.filter((m) => DRAGONS.includes(m.tile)).length;
  const windTriplets = triplets.filter((m) => WINDS.includes(m.tile)).length;

  // --- 役満（構造）---
  if (windTriplets === 4) ym('大四喜', 2);
  else if (windTriplets === 3 && WINDS.includes(pair)) ym('小四喜', 1);
  if (dragonTriplets === 3) ym('大三元', 1);
  if (concealedTriplets === 4) ym(waitType === 'tanki' ? '四暗刻単騎' : '四暗刻', waitType === 'tanki' ? 2 : 1);
  if (kantsuCount === 4) ym('四槓子', 1);

  const presentKinds: TileKind[] = [];
  for (let k = 0; k < 34; k++) if (used[k] > 0) presentKinds.push(k);
  const allHonor = presentKinds.every((k) => k >= 27);
  const allTerminalNum = presentKinds.every((k) => k < 27 && (k % 9 === 0 || k % 9 === 8));
  const allYaochu = presentKinds.every((k) => isYaochu(k));
  if (allHonor) ym('字一色', 1);
  if (allTerminalNum) ym('清老頭', 1);
  if (presentKinds.every((k) => GREEN.includes(k))) ym('緑一色', 1);

  // 九蓮宝燈（門前清一色で 1112345678999 + 1）
  if (menzen) {
    const suits = new Set(presentKinds.filter((k) => k < 27).map((k) => Math.floor(k / 9)));
    if (suits.size === 1 && !presentKinds.some((k) => k >= 27)) {
      const base = [...suits][0] * 9;
      const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      let chuuren = true;
      for (let i = 0; i < 9; i++) if (used[base + i] < need[i]) chuuren = false;
      if (chuuren) {
        // 純正（待ち前が 1112345678999）なら double
        const pure = used[base + (input.winTile % 9)] - need[input.winTile % 9] === 1 &&
          input.winTile >= base && input.winTile < base + 9;
        ym(pure ? '純正九蓮宝燈' : '九蓮宝燈', pure ? 2 : 1);
      }
    }
  }

  if (yakuman.length > 0) return { yaku: [], yakuman };

  // --- 通常役 ---
  const seatK = WIND_KIND[input.seatWind];
  const roundK = WIND_KIND[input.roundWind];
  const pairIsYakuhai = DRAGONS.includes(pair) || pair === seatK || pair === roundK;

  // 役牌
  for (const m of triplets) {
    if (DRAGONS.includes(m.tile)) han(`役牌(${['白', '發', '中'][m.tile - 31]})`, 1);
  }
  if (triplets.some((m) => m.tile === roundK)) han('場風', 1);
  if (triplets.some((m) => m.tile === seatK)) han('自風', 1);

  // 小三元（大三元は役満で除外済み）
  if (dragonTriplets === 2 && DRAGONS.includes(pair)) han('小三元', 2);

  // 断么九
  if (presentKinds.every((k) => !isYaochu(k))) {
    if (menzen || rule.kuitan) han('断么九', 1);
  }

  // 平和
  if (menzen && shuntsu.length === 4 && !pairIsYakuhai && waitType === 'ryanmen') {
    han('平和', 1);
  }

  // 一盃口 / 二盃口（門前）
  if (menzen) {
    const bySeq = new Map<number, number>();
    for (const m of shuntsu) bySeq.set(m.tile, (bySeq.get(m.tile) ?? 0) + 1);
    let pairs = 0;
    for (const c of bySeq.values()) pairs += Math.floor(c / 2);
    if (pairs === 2) han('二盃口', 3);
    else if (pairs === 1) han('一盃口', 1);
  }

  // 三色同順
  {
    const bySuit: Set<number>[] = [new Set(), new Set(), new Set()];
    for (const m of shuntsu) bySuit[Math.floor(m.tile / 9)].add(m.tile % 9);
    if ([...bySuit[0]].some((x) => bySuit[1].has(x) && bySuit[2].has(x))) {
      han('三色同順', menzen ? 2 : 1);
    }
  }
  // 一気通貫
  {
    const bySuit: Set<number>[] = [new Set(), new Set(), new Set()];
    for (const m of shuntsu) bySuit[Math.floor(m.tile / 9)].add(m.tile % 9);
    if (bySuit.some((s) => s.has(0) && s.has(3) && s.has(6))) {
      han('一気通貫', menzen ? 2 : 1);
    }
  }
  // 三色同刻
  {
    const bySuit: Set<number>[] = [new Set(), new Set(), new Set()];
    for (const m of triplets) if (m.tile < 27) bySuit[Math.floor(m.tile / 9)].add(m.tile % 9);
    if ([...bySuit[0]].some((x) => bySuit[1].has(x) && bySuit[2].has(x))) han('三色同刻', 2);
  }

  // 対々和（役満の四暗刻でない場合）
  if (shuntsu.length === 0) han('対々和', 2);
  // 三暗刻（2翻）
  if (concealedTriplets === 3) han('三暗刻', 2);
  // 三槓子
  if (kantsuCount === 3) han('三槓子', 2);

  // 混老頭（全て么九・字牌混在。字一色/清老頭は役満で除外済み）
  if (allYaochu && shuntsu.length === 0) han('混老頭', 2);

  // 全帯么九 / 純全帯么九（順子を含む場合のみ）
  if (shuntsu.length > 0) {
    const setHasYaochu = (m: ParsedMeld) =>
      m.kind === 'shuntsu' ? m.tile % 9 === 0 || m.tile % 9 === 6 : isYaochu(m.tile);
    const allSetsYaochu = melds.every(setHasYaochu) && isYaochu(pair);
    if (allSetsYaochu) {
      const hasHonor = melds.some((m) => isHonor(m.tile)) || isHonor(pair);
      if (hasHonor) han('混全帯么九', menzen ? 2 : 1);
      else han('純全帯么九', menzen ? 3 : 2);
    }
  }

  // 混一色 / 清一色
  {
    const suits = new Set(presentKinds.filter((k) => k < 27).map((k) => Math.floor(k / 9)));
    const hasHonor = presentKinds.some((k) => k >= 27);
    if (suits.size === 1) {
      if (hasHonor) han('混一色', menzen ? 3 : 2);
      else han('清一色', menzen ? 6 : 5);
    }
  }

  return { yaku, yakuman };
}

function sumHan(list: YakuHan[]): number {
  return list.reduce((a, b) => a + b.han, 0);
}

/** 七対子の役判定（門前固定・単騎）。 */
function detectChiitoitsu(used: Counts, input: WinInput, rule: RuleConfig): StructuralResult {
  const yaku: YakuHan[] = [{ name: '七対子', han: 2 }];
  const yakuman: YakuHan[] = [];
  const present: TileKind[] = [];
  for (let k = 0; k < 34; k++) if (used[k] > 0) present.push(k);

  if (present.every((k) => k >= 27)) {
    return { yaku: [], yakuman: [{ name: '字一色', han: rule.doubleYakuman ? 1 : 1 }] };
  }
  if (present.every((k) => !isYaochu(k))) yaku.push({ name: '断么九', han: 1 });
  if (present.every((k) => isYaochu(k))) yaku.push({ name: '混老頭', han: 2 });

  const suits = new Set(present.filter((k) => k < 27).map((k) => Math.floor(k / 9)));
  const hasHonor = present.some((k) => k >= 27);
  if (suits.size === 1) {
    if (hasHonor) yaku.push({ name: '混一色', han: 3 });
    else yaku.push({ name: '清一色', han: 6 });
  }
  return { yaku, yakuman };
}

/** 文脈役（分解非依存）。menzen と byTsumo に依存。 */
function contextYaku(input: WinInput, menzen: boolean): StructuralResult {
  const yaku: YakuHan[] = [];
  const yakuman: YakuHan[] = [];
  if (input.tenhou) yakuman.push({ name: '天和', han: 1 });
  if (input.chiihou) yakuman.push({ name: '地和', han: 1 });
  if (yakuman.length) return { yaku: [], yakuman };

  if (input.doubleRiichi) yaku.push({ name: 'ダブル立直', han: 2 });
  else if (input.riichi) yaku.push({ name: '立直', han: 1 });
  if (input.ippatsu) yaku.push({ name: '一発', han: 1 });
  if (menzen && input.byTsumo) yaku.push({ name: '門前清自摸和', han: 1 });
  if (input.rinshan && input.byTsumo) yaku.push({ name: '嶺上開花', han: 1 });
  if (input.chankan && !input.byTsumo) yaku.push({ name: '槍槓', han: 1 });
  if (input.haitei && input.byTsumo) yaku.push({ name: '海底摸月', han: 1 });
  if (input.houtei && !input.byTsumo) yaku.push({ name: '河底撈魚', han: 1 });
  return { yaku, yakuman };
}

/**
 * 和了形を評価し、役・翻・ドラを返す。役なし（ドラのみ）なら null。
 * 符・点数は Phase 3。
 */
export function evaluateWin(input: WinInput): WinResult | null {
  const rule = input.rule ?? DEFAULT_RULE;
  const called = input.called ?? [];
  const calledParsed = called.map(calledToParsed);
  const menzen = called.every((c) => c.type === 'ankan');
  const used = buildUsed(input.concealed, called);

  const dora = {
    dora: countDora(used, input.doraIndicators ?? []),
    aka: input.redCount ?? 0,
    ura: input.riichi || input.doubleRiichi ? countDora(used, input.uraIndicators ?? []) : 0,
  };
  const doraHan = dora.dora + dora.aka + dora.ura;

  const ctx = contextYaku(input, menzen);

  // --- 国士無双（門前・副露なし）---
  if (called.length === 0 && isKokushi(input.concealed)) {
    const thirteen =
      input.concealed[input.winTile] === 2; // 和了牌が雀頭側＝13面待ち
    return {
      yaku: [],
      yakuman: [{ name: thirteen && rule.doubleYakuman ? '国士無双十三面' : '国士無双', han: thirteen && rule.doubleYakuman ? 2 : 1 }],
      yakumanTotal: thirteen && rule.doubleYakuman ? 2 : 1,
      han: 0,
      fu: null,
      dora,
      menzen,
      waitType: 'tanki',
    };
  }

  type Cand = { yaku: YakuHan[]; yakuman: YakuHan[]; waitType: WaitType };
  const cands: Cand[] = [];

  // --- 七対子 ---
  if (called.length === 0 && isChiitoitsu(input.concealed)) {
    const r = detectChiitoitsu(used, input, rule);
    cands.push({ ...r, waitType: 'tanki' });
  }

  // --- 標準形（全分解 × 待ち解釈）---
  const neededMelds = 4 - called.length;
  for (const dec of decomposeStandard(input.concealed, neededMelds)) {
    const interps = interpretWaits(dec.melds, dec.pair, calledParsed, input.winTile, !input.byTsumo);
    for (const interp of interps) {
      const r = detectStructural(interp, used, menzen, input, rule);
      cands.push({ ...r, waitType: interp.waitType });
    }
  }

  if (cands.length === 0) return null; // 和了形でない

  // 文脈役を各候補に合算してから高点法で選ぶ
  const scored = cands.map((c) => {
    if (ctx.yakuman.length || c.yakuman.length) {
      const yakuman = [...c.yakuman, ...ctx.yakuman];
      return { c, yakuman, yaku: [] as YakuHan[], score: 100000 + sumHan(yakuman) };
    }
    const yaku = [...c.yaku, ...ctx.yaku];
    return { c, yakuman: [] as YakuHan[], yaku, score: sumHan(yaku) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // 役なし（ドラのみ）は和了不可
  if (best.yakuman.length === 0 && best.yaku.length === 0) return null;

  if (best.yakuman.length > 0) {
    return {
      yaku: [],
      yakuman: best.yakuman,
      yakumanTotal: sumHan(best.yakuman),
      han: 0,
      fu: null,
      dora,
      menzen,
      waitType: best.c.waitType,
    };
  }
  return {
    yaku: best.yaku,
    yakuman: [],
    yakumanTotal: 0,
    han: sumHan(best.yaku) + doraHan,
    fu: null,
    dora,
    menzen,
    waitType: best.c.waitType,
  };
}
