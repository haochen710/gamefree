/**
 * 资源与材料定义
 *
 * 分成两类，命名空间上刻意区分开：
 *   - 资源（ResourceId）：有设施持续产出、像货币一样的东西
 *   - 材料（MaterialId）：来自游历 / 秘境 / 种植 / 商行，用来炼丹炼器
 *
 * 材料再细分两级（需求 2）：
 *   - 基础材料（base）：一至三品丹药器物的主料，可以买到种子、可以自己种
 *   - 稀有材料（rare）：越高品阶的丹方器方越依赖它，**种类数随品阶递增**；
 *     种子只能靠探索获取，概率随稀有度递减
 *
 * 炼丹 / 炼器的配方可以同时消耗资源与材料，所以用 ItemId 作为统一键。
 */

/* ------------------------------------------------------------------ */
/* 资源                                                                */
/* ------------------------------------------------------------------ */

export type ResourceId = 'qi' | 'wood' | 'ore' | 'stone' | 'herb';

export const RESOURCE_IDS: ResourceId[] = ['qi', 'wood', 'ore', 'stone', 'herb'];

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
    desc: '修仙之本。聚灵阵可自动汲取，打坐也能获取。',
  },
  {
    id: 'wood',
    name: '灵木',
    icon: '🌿',
    desc: '灵木林所产，建造多数设施的必备木料。',
  },
  {
    id: 'ore',
    name: '灵矿',
    icon: '⛰',
    desc: '灵矿脉所采，可炼器，也能与灵气合成灵石。',
  },
  {
    id: 'stone',
    name: '灵石',
    icon: '💎',
    desc: '修仙界的通货。可开采、可合成，招收弟子与商行交易都必需。',
  },
  {
    id: 'herb',
    name: '灵草',
    icon: '🍀',
    desc: '灵田所植，一切丹药的基础药引。',
  },
];

/* ------------------------------------------------------------------ */
/* 材料                                                                */
/* ------------------------------------------------------------------ */

export type MaterialId =
  /* 基础材料 */
  | 'demonCore'
  | 'blackIron'
  | 'spiritSilk'
  | 'fireMarrow'
  | 'coldJade'
  /* 稀有材料 */
  | 'moonDew'
  | 'starSand'
  | 'lunarCrystal'
  | 'dragonBlood'
  | 'netherFlame'
  | 'immortalJade'
  | 'chaosQi'
  | 'primordialFruit'
  /* 进阶资源（需求 4：由基础资源合成而来，不能种、也不从秘境掉） */
  | 'spiritEssence'
  | 'refinedGold'
  | 'arrayCore';

/**
 * 基础材料：低品阶丹药器物的常备主料。
 * 商行会出售它们的种子，因此来源稳定。
 */
export const BASE_MATERIAL_IDS: MaterialId[] = [
  'demonCore',
  'blackIron',
  'spiritSilk',
  'fireMarrow',
  'coldJade',
];

/**
 * 稀有材料：高品阶丹方的关键。
 *
 * 顺序即「解锁顺序」，越靠后越稀有：种子只能靠探索得到，
 * 掉落权重随稀有度递减（需求 5）。
 */
export const RARE_MATERIAL_IDS: MaterialId[] = [
  'moonDew',
  'starSand',
  'lunarCrystal',
  'dragonBlood',
  'netherFlame',
  'immortalJade',
  'chaosQi',
  'primordialFruit',
];

/**
 * 进阶资源（需求 4）。
 *
 * 需求原文：
 *   「增加进阶资源，可有基础资源合成获取，当前只有灵石合成，过于单调，
 *     进阶资源可用于商行交易或者炼丹炼器，这块需要你重新设计一下」
 *
 * 设计成**三种、各自对应一条下游**，而不是堆一堆中间产物：
 *   - 灵液 spiritEssence —— 灵气 + 灵草 → 炼丹（高品丹方的必需辅料）
 *   - 精金 refinedGold   —— 灵矿 + 灵石 → 炼器（高阶器物的主料）
 *   - 阵枢 arrayCore     —— 灵木 + 灵石 → 阵法/宗门建筑（宗门大阵的必需件）
 *
 * 三条线各有明确出口，玩家一看就知道"缺哪个该去合成哪个"。
 * 它们**不能种、也不会从秘境掉落** —— 只能合成，
 * 这样"合成"才是一门真手艺，而不是又一条能靠挂机绕过去的路。
 */
export const REFINED_MATERIAL_IDS: MaterialId[] = ['spiritEssence', 'refinedGold', 'arrayCore'];

export const MATERIAL_IDS: MaterialId[] = [
  ...BASE_MATERIAL_IDS,
  ...RARE_MATERIAL_IDS,
  ...REFINED_MATERIAL_IDS,
];

export type MaterialCategory = 'base' | 'rare' | 'refined';

export interface MaterialDef {
  id: MaterialId;
  name: string;
  icon: string;
  /** 稀有度 1~6，用于掉落权重、种子成熟时间与界面配色 */
  rarity: number;
  category: MaterialCategory;
  /** 是否可以用种子种出（本作所有材料都有种子） */
  plantable: boolean;
  desc: string;
}

