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
import { getHappinessCultivationMultiplier } from './happiness';
import { getSectArrayCultivationBonus } from './sectArray';
import {
  ALCHEMY_SLOT_REQUIREMENT,
  ALLIANCE_PRODUCTION_BONUS,
  ASCENSION_MIN_REALM,
  ARENA_BUFF_BONUS,
  ARTIFACTS,
  AUTO_REFINE_LEVEL_MAX,
  AUTO_REFINE_RATES,
  type ArtifactDef,
  BASE_STORAGE,
  BLUEPRINT_MAP,
  FAME_MAX,
  FAME_TIERS,
  COMBAT_TALENT_MAP,
  FURNACE_MAP,
  POST_BASE_BONUS,
  POST_BONUS_CAP,
  POST_BUILDINGS,
  SKILL_BONUS_PER_LEVEL,
  TALENT_MATCH_MULT,
  FARM_TALENT_MAP,
  skillLevelOf,
  type SkillKind,
  BREAKTHROUGH_MAX_SUCCESS,
  BREAKTHROUGH_PILL_GAP_RECOVERY,
  BUILDABLES,
  BUILDABLE_MAP,
  BUILD_QUEUE_BASE_SLOTS,
  BUILD_QUEUE_BUILDING,
  BUILD_QUEUE_MAX_SLOTS,
  QUEUE_UPGRADES,
  REFINE_RECIPE_MAP,
  REFINE_RECIPES,
  DAO_YUN_BONUS,
  DAO_YUN_DIVISOR,
  DAO_YUN_EXPONENT,
  DISCOVERY_BASE_CHANCE,
  DISCOVERY_MAX_CHANCE,
  DISCOVERY_PITY_FAILURES,
  FINAL_REALM_INDEX,
  FARM_TALENTS,
  farmTalentBonus,
  type FarmTalentId,
  type FarmTalentTarget,
  GENERATORS,
  INJURY_FALLBACK_SECONDS,
  INJURY_FROM_REALM,
  INJURY_PRODUCTION_PENALTY,
  INJURY_SECONDS,
  INSIGHT_MAX_BASE,
  INSIGHT_MAX_PER_REALM,
  ITEM_MAP,
  MAP_REGIONS,
  MAP_REGION_MAP,
  MEDITATE_COST,
  MEDITATE_MIN_QI,
  MEDITATE_SECONDS,
  MIND_MAX,
  MIND_REGEN_SECONDS,
  PILL_MAP,
  REALMS,
  SPATIAL_WARD_CAPACITY_BONUS,
  PROGRESS_QI_SCALE,
  scaledBreakthroughQi,
  REFINING_SLOT_REQUIREMENT,
  REGION_PREVIEW_REALMS,
  RESOURCE_IDS,
  SECT_MIN_REALM,
  SECRET_REALMS,
  SECT_LEVELS,
  SERVANT_BONUS_PER_HEAD,
  SERVANT_JOBS,
  SHOP_OFFER_COUNT,
  STONE_REFINE_COST,
  STONE_REFINE_OUTPUT,
  spiritArrayCultivationBonus,
  STRUCTURES,
  TECH_MAP,
  TRAIT_MAP,
  discipleCapBySect,
  isResourceId,
  servantCost,
  type BuildableDef,
  type GeneratorDef,
  type ItemId,
  type MapRegionDef,
  type FameTierDef,
  type TraitEffects,
  type QueueUpgradeDef,
  type RefineRecipe,
  type RealmDef,
  type ResourceId,
  type SecretRealmDef,
  type ServantJobId,
} from './content';
import { gameRandom, type RandomSource } from './random';
import { getEnvironmentResourceBonus, getWeatherEffects, getWeatherProductionBonus } from './season';
import { KARMA_LAYER_FAIL_INJURY, KARMA_SUCCESS_FLOOR, getKarma, getKarmaThunderPenalty } from './encounter';
import { pushJournal } from './disciples';
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
  /** 发现新秘境的概率加成（只由寻宝宝盘提供） */
  discovery: number;
}

/**
 * 器物加成。
 *
 * 关键约束：每件器物最多只有「弟子人数」份生效 ——
 * 相当于每名弟子只能持有一件。这样既要多造器物，也必须有足够弟子，
 * 否则玩家可以靠刷几百把铁剑把战力堆到天上。
 *
 * 寻宝宝盘（发现概率）也受这条约束：想堆发现概率就得同时有弟子和材料。
 */
export function getArtifactBonuses(state: GameState): ArtifactBonuses {
  const holders = Math.max(1, state.sect.disciples.length);
  const acc: ArtifactBonuses = {
    combat: 0,
    production: 0,
    expeditionSpeed: 0,
    expeditionSafety: 0,
    expeditionYield: 0,
    discovery: 0,
  };

  for (const def of ARTIFACTS) {
    const owned = state.artifacts[def.id] ?? 0;
    if (owned <= 0) continue;

    /*
     * 需求 2：可携带器物（`carry`）会随探索消耗次数，用光了就不再提供加成。
     *
     * 注意这里的两层"打折"：
     *   1. 存量为 0 直接跳过（已损毁）；
     *   2. 生效件数还受弟子数限制（老规矩：100 把剑给 1 个弟子也只能算 1 把）。
     * 用 `getGearCharges` 而不是直接读字段，是为了让"没记录 = 满次数"这条规则
     * 只有一个落点，不会在有别的地方读的时候各自解释一遍。
     */
    if (def.carry && getGearCharges(state, def) <= 0) continue;

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
      case 'discovery':
        acc.discovery += effect.bonus * effective;
        break;
    }
  }
  return acc;
}

/**
 * 可携带器物的剩余次数（需求 2）。
 *
 * 三条规则，缺一不可：
 *   1. **没库存就是 0** —— 用坏之后记录会被删掉，如果只写"没记录 = 满次数"，
 *      损毁的器物会立刻"满耐久复活"（这个 bug 是冒烟测试逮到的）；
 *   2. **没记录 = 满次数** —— 新增器物或旧存档第一次遇到它时，
 *      不该出现"刚炼出来就是 0 次"的怪事；
 *   3. 有记录就夹到 0~上限。
 */
export function getGearCharges(state: GameState, def: ArtifactDef): number {
  if (!def.carry) return 0;
  if ((state.artifacts[def.id] ?? 0) <= 0) return 0;
  const raw = state.gearCharges[def.id];
  if (raw === undefined) return def.carry.charges;
  return Math.max(0, Math.min(def.carry.charges, raw));
}

/**
 * 探索结算时消耗一次携带器物的耐久（需求 2），用完即毁。
 *
 * 需求原文：「影响弟子探索的器物有使用次数限制，达到限制后损毁，需要重新炼制」。
 * 返回新的 state 与被用坏的器物名（给记事用）。
 */
export function consumeGear(state: GameState): { state: GameState; broken: string[] } {
  const charges: Record<string, number> = { ...state.gearCharges };
  const artifacts: Record<string, number> = { ...state.artifacts };
  const broken: string[] = [];
  let changed = false;

  for (const def of ARTIFACTS) {
    if (!def.carry) continue;
    if ((artifacts[def.id] ?? 0) <= 0) continue;

    const left = getGearCharges(state, def) - 1;
    changed = true;
    if (left > 0) {
      charges[def.id] = left;
    } else {
      // 用完了：器物从库存里消失，次数记录一并清掉
      delete charges[def.id];
      artifacts[def.id] = 0;
      broken.push(def.name);
    }
  }

  if (!changed) return { state, broken };
  return { state: { ...state, gearCharges: charges, artifacts }, broken };
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
    .mul(1 + artifact + getStructureBonus(state, 'productionBonus') + getWeatherProductionBonus(state))
    .mul(state.buffs.productionMultiplier)
    .mul(getInjuryMultiplier(state));
}

/** 道伤未愈时的产量惩罚（「萎靡不振」的具象化） */
export function getInjuryMultiplier(state: GameState): number {
  return state.injurySeconds > 0 ? 1 - INJURY_PRODUCTION_PENALTY : 1;
}

/*
 * 「掌门出门时产量下降」这条惩罚已经**删除**（本轮需求 4）。
 *
 * 原来的设计是"想要材料就得减产"——把出门当成一种取舍。但实际玩下来它只做了一件事：
 * 让玩家不敢出门。而出门本身已经有明确的代价（时间、以及派队伍时的伤亡风险），
 * 再叠一层看不见的全局减产能只让人在事后才发现"我亏了 45%"。
 * 所以 `TRAVEL_PRODUCTION_PENALTY` / `getTravelMultiplier` 一并移除，
 * 产量公式里不再有这一项。
 */

