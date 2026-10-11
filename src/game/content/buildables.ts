/**
 * 可建造物：设施（有产出）与建筑（无产出，提供容量或功能）
 *
 * 两者共用同一套「等比递增价格」机制，所以共用一个基类。
 * engine.ts 里的价格计算、批量购买对它俩是通用的。
 */
import type { ItemId, ResourceId } from './resources';

export interface BuildableBase {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 第一个的价格 */
  baseCost: Partial<Record<ItemId, number>>;
  /** 每多买一个，价格乘以该系数 */
  costGrowth: number;
  /** 拥有多少资源后才出现在面板上 */
  unlock: Partial<Record<ItemId, number>>;
  /** 需要宗门达到该等级才能建造（默认 0，即不限制） */
  requiresSectLevel?: number;
}

/** 设施：持续产出资源 */
export interface GeneratorDef extends BuildableBase {
  kind: 'generator';
  produces: ResourceId;
  /** 单个设施每秒基础产量（未计入全局倍率） */
  baseOutput: number;
}

/** 建筑：不产出资源，提供弟子容量、炼丹炼器位等功能 */
export interface StructureDef extends BuildableBase {
  kind: 'structure';
  /** 提供多少弟子居住位 */
  capacity?: number;
  /** 提供多少炼丹位 */
  alchemySlots?: number;
  /** 提供多少炼器位 */
  refiningSlots?: number;
}

export type BuildableDef = GeneratorDef | StructureDef;

/* ------------------------------------------------------------------ */
/* 设施                                                                */
/* ------------------------------------------------------------------ */

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'spiritArray',
    kind: 'generator',
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
