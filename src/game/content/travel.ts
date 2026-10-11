/**
 * 个人游历（需求 1）
 *
 * 需求原文：「在玩家未开宗立派之前，玩家可以自己去探索，获取各种材料，
 *           材料的获取随机，可以是灵石等基础材料，也可能是炼丹炼器等进阶材料。
 *           并且材料的获取跟着玩家的等级走，玩家的等级越高，才能获取对应等级的材料。
 *           玩家探索的时候由于无人监管家里，各种产量降低」
 *
 * 设计要点：
 *   1. 每个区域有 minRealm 门槛 —— 境界不够就去不了，这是「材料跟着等级走」的实现；
 *   2. **出游期间全局产量下降**（TRAVEL_PRODUCTION_PENALTY），这是需求明确要求的代价，
 *      也让「要不要出门」成为每个阶段都要重新权衡的决策；
 *   3. 掌门亲自出行不会陨落 —— 秘境里死人的是弟子，玩家自己不会，
 *      所以游历是「安全但慢」的材料来源，与秘境的「快但会死人」相对。
 */
import type { ItemId } from './resources';

export interface TravelLootEntry {
  item: ItemId;
  /** 基础数量 */
  amount: number;
  /** 抽取权重 */
  weight: number;
  /** 是否必定掉落 */
  guaranteed?: boolean;
}

export interface TravelRegionDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 所在的地图区域（见 map.ts） */
  regionId: string;
  /** 玩家境界下限（对应 REALMS 下标） */
  minRealm: number;
  /** 一次游历的进度秒数 */
  duration: number;
  loot: TravelLootEntry[];
  /** 带回材料种子的概率 */
  seedChance: number;
  /**
   * 此地最低会掉几级稀有度的种子（默认 1）。
   *
   * 高级区域不该再掉凡品种子：否则到了大乘期，种子池里塞满
   * 妖丹、玄铁这类一二品种子，六品的鸿蒙道果种子会被稀释到几乎抽不到。
   */
  seedMinRarity?: number;
  /** 此地最多能带回多少级稀有度的种子 */
  seedMaxRarity: number;
}

/** 每次游历从掉落池里抽取的条目数 */
export const TRAVEL_LOOT_ROLLS = 3;

/**
 * 出游期间的全局产量惩罚（0.45 = 减产 45%）。
 *
 * 「无人监管家里」—— 掌门一走，聚灵阵没人照看、灵田没人打理。
 * 定得比道伤（25%）重，因为游历是玩家主动选择的行为，
 * 而且随时可以取消，不像道伤那样是被迫承受的。
 */
export const TRAVEL_PRODUCTION_PENALTY = 0.45;

/**
 * 游历一次至少带回多少灵石。
 *
 * 山野荒村的灵石是必掉项（60 × 0.8~1.2 = 48~72），这里再兜一个下限，
 * 保证"出门一趟一定有实在收益"。
 * 注意：**一趟凑不齐第一门技术**（炼丹入门要 100 灵石），通常要跑两趟 ——
 * 这是刻意的，「第一次出门」不必一步到位。
 */
export const TRAVEL_MIN_STONE = 40;