/* ------------------------------------------------------------------ */
/* 钻研与图纸（需求 6）                                                 */
/* ------------------------------------------------------------------ */


/** 该技术的名称（用于界面与门槛提示），未知 id 原样返回 */
export function techName(id: string): string {
  return TECH_MAP[id]?.name ?? id;
}

export function blueprintName(id: string): string {
  return BLUEPRINT_MAP[id]?.name ?? id;
}

/**
 * 汇总所有建筑提供的某一项加成。
 *
 * 把「某种加成怎么算」收敛到一个函数里，新增建筑效果时
 * 只需要在这里加一个 key，界面与逻辑不会各自跑偏。
 */
export type StructureBonusKey =
  | 'cultivationBonus'
  | 'disciplePowerBonus'
  | 'expeditionSpeedBonus'
  | 'expeditionDistanceBonus'
  | 'expeditionYieldBonus'
  | 'casualtyReduction'
  | 'insightBonus'
  | 'breakthroughBonus'
  | 'queueSlots'
  | 'sectDefense'
  | 'alchemySuccessBonus'
  | 'refiningSuccessBonus'
  | 'mindDrain'
  | 'productionBonus';

/**
 * 某个技艺面的派遣加成（需求 3 / 12）。
 *
 * ⚠️ 实现在这里而不是 posting.ts：posting 依赖 engine（拿 getBuildingCount），
 * engine 反过来 import posting 就成了环。数值只有一份来源（content/skills 与
 * content/talents），posting.getPostBonus 是同一个算法对外的名字 ——
 * 两处必须保持一致（冒烟里有断言比对）。
 */
export function getPostBonusHere(state: GameState, kind: SkillKind): number {
  let total = 0;
  for (const d of state.sect.disciples) {
    if (!d.post) continue;
    const def = POST_BUILDINGS[d.post];
    if (!def || def.kind !== kind) continue;
    const points = d.skills[kind] ?? 0;
    const lv = skillLevelOf(points);
    const base = POST_BASE_BONUS + lv * SKILL_BONUS_PER_LEVEL;
    const match = FARM_TALENT_MAP[d.farmTalent]?.kind === kind ? TALENT_MATCH_MULT : 1;
    total += base * match;
  }
  return Math.min(POST_BONUS_CAP, total);
}

