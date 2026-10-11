/**
 * 秘境（需求 1 / 5）
 *
 * 需求原文：
 *   1.「秘境设计为弟子或者玩家探索发现，发现后固定在秘境栏，
 *      每次探索后需要隔一段时间才能再次探索。秘境探索有境界限制，
 *      并且人越多最终获取的资源越多。」
 *   5.「设计一个地图，并划分不同区域，玩家或者弟子只有等级高了，
 *      才能去更远的地域探索」
 *
 * 因此秘境不再是「攒够材料就自动出现」，而是**探索中发现**的：
 *   - 每处秘境挂在地图的一个区域下（见 map.ts），区域有境界门槛；
 *   - 弟子探索或掌门游历时有概率发现新秘境，发现后永久固定在秘境栏；
 *   - 每次探索完毕该秘境进入冷却，冷却结束才能再探；
 *   - 派遣人数在 minParty~maxParty 之间自由决定，人越多总产出越高。
 *
 * 探索结算的核心公式（在 expeditions.ts 里实现）：
 *   战力比 = 队伍总战力 / 秘境推荐战力
 *   人数系数 = 1 + (人数 - 最少人数) × PARTY_YIELD_PER_EXTRA
 *   产出   = 基础 × clamp(战力比, 0.5, 3) × 人数系数 × 增益 × 随机浮动
 *   伤亡率 = 基础伤亡率 / 战力比 × (1 - 减免)
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
  /** 所在的地图区域（见 map.ts）。区域门槛是探索的第一道门 */
  regionId: string;
  /** 推荐战力 */
  requiredPower: number;
  /** 一次探索所需的进度秒数（受探索速度加成影响） */
  duration: number;
  /** 至少派遣几名弟子 */
  minParty: number;
  /** 最多能派遣几名弟子（人越多产出越高，见 PARTY_YIELD_PER_EXTRA） */
  maxParty: number;
  /** 弟子境界下限 */
  minRealm: number;
  /** 一次探索结束后的冷却秒数（需求 1：隔一段时间才能再探） */
  cooldown: number;
  /** 基础伤亡率 */
  baseCasualty: number;
  loot: LootEntry[];
  /** 小概率直接掉成品丹药 */
  pillLoot?: PillLootEntry[];
  /** 带回材料种子的概率（需求 5） */
  seedChance: number;
  /** 此地最低会掉几级稀有度的种子（默认 1），理由同 travel.ts */
  seedMinRarity?: number;
  /** 该秘境最多能掉出多少级的种子稀有度 */
  seedMaxRarity: number;
  /** 掉落图纸的概率（需求 6）。0 表示此地不出图纸 */
  blueprintChance: number;
  /** 发现难度权重：数字越大越容易被抽到（同区域内越靠后的秘境给越小的值） */
  discoveryWeight: number;
  requiresSectLevel?: number;
}

/** 每次探索从掉落表里抽取的条目数，还会随人数增加 */
export const LOOT_ROLLS = 3;

/**
 * 每多派一名弟子（超出 minParty）增加的抽取条目数，上限 LOOT_ROLLS_MAX。
 *
 * 「人越多最终获取的资源越多」有两种体现：
 *   1. 每多一人，数量系数 +40%（PARTY_YIELD_PER_EXTRA）
 *   2. 每多一人，多抽一条掉落
 * 两条叠加，所以多带人不是浪费。
 */
export const LOOT_ROLLS_PER_EXTRA = 1;
export const LOOT_ROLLS_MAX = 6;

/** 每多派一名弟子（超出 minParty）的总产量加成 */
export const PARTY_YIELD_PER_EXTRA = 0.4;

/**
 * 秘境掉落成品丹药的概率。
 *
 * 这是调平衡时踩过的坑：如果每次探索必掉一颗丹药，
 * 挂机几天就能囤几百颗境界丹，炼丹系统（需要提升炼丹品阶才能炼高阶丹）
 * 就完全失去意义了。所以限定成小概率掉落。
 */
export const PILL_DROP_CHANCE = 0.15;

/** 一次探索最多带回几种种子 */
export const SEED_ROLLS = 1;

/** 图纸只会从「元婴期以上」的秘境里掉出来 —— 那里才有资格谈论上古传承 */
export const MIN_REALM_FOR_BLUEPRINT = 3;

/* ------------------------------------------------------------------ */
/* 发现机制（需求 1）                                                   */
/* ------------------------------------------------------------------ */

/** 开局就已知的秘境：宗门草创时的第一处试炼地 */
export const STARTER_REALM_ID = 'sunsetValley';

/** 一次探索结算时的基础发现概率 */
export const DISCOVERY_BASE_CHANCE = 0.1;
/** 每失败一次累积的保底概率（防止运气差永远发现不了） */
export const DISCOVERY_PITY_STEP = 0.04;
/** 保底累积上限 */
export const DISCOVERY_PITY_CAP = 0.5;
/**
 * 发现概率总上限，留一点运气成分。
 *
 * 满配（5 座灵舟坊 + 山门/通天塔/照天镜满级 + 满编队伍）时各项相加会超过 1，
 * 被这里砍到 0.75 —— 这是**有意为之**：全世界只有 8 处秘境，
 * 而秘境是稀有材料的唯一来源，把发现做成无底洞只会让玩家卡在内容外面。
 * 上限的作用是「投入再多也保留 25% 的运气成分」，而不是一个待修的数值问题。
 */
