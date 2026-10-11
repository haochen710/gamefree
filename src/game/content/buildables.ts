/**
 * 可建造物：设施（有产出）与建筑（无产出，提供容量或功能）
 *
 * 两者共用同一套「等比递增价格」机制，所以共用一个基类。
 * engine.ts 里的价格计算、批量购买对它俩是通用的。
 */
import type { ItemId, ResourceId } from './resources';

/** 建筑分组，用于界面归类 */
export type BuildGroupId = 'resource' | 'storage' | 'housing' | 'workshop';

export interface BuildGroupDef {
  id: BuildGroupId;
  title: string;
  hint: string;
}

export const BUILD_GROUPS: BuildGroupDef[] = [
  { id: 'resource', title: '资源设施', hint: '持续产出各类资源' },
  { id: 'storage', title: '储物建筑', hint: '提高资源储存上限，按境界逐级解锁' },
  { id: 'housing', title: '弟子居所', hint: '每位弟子都需要一个住处' },
  { id: 'workshop', title: '丹器工坊', hint: '决定炼丹炼器的品阶上限' },
];

export interface BuildableBase {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 界面上归到哪一组 */
  group: BuildGroupId;
  /** 第一个的价格 */
  baseCost: Partial<Record<ItemId, number>>;
  /** 每多买一个，价格乘以该系数 */
  costGrowth: number;
  /**
   * 解锁条件：拥有过这么多资源后永久解锁。
   *
   * 注意是「拥有过」而不是「当前拥有」—— 解锁状态一旦达成就永久记录，
   * 否则玩家一花掉灵气，已经建过的建筑就会从面板上消失。
   */
  unlock: Partial<Record<ItemId, number>>;
  /** 需要宗门达到该等级才能建造（默认 0，即不限制） */
  requiresSectLevel?: number;
  /**
   * 需要掌门达到该境界才能建造（下标对应 REALMS）。
   * 提前一个境界就会显示出来（灰掉并标注需求），让玩家看到下一级的目标。
   */
  requiresRealm?: number;
  /**
   * 建造数量上限。
   *
   * 储物建筑必须设上限：价格是等比递增的，买太多之后
   * 「下一座的价格」会超过「当前储存上限」，而资源又永远涨不上去，
   * 游戏就永久卡死了。设了上限就彻底排除了这种死锁。
   */
  max?: number;
}

/** 设施：持续产出资源 */
export interface GeneratorDef extends BuildableBase {
  kind: 'generator';
  produces: ResourceId;
  /** 单个设施每秒基础产量（未计入全局倍率） */
  baseOutput: number;
}

/** 建筑：不产出资源，提供弟子容量、炼丹炼器位、储存上限等功能 */
export interface StructureDef extends BuildableBase {
  kind: 'structure';
  /** 提供多少弟子居住位 */
  capacity?: number;
  /** 提供多少炼丹位 */
  alchemySlots?: number;
  /** 提供多少炼器位 */
  refiningSlots?: number;
  /**
   * 每座提供的资源储存上限。
   *
   * 灵气是主资源、消耗量随境界指数增长，所以给得最多；
   * 灵石是通货、需求相对温和，比例最低。
   */
  storage?: Partial<Record<ResourceId, number>>;
}

export type BuildableDef = GeneratorDef | StructureDef;

/* ------------------------------------------------------------------ */
/* 设施                                                                */
/* ------------------------------------------------------------------ */

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'spiritArray',
    kind: 'generator',
    group: 'resource',
    name: '聚灵阵',
    icon: '☯',
    desc: '引天地灵气入洞府，修行起步的根本。',
    produces: 'qi',
    baseOutput: 0.6,
    baseCost: { qi: 15 },
    costGrowth: 1.15,
    unlock: {},
  },
  {
    id: 'woodGrove',
    kind: 'generator',
    group: 'resource',
    name: '灵木林',
    icon: '🌳',
    desc: '栽种灵木，可伐取建造所需的木料。',
    produces: 'wood',
    baseOutput: 0.25,
    baseCost: { qi: 120 },
    costGrowth: 1.15,
    unlock: { qi: 60 },
  },
  {
    id: 'oreVein',
    kind: 'generator',
    group: 'resource',
    name: '灵矿脉',
    icon: '⛰',
    desc: '开凿山腹灵脉，采掘蕴灵之矿，可炼器亦可合炼灵石。',
    produces: 'ore',
    baseOutput: 0.12,
    baseCost: { qi: 800, wood: 200 },
    costGrowth: 1.16,
    unlock: { wood: 50 },
  },
  {
    id: 'herbField',
    kind: 'generator',
    group: 'resource',
    name: '灵田',
    icon: '🍀',
    desc: '引灵泉灌溉，种植炼丹所需的灵草。',
    produces: 'herb',
    baseOutput: 0.06,
    baseCost: { qi: 3000, wood: 500 },
    costGrowth: 1.17,
    unlock: { ore: 100 },
  },
  {
    id: 'stoneMine',
    kind: 'generator',
    group: 'resource',
    name: '灵石矿',
    icon: '💎',
    desc: '开采蕴灵石脉。灵石是修仙界的通货，招收弟子必需。',
    produces: 'stone',
    baseOutput: 0.05,
    baseCost: { qi: 8000, ore: 800, herb: 200 },
    costGrowth: 1.17,
    unlock: { herb: 50 },
  },
];

