/**
 * 游戏核心计算：产量、价格、境界、飞升结算、时间推进。
 *
 * 这里的所有函数都是「纯函数」—— 传入 state，返回结果，不修改传入对象。
 * 好处是可以直接拿到 Node 里跑数值模拟（见 tools/simulate.mjs）。
 */
import Decimal, { D } from './decimal';
import {
  ASCENSION_MIN_REALM,
  DAO_YUN_BONUS,
  DAO_YUN_DIVISOR,
  DAO_YUN_EXPONENT,
  FINAL_REALM_INDEX,
  GENERATORS,
  MEDITATE_MIN_QI,
  MEDITATE_SECONDS,
  REALMS,
  RESOURCE_IDS,
  type GeneratorDef,
  type RealmDef,
  type ResourceId,
} from './content';
import type { GameState, ResourceMap } from './state';

export type CostMap = Partial<Record<ResourceId, Decimal>>;

/* ------------------------------------------------------------------ */
/* 全局倍率                                                            */
/* ------------------------------------------------------------------ */

export function getRealm(state: GameState): RealmDef {
  return REALMS[Math.min(state.realmIndex, FINAL_REALM_INDEX)];
}

export function isFinalRealm(state: GameState): boolean {
  return state.realmIndex >= FINAL_REALM_INDEX;
}

/** 境界本身带来的倍率 × 小境界层数的加成 */
export function getRealmMultiplier(state: GameState): Decimal {
  const realm = getRealm(state);
  return D(realm.realmMultiplier).mul(1 + realm.layerBonus * state.layer);
}

/** 道韵带来的永久倍率：每点 +5% */
export function getDaoYunMultiplier(state: GameState): Decimal {
  return D(1).add(state.daoYun.mul(DAO_YUN_BONUS));
}

/** 总倍率，所有产量都要乘它 */
export function getGlobalMultiplier(state: GameState): Decimal {
  return getRealmMultiplier(state).mul(getDaoYunMultiplier(state));
}

/* ------------------------------------------------------------------ */
/* 产量                                                                */
/* ------------------------------------------------------------------ */

export function getProduction(state: GameState): ResourceMap {
  const mult = getGlobalMultiplier(state);
  const out = {} as ResourceMap;
  for (const id of RESOURCE_IDS) out[id] = D(0);

  for (const def of GENERATORS) {
    const count = state.generators[def.id] ?? 0;
    if (count <= 0) continue;
    out[def.produces] = out[def.produces].add(D(count).mul(def.baseOutput).mul(mult));
  }
  return out;
}

/** 单个设施显示用的每秒产量（已计入全局倍率） */
export function getGeneratorOutput(state: GameState, def: GeneratorDef): Decimal {
  const count = state.generators[def.id] ?? 0;
  return D(count).mul(def.baseOutput).mul(getGlobalMultiplier(state));
}

/* ------------------------------------------------------------------ */
/* 价格                                                                */
/* ------------------------------------------------------------------ */

/**
 * 买 count 个设施的总价。
 * 价格是等比数列：第 n 个的价格 = baseCost * growth^n，
 * 所以用等比数列求和公式一次算完，不用循环。
 */
export function getCost(def: GeneratorDef, owned: number, count: number): CostMap {
  const out: CostMap = {};
  for (const [key, base] of Object.entries(def.baseCost) as [ResourceId, number][]) {
    out[key] = Decimal.sumGeometricSeries(count, base, def.costGrowth, owned);
  }
  return out;
}

export function canAfford(cost: CostMap, resources: ResourceMap): boolean {
  return Object.entries(cost).every(([key, value]) => resources[key as ResourceId].gte(value as Decimal));
}

/** 当前资源最多能买几个（取所有材料里最紧俏的那个） */
export function maxAffordable(def: GeneratorDef, owned: number, resources: ResourceMap): number {
  let max = Infinity;
  for (const [key, base] of Object.entries(def.baseCost) as [ResourceId, number][]) {
    const n = Decimal.affordGeometricSeries(resources[key], base, def.costGrowth, owned).floor().toNumber();
    max = Math.min(max, n);
  }
  if (!Number.isFinite(max)) return 0;
  // 上限只是为了防止极端情况下 toNumber 溢出成 Infinity
  return Math.max(0, Math.min(Math.floor(max), 1e9));
}

export function isUnlocked(def: GeneratorDef, state: GameState): boolean {
  return Object.entries(def.unlock).every(([key, amount]) =>
    state.resources[key as ResourceId].gte(amount as number),
  );
}

/* ------------------------------------------------------------------ */
/* 境界                                                                */
/* ------------------------------------------------------------------ */

