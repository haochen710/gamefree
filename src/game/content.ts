/**
 * 游戏内容定义（纯数据，不含逻辑）。
 *
 * 想加新资源 / 新设施 / 新境界，只改这个文件就够了，
 * engine.ts 会自动按这里的定义算产量和价格。
 */

export type ResourceId = 'qi' | 'wood' | 'ore' | 'pill';

export const RESOURCE_IDS: ResourceId[] = ['qi', 'wood', 'ore', 'pill'];

export interface ResourceDef {
  id: ResourceId;
  name: string;
  icon: string;
  desc: string;
}

export const RESOURCES: ResourceDef[] = [
  {
    id: 'qi',
    name: '灵气',
    icon: '☯',
    desc: '修仙之本。聚灵阵可自动汲取，打坐也能直接获取。',
  },
  {
    id: 'wood',
    name: '灵木',
    icon: '🌿',
    desc: '灵木林所产，用于建造灵矿脉与丹房。',
  },
  {
    id: 'ore',
    name: '灵矿',
    icon: '⛰',
    desc: '灵矿脉所采，炼制丹药的必需品。',
  },
  {
    id: 'pill',
    name: '丹药',
    icon: '⚗',
    desc: '丹房所炼。突破大境界时必须服用。',
  },
];

export const RESOURCE_MAP: Record<ResourceId, ResourceDef> = RESOURCES.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<ResourceId, ResourceDef>,
);

/** 设施（产出建筑）定义 */
export interface GeneratorDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 产出的资源 */
  produces: ResourceId;
  /** 单个设施每秒的基础产量（未计入全局倍率） */
  baseOutput: number;
  /** 第一个的价格 */
  baseCost: Partial<Record<ResourceId, number>>;
  /** 每买一个，价格乘以这个系数 */
  costGrowth: number;
  /** 拥有多少资源后才显示在面板上（避免开局一堆看不懂的东西） */
  unlock: Partial<Record<ResourceId, number>>;
}

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'spiritArray',
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
    name: '灵木林',
    icon: '🌳',
    desc: '栽种灵木，可伐取炼制法器与丹炉的木料。',
    produces: 'wood',
    baseOutput: 0.25,
    baseCost: { qi: 120 },
    costGrowth: 1.15,
    unlock: { qi: 60 },
  },
  {
    id: 'oreVein',
    name: '灵矿脉',
    icon: '⛰',
    desc: '开凿山腹灵脉，采掘蕴灵之矿。',
    produces: 'ore',
    baseOutput: 0.12,
    baseCost: { qi: 800, wood: 200 },
    costGrowth: 1.16,
    unlock: { wood: 50 },
  },
  {
    id: 'alchemyRoom',
    name: '丹房',
    icon: '⚗',
    desc: '以灵木为薪、灵矿为引，炼制突破所用的丹药。',
    produces: 'pill',
    baseOutput: 0.02,
    baseCost: { wood: 1200, ore: 600 },
    costGrowth: 1.2,
    unlock: { ore: 100 },
  },
];

export const GENERATOR_MAP: Record<string, GeneratorDef> = GENERATORS.reduce(
  (acc, g) => {
    acc[g.id] = g;
    return acc;
  },
  {} as Record<string, GeneratorDef>,
);

/** 境界定义 */
export interface RealmDef {
  name: string;
  /** 本境界有多少层小境界 */
  layerCount: number;
  /** 第 1 层小境界的参悟消耗（灵气） */
  baseLayerCost: number;
  /** 每多一层，消耗乘以这个系数 */
  costGrowth: number;
  /** 每层小境界提供的全局产量加成（加算，0.05 = +5%） */
  layerBonus: number;
  /** 身处此境界时的全局产量乘数（含前面所有境界的累积效果） */
  realmMultiplier: number;
  /** 突破到下一境界所需的灵气 */
  breakthroughQi: number;
  /** 突破到下一境界所需服用的丹药 */
  breakthroughPills: number;
  desc: string;
}

