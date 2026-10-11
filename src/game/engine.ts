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
  BASE_STORAGE,
  BREAKTHROUGH_FAIL_BONUS,
  BREAKTHROUGH_FAIL_BONUS_CAP,
  BREAKTHROUGH_MAX_SUCCESS,
  BREAKTHROUGH_PILL_BONUS,
  BUILDABLES,
  DAO_YUN_BONUS,
  DAO_YUN_DIVISOR,
  DAO_YUN_EXPONENT,
  FINAL_REALM_INDEX,
  GENERATORS,
  INJURY_FALLBACK_SECONDS,
  INJURY_FROM_REALM,
  INJURY_PRODUCTION_PENALTY,
  INJURY_SECONDS,
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
  SECRET_REALMS,
  SERVANT_BONUS_PER_HEAD,
  SERVANT_JOBS,
  STONE_REFINE_COST,
  STONE_REFINE_OUTPUT,
  STRUCTURES,
  discipleCapBySect,
  isResourceId,
  servantCost,
  type BuildableDef,
  type GeneratorDef,
  type ItemId,
  type RealmDef,
  type ResourceId,
  type SecretRealmDef,
  type ServantJobId,
} from './content';
import { gameRandom, type RandomSource } from './random';
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
    .mul(state.buffs.productionMultiplier)
    .mul(getInjuryMultiplier(state));
}

/** 道伤未愈时的产量惩罚（「萎靡不振」的具象化） */
export function getInjuryMultiplier(state: GameState): number {
  return state.injurySeconds > 0 ? 1 - INJURY_PRODUCTION_PENALTY : 1;
}

/* ------------------------------------------------------------------ */
/* 仆人（杂役）                                                        */
/* ------------------------------------------------------------------ */

export function getServantCount(state: GameState): number {
  let total = 0;
  for (const job of SERVANT_JOBS) total += state.servants[job.id] ?? 0;
  return total;
}

/** 某工种当前的仆人加成（加算比例，0.05 = +5%） */
export function getServantBonus(state: GameState, resource: ResourceId): number {
  let bonus = 0;
  for (const job of SERVANT_JOBS) {
    if (job.resource !== resource) continue;
    bonus += (state.servants[job.id] ?? 0) * SERVANT_BONUS_PER_HEAD;
  }
  return bonus;
}

/** 居所已被占用多少名额（仆人与弟子共用） */
export function getHousingUsed(state: GameState): number {
  return getServantCount(state) + state.sect.disciples.length;
}

export function getFreeHousing(state: GameState): number {
  return Math.max(0, getHousingCapacity(state) - getHousingUsed(state));
}

/** 仆人的招收花费，随已有仆人数递增 */
export function getServantCost(state: GameState): Decimal {
  return D(servantCost(getServantCount(state)));
}

export interface RecruitCheck {
  ok: boolean;
  reason: string | null;
}

export function canRecruitServant(state: GameState): RecruitCheck {
  if (getHousingCapacity(state) === 0) {
    return { ok: false, reason: '尚无居所，先建一座茅屋' };
  }
  if (getFreeHousing(state) <= 0) {
    return { ok: false, reason: '居所已满，需先扩建或腾出房间' };
  }
  if (state.resources.qi.lt(getServantCost(state))) {
    return { ok: false, reason: '灵气不足' };
  }
  return { ok: true, reason: null };
}

export function recruitServant(state: GameState, job: ServantJobId = 'chores'): GameState {
  if (!canRecruitServant(state).ok) return state;
  return {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.sub(getServantCost(state)) },
    servants: { ...state.servants, [job]: (state.servants[job] ?? 0) + 1 },
  };
}

/** 把一个仆人从某工种调到另一工种 */
export function assignServant(state: GameState, from: ServantJobId, to: ServantJobId): GameState {
  if (from === to) return state;
  const fromCount = state.servants[from] ?? 0;
  if (fromCount <= 0) return state;

  const servants = { ...state.servants };
  if (fromCount > 1) servants[from] = fromCount - 1;
  else delete servants[from];
  servants[to] = (servants[to] ?? 0) + 1;

  return { ...state, servants };
}

/** 遣散一名某工种的仆人（用来给弟子腾房间） */
export function dismissServant(state: GameState, job: ServantJobId): GameState {
  const count = state.servants[job] ?? 0;
  if (count <= 0) return state;

  const servants = { ...state.servants };
  if (count > 1) servants[job] = count - 1;
  else delete servants[job];

  return { ...state, servants };
}