export const DISCOVERY_MAX_CHANCE = 0.75;
/** 每多派一名弟子（超出最少人数）对发现概率的加成 */
export const DISCOVERY_PER_EXTRA_MEMBER = 0.02;

/**
 * 探索距离加成折算成发现概率的比例。
 *
 * 这里刻意**不**复用灵舟坊那个「每座 +25% 探索距离」的常量：
 * 那个常量描述的是距离，而这里要回答的是「距离能换多少发现概率」。
 * 早先直接拿两个 0.25 相乘，等于每座灵舟坊只给 +6.25% 发现概率，
 * 看上去像笔误。现在明确成：每 +100% 探索距离 → +50% 发现概率，
 * 于是每座灵舟坊（+25% 距离）= +12.5% 发现概率。
 *
 * 0.5 定得偏高是**有意的**：灵舟坊要图纸 + 元婴期才能建，是整个发现体系里
 * 最贵的一环，理应是最大的一项贡献。后期总概率会被
 * `DISCOVERY_MAX_CHANCE` 砍到 0.75，所以它并不会让别的建筑失去意义 ——
 * 只是让"先建灵舟坊"成为性价比最高的选择。
 */
export const DISCOVERY_PER_DISTANCE = 0.5;

/**
 * 秘境表。按地图区域从近到远排列。
 */
