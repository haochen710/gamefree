/**
 * 秘境（需求 5）
 *
 * 秘境是「稀有丹药材料」的唯一来源，也是弟子伤亡的地方。
 *
 * 核心公式（都在 engine 里实现）：
 *   战力比 = 队伍总战力 / 秘境推荐战力
 *   产量   = 基础产量 × clamp(战力比, 0.5, 3) × 增益倍率 × 随机浮动
 *   伤亡率 = 基础伤亡率 / 战力比 × (1 - 减免)
 *
 * 也就是说：派低境界弟子去高难度秘境，收益腰斩、死伤惨重。
 * 这构成了"练弟子 → 闯秘境 → 拿材料 → 炼丹药 → 突破"的完整闭环。
 */
import type { ItemId } from './resources';

export interface LootEntry {
  item: ItemId;
  /** 基础数量 */
  amount: number;
  /** 掉落权重（同一次探索里按权重抽取若干项） */
  weight: number;
  /** 是否必定掉落 */
  guaranteed?: boolean;
}

export interface PillLootEntry {
  pill: string;
  amount: number;
  weight: number;
}

export interface SecretRealmDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 推荐战力 */
  requiredPower: number;
  /** 一次探索所需的进度秒数（受探索速度加成影响） */
  duration: number;
  /** 需要派遣的弟子数量 */
  partySize: number;
  /** 弟子境界下限 */
  minRealm: number;
  /** 基础伤亡率 */
  baseCasualty: number;
  loot: LootEntry[];
  /** 小概率直接掉成品丹药 */
  pillLoot?: PillLootEntry[];
  unlock: Partial<Record<ItemId, number>>;
  requiresSectLevel?: number;
}

/** 每次探索从掉落表里抽取的条目数 */
export const LOOT_ROLLS = 3;

/**
 * 秘境掉落成品丹药的概率。
 *
 * 这是调平衡时踩过的坑：如果每次探索必掉一颗丹药，
 * 挂机几天就能囤几百颗境界丹，炼丹系统（需要提升炼丹品阶才能炼高阶丹）
 * 就完全失去意义了。所以限定成小概率掉落。
 */
export const PILL_DROP_CHANCE = 0.15;