/* ------------------------------------------------------------------ */
/* 建筑                                                                */
/* ------------------------------------------------------------------ */

export const STRUCTURES: StructureDef[] = [
  {
    id: 'thatchHut',
    kind: 'structure',
    group: 'housing',
    name: '茅屋',
    icon: '🛖',
    desc: '最简陋的居所，仅能容纳 3 名弟子。',
    capacity: 3,
    baseCost: { qi: 200, wood: 80 },
    costGrowth: 1.25,
    unlock: { wood: 30 },
  },
  {
    id: 'alchemyRoom',
    kind: 'structure',
    group: 'workshop',
    name: '丹房',
    icon: '⚗',
    desc: '炼丹之所。丹房越多，能掌握的炼丹品阶越高。',
    alchemySlots: 1,
    baseCost: { qi: 1500, wood: 300 },
    costGrowth: 1.18,
    unlock: { wood: 100 },
  },
  {
    id: 'refinery',
    kind: 'structure',
    group: 'workshop',
    name: '炼器房',
    icon: '🔨',
    desc: '锻造器物之所。炼器房越多，能掌握的炼器品阶越高。',
    refiningSlots: 1,
    baseCost: { qi: 4000, ore: 600 },
    costGrowth: 1.2,
    unlock: { ore: 150 },
  },
  {
    id: 'courtyard',
    kind: 'structure',
    group: 'housing',
    name: '院落',
    icon: '🏯',
    desc: '有山有水的独立院落，可容纳 10 名弟子。',
    capacity: 10,
    baseCost: { qi: 5e4, wood: 1500, stone: 300 },
    costGrowth: 1.3,
    unlock: { stone: 50 },
  },
  {
    id: 'grotto',
    kind: 'structure',
    group: 'housing',
    name: '洞天',
    icon: '⛩',
    desc: '以大法力开辟的洞天福地，可容纳 30 名弟子。',
    capacity: 30,
    baseCost: { qi: 2e6, stone: 2e4, herb: 5000 },
    costGrowth: 1.35,
    unlock: { stone: 5000 },
    requiresSectLevel: 4,
  },
];

/* ------------------------------------------------------------------ */
/* 储物建筑                                                            */
/* ------------------------------------------------------------------ */

/**
 * 各资源的**基础**储存上限（一座储物建筑都没有时）。
 *
 * 刻意定得很小：开局灵气上限只有 250，而第一次突破要 600 灵气，
 * 所以玩家必须在第一小时内就学会「攒不下就得先修仓库」这件事。
 */
export const BASE_STORAGE: Record<ResourceId, number> = {
  qi: 250,
  wood: 100,
  ore: 100,
  stone: 50,
  herb: 50,
};

/**
 * 储物建筑每座提供的上限，按「灵气容量 × 比例」计算。
 *
 * 灵气是主资源、消耗量随境界指数增长，所以基准最大；
 * 灵石只用于招收弟子和宗门晋升，需求温和得多，比例最低。
 */
export const STORAGE_RATIOS: Record<Exclude<ResourceId, 'qi'>, number> = {
  wood: 0.4,
  ore: 0.4,
  herb: 0.25,
  stone: 0.06,
};

interface StorageTier {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 灵气容量（其余资源按 STORAGE_RATIOS 折算） */
  power: number;
  /** 所需境界下标 */
  realm: number;
  /** 造价（灵气） */
  cost: number;
}