export const TRAVEL_REGIONS: TravelRegionDef[] = [
  {
    id: 'mortalVillage',
    regionId: 'nearHills',
    name: '山野荒村',
    icon: '🏘',
    desc: '山下的凡俗村落，收些药材、换些散碎灵石，炼气修士足矣。',
    minRealm: 0,
    seedMaxRarity: 2,
    duration: 90,
    seedChance: 0.35,
    loot: [
      { item: 'stone', amount: 60, weight: 1, guaranteed: true },
      { item: 'wood', amount: 250, weight: 5 },
      { item: 'herb', amount: 200, weight: 5 },
      { item: 'demonCore', amount: 3, weight: 3 },
      // 需求 1 原文说得很明白：「可能是灵石等基础材料，也可能是炼丹炼器等进阶材料」。
      // 月华露与灵蚕丝刻意给低权重 —— 炼气期也能沾到一点，但要跑好几趟，
      // 这样二品丹方（筑基丹等）才有材料可用，而不必等到筑基期再回头做。
      { item: 'spiritSilk', amount: 3, weight: 2 },
      { item: 'moonDew', amount: 2, weight: 2 },
    ],
  },
  {
    id: 'mistyForest',
    regionId: 'mistyFrontier',
    name: '迷雾灵林',
    icon: '🌫',
    desc: '终年不散的白雾中藏着灵蚕与妖兽，筑基修士方可深入。',
    minRealm: 1,
    seedMaxRarity: 3,
    duration: 180,
    seedChance: 0.4,
    loot: [
      { item: 'stone', amount: 150, weight: 1, guaranteed: true },
      { item: 'wood', amount: 600, weight: 4 },
      { item: 'herb', amount: 500, weight: 4 },
      { item: 'demonCore', amount: 12, weight: 3 },
      { item: 'blackIron', amount: 6, weight: 3 },
      { item: 'spiritSilk', amount: 5, weight: 2 },
      { item: 'moonDew', amount: 2, weight: 1 },
    ],
  },
  {
    id: 'emberRavine',
    regionId: 'scorchedWilds',
    name: '烈焰裂谷',
    icon: '🌋',
    desc: '地火喷涌的裂谷，火髓与寒玉在此同生，乃是奇景。',
    minRealm: 2,
    seedMinRarity: 2,
    seedMaxRarity: 3,
    duration: 300,
    seedChance: 0.45,
    loot: [
      { item: 'stone', amount: 400, weight: 1, guaranteed: true },
      { item: 'ore', amount: 800, weight: 4 },
      { item: 'demonCore', amount: 25, weight: 3 },
      { item: 'blackIron', amount: 18, weight: 3 },
      { item: 'fireMarrow', amount: 5, weight: 2 },
      { item: 'coldJade', amount: 4, weight: 2 },
      { item: 'starSand', amount: 2, weight: 1 },
      // 三、四品丹方（化婴丹等）在金丹期就要用月华露，
      // 所以这里必须能稳定拿到 —— 否则玩家得回头刷迷雾灵林，很别扭
      { item: 'moonDew', amount: 6, weight: 2 },
      { item: 'spiritSilk', amount: 15, weight: 2 },
    ],
  },
  {
    id: 'frostHollow',
    regionId: 'iceValley',
    name: '寒泉幽谷',
    icon: '❄',
    desc: '万年寒泉自谷底涌出，泉边结满寒玉，月华在此凝露。',
    minRealm: 3,
    seedMinRarity: 2,
    seedMaxRarity: 4,
    duration: 420,
    seedChance: 0.5,
    loot: [
      { item: 'stone', amount: 1200, weight: 1, guaranteed: true },
      { item: 'herb', amount: 3000, weight: 4 },
      { item: 'coldJade', amount: 10, weight: 3 },
      { item: 'spiritSilk', amount: 20, weight: 3 },
      { item: 'moonDew', amount: 8, weight: 3 },
      { item: 'starSand', amount: 8, weight: 2 },
      { item: 'lunarCrystal', amount: 1, weight: 1 },
    ],
  },
  {
    id: 'ancientBattlefield',
    regionId: 'netherVoid',
    name: '上古战场',
    icon: '⚔',
    desc: '两位大能交手之处，空间至今未曾愈合，残兵与魂魄遍地。',
    minRealm: 4,
    seedMinRarity: 3,
    seedMaxRarity: 5,
    duration: 600,
    seedChance: 0.55,
    loot: [
      { item: 'stone', amount: 4000, weight: 1, guaranteed: true },
      { item: 'blackIron', amount: 120, weight: 3 },
      { item: 'starSand', amount: 20, weight: 3 },
      { item: 'lunarCrystal', amount: 4, weight: 2 },
      { item: 'dragonBlood', amount: 3, weight: 2 },
      { item: 'netherFlame', amount: 1, weight: 1 },
    ],
  },
  {
    id: 'netherRift',
    regionId: 'starCorridor',
    name: '九幽裂隙',
    icon: '🕳',
    desc: '直通九幽的裂口，魂火飘荡，寻常修士靠近便神魂受损。',
    minRealm: 5,
    seedMinRarity: 3,
    seedMaxRarity: 5,
    duration: 900,
    seedChance: 0.6,
    loot: [
      { item: 'stone', amount: 12000, weight: 1, guaranteed: true },
      { item: 'starSand', amount: 60, weight: 3 },
      { item: 'lunarCrystal', amount: 10, weight: 3 },
      { item: 'dragonBlood', amount: 10, weight: 3 },
      { item: 'netherFlame', amount: 4, weight: 2 },
      { item: 'immortalJade', amount: 1, weight: 1 },
    ],
  },
  {
    id: 'chaosSea',
    regionId: 'primordialRemnant',
    name: '混沌之海',
    icon: '🌊',
    desc: '未经开辟的混沌之水，一滴可压塌山岳，紫气自其中翻涌而出。',
    minRealm: 6,
    seedMinRarity: 4,
    seedMaxRarity: 6,
    duration: 1200,
    seedChance: 0.65,
    loot: [
      { item: 'stone', amount: 4e4, weight: 1, guaranteed: true },
      { item: 'dragonBlood', amount: 30, weight: 3 },
      { item: 'netherFlame', amount: 10, weight: 3 },
      { item: 'immortalJade', amount: 5, weight: 2 },
      { item: 'chaosQi', amount: 2, weight: 1 },
    ],
  },
  {
    id: 'primordialVoid',
    regionId: 'starSeaEnd',
    name: '鸿蒙虚空',
    icon: '🌌',
    desc: '开天辟地之前的遗迹，法则尚未成形，道果就悬在最深处。',
    minRealm: 7,
    seedMinRarity: 4,
    seedMaxRarity: 6,
    duration: 1800,
    seedChance: 0.7,
    loot: [
      { item: 'stone', amount: 2e5, weight: 1, guaranteed: true },
      { item: 'dragonBlood', amount: 80, weight: 3 },
      { item: 'immortalJade', amount: 15, weight: 3 },
      { item: 'chaosQi', amount: 6, weight: 2 },
      { item: 'primordialFruit', amount: 1, weight: 1 },
    ],
  },
];

export const TRAVEL_REGION_MAP: Record<string, TravelRegionDef> = TRAVEL_REGIONS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, TravelRegionDef>,
);
