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
  | 'primordialFruit';

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

export const MATERIAL_IDS: MaterialId[] = [...BASE_MATERIAL_IDS, ...RARE_MATERIAL_IDS];

export type MaterialCategory = 'base' | 'rare';

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

/** 稀有度 → 界面配色 */
export const RARITY_COLORS: Record<number, string> = {
  1: '#8a8578',
  2: '#3d7a63',
  3: '#3a6ea8',
  4: '#8a4fa8',
  5: '#b8860b',
  6: '#c0392b',
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