/**
 * 九级储物建筑，每级约 20 倍容量，按境界逐级解锁。
 *
 * 容量是照着「该境界内最贵的一次灵气消耗」定的：
 * 每级容量约为对应境界峰值消耗的 1.2~5 倍，
 * 因此玩家通常需要建 1~3 座当前等级的仓库 —— 有压力但不至于卡死。
 *
 * 造价则定为「上一级容量的 0.6 倍」，保证永远买得起：
 * 两座上一级仓库就足够攒出下一级的钱，不存在死锁。
 */
const STORAGE_TIERS: StorageTier[] = [
  { id: 'storagePouch', name: '储物袋', icon: '👝', desc: '最简易的储物法器，内有方寸之地。', power: 2e3, realm: 0, cost: 150 },
  { id: 'treasurePavilion', name: '藏宝阁', icon: '🏛', desc: '专门辟出的楼阁，用来堆放灵材。', power: 3e4, realm: 1, cost: 1.2e3 },
  { id: 'spiritVault', name: '灵脉库房', icon: '🏦', desc: '以地底灵脉为基，可储存大量灵气。', power: 5e5, realm: 2, cost: 1.8e4 },
  { id: 'sumeruCave', name: '须弥洞府', icon: '🕳', desc: '芥子纳须弥，一间石室可容山海。', power: 1e7, realm: 3, cost: 3e5 },
  { id: 'cosmosRealm', name: '芥子乾坤', icon: '🌐', desc: '自成一界的储物空间，法则由你书写。', power: 2e8, realm: 4, cost: 6e6 },
  { id: 'voidTreasury', name: '太虚宝库', icon: '💠', desc: '开辟于虚空夹缝，无视物理之限。', power: 4e9, realm: 5, cost: 1.2e8 },
  { id: 'starVault', name: '周天星库', icon: '✨', desc: '引周天星力构筑，容量随星辰增辉。', power: 8e10, realm: 6, cost: 2.4e9 },
  { id: 'primordialCache', name: '混元仙藏', icon: '🔮', desc: '混元一气所化，可藏一域之资。', power: 1.6e12, realm: 7, cost: 4.8e10 },
  { id: 'daoRepository', name: '鸿蒙道藏', icon: '🌌', desc: '开天辟地前的道之容器，几无穷尽。', power: 3.2e13, realm: 8, cost: 9.6e11 },
];

function storageOf(power: number): Partial<Record<ResourceId, number>> {
  return {
    qi: power,
    wood: power * STORAGE_RATIOS.wood,
    ore: power * STORAGE_RATIOS.ore,
    herb: power * STORAGE_RATIOS.herb,
    stone: power * STORAGE_RATIOS.stone,
  };
}

export const STORAGE_BUILDINGS: StructureDef[] = STORAGE_TIERS.map((tier) => ({
  id: tier.id,
  kind: 'structure' as const,
  group: 'storage' as const,
  name: tier.name,
  icon: tier.icon,
  desc: tier.desc,
  storage: storageOf(tier.power),
  baseCost: { qi: tier.cost },
  costGrowth: 1.25,
  // 全部可见（靠 requiresRealm 逐级开放），所以不带材料解锁条件
  unlock: {},
  requiresRealm: tier.realm,
  // 每级最多 10 座：10 座当前等级的仓库足以覆盖该境界的全部消耗，
  // 想再扩容就必须突破到下一个境界解锁更高级的储物建筑
  max: 10,
}));

STRUCTURES.push(...STORAGE_BUILDINGS);

export const BUILDABLES: BuildableDef[] = [...GENERATORS, ...STRUCTURES];

export const BUILDABLE_MAP: Record<string, BuildableDef> = BUILDABLES.reduce(
  (acc, b) => {
    acc[b.id] = b;
    return acc;
  },
  {} as Record<string, BuildableDef>,
);

/* ------------------------------------------------------------------ */
/* 灵石合成                                                            */
/* ------------------------------------------------------------------ */

/**
 * 灵气 + 灵矿 合成灵石。
 * 给玩家一条"不建灵石矿也能拿到灵石"的路子，同时也让灵矿在中期有消耗出口。
 */
export const STONE_REFINE_COST = { qi: 5000, ore: 500 } as const;
export const STONE_REFINE_OUTPUT = 25;