export const MATERIALS: MaterialDef[] = [
  /* ---------------- 基础材料 ---------------- */
  {
    id: 'demonCore',
    name: '妖丹',
    icon: '🔴',
    rarity: 1,
    category: 'base',
    plantable: true,
    desc: '妖兽内丹，低阶丹药与器物的常见主料。',
  },
  {
    id: 'blackIron',
    name: '玄铁',
    icon: '⬛',
    rarity: 2,
    category: 'base',
    plantable: true,
    desc: '深海玄铁，炼器之基。凡有矿脉处皆可寻得。',
  },
  {
    id: 'spiritSilk',
    name: '灵蚕丝',
    icon: '🧵',
    rarity: 2,
    category: 'base',
    plantable: true,
    desc: '灵蚕吐出的丝，柔韧而通灵，法衣与符箓之本。',
  },
  {
    id: 'fireMarrow',
    name: '地火髓',
    icon: '🔥',
    rarity: 3,
    category: 'base',
    plantable: true,
    desc: '地脉深处凝出的火精，能催动丹炉与炉火。',
  },
  {
    id: 'coldJade',
    name: '寒玉',
    icon: '🧊',
    rarity: 3,
    category: 'base',
    plantable: true,
    desc: '万年寒泉中结出的玉髓，可镇药性、可淬剑锋。',
  },

  /* ---------------- 稀有材料 ---------------- */
  {
    id: 'moonDew',
    name: '月华露',
    icon: '🌙',
    rarity: 2,
    category: 'rare',
    plantable: true,
    desc: '月圆之夜凝聚的清露，虽为稀有，却是最易得的一种。',
  },
  {
    id: 'starSand',
    name: '星辰砂',
    icon: '✨',
    rarity: 3,
    category: 'rare',
    plantable: true,
    desc: '天外陨星所化，中品丹药与法器的关键材料。',
  },
  {
    id: 'lunarCrystal',
    name: '太阴玄晶',
    icon: '🔷',
    rarity: 4,
    category: 'rare',
    plantable: true,
    desc: '太阴星力凝成的晶石，可容纳庞大灵机。',
  },
  {
    id: 'dragonBlood',
    name: '龙血',
    icon: '🩸',
    rarity: 4,
    category: 'rare',
    plantable: true,
    desc: '真龙遗血，蕴含磅礴生机，高阶丹药不可或缺。',
  },
  {
    id: 'netherFlame',
    name: '九幽魂火',
    icon: '🕯',
    rarity: 5,
    category: 'rare',
    plantable: true,
    desc: '九幽之地不灭的魂火，能焚炼神魂。',
  },
  {
    id: 'immortalJade',
    name: '仙玉',
    icon: '🟩',
    rarity: 5,
    category: 'rare',
    plantable: true,
    desc: '仙界遗珍，只存在于最凶险的秘境深处。',
  },
  {
    id: 'chaosQi',
    name: '混沌紫气',
    icon: '🟣',
    rarity: 6,
    category: 'rare',
    plantable: true,
    desc: '开天辟地前的一缕紫气，贵重胜过一国。',
  },
  {
    id: 'primordialFruit',
    name: '鸿蒙道果',
    icon: '🍑',
    rarity: 6,
    category: 'rare',
    plantable: true,
    desc: '鸿蒙初开时结下的道果，一枚可抵千年苦修。',
  },

  /* ---------------- 进阶资源（需求 4：只能合成） ---------------- */
  {
    id: 'spiritEssence',
    name: '灵液',
    icon: '💧',
    rarity: 3,
    category: 'refined',
    plantable: false,
    desc: '灵气与灵草反复煎熬后凝出的液滴。四品以上的丹方几乎都要用它作引。',
  },
  {
    id: 'refinedGold',
    name: '精金',
    icon: '🥇',
    rarity: 4,
    category: 'refined',
    plantable: false,
    desc: '灵矿与灵石同炉百炼，去尽杂质剩下的那一分。五品以上的器物非它不成。',
  },
  {
    id: 'arrayCore',
    name: '阵枢',
    icon: '🔯',
    rarity: 4,
    category: 'refined',
    plantable: false,
    desc: '灵木为骨、灵石为血，刻满符文的枢纽。所有大型阵法的核心部件。',
  },
];

export const MATERIAL_MAP: Record<MaterialId, MaterialDef> = MATERIALS.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<MaterialId, MaterialDef>,
);


/* ------------------------------------------------------------------ */
/* 统一键                                                              */
/* ------------------------------------------------------------------ */

export type ItemId = ResourceId | MaterialId;

export const ITEM_IDS: ItemId[] = [...RESOURCE_IDS, ...MATERIAL_IDS];

const RESOURCE_ID_SET = new Set<string>(RESOURCE_IDS);

export function isResourceId(id: ItemId): id is ResourceId {
  return RESOURCE_ID_SET.has(id);
}

const RARE_MATERIAL_SET = new Set<string>(RARE_MATERIAL_IDS);