export function getStructureBonus(state: GameState, key: StructureBonusKey): number {
  let total = 0;
  for (const def of STRUCTURES) {
    const per = def[key];
    if (!per) continue;
    const count = getBuildingCount(state, def.id);
    if (count > 0) total += per * count;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* 先天特质与盟约的聚合（设定集第 1 / 9 章）                              */
/* ------------------------------------------------------------------ */
/*
 * ⚠️ 为什么这些聚合放在 engine 而不是 fame.ts / diplomacy.ts：
 * `fame.ts` 与 `diplomacy.ts` 都要 import engine（拿 addItem / payCost），
 * 反过来 import 就成环了。而"按 state 算出一个倍率"本来就是 engine 的活。
 * 数值只有一份来源 —— `content/fame.ts` 的 `TRAITS[].effects`。
 */

/** 某个先天特质效果的合计值（没有该特质时为 0；倍率类会返回 1） */
export function getTraitEffect<K extends keyof TraitEffects>(
  state: GameState,
  key: K,
  fallback: number,
): number {
  if (state.traits.length === 0) return fallback;
  let total = fallback;
  for (const id of state.traits) {
    const value = TRAIT_MAP[id]?.effects?.[key];
    if (typeof value !== 'number') continue;
    // 倍率类（以 Mult 结尾）相乘，加法类相加
    if (String(key).endsWith('Mult')) total *= value;
    else total += value;
  }
  return total;
}

/** 是否拥有某个"开关型"特质效果（如上古血脉的资质上偏） */
export function hasTraitEffect(state: GameState, key: keyof TraitEffects): boolean {
  return state.traits.some((id) => TRAIT_MAP[id]?.effects?.[key] === true);
}

/** 已结盟的宗门数带来的产出加成 —— 读取点：getProduction */
export function getAllianceProductionBonus(state: GameState): number {
  const allied = state.npcSects.filter((s) => s.alliance).length;
  return allied * ALLIANCE_PRODUCTION_BONUS;
}

/**
 * 当前声望段位（从高往低找第一个够门槛的）。
 *
 * ⚠️ 与 `fame.getFameTier` 是同一个判断，但是放在 engine：
 * `disciples.ts` 要按段位算招收折扣，而 `fame.ts` 反过来 import 了 disciples
 * （pushJournal）—— 那条路成环。所以"按 state 算出来的东西"一律归 engine，
 * `fame.ts` 只保留纯函数与界面辅助。
 */
export function getFameTierOf(state: GameState): FameTierDef {
  const fame = Math.max(0, Math.min(FAME_MAX, state.fame));
  for (let i = FAME_TIERS.length - 1; i >= 0; i -= 1) {
    if (fame >= FAME_TIERS[i].min) return FAME_TIERS[i];
  }
  return FAME_TIERS[0];
}

/** 段位带来的招收折扣 —— 读取点：disciples.getRecruitCost */
export function fameRecruitDiscount(state: GameState): number {
  return getFameTierOf(state).recruitDiscount;
}

/** 段位带来的商行折扣 —— 读取点：shop.getOfferPrice */
export function fameShopDiscount(state: GameState): number {
  return getFameTierOf(state).shopDiscount;
}

/* ------------------------------------------------------------------ */
/* 种田天赋的全宗聚合（设定集第 8.4 章）                                */
/* ------------------------------------------------------------------ */
/*
 * 这两个函数放在 engine 而不是 disciples：产出、炼丹成功率、灵植成熟速度
 * 都要用它，而 disciples 已经 import engine —— 反过来 import 就成环了。
 * （放 content 也不行：它们要读 state。）
 */

/** 拥有某种种田天赋的弟子数 */
export function countFarmTalent(state: GameState, id: FarmTalentId): number {
  let n = 0;
  for (const d of state.sect.disciples) {
    if (d.farmTalent === id) n += 1;
  }
  return n;
}

/** 某个作用面上，全宗种田天赋提供的加成合计（每条按 √人数 收益递减） */
export function getFarmTalentBonus(state: GameState, target: FarmTalentTarget): number {
  let total = 0;
  for (const def of FARM_TALENTS) {
    if (def.target !== target) continue;
    total += farmTalentBonus(countFarmTalent(state, def.id), def.rate);
  }
  return total;
}

/**
 * 弟子修炼速度倍率。
 *
 * = 1 + 建筑加成（讲道堂 / 功法殿）+ 大比加成（需求 4）
 *
 * ⚠️ 大比原本是**乘算**的 ×2，本轮改成加算 +50%。
 * 原因：它和建筑加成相乘，把整个修行倍率的天花板推到了 ×7.4 左右，
 * 而大比本来只是个"十年一次的节日"，不该是乘区里最重的一块。
 * 改成加算之后：满配 功法殿 80% + 讲道堂 50% + 大比 50% = ×2.80。
 * （心得也在这个加算池里，由 disciples.getDiscipleSpeed 相加，满配 ×4.15。）
 */
/**
 * 弟子修行速度的全局倍率。
 *
 * 需求 4：「幸福度越高，可以给弟子修炼的增益，反之减益」——
 * 所以最后一个乘数是 `getHappinessCultivationMultiplier`：
 * 幸福 100 → ×1.30，幸福 0 → ×0.80。
 */
export function getCultivationSpeedMultiplier(state: GameState): number {
  const buildings = getStructureBonus(state, 'cultivationBonus');
    /*
     * 本轮需求 6：聚灵阵的座数也算进修行加成。
     * 它是**设施**（generator）而不是建筑（structure），而 `getStructureBonus`
     * 只遍历 STRUCTURES，所以这里单独加一项 —— 顺带让"聚灵阵等级"这个说法
     * 在公式里有一个明确的位置。
     */
    const spiritArray = spiritArrayCultivationBonus(getBuildingCount(state, 'spiritArray'));
  const arena = state.arenaBuffSeconds > 0 ? ARENA_BUFF_BONUS : 0;
  // 天象（灵雨 / 极寒之潮）临时改变修行速度（需求 1）。
  // 它是独立的一项，所以不会永久抬高前面算出来的那个天花板。
  const weather = getWeatherEffects(state).cultivation ?? 0;
  return ((Math.max(0, 1 + buildings + spiritArray + arena + weather)) * getHappinessCultivationMultiplier(state)) * (1 + getSectArrayCultivationBonus(state));
}

/**
 * 心得上限（需求：「让心得上限随玩家等级增长」）。
 *
 * 早先是写死的 100 点，既摸不到（实测 21 天最高 52）又是个墙。
 * 现在 = 基数 + 掌门境界 × 每境界增量，于是它跟着玩家等级一起长。
 */
export function getInsightMax(state: GameState): number {
  return INSIGHT_MAX_BASE + Math.max(0, state.realmIndex) * INSIGHT_MAX_PER_REALM;
}

/* ------------------------------------------------------------------ */
/* 地图与探索距离（需求 5）                                             */
/* ------------------------------------------------------------------ */

export interface ExplorationRange {
  /** 可抵达的最远区域下标（-1 表示哪儿都去不了） */
  maxRegionIndex: number;
  /** 当前探索距离（里） */
  distance: number;
  /** 探索距离倍率（灵舟坊等提供） */
  distanceMultiplier: number;
  /** 当前可抵达的区域 */
  reachable: MapRegionDef[];
  /** 可见但还去不了的区域（提前一档显示，便于规划） */
  locked: MapRegionDef[];
}

/** 某个地图区域当前是否已可抵达 */
export function canReachRegion(state: GameState, def: MapRegionDef): boolean {
  return state.realmIndex >= def.requiresRealm;
}

/** 某个地图区域是否已「看得见」（提前一档显示，让玩家知道远处有什么） */
export function isRegionVisible(state: GameState, def: MapRegionDef): boolean {
  return state.realmIndex + REGION_PREVIEW_REALMS >= def.requiresRealm;
}

/**
 * 当前探索范围。
 *
 * 境界决定能到哪些区域（「境界越高可以飞行，所以探索距离可以增加」），
 * 灵舟坊这类造物再给一个距离倍率 —— 它不改变能去的区域，
 * 而是让同样的境界望得更远（探索距离本身只是进度指标）。
 */
export function getExplorationRange(state: GameState): ExplorationRange {
  const distanceMultiplier = 1 + getStructureBonus(state, 'expeditionDistanceBonus');

  const reachable: MapRegionDef[] = [];
  const locked: MapRegionDef[] = [];
  let maxRegionIndex = -1;
  let distance = 0;

  MAP_REGIONS.forEach((region, index) => {
    if (canReachRegion(state, region)) {
      reachable.push(region);
      maxRegionIndex = index;
      distance += region.distance;
    } else if (isRegionVisible(state, region)) {
      locked.push(region);
    }
  });

  return {
    maxRegionIndex,
    distance: Math.round(distance * distanceMultiplier),
    distanceMultiplier,
    reachable,
    locked,
  };
}

/** 某个区域是否已进入探索范围 */
export function isRegionReachable(state: GameState, regionId: string): boolean {
  const def = MAP_REGION_MAP[regionId];
  return Boolean(def) && canReachRegion(state, def);
}

/** 某处秘境是否在可达区域内（秘境探索的第二道门是它自己的 minRealm） */
export function isRealmInRange(state: GameState, def: SecretRealmDef): boolean {
  return isRegionReachable(state, def.regionId);
}

/* ------------------------------------------------------------------ */
/* 秘境发现（需求 1）                                                   */
/* ------------------------------------------------------------------ */

/** 某处秘境是否已经被发现 */
export function isRealmDiscovered(state: GameState, def: SecretRealmDef): boolean {
  return state.discoveredRealms[def.id] === true;
}

/** 已经发现的秘境列表（按地图由近到远排序） */
export function getDiscoveredRealms(state: GameState): SecretRealmDef[] {
  return SECRET_REALMS.filter((def) => isRealmDiscovered(state, def));
}

/**
 * 当前还可能被发现的秘境。
 *
 * 条件：还没发现、所在区域已抵达、发现权重 > 0。
 *
 * ⚠️ 这里**故意不按区域收窄**，尽管看起来那样更"合理"。
 *
 * 试过一版：只在同一个小区域群内发现，想开新的大区域就必须先在那里做普通探索。
 * 逻辑上更贴合「每个小区域在未发现秘境时只能普通探索」，但实测**经济被拖垮** ——
 * 高端秘境的发现被推迟，玄铁、星辰砂这些关键材料跟不上，器物落后，
 * 弟子战力不足 → 伤亡上升 → 修为上不去 → 寿元短 → 人口崩盘
 * （30 天模拟结束时弟子 0 人，而全局候选池那一版是 40 人）。
 *
 * 需求要的是「**那个小区域里**没发现秘境时只能普通探索」——
 * 这是"当地能做什么"的规则，在 `canSurveyRegion` / `canStartExpedition` 里执行，
 * 并不要求"发现"也必须发生在当地。所以保持全局候选池：
 * 弟子在远方听说了秘境，也是修行界常有的事。
 *
 * `nearRegionId` 仍然保留，用于日志与将来可能的加权，不影响候选集。
 */
export function getUndiscoveredCandidates(state: GameState, nearRegionId?: string): SecretRealmDef[] {
  void nearRegionId;
  return SECRET_REALMS.filter(
    (def) => !isRealmDiscovered(state, def) && isRealmInRange(state, def) && def.discoveryWeight > 0,
  );
}

/**
 * 一次探索结束时的「发现新秘境」概率。
 *
 * = 基础概率 + 寻宝宝盘加成
 *
 * ⚠️ 这是**全游戏唯一**的发现概率公式，也是唯一一个能提升它的东西。
 * 早先这里还叠加了建筑加成（山门 / 通天塔 / 照天镜）、探索距离折算、
 * 队伍人数加成 —— 五个来源全挤在 DISCOVERY_MAX_CHANCE 这一个上限上，
 * 后期无论建哪一座都被砍到同一个数，几座建筑之间完全没有区分度。
 * 现在只有寻宝宝盘（七品炼器 + 超稀有材料）能往上加。
 *
 * 保底**不在这个公式里**：它是独立的一条机制（见 isDiscoveryGuaranteed），
 * 连续失败太多次时直接兜一次底，所以"概率"确实只有一个来源。
 */
/**
 * 发现新秘境的概率。
 *
 * 「洞察先机」（战斗辅助天赋，需求 3）在这里生效 —— 它读的是全宗最强的那一个，
 * 所以带一个这样的弟子出门就够了。
 */
export function getDiscoveryChance(state: GameState): number {
  const compass = getArtifactBonuses(state).discovery;
  /*
   * 「洞察先机」（战斗辅助天赋，需求 3）：发现新秘境的概率 +15%。
   * 只取全宗最高的那一个 —— 带一个这样的弟子出门就够了，带十个不会叠。
   */
  const talent = getSectTalentDiscoveryBonus(state);
  return Math.min(DISCOVERY_BASE_CHANCE + compass + talent, DISCOVERY_MAX_CHANCE);
}

/**
 * 全宗「洞察先机」带来的发现概率加成。
 *
 * ⚠️ 实现在 engine 里，因为 engine 不能 import disciples（两者会成环）。
 * 数值仍然只有一份来源：`content/talents` 的 COMBAT_TALENTS。
 */
export function getSectTalentDiscoveryBonus(state: GameState): number {
  let best = 0;
  for (const d of state.sect.disciples) {
    const def = COMBAT_TALENT_MAP[d.combatTalent];
    if (def?.discoveryBonus) best = Math.max(best, def.discoveryBonus);
  }
  return best;
}

/** 寻宝宝盘带来的发现概率加成（界面用来解释"为什么概率是这个数"） */
export function getDiscoveryBonusFromArtifacts(state: GameState): number {
  return getArtifactBonuses(state).discovery;
}

/** 连续失败太多次 → 下一次必然发现（硬保底，独立于概率公式） */
export function isDiscoveryGuaranteed(state: GameState): boolean {
  return state.discoveryFailures >= DISCOVERY_PITY_FAILURES;
}

/** 还差几次失败才触发硬保底（界面提示用） */
export function getDiscoveryPityRemaining(state: GameState): number {
  return Math.max(0, DISCOVERY_PITY_FAILURES - state.discoveryFailures);
}

/** 发现失败时累积一次失败计数 */
export function recordDiscoveryFailure(state: GameState): GameState {
  return { ...state, discoveryFailures: state.discoveryFailures + 1 };
}

/** 秘境的冷却剩余秒数 */
export function getRealmCooldown(state: GameState, realmId: string): number {
  return state.realmCooldowns[realmId] ?? 0;
}

/** 该秘境现在是否处于冷却中 */
export function isRealmOnCooldown(state: GameState, realmId: string): boolean {
  return getRealmCooldown(state, realmId) > 0;
}

/** 推进所有秘境的冷却计时（需求 1） */
export function tickRealmCooldowns(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  const entries = Object.entries(state.realmCooldowns);
  if (entries.length === 0) return state;

  // 冷却归零的条目直接删掉，存档里不会堆积一堆 0
  const realmCooldowns: Record<string, number> = {};
  for (const [id, seconds] of entries) {
    const left = seconds - dt;
    if (left > 0) realmCooldowns[id] = left;
  }
  return { ...state, realmCooldowns };
}

/** 灵植地块总数（需求 5），由灵植园 / 药王圃提供 */
export function getPlotCapacity(state: GameState): number {
  let total = 0;
  for (const def of STRUCTURES) {
    if (!def.plots) continue;
    total += getBuildingCount(state, def.id) * def.plots;
  }
  return total;
}

/** 商行货位：基础货位数 + 每多一座商行多摆几件 */
export function getShopOfferCapacity(state: GameState): number {
  let extra = 0;
  for (const def of STRUCTURES) {
    if (!def.shopSlots) continue;
    extra += getBuildingCount(state, def.id) * def.shopSlots;
  }
  if (extra <= 0) return 0;
  return SHOP_OFFER_COUNT + extra;
}

/** 是否已经建起商行（没建就完全不刷新货架） */
export function hasShop(state: GameState): boolean {
  return getShopOfferCapacity(state) > 0;
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

/** 仆人的招收花费（固定值，不再随人数增长：见 servants.ts 的 SERVANT_COST） */
export function getServantCost(state: GameState): Decimal {
  return D(servantCost(getServantCount(state)));
}

export interface RecruitCheck {
  ok: boolean;
  reason: string | null;
}

export function canRecruitServant(state: GameState): RecruitCheck {
  if (getServantHousing(state) === 0) {
    return { ok: false, reason: '尚无仆役居所，先建一座茅屋' };
  }
  if (getFreeServantHousing(state) <= 0) {
    return { ok: false, reason: '仆役居所已满，需再建一座（弟子居所不算数）' };
  }
  if (state.resources.qi.lt(getServantCost(state))) {
    return { ok: false, reason: '灵气不足' };
  }
  return { ok: true, reason: null };
}

/**
 * 把 N 名仆人从某工种一次调到另一工种（本轮需求 4：批量转移）。
 *
 * 与 `assignServant` 的关系是"一次搬完"而不是"逐次搬"：
 * 数量先夹到源工种现有的人数，所以传 `count` 大于实际人数也不会出错，
 * 传 `Infinity`/`总数` 就是"这个岗位的人全搬过去"。
 */
export function assignServants(state: GameState, from: ServantJobId, to: ServantJobId, count: number): GameState {
  if (from === to) return state;
  const fromCount = state.servants[from] ?? 0;
  if (fromCount <= 0) return state;
  const move = Math.min(fromCount, Math.max(0, Math.floor(count)));
  if (move <= 0) return state;

  const servants = { ...state.servants };
  if (fromCount > move) servants[from] = fromCount - move;
  else delete servants[from];
  servants[to] = (servants[to] ?? 0) + move;

  return { ...state, servants };
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

/** 遣散一名某工种的仆人（回收一个仆役床位 —— 与弟子床位无关，需求 2） */
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

  /*
   * 季节与天象：作用在**每一种资源**上（需求 1）。
   *
   * 必须放在这里而不是 getGlobalMultiplier 里 —— 因为四季对不同资源
   * 的加成不一样（春 +45% 灵草、冬 -35% 灵草），一个全局倍率表达不了。
   * 放在这里的好处是：资源栏显示的每秒产量、实际落袋的产量、
   * 以及"丹药给 N 秒产量"这类一次性结算，全都自动吃到了季节加成。
   */
  for (const id of RESOURCE_IDS) {
    const bonus = getEnvironmentResourceBonus(state, id);
    if (bonus !== 0) out[id] = out[id].mul(Math.max(0, 1 + bonus));
  }

  /*
   * 种田天赋（设定集第 8.4 章）：灵泉感悟抬灵气、灵草亲和抬灵草。
   *
   * 只作用于这两条资源线 —— 天赋描述里说的就是"门派灵气产出速度""门派灵田产量"，
   * 而不是"所有资源"。放在最后一步（在季节之后）是因为它是一个**人**的加成，
   * 与气候无关；顺序在这里不影响结果（都是乘法），但读起来更清楚。
   */
  out.qi = out.qi.mul(1 + getFarmTalentBonus(state, 'qi'));
  out.herb = out.herb.mul(1 + getFarmTalentBonus(state, 'herb'));

  /*
   * 先天特质与盟约（设定集第 1 / 9 章）：
   *   灵脉福地 ×1.25 灵气 · 万载灵泉 ×1.15 灵气 · 药圃天成 ×1.25 灵草
   *   每个盟友宗门 +3% 全产出
   * 盟约那一条作用于**所有**资源（它是"整个山门的景气"，不是某一条产线），
   * 特质那两条则各管自己那一味。
   */
  /*
   * 派遣加成（需求 3 / 12）：灵田里在岗的弟子提高灵草产量。
   * 只作用于灵草这一条线 —— 丹房 / 炼器房 / 符房的岗位作用在
   * 各自的**成功率**上（见 crafting.getCraftSuccessRate），不是产量。
   */
  out.herb = out.herb.mul(1 + getPostBonusHere(state, 'farm'));

  const alliance = 1 + getAllianceProductionBonus(state);
  for (const id of RESOURCE_IDS) out[id] = out[id].mul(alliance);
  out.qi = out.qi.mul(getTraitEffect(state, 'qiMult', 1));
  out.herb = out.herb.mul(getTraitEffect(state, 'herbMult', 1));

  return out;
}

/** 单个设施已计入全局倍率与季节的每秒产量 */
export function getGeneratorOutput(state: GameState, def: GeneratorDef): Decimal {
  const count = state.buildings[def.id] ?? 0;
  const seasonal = Math.max(0, 1 + getEnvironmentResourceBonus(state, def.produces));
  return D(count).mul(def.baseOutput).mul(getGlobalMultiplier(state)).mul(seasonal);
}

/* ------------------------------------------------------------------ */
/* 建筑购买                                                            */
/* ------------------------------------------------------------------ */

/**
 * 买 count 个的总价。
 * 价格是等比数列，用求和公式一次算完，不用循环。
 */
/**
 * 需求 11 的成长加成。
 *
 * 原文：「每多建一个消耗的资源也**多增加一些**」。
 * 做法不是去改 76 座建筑各自的 costGrowth（那会散成 76 个数字、
 * 以后没人敢动），而是**在这里统一把涨幅抬陡**：
 *   growth = 1 + (costGrowth − 1) × 1.45
 * 于是"每多一座的涨幅"整体 +45%，而每座建筑之间的相对关系不变。
 *
 * 另外给一个下限 1.3：原本 1.25 那种"越建越便宜"的老建筑也一并收紧。
 */
/*
 * ⚠️ 力度调过一轮：第一版 1.45 把后期拖垮了（合体→大乘 从 2 天 23 小时
 * 变成 16 天 22 小时，30 天只到大乘 5 层）—— 需求 11 要的是「每多建一个
 * 更贵」，不是「贵到建不起」。1.2 既满足需求，又保住了第 17 轮定的节奏。
 */
export const BUILD_COST_GROWTH_BOOST = 1.2;
export const BUILD_COST_GROWTH_FLOOR = 1.3;

function steepenedGrowth(costGrowth: number): number {
  if (costGrowth <= 1) return 1;
  return Math.max(BUILD_COST_GROWTH_FLOOR, 1 + (costGrowth - 1) * BUILD_COST_GROWTH_BOOST);
}

export function getCost(def: BuildableDef, owned: number, count: number): CostMap {
  const out: CostMap = {};
  for (const [id, base] of Object.entries(def.baseCost) as [ItemId, number][]) {
    // costGrowth === 1（只可能建一座的建筑，如掌门大殿 / 比武台）必须单独处理：
    // 等比求和公式要除以 (r - 1)，r = 1 时会算出 NaN，
    // 结果就是"明明买得起却买不动"。这个坑是被数值模拟器抓出来的。
    out[id] =
      def.costGrowth === 1
        ? D(base * count)
        : Decimal.sumGeometricSeries(count, base, steepenedGrowth(def.costGrowth), owned);
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
    // 同上：价格不涨时直接除，绕开 r = 1 的退化情况
    const n =
      def.costGrowth === 1
        ? Math.floor(available.div(base).toNumber())
        : Decimal.affordGeometricSeries(available, base, def.costGrowth, owned).floor().toNumber();
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
 *
 * 技术与图纸门槛**不**参与这个判断（需求 6）：它们不隐藏建筑，
 * 反而是建筑卡片上的一个提示 —— 玩家得先知道"有丹房这东西，
 * 但要钻研炼丹入门"，才有可能去钻研。
 */
export function isUnlocked(def: BuildableDef, state: GameState): boolean {
  if (!state.unlockedBuildings[def.id]) return false;
  if (def.requiresRealm !== undefined && state.realmIndex + 1 < def.requiresRealm) return false;
  if (def.requiresSectLevel && state.sect.level + 1 < def.requiresSectLevel) return false;
  return true;
}

/**
 * 现在能不能建。返回不能建造的原因，null 表示可以。
 *
 * 顺序即「玩家下一步该干什么」：
 *   先开宗 → 先钻研 / 先找图纸 / 先建前置建筑 → 再看等级。
 */
export function getBuildGate(def: BuildableDef, state: GameState): string | null {
  if (!state.unlockedBuildings[def.id]) return '尚未解锁';
  if (def.requiresSect && !state.sect.founded) return '需先开宗立派';
  if (def.requiresTech && !state.techs[def.requiresTech]) {
    return `需钻研「${techName(def.requiresTech)}」`;
  }
  if (def.requiresBlueprint && !state.blueprints[def.requiresBlueprint]) {
    return `需「${blueprintName(def.requiresBlueprint)}」`;
  }
  if (def.requiresBuilding) {
    const need = BUILDABLE_MAP[def.requiresBuilding];
    if (getBuildingCount(state, def.requiresBuilding) <= 0) {
      return `需先建${need?.name ?? def.requiresBuilding}`;
    }
  }
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
/**
 * 某座库房的空间禁制加成（需求 6）：每层 +25% 容量。
 *
 * 读的是 `state.spatialWards[buildingId]`；施加动作在 game/spatial.ts。
 */
export function getSpatialWardBonus(state: GameState, buildingId: string): number {
  const stacks = state.spatialWards[buildingId] ?? 0;
  return stacks * SPATIAL_WARD_CAPACITY_BONUS;
}

export function getStorageCaps(state: GameState): Record<ResourceId, Decimal> {
  const caps = {} as Record<ResourceId, Decimal>;
  for (const id of RESOURCE_IDS) caps[id] = D(BASE_STORAGE[id]);

  for (const def of STRUCTURES) {
    if (!def.storage) continue;
    const count = state.buildings[def.id] ?? 0;
    if (count <= 0) continue;
    /*
     * 需求 6：空间禁制作用在**这一座库房**上，所以加成是逐建筑算的 ——
     * `1 + 层数 × 25%`。这也是为什么它是"主动施加在某一座库房上"，
     * 而不是一个全局被动：加成跟着建筑走。
     */
    const ward = 1 + getSpatialWardBonus(state, def.id);
    for (const [id, amount] of Object.entries(def.storage) as [ResourceId, number][]) {
      caps[id] = caps[id].add(count * amount * ward);
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
 * 把新达成的解锁条件永久记录下来。
 *
 * 每次状态推进后都会调用（主循环、购买、读档……）。
 * 没有新解锁时返回**原对象**，避免无谓的重新渲染。
 *
 * 注意：秘境**不在这里解锁**。需求 1 之后秘境改为「探索中发现」，
 * 由 expeditions / travel 在结算时随机揭示（见 discoverRealm）。
 */
export function refreshUnlocks(state: GameState): GameState {
  let unlockedBuildings: Record<string, boolean> | null = null;
  for (const def of BUILDABLES) {
    if (state.unlockedBuildings[def.id]) continue;
    if (!meetsUnlockCondition(def, state)) continue;
    unlockedBuildings = unlockedBuildings ?? { ...state.unlockedBuildings };
    unlockedBuildings[def.id] = true;
  }

  if (!unlockedBuildings) return state;
  return { ...state, unlockedBuildings };
}

/* ------------------------------------------------------------------ */
/* 秘境解锁                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把一处秘境记为「已发现」（需求 1）。
 *
 * 发现后永久固定，不会因为材料被花掉而消失 —— 这是需求原文
 * 「发现后固定在秘境栏」的字面实现。
 */
export function discoverRealm(state: GameState, realmId: string): GameState {
  if (state.discoveredRealms[realmId]) return state;
  return {
    ...state,
    discoveredRealms: { ...state.discoveredRealms, [realmId]: true },
    // 发现了新的，硬保底的失败计数清零
    discoveryFailures: 0,
  };
}

/** 秘境的宗门等级门槛是否达标（与「是否已发现」是两件事） */
export function meetsRealmSectGate(def: SecretRealmDef, state: GameState): boolean {
  return !def.requiresSectLevel || state.sect.level >= def.requiresSectLevel;
}

/**
 * 该秘境现在能不能派遣。
 *
 * = 已发现 + 区域已抵达 + 宗门等级达标 + 不在冷却中
 * 弟子境界门槛在 expeditions.canStartExpedition 里单独判断。
 */
export function isRealmAvailable(state: GameState, def: SecretRealmDef): boolean {
  if (!isRealmDiscovered(state, def)) return false;
  if (!isRealmInRange(state, def)) return false;
  if (!meetsRealmSectGate(def, state)) return false;
  return !isRealmOnCooldown(state, def.id);
}

/** 已发现但当前不可派的原因（用于界面提示），可派遣时返回 null */
export function getRealmGate(state: GameState, def: SecretRealmDef): string | null {
  if (!isRealmDiscovered(state, def)) return '尚未发现';
  if (!isRealmInRange(state, def)) {
    const region = MAP_REGION_MAP[def.regionId];
    return `需先能抵达${region?.name ?? def.regionId}`;
  }
  if (!meetsRealmSectGate(def, state)) return `需${def.requiresSectLevel}品宗门`;
  const cooldown = getRealmCooldown(state, def.id);
  if (cooldown > 0) return `冷却中 ${Math.ceil(cooldown)} 秒`;
  return null;
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
/* 秘境开启（需求 1）                                                   */
/* ------------------------------------------------------------------ */

/** 这处秘境需不需要先"开启"（只有资源富集区的秘境需要） */
export function needsOpening(def: SecretRealmDef): boolean {
  return def.unlockCost !== undefined && Object.keys(def.unlockCost).length > 0;
}

/** 这处秘境开启了没有（不需要开启的直接算已开启） */
export function isRealmOpened(state: GameState, def: SecretRealmDef): boolean {
  if (!needsOpening(def)) return true;
  return state.openedRealms[def.id] === true;
}

/** 开启所需的消耗 */
export function getOpenCost(def: SecretRealmDef): CostMap {
  return toCostMap(def.unlockCost ?? {});
}

/** 能不能开启：已发现、还没开、资源够，三道关 */
export function canOpenRealm(state: GameState, def: SecretRealmDef): { ok: boolean; reason: string | null } {
  if (!needsOpening(def)) return { ok: false, reason: '此地无需开启' };
  if (!isRealmDiscovered(state, def)) return { ok: false, reason: '尚未发现此秘境' };
  if (isRealmOpened(state, def)) return { ok: false, reason: '已经开启' };
  if (!canAfford(state, getOpenCost(def))) return { ok: false, reason: '资源不足' };
  return { ok: true, reason: null };
}

/** 花资源开启一处秘境（一次性，永久生效） */
export function openRealm(state: GameState, def: SecretRealmDef): GameState {
  if (!canOpenRealm(state, def).ok) return state;
  const paid = payCost(state, getOpenCost(def));
  return {
    ...paid,
    openedRealms: { ...paid.openedRealms, [def.id]: true },
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'good',
      text: `耗费资源立起阵眼，${def.name} 已开启`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 建造队列（需求 2）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 当前有几个建造队列名额（3~7）。
 *
 *   基础 3 个
 *   + 天工院本身 1 个（它唯一）
 *   + 天工院的特殊升级，每级 1 个（最多 3 级）
 * = 最多 7 个，正好对上需求里的「最多允许7个建筑排队，初始只有3个排队名额」。
 */
export function getQueueSlots(state: GameState): number {
  const fromBuildings = getStructureBonus(state, 'queueSlots');
  const fromUpgrades = Math.min(QUEUE_UPGRADES.length, Math.max(0, state.tiangongLevel));
  return Math.min(BUILD_QUEUE_MAX_SLOTS, BUILD_QUEUE_BASE_SLOTS + fromBuildings + fromUpgrades);
}

/** 天工院是否已经建好（升级的前提） */
export function hasQueueBuilding(state: GameState): boolean {
  return getBuildingCount(state, BUILD_QUEUE_BUILDING) > 0;
}

/** 把升级表里的数字花费转成 canAfford / payCost 认的 Decimal 形式 */
function queueUpgradeCost(upgrade: QueueUpgradeDef): Partial<Record<ItemId, Decimal>> {
  const cost: Partial<Record<ItemId, Decimal>> = {};
  for (const [item, amount] of Object.entries(upgrade.cost)) {
    cost[item as ItemId] = D(amount as number);
  }
  return cost;
}

/** 下一级特殊升级的花费；已经满级返回 null */
export function getQueueUpgrade(state: GameState): QueueUpgradeDef | null {
  return QUEUE_UPGRADES[state.tiangongLevel] ?? null;
}

/** 能不能升级天工院 */
export function canUpgradeQueue(state: GameState): { ok: boolean; reason: string | null } {
  if (!hasQueueBuilding(state)) {
    return { ok: false, reason: `需先建${BUILDABLE_MAP[BUILD_QUEUE_BUILDING]?.name ?? '天工院'}` };
  }
  const upgrade = getQueueUpgrade(state);
  if (!upgrade) return { ok: false, reason: '已开到最多名额' };
  if (getQueueSlots(state) >= BUILD_QUEUE_MAX_SLOTS) return { ok: false, reason: '已开到最多名额' };
  if (!canAfford(state, queueUpgradeCost(upgrade))) return { ok: false, reason: '资源不足' };
  return { ok: true, reason: null };
}

/** 特殊升级天工院，解锁一个建造名额 */
export function upgradeQueue(state: GameState): GameState {
  const check = canUpgradeQueue(state);
  if (!check.ok) return state;
  const upgrade = getQueueUpgrade(state);
  if (!upgrade) return state;
  return {
    ...payCost(state, queueUpgradeCost(upgrade)),
    tiangongLevel: state.tiangongLevel + 1,
  };
}

/** 把一个可建造物排进队列 */
export function enqueueBuild(state: GameState, id: string): GameState {
  if (!BUILDABLE_MAP[id]) return state;
  if (state.buildQueue.length >= getQueueSlots(state)) return state;
  return { ...state, buildQueue: [...state.buildQueue, id] };
}

export function dequeueBuild(state: GameState, index: number): GameState {
  if (index < 0 || index >= state.buildQueue.length) return state;
  return { ...state, buildQueue: state.buildQueue.filter((_, i) => i !== index) };
}

/** 在队列里上移 / 下移一项（delta 为 -1 / +1） */
export function moveQueueItem(state: GameState, index: number, delta: number): GameState {
  const target = index + delta;
  if (index < 0 || index >= state.buildQueue.length) return state;
  if (target < 0 || target >= state.buildQueue.length) return state;
  const queue = [...state.buildQueue];
  [queue[index], queue[target]] = [queue[target], queue[index]];
  return { ...state, buildQueue: queue };
}

export function clearQueue(state: GameState): GameState {
  return state.buildQueue.length === 0 ? state : { ...state, buildQueue: [] };
}

/**
 * 推进建造队列：队首只要**门槛过了、资源也够**，就立刻建一座并出队。
 *
 * 这个语义是刻意的：队列不是"定时开工"，而是**把玩家想盖的东西排好队**，
 * 资源一到就自动盖 —— 挂机 / 离线回来时收益最大。
 * 门槛没到或资源不够时会原地等着，不消耗也不跳过，
 * 因为"为什么没盖"这件事必须可预期，玩家才知道该攒什么。
 *
 * 一次 tick 只推进一座：连建会让"刚花掉资源"和"刚入账的资源"在同一帧里
 * 互相看不见，反而更难预测。
 */
export function tickBuildQueue(state: GameState): GameState {
  if (state.buildQueue.length === 0) return state;

  const id = state.buildQueue[0];
  const def = BUILDABLE_MAP[id];
  if (!def) return { ...state, buildQueue: state.buildQueue.slice(1) };
  if (getBuildGate(def, state) !== null) return state;

  const owned = getBuildingCount(state, def.id);
  if (def.max !== undefined && owned >= def.max) return { ...state, buildQueue: state.buildQueue.slice(1) };
  if (maxAffordable(def, owned, state) <= 0) return state;

  const next = buyBuilding(state, def, 1);
  if (next === state) return state;
  return { ...next, buildQueue: next.buildQueue.slice(1) };
}

/* ------------------------------------------------------------------ */
/* 建筑效果                                                            */
/* ------------------------------------------------------------------ */

/** 仆役居所提供的总床位（需求 2：与弟子居所分开算） */
export function getServantHousing(state: GameState): number {
  let capacity = 0;
  for (const def of STRUCTURES) {
    if (!def.servantCapacity) continue;
    capacity += getBuildingCount(state, def.id) * def.servantCapacity;
  }
  return capacity;
}

/**
 * 弟子居所提供的总床位（需求 2）。开宗前一定是 0 —— 这类建筑都要求已开宗。
 *
 * ⚠️ 满配床位（四档各盖到上限是 1.2 万+）远超九品宗门的 2048 人上限，
 * 也就是说"床位"在弟子这条线上只是**前期**（一品 ~100 人时）的真实约束，
 * 中后期真正卡人的是宗门品阶。这是刻意的：居所是入门门槛，品阶是长期目标。
 */
export function getDiscipleHousing(state: GameState): number {
  let capacity = 0;
  for (const def of STRUCTURES) {
    if (!def.discipleCapacity) continue;
    capacity += getBuildingCount(state, def.id) * def.discipleCapacity;
  }
  return capacity;
}

/** 已占用的仆役床位 */
export function getServantHousingUsed(state: GameState): number {
  return getServantCount(state);
}

/** 已占用的弟子床位（开宗前弟子恒为 0，这里不必特判） */
export function getDiscipleHousingUsed(state: GameState): number {
  return state.sect.disciples.length;
}

export function getFreeServantHousing(state: GameState): number {
  return Math.max(0, getServantHousing(state) - getServantHousingUsed(state));
}

export function getFreeDiscipleHousing(state: GameState): number {
  return Math.max(0, getDiscipleHousing(state) - getDiscipleHousingUsed(state));
}

/**
 * 弟子总数上限 = min(弟子居所床位, 宗门品阶上限)。
 *
 * 需求 1 给的是**品阶**这一条线（一品 100 → 九品 2048），
 * 需求 2 给的是**建筑**这一条线（弟子居所要开宗后自己盖）。
 * 两条都是硬上限，所以取较小值：品阶决定"你这个宗门配得上多少弟子"，
 * 居所决定"你实际安顿得下多少弟子"。
 *
 * 与旧版的区别：仆人**不再**占弟子的名额。原先 `居所 - 仆人数` 让
 * "养仆人换产量"和"收弟子换战力"变成零和题；现在两边各自盖各自的房子，
 * 取舍从"抢床位"变成"资源先投哪一边"。
 */
export function getDiscipleCapacity(state: GameState): number {
  if (!state.sect.founded) return 0;
  return Math.min(getDiscipleHousing(state), discipleCapBySect(state.sect.level));
}

/**
 * 仆人总数上限 = 仆役居所床位。
 *
 * 与弟子居所完全无关 —— 这是需求 2「仆役居所和弟子居所区分开」的直接结论：
 * 想多收仆人，就再盖一间仆役居所，不必再看弟子的脸色。
 */
export function getServantCapacity(state: GameState): number {
  return getServantHousing(state);
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
  /*
   * 需求 16：小境界参悟的灵气也按境界系数放大。
   *
   * ⚠️ 第一版只放大了大境界突破的灵气，实测**完全没有效果** ——
   * 掌门的真正闸门是"每个大境界的 9 个小境界"，那一部分没动，
   * 结果渡劫期还是在第 7 天就到了。两条闸门必须一起加系数。
   */
  return D(realm.baseLayerCost)
    .mul(Decimal.pow(realm.costGrowth, state.layer))
    .mul(PROGRESS_QI_SCALE[Math.min(state.realmIndex, PROGRESS_QI_SCALE.length - 1)] ?? 1);
}

export function canAdvanceLayer(state: GameState): boolean {
  const cost = getLayerCost(state);
  return cost !== null && state.resources.qi.gte(cost);
}

/**
 * 参悟一层小境界（需求 2 起：小境界也会遭天雷）。
 *
 * 恶行值高的时候，参悟有一定概率**失败** —— 灵气照样消耗（这就是代价），
 * 境界不涨，还会落下一段道伤。需求原文特意点了"小境界突破也会"，
 * 所以这条不能只挂在大境界上。
 */
export function advanceLayer(state: GameState, random: RandomSource = gameRandom): GameState {
  const cost = getLayerCost(state);
  if (cost === null || state.resources.qi.lt(cost)) return state;

  const penalty = getKarmaThunderPenalty(state);
  const struck = penalty > 0 && random() < penalty;

  if (struck) {
    return {
      ...state,
      resources: { ...state.resources, qi: state.resources.qi.sub(cost) },
      injurySeconds: Math.max(state.injurySeconds, KARMA_LAYER_FAIL_INJURY),
      journal: pushJournal(state.journal, {
        time: state.playTime,
        kind: 'bad',
        text: `参悟第 ${state.layer + 1} 层时天雷加身，功亏一篑（恶行值 ${Math.round(getKarma(state))}）`,
      }),
    };
  }

  return {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.sub(cost) },
    layer: state.layer + 1,
  };
}

export interface BreakthroughStatus {
  possible: boolean;
  reason: string | null;
  /** 该境界**必须**服用的境界丹 id（可能为空字符串） */
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
  // 需求 16：突破所需灵气按境界系数放大（越往后越陡）
  if (state.resources.qi.lt(scaledBreakthroughQi(state.realmIndex))) {
    return { possible: false, reason: '灵气不足', pillId, hasPill, injurySeconds, safe };
  }
  /*
   * 需求 9：「突破对丹药的需求很强烈」。
   *
   * 这是本轮最硬的一条规则 —— **没有对应境界丹就直接不允许尝试**。
   * 原来的丹药只是一个 +35% 的可选项，于是它其实可有可无：
   * 攒够灵气就能反复撞，撞几次总会过（还有失败保底）。
   * 现在丹药是门票，宗门就必须真的把炼丹这条线跑起来。
   */
  if (!hasPill) {
    const pill = PILL_MAP[pillId];
    return {
      possible: false,
      reason: `需${pill?.name ?? '对应境界丹'}（丹房炼制，或秘境掉落）`,
      pillId,
      hasPill,
      injurySeconds,
      safe,
    };
  }
  return { possible: true, reason: null, pillId, hasPill, injurySeconds, safe };
}

/**
 * 突破成功率（0~1）。
 *
 * 需求 9 之后**不再有 `usePill` 开关** —— 丹药是硬门槛，能走到这里就一定在服丹，
 * 所以丹药加成恒为「补掉 (1 − baseSuccess) 的 62%」。
 *
 * 另外两项加成照旧加在最上面：
 *   - 建筑（雷池）与天象：`getStructureBonus` / `getWeatherEffects`；
 *   - 「固本丹」之类的永久加成：`state.globalBreakthroughBonus`。
 */
export function getSuccessRate(state: GameState): number {
  // 星象亲和（先天特质）：掌门突破成功率 +6% —— 读取点就在这里
  const traitBonus = getTraitEffect(state, 'breakthroughBonus', 0);
  const realm = getRealm(state);
  if (isFinalRealm(state)) return 1;

  const base = realm.baseSuccess;
  const pill = (1 - base) * BREAKTHROUGH_PILL_GAP_RECOVERY;
  // 雷池等建筑也提供突破加成；天象（天雷劫云）也会临时加一点（需求 1）
  const building = getStructureBonus(state, 'breakthroughBonus');
  const weather = getWeatherEffects(state).breakthrough ?? 0;
  /*
   * 恶行值带来的天雷之罚（需求 2）：恶行值越高，突破时越容易挨天雷。
   * 这里对**大境界突破**生效；小境界参悟走的是 advanceLayer，那边单独判一次。
   * 成功率留一个下限（KARMA_SUCCESS_FLOOR），否者恶行线会变成死路。
   */
  const thunder = getKarmaThunderPenalty(state);

  const raw = base + pill + state.globalBreakthroughBonus + building + weather - thunder + traitBonus;
  return Math.max(KARMA_SUCCESS_FLOOR, Math.min(raw, BREAKTHROUGH_MAX_SUCCESS));
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
 * 需求 9 起：**必须消耗一颗对应境界丹**（`getBreakthroughStatus` 已经把
 * 没有丹药的情况挡在门外）。所以这个函数不再有 `usePill` 参数 ——
 * 能进来就一定要吃丹，丹药在函数内部直接扣。
 *
 * 失败的代价按境界分级：
 *   - **低境界（炼气 / 筑基 / 金丹）失败没有任何负面影响** ——
 *     灵气全额返还，没有冷却。前期是教学阶段，不该惩罚玩家。
 *   - **元婴期起失败会留下「道伤」**：一段时间内无法再次突破，
 *     且全局产量下降。失败仍返还一半灵气。
 *
 * ⚠️ 「失败后累积保底成功率」（breakthroughPity）本轮已按需求 9 删除。
 * 那条机制的作用是"撞够次数总会过"，而它正好抵消了丹药的价值 ——
 * 既然丹药现在是门票，就不该再有第二条不花丹药的路。
 */
export function breakthrough(
  state: GameState,
  random: RandomSource = gameRandom,
): BreakthroughResult | null {
  const status = getBreakthroughStatus(state);
  if (!status.possible) return null;

  const rate = getSuccessRate(state);
  const success = random() < rate;

  // 丹药是门票：无论成败都消耗（这是需求 9 的核心代价）
  const pills = { ...state.pills };
  if (status.pillId && (pills[status.pillId] ?? 0) > 0) {
    const left = (pills[status.pillId] ?? 0) - 1;
    if (left > 0) pills[status.pillId] = left;
    else delete pills[status.pillId];
  }

  // 失败时的灵气消耗：
  //   成功        → 全额消耗
  //   低境界失败  → 全额返还（无任何代价）
  //   高境界失败  → 返还一半
  const need = scaledBreakthroughQi(state.realmIndex);
  const qiSpent = success ? need : status.safe ? 0 : need * 0.5;

  const injurySeconds =
    success || status.safe ? 0 : (INJURY_SECONDS[state.realmIndex] ?? INJURY_FALLBACK_SECONDS);

  const next: GameState = {
    ...state,
    resources: { ...state.resources, qi: state.resources.qi.sub(qiSpent) },
    pills,
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
  if (state.sect.founded || state.realmIndex < SECT_MIN_REALM) return state;
  const cost = toCostMap(SECT_LEVELS[0].cost);
  if (!canAfford(state, cost)) return state;

  const paid = payCost(state, cost);
  return { ...paid, sect: { ...paid.sect, founded: true, level: 1 } };
}

/* ------------------------------------------------------------------ */
/* 飞升                                                                */
/* ------------------------------------------------------------------ */

export function canAscend(state: GameState): boolean {
  return state.realmIndex >= ASCENSION_MIN_REALM && getDaoYunGain(state).gt(0);
}

export function getDaoYunGain(state: GameState): Decimal {
  if (state.realmIndex < ASCENSION_MIN_REALM) return D(0);
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

/* ------------------------------------------------------------------ */
/* 通用合成 / 精炼（需求 4）                                            */
/* ------------------------------------------------------------------ */

/** 一条配方现在的门槛提示；null = 可以做 */
export function getRefineGate(recipe: RefineRecipe, state: GameState): string | null {
  if (!state.unlockedBuildings) {
    // 防御性：理论上不会发生（unlockedBuildings 恒有值）
  }
  if (state.realmIndex < recipe.requiresRealm) return `需${REALMS[recipe.requiresRealm].name}`;
  if (recipe.requiresTech && !state.techs[recipe.requiresTech]) {
    return `需钻研「${techName(recipe.requiresTech)}」`;
  }
  return null;
}

/** 把配方里的数字消耗转成 CostMap */
export function refineCostMap(recipe: RefineRecipe): CostMap {
  const cost: CostMap = {};
  for (const [id, amount] of Object.entries(recipe.cost) as [ItemId, number][]) {
    cost[id] = D(amount);
  }
  return cost;
}

/** 这条配方最多能合成几次（受最低的那种料限制） */
export function maxRefine(state: GameState, recipeId: string): number {
  const recipe = REFINE_RECIPE_MAP[recipeId];
  if (!recipe) return 0;
  if (getRefineGate(recipe, state) !== null) return 0;

  let max = Infinity;
  for (const [id, amount] of Object.entries(refineCostMap(recipe)) as [ItemId, Decimal][]) {
    if (amount.lte(0)) continue;
    max = Math.min(max, getAmount(state, id).div(amount).floor().toNumber());
  }
  return Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
}

/**
 * 合成若干次。
 *
 * 产出走 `addItem`，所以进阶资源会落进**材料**背包（它们本来就是材料的一种），
 * 灵石之类的资源落进资源背包 —— 由 `addItem` 自己按类型分派，这里不用管。
 */
export function refine(state: GameState, recipeId: string, times: number): GameState {
  const recipe = REFINE_RECIPE_MAP[recipeId];
  if (!recipe) return state;

  const actual = Math.min(Math.max(0, Math.floor(times)), maxRefine(state, recipeId));
  if (actual <= 0) return state;

  const scaled: CostMap = {};
  for (const [id, amount] of Object.entries(refineCostMap(recipe)) as [ItemId, Decimal][]) {
    scaled[id] = amount.mul(actual);
  }

  const paid = payCost(state, scaled);
  return addItem(paid, recipe.output.item, D(recipe.output.amount * actual));
}

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
/* 自动合成（需求 4；本轮需求 2 起管全部配方）                        */
/* ------------------------------------------------------------------ */

/*
 * ⚠️ 这里原来有个 `AUTO_REFINE_BACKLOG_BATCHES = 3600`（欠账上限），
 * 本轮把自动合成改成"按目标存量补齐"之后，欠账机制整块消失了，
 * 它就成了零引用的死常量 —— 已删除。
 * （与"删设定不删常量"那条坑同型：改行为时要顺手 grep 掉不再被用的常量。）
 */

/** 当前自动合成的**全局**速率（批/秒），0 表示关闭 */
/**
 * 自动合成的速度（批/秒）。
 *
 * ⚠️ 丹炉的"省时间"这条设定就落在这里（见 content/furnace.ts 的取舍说明）：
 * 本作的炼丹炼器是瞬时的，唯一带"速度"的炼制环节是自动合成，
 * 所以炉鼎的 refineSpeedBonus 作用在它上面。
 *
 * ⚠️⚠️ 这段注释曾经是**一句谎**：函数体里只有 `AUTO_REFINE_RATES[level]`，
 * 压根没读炉鼎 —— 于是"自动合成 +40%"这类数字永远不生效，
 * 而注释还替它担保说"作用在它上面"（文档代理第五次核出这一类问题）。
 * 现在真的接上了，并且冒烟里有断言守着。
 */
export function getAutoRefineRate(state: GameState): number {
  const level = Math.min(Math.max(Math.floor(state.autoRefineLevel), 0), AUTO_REFINE_LEVEL_MAX);
  const base = AUTO_REFINE_RATES[level];
  if (base <= 0) return 0;
  // 丹炉九件（设定集第 11 章）：当前那口炉子的自动合成加速
  return base * (1 + getFurnaceRefineSpeedBonus(state));
}

/**
 * 丹炉的自动合成加速。
 *
 * 这里**内联读 state.furnaces 那张表**而不是 import `gear.ts`：
 * `gear.ts` 依赖 engine（payCost / getAmount），engine 反过来 import 它就是成环。
 * 数值仍然只有一个来源（`content/furnace.ts` 的 FURNACES）。
 */
export function getFurnaceRefineSpeedBonus(state: GameState): number {
  const def = FURNACE_MAP[state.furnaceId];
  return def ? def.refineSpeedBonus : 0;
}

/** 某条配方现在最多还能合成几批（受它的原料存量与产出的储存上限限制） */
export function maxAutoRefineBatchesFor(state: GameState, recipeId: string): number {
  const recipe = REFINE_RECIPE_MAP[recipeId];
  if (!recipe) return 0;
  if (getRefineGate(recipe, state) !== null) return 0;

  /*
   * ⚠️ 原料看**存量**，产出看**余量** —— 这两者不能混。
   *
   * 第一版把原料也按"储存余量"（`cap - have`）算了，于是灵气快满时反而合不出东西：
   * 明明是"有 20000 灵气、只剩 250 的空位"，却被算成"只能拿 250 灵气去合成"。
   * 原料是**花掉**的，不是存进去的；只有产出才需要仓库有空位。
   */
  let limit = Number.POSITIVE_INFINITY;
  for (const [id, amount] of Object.entries(refineCostMap(recipe)) as [ItemId, ReturnType<typeof D>][]) {
    if (amount.lte(0)) continue;
    limit = Math.min(limit, getAmount(state, id).div(amount).floor().toNumber());
  }
  if ((RESOURCE_IDS as readonly string[]).includes(recipe.output.item)) {
    const out = recipe.output.item as ResourceId;
    const room = getStorageCap(state, out).sub(state.resources[out]);
    if (room.lte(0)) return 0;
    limit = Math.min(limit, room.div(recipe.output.amount).floor().toNumber());
  }
  return Math.max(0, Number.isFinite(limit) ? limit : 0);
}

/** 灵石那条老接口：界面与测试还在用 */
export function maxAutoRefineBatches(state: GameState): number {
  return maxAutoRefineBatchesFor(state, 'stoneRefine');
}

/** 距离目标还差多少（产出存量低于目标才算"欠"） */
function autoRefineShortfall(state: GameState, recipeId: string): number {
  const recipe = REFINE_RECIPE_MAP[recipeId];
  if (!recipe) return 0;
  const target = state.autoRefineTargets[recipeId] ?? 0;
  if (target <= 0) return 0;
  const have = getAmount(state, recipe.output.item);
  return have.gte(target) ? 0 : target - have.toNumber();
}

/**
 * 自动合成（本轮需求 2：从"只管灵石"扩到"管全部配方"）。
 *
 * 需求原文：「合成栏位内所有材料都可以自动合成，可以设置需要合成到多少」。
 *
 * 所以规则从"按速率产灵石"改成"**按目标存量补齐**"：
 *   - 玩家给每条配方设一个目标数（0 = 那条不管）；
 *   - 总速率由 `autoRefineLevel` 决定（所有配方共用，见 AUTO_REFINE_RATES 的注释）；
 *   - 每一批优先补**缺口最大**的那条配方，补到目标就自动停手。
 *
 * 这样"我要 2000 灵液"是一句话就能表达的意图，而不是"开 0.8 批/秒然后盯着屏幕"。
 */
export function autoRefine(state: GameState, dt: number): GameState {
  const rate = getAutoRefineRate(state);
  if (rate <= 0 || dt <= 0) return state;

  const demanded = state.autoRefineProgress + rate * dt;
  let wanted = Math.floor(demanded);
  // 还没攒够一批，先记账
  if (wanted <= 0) return { ...state, autoRefineProgress: demanded };

  let next = state;
  let done = 0;
  let guard = 0;
  while (done < wanted && guard < 64) {
    guard += 1;
    // 挑"缺口最大且还炼得动"的那条
    const candidates = REFINE_RECIPES.map((r) => ({
      id: r.id,
      short: autoRefineShortfall(next, r.id),
    }))
      .filter((c) => c.short > 0)
      .filter((c) => maxAutoRefineBatchesFor(next, c.id) > 0)
      .sort((a, b) => b.short - a.short);

    const pick = candidates[0];
    if (!pick) break;

    const paid = refine(next, pick.id, 1);
    if (paid === next) break;
    next = paid;
    done += 1;
  }

  /*
   * 没做完的"欠账"不保留：目标是"补到目标就停"，攒着欠账只会在
   * 资源突然变多的一瞬间爆发式合成，把灵气抽干（那正是上一版的老毛病）。
   */
  return { ...next, autoRefineProgress: 0 };
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