export const REALMS: RealmDef[] = [
  {
    name: '炼气期',
    layerCount: 9,
    baseLayerCost: 8,
    costGrowth: 1.75,
    layerBonus: 0.05,
    realmMultiplier: 1,
    breakthroughQi: 600,
    breakthroughPills: 0,
    desc: '引气入体，初窥门径。',
  },
  {
    name: '筑基期',
    layerCount: 9,
    baseLayerCost: 150,
    costGrowth: 1.85,
    layerBonus: 0.06,
    realmMultiplier: 3,
    breakthroughQi: 1.2e4,
    breakthroughPills: 2,
    desc: '筑就道基，从此寿元大增。',
  },
  {
    name: '金丹期',
    layerCount: 9,
    baseLayerCost: 2.5e3,
    costGrowth: 1.9,
    layerBonus: 0.08,
    realmMultiplier: 9,
    breakthroughQi: 1.5e5,
    breakthroughPills: 5,
    desc: '结丹成婴之始，一方修士中的翘楚。',
  },
  {
    name: '元婴期',
    layerCount: 9,
    baseLayerCost: 1.6e4,
    costGrowth: 1.95,
    layerBonus: 0.1,
    realmMultiplier: 27,
    breakthroughQi: 8e5,
    breakthroughPills: 8,
    desc: '元婴出窍，肉身可弃而神魂不灭。',
  },
  {
    name: '化神期',
    layerCount: 9,
    baseLayerCost: 2.4e5,
    costGrowth: 2.0,
    layerBonus: 0.12,
    realmMultiplier: 81,
    breakthroughQi: 1.2e7,
    breakthroughPills: 20,
    desc: '神识化虚，可窥天地法则。自此可尝试飞升。',
  },
  {
    name: '炼虚期',
    layerCount: 9,
    baseLayerCost: 4e6,
    costGrowth: 2.05,
    layerBonus: 0.15,
    realmMultiplier: 243,
    breakthroughQi: 2e8,
    breakthroughPills: 45,
    desc: '炼化虚空，举手投足皆合天道。',
  },
  {
    name: '合体期',
    layerCount: 9,
    baseLayerCost: 6e7,
    costGrowth: 2.1,
    layerBonus: 0.18,
    realmMultiplier: 729,
    breakthroughQi: 3.2e9,
    breakthroughPills: 100,
    desc: '法体合一，已非凡俗之身。',
  },
  {
    name: '大乘期',
    layerCount: 9,
    baseLayerCost: 1e9,
    costGrowth: 2.15,
    layerBonus: 0.22,
    realmMultiplier: 2187,
    breakthroughQi: 6e10,
    breakthroughPills: 250,
    desc: '大乘圆满，只待雷劫加身。',
  },
  {
    name: '渡劫期',
    layerCount: 9,
    baseLayerCost: 1.6e10,
    costGrowth: 2.2,
    layerBonus: 0.26,
    realmMultiplier: 6561,
    breakthroughQi: 1.2e12,
    breakthroughPills: 600,
    desc: '九重雷劫，过则登仙。',
  },
  {
    name: '仙人',
    layerCount: 1,
    baseLayerCost: 4e12,
    costGrowth: 2.5,
    layerBonus: 1.0,
    realmMultiplier: 19683,
    breakthroughQi: 0,
    breakthroughPills: 0,
    desc: '跳出三界外，不在五行中。此界已是尽头。',
  },
];

/** 最后一个境界没有"下一境界"可突破 */
export const FINAL_REALM_INDEX = REALMS.length - 1;

/** 达到这个境界（化神期）之后才能飞升 */
export const ASCENSION_MIN_REALM = 4;

/** 每点「道韵」提供的全局产量加成 */
export const DAO_YUN_BONUS = 0.05;

/**
 * 飞升结算：本世累计灵气 → 道韵
 *     道韵 = floor( (本世灵气 / DAO_YUN_DIVISOR) ^ DAO_YUN_EXPONENT )
 *
 * 指数取 0.5（开平方）是放置游戏的常用做法：
 * 收益低于线性增长，既让每次飞升都有明显提升，又不会几世之后就崩坏。
 * 想调飞升手感，优先改这两个常量。
 */
export const DAO_YUN_DIVISOR = 1e5;
export const DAO_YUN_EXPONENT = 0.5;

/** 打坐一次至少获得的灵气 */
export const MEDITATE_MIN_QI = 1;
/** 打坐一次 = 多少秒的当前灵气产量 */
export const MEDITATE_SECONDS = 3;