/** 这个物品是不是「稀有材料」（月华露及以上那几种）。掌门独自探秘境时专挑这些 */
export function isRareMaterial(id: ItemId): boolean {
  return RARE_MATERIAL_SET.has(id);
}

/**
 * 这个物品是不是「**基础材料**」（材料里除稀有材料之外的那几种）。
 *
 * 季节与天象只影响基础材料的产出：稀有材料来自秘境深处，
 * 不该被地表的气候左右 —— 否则一年里总有一段时间刷不到星辰砂。
 */
export function isBasicMaterial(id: ItemId): id is MaterialId {
  return MATERIAL_ID_SET.has(id) && !RARE_MATERIAL_SET.has(id);
}

const MATERIAL_ID_SET = new Set<string>(MATERIAL_IDS);


export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  desc: string;
}

export const ITEM_MAP: Record<ItemId, ItemDef> = [
  ...RESOURCES,
  ...MATERIALS.map((m) => ({ id: m.id as ItemId, name: m.name, icon: m.icon, desc: m.desc })),
].reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<ItemId, ItemDef>,
);

export const RESOURCE_MAP: Record<ResourceId, ResourceDef> = RESOURCES.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<ResourceId, ResourceDef>,
);

/**
 * 稀有度 → 界面配色（本轮需求 3：UI 改黑白风）。
 *
 * 原来是绿 / 蓝 / 紫 / 金 / 红五色。去掉色相之后，
 * 稀有度靠**明度**表达：越稀有越黑（墨越浓）。
 * 于是"道品"是近乎纯黑、凡品是浅灰 —— 在一屏浅色底上，
 * 一眼仍能看出哪一行更重。
 *
 * ⚠️ 颜色写在这里而不是 CSS 里，所以改主题时必须回来改这一处，
 * 否则"黑白风"只改了外壳、物品名字还是彩色。
 */
export const RARITY_COLORS: Record<number, string> = {
  1: '#b3b3b3',
  2: '#969696',
  3: '#7a7a7a',
  4: '#5c5c5c',
  5: '#3d3d3d',
  6: '#151515',
};

export const RARITY_NAMES: Record<number, string> = {
  1: '凡品',
  2: '灵品',
  3: '宝品',
  4: '仙品',
  5: '神品',
  6: '道品',
};

/** 一到九品的罗马化中文序号，炼丹炼器到处都要用 */
export const TIER_NAMES = [
  '',
  '一品',
  '二品',
  '三品',
  '四品',
  '五品',
  '六品',
  '七品',
  '八品',
  '九品',
];

export function tierName(tier: number): string {
  return TIER_NAMES[tier] ?? `${tier}品`;
}

/**
 * 稀有材料的掉落权重（第 33 轮需求 7）。
 *
 * 玩家原话：「稀有材料里面，各个材料的掉落率降低，且越是在高境界需要的材料，
 * 掉落概率越低」。权重按 RARE_MATERIAL_IDS 的位次逐级衰减：位次 0 乘 RARE_DROP_BASE，
 * 之后每级再乘 RARE_DROP_FALLOFF。改这两个数就能整体调松/调紧，
 * 不必去动几十处秘境的掉落表。
 */
export const RARE_DROP_BASE = 0.6;
export const RARE_DROP_FALLOFF = 0.72;

/* ------------------------------------------------------------------ */
/* 观天楼与天机点（第 33 轮需求 5）                                     */
/* ------------------------------------------------------------------ */

/**
 * 夜观星象的**天机点**产出（每秒）。
 *
 * 玩家原话：「增加观天楼建筑……该建筑夜观星象，可获得天机点，
 * 钻研和领悟功法等增加消耗天机点的需求」。
 *
 * 数值口径：**前期卡、后期够用** —— 每级每秒 0.1 点（一级楼 6 点/分），
 * 而钻研一次要 3~12 点、领悟一次要 1~16 点，所以想快点钻研就得多升楼。
 * 三个数都在这里，想调只改这一处。
 */
export const FATE_PER_SECOND = 0.1;

/** 观天楼最高等级（与"每升一个大境界可升一级"配套） */
export const OBSERVATORY_MAX_LEVEL = 9;

/** 钻研一项技术要多少天机点（按它要求的境界递增） */
export const FATE_COST_RESEARCH_PER_REALM = 3;

/** 领悟一册功法要多少天机点（按品阶 1~5） */
export const FATE_COST_CONTEMPLATE = [1, 2, 4, 8, 16] as const;

/**
 * 观天楼升级的**海量花费**（第 33 轮需求 5）。
 *
 * 玩家原话：「该建筑可升级，玩家每升一个大境界，该建筑也可升级，但需求海量资源」。
 *
 * 设计口径：**升级的花费明显高于同期的其它开销**（约为一次突破的 1~2 倍），
 * 而且要随等级指数增长（每级 ×3）—— 这样"升楼"永远是一个需要专门攒钱的决定，
 * 而不是顺手就点了。想调松紧只改这两个数。
 */
export const OBSERVATORY_UPGRADE_BASE = { qi: 5e5, wood: 2e4, stone: 1e4 } as const;
export const OBSERVATORY_UPGRADE_GROWTH = 3;