export const SECRET_REALMS: SecretRealmDef[] = [
  {
    id: 'sunsetValley',
    name: '落霞谷',
    icon: '🌄',
    desc: '谷中妖兽多为炼气期，是新入门的弟子练手之处。',
    regionId: 'nearHills',
    requiredPower: 3,
    duration: 120,
    minParty: 1,
    maxParty: 4,
    minRealm: 0,
    cooldown: 90,
    baseCasualty: 0.02,
    seedChance: 0.3,
    seedMaxRarity: 2,
    blueprintChance: 0,
    discoveryWeight: 0,
    loot: [
      { item: 'herb', amount: 100, weight: 5 },
      { item: 'demonCore', amount: 5, weight: 3, guaranteed: true },
      { item: 'moonDew', amount: 2, weight: 2 },
      { item: 'spiritSilk', amount: 3, weight: 2 },
    ],
  },
  {
    id: 'blackWindRidge',
    name: '黑风岭',
    icon: '🌫',
    desc: '常年黑风怒号，岭中隐匿筑基期妖兽。',
    regionId: 'mistyFrontier',
    requiredPower: 15,
    duration: 300,
    minParty: 2,
    maxParty: 6,
    minRealm: 1,
    cooldown: 240,
    baseCasualty: 0.04,
    seedChance: 0.35,
    seedMaxRarity: 3,
    blueprintChance: 0,
    discoveryWeight: 10,
    loot: [
      { item: 'demonCore', amount: 20, weight: 3, guaranteed: true },
      { item: 'blackIron', amount: 8, weight: 3 },
      { item: 'spiritSilk', amount: 10, weight: 3 },
      { item: 'moonDew', amount: 4, weight: 2 },
      { item: 'herb', amount: 400, weight: 4 },
    ],
    pillLoot: [{ pill: 'qiGatheringPill', amount: 1, weight: 2 }],
  },
  {
    id: 'boneField',
    name: '万骨战场',
    icon: '💀',
    desc: '上古修士大战之地，怨气凝而不散，遍地残兵断刃。',
    regionId: 'scorchedWilds',
    requiredPower: 60,
    duration: 600,
    minParty: 3,
    maxParty: 8,
    minRealm: 2,
    cooldown: 420,
    baseCasualty: 0.07,
    seedChance: 0.4,
    seedMinRarity: 2,
    seedMaxRarity: 3,
    blueprintChance: 0,
    discoveryWeight: 9,
    loot: [
      { item: 'blackIron', amount: 30, weight: 3, guaranteed: true },
      { item: 'demonCore', amount: 60, weight: 3 },
      { item: 'starSand', amount: 6, weight: 2 },
      { item: 'fireMarrow', amount: 6, weight: 2 },
      { item: 'coldJade', amount: 5, weight: 2 },
    ],
    pillLoot: [
      { pill: 'foundationPill', amount: 1, weight: 3 },
      { pill: 'temperPill', amount: 1, weight: 2 },
    ],
  },
  {
    id: 'starfallAbyss',
    name: '星陨深渊',
    icon: '☄',
    desc: '天外星辰坠落之所，深渊底部遍是星辰砂，亦藏太阴之晶。',
    regionId: 'starfallDeep',
    requiredPower: 250,
    duration: 900,
    minParty: 3,
    maxParty: 9,
    minRealm: 3,
    cooldown: 600,
    baseCasualty: 0.1,
    seedChance: 0.45,
    seedMinRarity: 2,
    seedMaxRarity: 4,
    blueprintChance: 0.05,
    discoveryWeight: 8,
    loot: [
      { item: 'starSand', amount: 25, weight: 3, guaranteed: true },
      { item: 'blackIron', amount: 120, weight: 3 },
      { item: 'demonCore', amount: 200, weight: 2 },
      { item: 'lunarCrystal', amount: 4, weight: 2 },
      { item: 'fireMarrow', amount: 20, weight: 2 },
    ],
    pillLoot: [{ pill: 'goldenCorePill', amount: 1, weight: 3 }],
  },
  {
    id: 'netherSea',
    name: '幽冥血海',
    icon: '🌊',
    desc: '血海翻涌，海底沉睡着上古真龙遗骸，九幽魂火在水面飘荡。',
    regionId: 'netherVoid',
    requiredPower: 1000,
    duration: 1200,
    minParty: 4,
    maxParty: 10,
    minRealm: 4,
    cooldown: 900,
    baseCasualty: 0.14,
    seedChance: 0.5,
    seedMinRarity: 3,
    seedMaxRarity: 5,
    blueprintChance: 0.07,
    discoveryWeight: 6,
    loot: [
      { item: 'dragonBlood', amount: 8, weight: 2, guaranteed: true },
      { item: 'starSand', amount: 90, weight: 3 },
      { item: 'blackIron', amount: 400, weight: 3 },
      { item: 'coldJade', amount: 60, weight: 2 },
      { item: 'netherFlame', amount: 3, weight: 2 },
    ],
    pillLoot: [{ pill: 'nascentPill', amount: 1, weight: 3 }],
    requiresSectLevel: 3,
  },
  {
    id: 'voidParadise',
    name: '太虚仙境',
    icon: '🌌',
    desc: '漂浮于虚空中的上古仙宫，机关重重，仙玉嵌于殿顶。',
    regionId: 'netherVoid',
    requiredPower: 4000,
    duration: 1800,
    minParty: 4,
    maxParty: 12,
    minRealm: 5,
    cooldown: 1200,
    baseCasualty: 0.18,
    seedChance: 0.55,
    seedMinRarity: 3,
    seedMaxRarity: 5,
    blueprintChance: 0.1,
    discoveryWeight: 5,
    loot: [
      { item: 'dragonBlood', amount: 30, weight: 3, guaranteed: true },
      { item: 'starSand', amount: 300, weight: 3 },
      { item: 'lunarCrystal', amount: 20, weight: 2 },
      { item: 'netherFlame', amount: 8, weight: 2 },
      { item: 'immortalJade', amount: 3, weight: 1 },
    ],
    pillLoot: [
      { pill: 'spiritPill', amount: 1, weight: 3 },
      { pill: 'youthPill', amount: 1, weight: 1 },
    ],
    requiresSectLevel: 5,
  },
  {
    id: 'primordialRuins',
    name: '鸿蒙遗境',
    icon: '🌀',
    desc: '开天辟地时残留的一角，法则残缺，紫气自裂隙中溢出。',
    regionId: 'outerChaos',
    requiredPower: 15000,
    duration: 2400,
    minParty: 5,
    maxParty: 14,
    minRealm: 6,
    cooldown: 1800,
    baseCasualty: 0.22,
    seedChance: 0.6,
    seedMinRarity: 4,
    seedMaxRarity: 6,
    blueprintChance: 0.12,
    discoveryWeight: 4,
    loot: [
      { item: 'immortalJade', amount: 12, weight: 3, guaranteed: true },
      { item: 'dragonBlood', amount: 100, weight: 3 },
      { item: 'netherFlame', amount: 30, weight: 2 },
      { item: 'chaosQi', amount: 2, weight: 1 },
    ],
    pillLoot: [
      { pill: 'unityPill', amount: 1, weight: 3 },
      { pill: 'tiangangPill', amount: 1, weight: 1 },
    ],
    requiresSectLevel: 7,
  },
  {
    id: 'gateOfHeaven',
    name: '上界之门',
    icon: '🚪',
    desc: '传说中的仙门。门后即是上界，多少修士有去无回。',
    regionId: 'outerChaos',
    requiredPower: 60000,
    duration: 3600,
    minParty: 6,
    maxParty: 16,
    minRealm: 7,
    cooldown: 2700,
    baseCasualty: 0.28,
    seedChance: 0.65,
    seedMinRarity: 4,
    seedMaxRarity: 6,
    blueprintChance: 0.15,
    discoveryWeight: 3,
    loot: [
      { item: 'immortalJade', amount: 50, weight: 4, guaranteed: true },
      { item: 'dragonBlood', amount: 300, weight: 3 },
      { item: 'chaosQi', amount: 8, weight: 2 },
      { item: 'primordialFruit', amount: 1, weight: 1 },
    ],
    pillLoot: [
      { pill: 'tribulationPill', amount: 1, weight: 2 },
      { pill: 'ascensionPill', amount: 1, weight: 1 },
    ],
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