export const SECRET_REALMS: SecretRealmDef[] = [
  {
    id: 'sunsetValley',
    name: '落霞谷',
    icon: '🌄',
    desc: '谷中妖兽多为炼气期，是新入门的弟子练手之处。',
    requiredPower: 3,
    duration: 120,
    partySize: 1,
    minRealm: 0,
    baseCasualty: 0.02,
    loot: [
      { item: 'herb', amount: 100, weight: 5 },
      { item: 'demonCore', amount: 5, weight: 3, guaranteed: true },
    ],
    unlock: {},
  },
  {
    id: 'blackWindRidge',
    name: '黑风岭',
    icon: '🌫',
    desc: '常年黑风怒号，岭中隐匿筑基期妖兽。',
    requiredPower: 15,
    duration: 300,
    partySize: 2,
    minRealm: 1,
    baseCasualty: 0.04,
    loot: [
      { item: 'demonCore', amount: 20, weight: 3, guaranteed: true },
      { item: 'blackIron', amount: 8, weight: 2 },
      { item: 'herb', amount: 400, weight: 4 },
    ],
    pillLoot: [{ pill: 'qiGatheringPill', amount: 1, weight: 2 }],
    unlock: { demonCore: 10 },
  },
  {
    id: 'boneField',
    name: '万骨战场',
    icon: '💀',
    desc: '上古修士大战之地，怨气凝而不散，遍地残兵断刃。',
    requiredPower: 60,
    duration: 600,
    partySize: 3,
    minRealm: 2,
    baseCasualty: 0.07,
    loot: [
      { item: 'blackIron', amount: 30, weight: 3, guaranteed: true },
      { item: 'demonCore', amount: 60, weight: 3 },
      { item: 'starSand', amount: 6, weight: 2 },
    ],
    pillLoot: [
      { pill: 'foundationPill', amount: 1, weight: 3 },
      { pill: 'temperPill', amount: 1, weight: 2 },
    ],
    unlock: { blackIron: 8 },
  },
  {
    id: 'starfallAbyss',
    name: '星陨深渊',
    icon: '☄',
    desc: '天外星辰坠落之所，深渊底部遍是星辰砂。',
    requiredPower: 250,
    duration: 900,
    partySize: 3,
    minRealm: 3,
    baseCasualty: 0.1,
    loot: [
      { item: 'starSand', amount: 25, weight: 3, guaranteed: true },
      { item: 'blackIron', amount: 120, weight: 3 },
      { item: 'demonCore', amount: 200, weight: 2 },
    ],
    pillLoot: [{ pill: 'goldenCorePill', amount: 1, weight: 3 }],
    unlock: { starSand: 6 },
  },
  {
    id: 'netherSea',
    name: '幽冥血海',
    icon: '🌊',
    desc: '血海翻涌，海底沉睡着上古真龙遗骸。',
    requiredPower: 1000,
    duration: 1200,
    partySize: 4,
    minRealm: 4,
    baseCasualty: 0.14,
    loot: [
      { item: 'dragonBlood', amount: 8, weight: 2, guaranteed: true },
      { item: 'starSand', amount: 90, weight: 3 },
      { item: 'blackIron', amount: 400, weight: 3 },
    ],
    pillLoot: [{ pill: 'nascentPill', amount: 1, weight: 3 }],
    unlock: { dragonBlood: 1 },
    requiresSectLevel: 3,
  },
  {
    id: 'voidParadise',
    name: '太虚仙境',
    icon: '🌌',
    desc: '漂浮于虚空中的上古仙宫，机关重重。',
    requiredPower: 4000,
    duration: 1800,
    partySize: 4,
    minRealm: 5,
    baseCasualty: 0.18,
    loot: [
      { item: 'dragonBlood', amount: 30, weight: 3, guaranteed: true },
      { item: 'starSand', amount: 300, weight: 3 },
      { item: 'immortalJade', amount: 3, weight: 1 },
    ],
    pillLoot: [
      { pill: 'spiritPill', amount: 1, weight: 3 },
      { pill: 'youthPill', amount: 1, weight: 1 },
    ],
    unlock: { immortalJade: 1 },
    requiresSectLevel: 5,
  },
  {
    id: 'primordialRuins',
    name: '鸿蒙遗境',
    icon: '🌀',
    desc: '开天辟地时残留的一角，法则残缺，凶险异常。',
    requiredPower: 15000,
    duration: 2400,
    partySize: 5,
    minRealm: 6,
    baseCasualty: 0.22,
    loot: [
      { item: 'immortalJade', amount: 12, weight: 3, guaranteed: true },
      { item: 'dragonBlood', amount: 100, weight: 3 },
    ],
    pillLoot: [
      { pill: 'unityPill', amount: 1, weight: 3 },
      { pill: 'tiangangPill', amount: 1, weight: 1 },
    ],
    unlock: { immortalJade: 3 },
    requiresSectLevel: 7,
  },
  {
    id: 'gateOfHeaven',
    name: '上界之门',
    icon: '🚪',
    desc: '传说中的仙门。门后即是上界，多少修士有去无回。',
    requiredPower: 60000,
    duration: 3600,
    partySize: 6,
    minRealm: 7,
    baseCasualty: 0.28,
    loot: [
      { item: 'immortalJade', amount: 50, weight: 4, guaranteed: true },
      { item: 'dragonBlood', amount: 300, weight: 3 },
    ],
    pillLoot: [
      { pill: 'tribulationPill', amount: 1, weight: 2 },
      { pill: 'ascensionPill', amount: 1, weight: 1 },
    ],
    unlock: { immortalJade: 12 },
    requiresSectLevel: 9,
  },
];

export const SECRET_REALM_MAP: Record<string, SecretRealmDef> = SECRET_REALMS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, SecretRealmDef>,
);

/** 伤亡率上限，避免高难度直接把队伍全灭 */
export const MAX_CASUALTY_RATE = 0.6;
/** 单次探索的产量浮动范围 */
export const YIELD_VARIANCE_MIN = 0.8;
export const YIELD_VARIANCE_MAX = 1.2;
/** 战力不足时的最低产量系数 */
export const MIN_YIELD_FACTOR = 0.5;
/** 战力碾压时的最高产量系数 */
export const MAX_YIELD_FACTOR = 3;
