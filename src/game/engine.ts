/**
 * 游戏核心计算：产量、价格、建筑效果、境界、突破、飞升。
 *
 * 这里几乎全是纯函数 —— 传入 state，返回新 state，不修改传入对象。
 * 因此可以直接拿到 Node 里跑数值模拟（见 tools/simulate.ts）。
 *
 * 注意：涉及随机的地方都接受一个可注入的 random 函数，
 * 默认 Math.random。这样模拟器和测试才能得到可复现的结果。
 */
import Decimal, { D } from './decimal';
import {
  ALCHEMY_SLOT_REQUIREMENT,
  ARTIFACTS,
  BREAKTHROUGH_FAIL_BONUS,
  BREAKTHROUGH_FAIL_BONUS_CAP,
  BREAKTHROUGH_MAX_SUCCESS,
  BREAKTHROUGH_PILL_BONUS,
  DAO_YUN_BONUS,
  DAO_YUN_DIVISOR,
  DAO_YUN_EXPONENT,
  FINAL_REALM_INDEX,
  GENERATORS,
  ITEM_MAP,
  MEDITATE_COST,
  MEDITATE_MIN_QI,
  MEDITATE_SECONDS,
  MIND_MAX,
  MIND_REGEN_SECONDS,
  REALMS,
  REFINING_SLOT_REQUIREMENT,
  RESOURCE_IDS,
  SECT_LEVELS,
  STONE_REFINE_COST,
  STONE_REFINE_OUTPUT,
  STRUCTURES,
  discipleCapBySect,
  isResourceId,
  type BuildableDef,
  type GeneratorDef,
  type ItemId,
  type RealmDef,
} from './content';
import type { GameState, ResourceMap } from './state';

/** 一份消耗清单：资源与材料混用 */
export type CostMap = Partial<Record<ItemId, Decimal>>;

/* ------------------------------------------------------------------ */
/* 物品读写                                                            */
/* ------------------------------------------------------------------ */

export function getAmount(state: GameState, id: ItemId): Decimal {
  return isResourceId(id) ? state.resources[id] : state.materials[id];
}

/** 增加资源或材料，返回新 state */
export function addItem(state: GameState, id: ItemId, amount: Decimal): GameState {
  if (amount.lte(0)) return state;
  if (isResourceId(id)) {
    return { ...state, resources: { ...state.resources, [id]: state.resources[id].add(amount) } };
  }
  return { ...state, materials: { ...state.materials, [id]: state.materials[id].add(amount) } };
}

/** 扣除一份消耗（调用前请先用 canAfford 检查） */
export function payCost(state: GameState, cost: CostMap): GameState {
  const resources = { ...state.resources };
  const materials = { ...state.materials };
  for (const [id, amount] of Object.entries(cost) as [ItemId, Decimal][]) {
    if (!amount) continue;
    if (isResourceId(id)) resources[id] = resources[id].sub(amount);
    else materials[id] = materials[id].sub(amount);
  }
  return { ...state, resources, materials };
}

export function canAfford(state: GameState, cost: CostMap): boolean {
  return Object.entries(cost).every(([id, amount]) => !amount || getAmount(state, id as ItemId).gte(amount));
}

/** 把 content 里的数字消耗转成 Decimal 消耗（用于炼丹炼器等配方） */
export function toCostMap(raw: Partial<Record<ItemId, number>>): CostMap {
  const cost: CostMap = {};
  for (const [id, amount] of Object.entries(raw) as [ItemId, number][]) {
    if (amount) cost[id] = D(amount);
  }
  return cost;
}