/** 参悟下一层小境界需要的灵气；已满层则返回 null */
export function getLayerCost(state: GameState): Decimal | null {
  const realm = getRealm(state);
  if (state.layer >= realm.layerCount) return null;
  return D(realm.baseLayerCost).mul(Decimal.pow(realm.costGrowth, state.layer));
}

export function canAdvanceLayer(state: GameState): boolean {
  const cost = getLayerCost(state);
  return cost !== null && state.resources.qi.gte(cost);
}

export interface BreakthroughStatus {
  possible: boolean;
  /** 不能突破的原因，用于界面提示 */
  reason: string | null;
}

export function getBreakthroughStatus(state: GameState): BreakthroughStatus {
  const realm = getRealm(state);
  if (isFinalRealm(state)) return { possible: false, reason: '已至修行尽头' };
  if (state.layer < realm.layerCount) return { possible: false, reason: '须先参悟圆满本境界所有小境界' };
  if (state.resources.qi.lt(realm.breakthroughQi)) return { possible: false, reason: '灵气不足' };
  if (state.resources.pill.lt(realm.breakthroughPills)) return { possible: false, reason: '丹药不足' };
  return { possible: true, reason: null };
}

/* ------------------------------------------------------------------ */
/* 飞升                                                                */
/* ------------------------------------------------------------------ */

export function canAscend(state: GameState): boolean {
  return state.realmIndex >= ASCENSION_MIN_REALM && getDaoYunGain(state).gt(0);
}

/** 本世修为可折算的道韵（不足 1 点时为 0） */
export function getDaoYunGain(state: GameState): Decimal {
  if (state.realmIndex < ASCENSION_MIN_REALM) return D(0);
  return state.totalQi.div(DAO_YUN_DIVISOR).pow(DAO_YUN_EXPONENT).floor();
}

/* ------------------------------------------------------------------ */
/* 行动                                                                */
/* ------------------------------------------------------------------ */

/** 打坐一次获得的灵气：至少 1 点，随产量提升而提升 */
export function getMeditateGain(state: GameState): Decimal {
  const perSecond = getProduction(state).qi;
  const scaled = perSecond.mul(MEDITATE_SECONDS);
  const min = D(MEDITATE_MIN_QI);
  const gain = Decimal.max(scaled, min);
  // 前期有小数会让"打坐"看起来收益很怪，直接取整
  return gain.floor();
}

/**
 * 推进 dt 秒。返回新的 state，不修改原对象。
 * 点击 / 自动生产获得的灵气都会累计到 totalQi，飞升时按它结算。
 */
export function applyTick(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;

  const production = getProduction(state);
  const resources = { ...state.resources };
  for (const id of RESOURCE_IDS) {
    resources[id] = resources[id].add(production[id].mul(dt));
  }

  const gainedQi = production.qi.mul(dt);
  return {
    ...state,
    resources,
    totalQi: state.totalQi.add(gainedQi),
    lifetimeQi: state.lifetimeQi.add(gainedQi),
    playTime: state.playTime + dt,
  };
}

export function meditate(state: GameState): GameState {
  const gain = getMeditateGain(state);
  return {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.add(gain) },
    totalQi: state.totalQi.add(gain),
    lifetimeQi: state.lifetimeQi.add(gain),
  };
}

export function buyGenerator(state: GameState, def: GeneratorDef, count: number): GameState {
  const owned = state.generators[def.id] ?? 0;
  const actual = Math.min(count, maxAffordable(def, owned, state.resources));
  if (actual <= 0) return state;

  const cost = getCost(def, owned, actual);
  const resources = { ...state.resources };
  for (const [key, value] of Object.entries(cost) as [ResourceId, Decimal][]) {
    resources[key] = resources[key].sub(value);
  }

  return {
    ...state,
    resources,
    generators: { ...state.generators, [def.id]: owned + actual },
  };
}

export function advanceLayer(state: GameState): GameState {
  const cost = getLayerCost(state);
  if (cost === null || state.resources.qi.lt(cost)) return state;

  return {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.sub(cost) },
    layer: state.layer + 1,
  };
}

export function breakthrough(state: GameState): GameState {
  const { possible } = getBreakthroughStatus(state);
  if (!possible) return state;

  const realm = getRealm(state);
  return {
    ...state,
    resources: {
      ...state.resources,
      qi: state.resources.qi.sub(realm.breakthroughQi),
      pill: state.resources.pill.sub(realm.breakthroughPills),
    },
    realmIndex: state.realmIndex + 1,
    layer: 0,
  };
}