/** 遣散全部仆人 */
export function dismissAllServants(state: GameState): GameState {
  if (getServantCount(state) === 0) return state;
  return { ...state, servants: {} };
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

  // 仆人加成：只作用于他们所从事的那种资源
  for (const job of SERVANT_JOBS) {
    const count = state.servants[job.id] ?? 0;
    if (count <= 0) continue;
    out[job.resource] = out[job.resource].mul(1 + count * SERVANT_BONUS_PER_HEAD);
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

/** 建筑的建造数量上限（未设置则不限） */
export function getMaxCount(def: BuildableDef): number {
  return def.max ?? Infinity;
}

/** 当前资源最多能买几个（取所有材料里最紧俏的那个，并受数量上限约束） */
export function maxAffordable(def: BuildableDef, owned: number, state: GameState): number {
  const room = getMaxCount(def) - owned;
  if (room <= 0) return 0;

  let max = Infinity;
  for (const [id, base] of Object.entries(def.baseCost) as [ItemId, number][]) {
    const available = getAmount(state, id);
    const n = Decimal.affordGeometricSeries(available, base, def.costGrowth, owned).floor().toNumber();
    max = Math.min(max, n);
  }
  if (!Number.isFinite(max)) return 0;
  return Math.max(0, Math.min(Math.floor(max), room, 1e9));
}

/**
 * 是否达成了「首次解锁」条件（只看资源拥有量）。
 *
 * 这是解锁的**触发条件**，不是显示条件 —— 达成后会由 refreshUnlocks
 * 永久记录到 state.unlockedBuildings，之后资源怎么花都不会再隐藏。
 */
export function meetsUnlockCondition(def: BuildableDef, state: GameState): boolean {
  return Object.entries(def.unlock).every(([id, amount]) =>
    getAmount(state, id as ItemId).gte(amount as number),
  );
}

/**
 * 是否可见。
 *
 * = 曾经达成过解锁条件（永久记录）
 *   且 境界 / 宗门门槛即将或已经达到
 *
 * 门槛刻意提前一级显示（灰掉并标注需求）——
 * 让玩家能看到「下一个境界就能建这个」的目标，而不是突然冒出来。
 */
export function isUnlocked(def: BuildableDef, state: GameState): boolean {
  if (!state.unlockedBuildings[def.id]) return false;
  if (def.requiresRealm !== undefined && state.realmIndex + 1 < def.requiresRealm) return false;
  if (def.requiresSectLevel && state.sect.level + 1 < def.requiresSectLevel) return false;
  return true;
}

/** 现在能不能建。返回不能建造的原因，null 表示可以 */
export function getBuildGate(def: BuildableDef, state: GameState): string | null {
  if (!state.unlockedBuildings[def.id]) return '尚未解锁';
  if (def.requiresRealm !== undefined && state.realmIndex < def.requiresRealm) {
    return `需${REALMS[def.requiresRealm].name}`;
  }
  if (def.requiresSectLevel && state.sect.level < def.requiresSectLevel) {
    return `需${def.requiresSectLevel}品宗门`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 储存上限                                                            */
/* ------------------------------------------------------------------ */

/**
 * 各资源的储存上限 = 基础上限 + 所有储物建筑提供的容量。
 *
 * 上限是本作的重要压力来源：产量到达上限后多出来的部分直接损失，
 * 所以玩家必须在「继续堆产量」和「扩建仓库」之间做选择。
 */
export function getStorageCaps(state: GameState): Record<ResourceId, Decimal> {
  const caps = {} as Record<ResourceId, Decimal>;
  for (const id of RESOURCE_IDS) caps[id] = D(BASE_STORAGE[id]);

  for (const def of STRUCTURES) {
    if (!def.storage) continue;
    const count = state.buildings[def.id] ?? 0;
    if (count <= 0) continue;
    for (const [id, amount] of Object.entries(def.storage) as [ResourceId, number][]) {
      caps[id] = caps[id].add(count * amount);
    }
  }
  return caps;
}

export function getStorageCap(state: GameState, id: ResourceId): Decimal {
  return getStorageCaps(state)[id];
}

/** 该资源是否已经装满（装满后继续产出就是浪费） */
export function isResourceFull(state: GameState, id: ResourceId): boolean {
  return state.resources[id].gte(getStorageCap(state, id));
}

/**
 * 把超出上限的资源砍回上限。
 *
 * 作为最后一道保险挂在所有状态变更之后 ——
 * 无论是产量、丹药、秘境掉落还是灵石合成，都不可能突破上限。
 */
export function clampResources(state: GameState): GameState {
  const caps = getStorageCaps(state);
  let resources: ResourceMap | null = null;

  for (const id of RESOURCE_IDS) {
    if (state.resources[id].lte(caps[id])) continue;
    resources = resources ?? { ...state.resources };
    resources[id] = caps[id];
  }

  return resources ? { ...state, resources } : state;
}

/** 该建筑的解锁进度（用于界面提示"还差多少"），已解锁返回 null */
export function getUnlockProgress(
  def: BuildableDef,
  state: GameState,
): { id: ItemId; need: number; have: Decimal } | null {
  if (state.unlockedBuildings[def.id]) return null;
  for (const [id, amount] of Object.entries(def.unlock) as [ItemId, number][]) {
    const have = getAmount(state, id);
    if (have.lt(amount)) return { id, need: amount, have };
  }
  return null;
}

/**
 * 把新达成的解锁条件永久记录下来（建筑与秘境通用）。
 *
 * 每次状态推进后都会调用（主循环、购买、读档……）。
 * 没有新解锁时返回**原对象**，避免无谓的重新渲染。
 */
export function refreshUnlocks(state: GameState): GameState {
  let unlockedBuildings: Record<string, boolean> | null = null;
  for (const def of BUILDABLES) {
    if (state.unlockedBuildings[def.id]) continue;
    if (!meetsUnlockCondition(def, state)) continue;
    unlockedBuildings = unlockedBuildings ?? { ...state.unlockedBuildings };
    unlockedBuildings[def.id] = true;
  }

  let unlockedRealms: Record<string, boolean> | null = null;
  for (const def of SECRET_REALMS) {
    if (state.unlockedRealms[def.id]) continue;
    if (!meetsRealmUnlockCondition(def, state)) continue;
    unlockedRealms = unlockedRealms ?? { ...state.unlockedRealms };
    unlockedRealms[def.id] = true;
  }

  if (!unlockedBuildings && !unlockedRealms) return state;

  return {
    ...state,
    unlockedBuildings: unlockedBuildings ?? state.unlockedBuildings,
    unlockedRealms: unlockedRealms ?? state.unlockedRealms,
  };
}

/* ------------------------------------------------------------------ */
/* 秘境解锁                                                            */
/* ------------------------------------------------------------------ */

/** 是否达成过秘境的发现条件（只看材料持有量，是触发条件不是显示条件） */
export function meetsRealmUnlockCondition(def: SecretRealmDef, state: GameState): boolean {
  return Object.entries(def.unlock).every(([id, amount]) =>
    getAmount(state, id as ItemId).gte(amount as number),
  );
}

/**
 * 秘境当前是否已发现。
 *
 * = 曾经达成过材料条件（永久记录）
 *   且 宗门等级达标（实时判断）
 */
export function isRealmUnlocked(def: SecretRealmDef, state: GameState): boolean {
  if (!state.unlockedRealms[def.id]) return false;
  if (def.requiresSectLevel && state.sect.level < def.requiresSectLevel) return false;
  return true;
}

export function getBuildingCount(state: GameState, id: string): number {
  return state.buildings[id] ?? 0;
}

export function buyBuilding(state: GameState, def: BuildableDef, count: number): GameState {
  // 尚未解锁或境界/宗门门槛未到，一律不能买（界面上也是灰的），当作最后一道保险
  if (getBuildGate(def, state) !== null) return state;

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
 * 弟子总数上限 = min(居所容纳 - 仆人占用, 宗门等级上限)。
 *
 * 居所名额是和仆人**共用**的：多收一个仆人，就少收一个弟子。
 * 于是「盖房 → 收仆人换产量」和「盖房 → 收弟子换战力/材料」之间
 * 始终存在取舍，居所在整局游戏里都有意义。
 */
export function getDiscipleCapacity(state: GameState): number {
  if (!state.sect.founded) return 0;
  const forDisciples = Math.max(0, getHousingCapacity(state) - getServantCount(state));
  return Math.min(forDisciples, discipleCapBySect(state.sect.level));
}

/** 仆人总数上限 = 居所容纳 - 弟子占用 */
export function getServantCapacity(state: GameState): number {
  return Math.max(0, getHousingCapacity(state) - state.sect.disciples.length);
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
  /** 道伤剩余秒数（大于 0 时无法突破） */
  injurySeconds: number;
  /** 本次突破是否属于「低境界」（失败无任何负面影响） */
  safe: boolean;
}

export function getBreakthroughStatus(state: GameState): BreakthroughStatus {
  const realm = getRealm(state);
  const pillId = realm.breakthroughPill;
  const hasPill = Boolean(pillId) && (state.pills[pillId] ?? 0) > 0;
  const injurySeconds = state.injurySeconds;
  const safe = state.realmIndex < INJURY_FROM_REALM;

  if (isFinalRealm(state)) {
    return { possible: false, reason: '已至修行尽头', pillId: '', hasPill: false, injurySeconds, safe };
  }
  if (injurySeconds > 0) {
    return { possible: false, reason: '道伤未愈', pillId, hasPill, injurySeconds, safe };
  }
  if (state.layer < realm.layerCount) {
    return {
      possible: false,
      reason: '须先参悟圆满本境界所有小境界',
      pillId,
      hasPill,
      injurySeconds,
      safe,
    };
  }
  if (state.resources.qi.lt(realm.breakthroughQi)) {
    return { possible: false, reason: '灵气不足', pillId, hasPill, injurySeconds, safe };
  }
  return { possible: true, reason: null, pillId, hasPill, injurySeconds, safe };
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
  /** 本次失败造成的道伤秒数（0 表示没有惩罚） */
  injurySeconds: number;
}

/**
 * 突破大境界。
 *
 * 失败的代价按境界分级：
 *   - **低境界（炼气 / 筑基 / 金丹）失败没有任何负面影响** ——
 *     灵气全额返还，没有冷却。前期是教学阶段，不该惩罚玩家。
 *   - **元婴期起失败会留下「道伤」**：一段时间内无法再次突破，
 *     且全局产量下降。失败仍返还一半灵气，并累积保底成功率，
 *     所以最坏情况也只是等一会儿，不会卡死。
 */
export function breakthrough(
  state: GameState,
  usePill: boolean,
  random: RandomSource = gameRandom,
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

  // 失败时的灵气消耗：
  //   成功        → 全额消耗
  //   低境界失败  → 全额返还（无任何代价）
  //   高境界失败  → 返还一半
  const qiSpent = success ? realm.breakthroughQi : status.safe ? 0 : realm.breakthroughQi * 0.5;

  const pity = [...state.breakthroughPity];
  pity[state.realmIndex] = success
    ? 0
    : Math.min((pity[state.realmIndex] ?? 0) + BREAKTHROUGH_FAIL_BONUS, BREAKTHROUGH_FAIL_BONUS_CAP);

  const injurySeconds =
    success || status.safe ? 0 : (INJURY_SECONDS[state.realmIndex] ?? INJURY_FALLBACK_SECONDS);

  const next: GameState = {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.sub(qiSpent) },
    pills,
    breakthroughPity: pity,
    realmIndex: success ? state.realmIndex + 1 : state.realmIndex,
    layer: success ? 0 : state.layer,
    // 新的道伤会覆盖旧的（取较长者，避免连败反而缩短惩罚）
    injurySeconds: Math.max(state.injurySeconds, injurySeconds),
  };

  return { state: next, success, rate, injurySeconds };
}

/** 道伤计时 */
export function tickInjury(state: GameState, dt: number): GameState {
  if (state.injurySeconds <= 0 || dt <= 0) return state;
  return { ...state, injurySeconds: Math.max(0, state.injurySeconds - dt) };
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
  const caps = getStorageCaps(state);
  const resources = { ...state.resources };

  for (const id of RESOURCE_IDS) {
    const next = resources[id].add(production[id].mul(dt));
    // 到上限后多出来的产量直接损失 —— 这是储物上限的核心压力来源
    resources[id] = next.gt(caps[id]) ? caps[id] : next;
  }

  // 只统计真正落袋的灵气，溢出部分不计入飞升结算
  const gainedQi = resources.qi.sub(state.resources.qi);
  return {
    ...state,
    resources,
    totalQi: state.totalQi.add(gainedQi),
    lifetimeQi: state.lifetimeQi.add(gainedQi),
    playTime: state.playTime + dt,
  };
}

/** 一次性把灵气加到当前值（培元丹 / 悟道丹用），同样受储存上限约束 */
export function grantQiSeconds(state: GameState, seconds: number): GameState {
  const gain = getProduction(state).qi.mul(seconds);
  const cap = getStorageCap(state, 'qi');
  const before = state.resources.qi;
  const after = before.add(gain);
  const clamped = after.gt(cap) ? cap : after;
  const gained = clamped.sub(before);

  return {
    ...state,
    resources: { ...state.resources, qi: clamped },
    totalQi: state.totalQi.add(gained),
    lifetimeQi: state.lifetimeQi.add(gained),
  };
}