export function formatCost(cost: CostMap): string {
  return (Object.entries(cost) as [ItemId, Decimal][])
    .filter(([, amount]) => amount && amount.gt(0))
    .map(([id, amount]) => `${ITEM_MAP[id].icon}${amount.toString()}`)
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* 全局倍率                                                            */
/* ------------------------------------------------------------------ */

export interface ArtifactBonuses {
  combat: number;
  production: number;
  expeditionSpeed: number;
  expeditionSafety: number;
  expeditionYield: number;
}

/**
 * 器物加成。
 *
 * 关键约束：每件器物最多只有「弟子人数」份生效 ——
 * 相当于每名弟子只能持有一件。这样既要多造器物，也必须有足够弟子，
 * 否则玩家可以靠刷几百把铁剑把战力堆到天上。
 */
export function getArtifactBonuses(state: GameState): ArtifactBonuses {
  const holders = Math.max(1, state.sect.disciples.length);
  const acc: ArtifactBonuses = {
    combat: 0,
    production: 0,
    expeditionSpeed: 0,
    expeditionSafety: 0,
    expeditionYield: 0,
  };

  for (const def of ARTIFACTS) {
    const owned = state.artifacts[def.id] ?? 0;
    if (owned <= 0) continue;
    const effective = Math.min(owned, holders);
    const effect = def.effect;

    switch (effect.kind) {
      case 'combat':
        acc.combat += effect.bonus * effective;
        break;
      case 'production':
        acc.production += effect.bonus * effective;
        break;
      case 'expeditionSpeed':
        acc.expeditionSpeed += effect.bonus * effective;
        break;
      case 'expeditionSafety':
        acc.expeditionSafety += effect.reduction * effective;
        break;
      case 'expeditionYield':
        acc.expeditionYield += effect.bonus * effective;
        break;
    }
  }
  return acc;
}

export function getRealm(state: GameState): RealmDef {
  return REALMS[Math.min(state.realmIndex, FINAL_REALM_INDEX)];
}

export function isFinalRealm(state: GameState): boolean {
  return state.realmIndex >= FINAL_REALM_INDEX;
}

/** 境界倍率 × 小境界层数加成 */
export function getRealmMultiplier(state: GameState): Decimal {
  const realm = getRealm(state);
  return D(realm.realmMultiplier).mul(1 + realm.layerBonus * state.layer);
}

export function getDaoYunMultiplier(state: GameState): Decimal {
  return D(1).add(state.daoYun.mul(DAO_YUN_BONUS));
}

/** 所有产量乘数的总积 */
export function getGlobalMultiplier(state: GameState): Decimal {
  const artifact = getArtifactBonuses(state).production;
  return getRealmMultiplier(state)
    .mul(getDaoYunMultiplier(state))
    .mul(1 + artifact)
    .mul(state.buffs.productionMultiplier);
}

/* ------------------------------------------------------------------ */
/* 产量                                                                */
/* ------------------------------------------------------------------ */

export function getProduction(state: GameState): ResourceMap {
  const mult = getGlobalMultiplier(state);
  const out = {} as ResourceMap;
  for (const id of RESOURCE_IDS) out[id] = D(0);

  for (const def of GENERATORS) {
    const count = state.buildings[def.id] ?? 0;
    if (count <= 0) continue;
    out[def.produces] = out[def.produces].add(D(count).mul(def.baseOutput).mul(mult));
  }
  return out;
}

/** 单个设施已计入全局倍率的每秒产量 */
export function getGeneratorOutput(state: GameState, def: GeneratorDef): Decimal {
  const count = state.buildings[def.id] ?? 0;
  return D(count).mul(def.baseOutput).mul(getGlobalMultiplier(state));
}

/* ------------------------------------------------------------------ */
/* 建筑购买                                                            */
/* ------------------------------------------------------------------ */

/**
 * 买 count 个的总价。
 * 价格是等比数列，用求和公式一次算完，不用循环。
 */
export function getCost(def: BuildableDef, owned: number, count: number): CostMap {
  const out: CostMap = {};
  for (const [id, base] of Object.entries(def.baseCost) as [ItemId, number][]) {
    out[id] = Decimal.sumGeometricSeries(count, base, def.costGrowth, owned);
  }
  return out;
}

/** 当前资源最多能买几个（取所有材料里最紧俏的那个） */
export function maxAffordable(def: BuildableDef, owned: number, state: GameState): number {
  let max = Infinity;
  for (const [id, base] of Object.entries(def.baseCost) as [ItemId, number][]) {
    const available = getAmount(state, id);
    const n = Decimal.affordGeometricSeries(available, base, def.costGrowth, owned).floor().toNumber();
    max = Math.min(max, n);
  }
  if (!Number.isFinite(max)) return 0;
  return Math.max(0, Math.min(Math.floor(max), 1e9));
}

export function isUnlocked(def: BuildableDef, state: GameState): boolean {
  if (def.requiresSectLevel && state.sect.level < def.requiresSectLevel) return false;
  return Object.entries(def.unlock).every(([id, amount]) => getAmount(state, id as ItemId).gte(amount as number));
}

export function getBuildingCount(state: GameState, id: string): number {
  return state.buildings[id] ?? 0;
}

export function buyBuilding(state: GameState, def: BuildableDef, count: number): GameState {
  const owned = getBuildingCount(state, def.id);
  const actual = Math.min(count, maxAffordable(def, owned, state));
  if (actual <= 0) return state;

  const cost = getCost(def, owned, actual);
  if (!canAfford(state, cost)) return state;

  const paid = payCost(state, cost);
  return {
    ...paid,
    buildings: { ...paid.buildings, [def.id]: owned + actual },
  };
}

/* ------------------------------------------------------------------ */
/* 建筑效果                                                            */
/* ------------------------------------------------------------------ */

/** 居所提供的弟子容量 */
export function getHousingCapacity(state: GameState): number {
  let capacity = 0;
  for (const def of STRUCTURES) {
    if (!def.capacity) continue;
    capacity += getBuildingCount(state, def.id) * def.capacity;
  }
  return capacity;
}

/**
 * 实际弟子上限 = min(居所容量, 宗门等级上限)。
 * 两个条件都得满足，所以"盖房"和"升宗门"缺一不可。
 */
export function getDiscipleCapacity(state: GameState): number {
  if (!state.sect.founded) return 0;
  return Math.min(getHousingCapacity(state), discipleCapBySect(state.sect.level));
}

export function getAlchemySlots(state: GameState): number {
  let slots = 0;
  for (const def of STRUCTURES) {
    if (!def.alchemySlots) continue;
    slots += getBuildingCount(state, def.id) * def.alchemySlots;
  }
  return slots;
}

export function getRefiningSlots(state: GameState): number {
  let slots = 0;
  for (const def of STRUCTURES) {
    if (!def.refiningSlots) continue;
    slots += getBuildingCount(state, def.id) * def.refiningSlots;
  }
  return slots;
}

/** 当前丹房数量所能支撑的最高炼丹品阶 */
export function getMaxAlchemyTierBySlots(state: GameState): number {
  const slots = getAlchemySlots(state);
  let tier = 1;
  for (let t = 2; t < ALCHEMY_SLOT_REQUIREMENT.length; t += 1) {
    if (slots >= ALCHEMY_SLOT_REQUIREMENT[t]) tier = t;
  }
  return tier;
}

export function getMaxRefiningTierBySlots(state: GameState): number {
  const slots = getRefiningSlots(state);
  let tier = 1;
  for (let t = 2; t < REFINING_SLOT_REQUIREMENT.length; t += 1) {
    if (slots >= REFINING_SLOT_REQUIREMENT[t]) tier = t;
  }
  return tier;
}

/* ------------------------------------------------------------------ */
/* 境界与突破                                                          */
/* ------------------------------------------------------------------ */

/** 参悟下一层小境界所需灵气；已满层返回 null */
export function getLayerCost(state: GameState): Decimal | null {
  const realm = getRealm(state);
  if (state.layer >= realm.layerCount) return null;
  return D(realm.baseLayerCost).mul(Decimal.pow(realm.costGrowth, state.layer));
}

export function canAdvanceLayer(state: GameState): boolean {
  const cost = getLayerCost(state);
  return cost !== null && state.resources.qi.gte(cost);
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

export interface BreakthroughStatus {
  possible: boolean;
  reason: string | null;
  /** 该境界建议服用的境界丹 id（可能为空字符串） */
  pillId: string;
  /** 是否持有该丹药 */
  hasPill: boolean;
}

export function getBreakthroughStatus(state: GameState): BreakthroughStatus {
  const realm = getRealm(state);
  const pillId = realm.breakthroughPill;
  const hasPill = Boolean(pillId) && (state.pills[pillId] ?? 0) > 0;

  if (isFinalRealm(state)) {
    return { possible: false, reason: '已至修行尽头', pillId: '', hasPill: false };
  }
  if (state.layer < realm.layerCount) {
    return {
      possible: false,
      reason: '须先参悟圆满本境界所有小境界',
      pillId,
      hasPill,
    };
  }
  if (state.resources.qi.lt(realm.breakthroughQi)) {
    return { possible: false, reason: '灵气不足', pillId, hasPill };
  }
  return { possible: true, reason: null, pillId, hasPill };
}

/** 突破成功率（0~1），usePill 表示这次是否服用境界丹 */
export function getSuccessRate(state: GameState, usePill: boolean): number {
  const realm = getRealm(state);
  if (isFinalRealm(state)) return 1;

  const pity = state.breakthroughPity[state.realmIndex] ?? 0;
  const pill =
    usePill && realm.breakthroughPill && (state.pills[realm.breakthroughPill] ?? 0) > 0
      ? BREAKTHROUGH_PILL_BONUS
      : 0;

  return Math.min(realm.baseSuccess + pity + state.globalBreakthroughBonus + pill, BREAKTHROUGH_MAX_SUCCESS);
}

export interface BreakthroughResult {
  state: GameState;
  success: boolean;
  rate: number;
}

/**
 * 突破大境界。
 *
 * 失败不会让你卡死：每次失败累积 +5% 保底成功率（上限 +50%），
 * 并且返还一半灵气。境界丹是可选的，但能一次性 +35%。
 */
export function breakthrough(
  state: GameState,
  usePill: boolean,
  random: () => number = Math.random,
): BreakthroughResult | null {
  const status = getBreakthroughStatus(state);
  if (!status.possible) return null;

  const realm = getRealm(state);
  const rate = getSuccessRate(state, usePill);
  const success = random() < rate;

  const pills = { ...state.pills };
  if (usePill && status.pillId && (pills[status.pillId] ?? 0) > 0) {
    const left = (pills[status.pillId] ?? 0) - 1;
    if (left > 0) pills[status.pillId] = left;
    else delete pills[status.pillId];
  }

  // 失败返还一半灵气，避免"连败把家底赔光"的挫败感
  const qiSpent = success ? realm.breakthroughQi : realm.breakthroughQi * 0.5;
  const pity = [...state.breakthroughPity];
  pity[state.realmIndex] = success
    ? 0
    : Math.min((pity[state.realmIndex] ?? 0) + BREAKTHROUGH_FAIL_BONUS, BREAKTHROUGH_FAIL_BONUS_CAP);

  const next: GameState = {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.sub(qiSpent) },
    pills,
    breakthroughPity: pity,
    realmIndex: success ? state.realmIndex + 1 : state.realmIndex,
    layer: success ? 0 : state.layer,
  };

  return { state: next, success, rate };
}

/* ------------------------------------------------------------------ */
/* 宗门                                                                */
/* ------------------------------------------------------------------ */

export function getSectLevelDef(level: number) {
  return SECT_LEVELS[Math.min(Math.max(level, 1), SECT_LEVELS.length) - 1];
}

export interface SectUpgradeStatus {
  possible: boolean;
  reason: string | null;
  /** 下一品阶，已满级则为 null */
  nextLevel: number | null;
  cost: CostMap;
}

export function getSectUpgradeStatus(state: GameState): SectUpgradeStatus {
  const level = state.sect.level;
  if (level >= SECT_LEVELS.length) {
    return { possible: false, reason: '宗门已至九品，无可再升', nextLevel: null, cost: {} };
  }

  const next = SECT_LEVELS[level]; // 数组下标 = 目标品阶 - 1
  const cost = toCostMap(next.cost);

  if (state.realmIndex < next.requiresRealm) {
    return {
      possible: false,
      reason: `需修至${REALMS[next.requiresRealm].name}`,
      nextLevel: next.level,
      cost,
    };
  }
  if (!canAfford(state, cost)) {
    return { possible: false, reason: '晋升材料不足', nextLevel: next.level, cost };
  }
  return { possible: true, reason: null, nextLevel: next.level, cost };
}

export function upgradeSect(state: GameState): GameState {
  const status = getSectUpgradeStatus(state);
  if (!status.possible || status.nextLevel === null) return state;

  const paid = payCost(state, status.cost);
  return {
    ...paid,
    sect: { ...paid.sect, level: status.nextLevel },
  };
}

/** 开宗立派（需求 3 的入口） */
export function foundSect(state: GameState): GameState {
  if (state.sect.founded || state.realmIndex < SECT_LEVELS[0].requiresRealm) return state;
  const cost = toCostMap(SECT_LEVELS[0].cost);
  if (!canAfford(state, cost)) return state;

  const paid = payCost(state, cost);
  return { ...paid, sect: { ...paid.sect, founded: true, level: 1 } };
}

/* ------------------------------------------------------------------ */
/* 飞升                                                                */
/* ------------------------------------------------------------------ */

export function canAscend(state: GameState): boolean {
  return state.realmIndex >= SECT_LEVELS[0].requiresRealm && getDaoYunGain(state).gt(0);
}

export function getDaoYunGain(state: GameState): Decimal {
  if (state.realmIndex < SECT_LEVELS[0].requiresRealm) return D(0);
  return state.totalQi.div(DAO_YUN_DIVISOR).pow(DAO_YUN_EXPONENT).floor();
}

/* ------------------------------------------------------------------ */
/* 打坐与心神（需求 1）                                                 */
/* ------------------------------------------------------------------ */

export function canMeditate(state: GameState): boolean {
  return state.mind >= MEDITATE_COST;
}

export function getMeditateGain(state: GameState): Decimal {
  if (!canMeditate(state)) return D(0);
  const perSecond = getProduction(state).qi;
  const scaled = perSecond.mul(MEDITATE_SECONDS);
  return Decimal.max(scaled, D(MEDITATE_MIN_QI)).floor();
}

export function meditate(state: GameState): GameState {
  if (!canMeditate(state)) return state;
  const gain = getMeditateGain(state);
  return {
    ...state,
    mind: state.mind - MEDITATE_COST,
    resources: { ...state.resources, qi: state.resources.qi.add(gain) },
    totalQi: state.totalQi.add(gain),
    lifetimeQi: state.lifetimeQi.add(gain),
  };
}

/**
 * 心神回复。
 * 用除法和取余一次算完，避免离线 8 小时时循环几千次。
 */
export function tickMind(state: GameState, dt: number): GameState {
  if (dt <= 0 || state.mind >= MIND_MAX) {
    return state.mind >= MIND_MAX ? { ...state, mind: MIND_MAX, mindProgress: 0 } : state;
  }

  const total = state.mindProgress + dt;
  const gained = Math.floor(total / MIND_REGEN_SECONDS);
  const mind = Math.min(MIND_MAX, state.mind + gained);
  const progress = mind >= MIND_MAX ? 0 : total - gained * MIND_REGEN_SECONDS;

  return { ...state, mind, mindProgress: progress };
}

/* ------------------------------------------------------------------ */
/* 灵石合成（需求 6）                                                   */
/* ------------------------------------------------------------------ */

export function getStoneRefineCost(): CostMap {
  const cost: CostMap = {};
  for (const [id, amount] of Object.entries(STONE_REFINE_COST) as [ItemId, number][]) {
    cost[id] = D(amount);
  }
  return cost;
}

/** 一次合成能产出多少灵石（可重复合成） */
export function maxStoneRefine(state: GameState): number {
  const cost = getStoneRefineCost();
  let max = Infinity;
  for (const [id, amount] of Object.entries(cost) as [ItemId, Decimal][]) {
    max = Math.min(max, getAmount(state, id).div(amount).floor().toNumber());
  }
  return Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
}

export function refineStone(state: GameState, times: number): GameState {
  const actual = Math.min(times, maxStoneRefine(state));
  if (actual <= 0) return state;

  const cost = getStoneRefineCost();
  const scaled: CostMap = {};
  for (const [id, amount] of Object.entries(cost) as [ItemId, Decimal][]) {
    scaled[id] = amount.mul(actual);
  }

  const paid = payCost(state, scaled);
  return {
    ...paid,
    resources: {
      ...paid.resources,
      stone: paid.resources.stone.add(STONE_REFINE_OUTPUT * actual),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 资源生产（时间推进的最小单元）                                        */
/* ------------------------------------------------------------------ */

/**
 * 只推进资源生产与统计。弟子、秘境、增益由 tick.ts 组合进来，
 * 这样 engine 不必依赖 disciples / expeditions，避免循环引用。
 */
export function produceResources(state: GameState, dt: number): GameState {
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

/** 一次性把灵气加到当前值（培元丹 / 悟道丹用） */
export function grantQiSeconds(state: GameState, seconds: number): GameState {
  const gain = getProduction(state).qi.mul(seconds);
  return {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.add(gain) },
    totalQi: state.totalQi.add(gain),
    lifetimeQi: state.lifetimeQi.add(gain),
  };
}
