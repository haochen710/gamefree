/**
 * 资源与材料定义
 *
 * 分成两类，命名空间上刻意区分开：
 *   - 资源（ResourceId）：有设施持续产出、像货币一样的东西
 *   - 材料（MaterialId）：几乎只能从秘境获得，用来炼丹炼器
 *
 * 炼丹 / 炼器的配方可以同时消耗两者，所以用 ItemId 作为统一键。
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
    desc: '修仙界的通货。由灵石矿开采，或用灵气与灵矿合成。招收弟子必需。',
  },
  {
    id: 'herb',
    name: '灵草',
    icon: '🍀',
    desc: '灵田所植，一切丹药的基础药引。',
  },
];

/* ------------------------------------------------------------------ */
/* 材料（秘境产物）                                                     */
/* ------------------------------------------------------------------ */

export type MaterialId = 'demonCore' | 'blackIron' | 'starSand' | 'dragonBlood' | 'immortalJade';

export const MATERIAL_IDS: MaterialId[] = [
  'demonCore',
  'blackIron',
  'starSand',
  'dragonBlood',
  'immortalJade',
];

export interface MaterialDef {
  id: MaterialId;
  name: string;
  icon: string;
  /** 稀有度 1~5，用于秘境掉落权重和界面配色 */
  rarity: number;
  desc: string;
}

export const MATERIALS: MaterialDef[] = [
  {
    id: 'demonCore',
    name: '妖丹',
    icon: '🔴',
    rarity: 1,
    desc: '妖兽内丹，低阶丹药与器物的常见主料。',
  },
  {
    id: 'blackIron',
    name: '玄铁',
    icon: '⬛',
    rarity: 2,
    desc: '深海玄铁，炼器之基。寻常秘境即可寻得。',
  },
  {
    id: 'starSand',
    name: '星辰砂',
    icon: '✨',
    rarity: 3,
    desc: '天外陨星所化，中品丹药与法器的关键材料。',
  },
  {
    id: 'dragonBlood',
    name: '龙血',
    icon: '🩸',
    rarity: 4,
    desc: '真龙遗血，蕴含磅礴生机，高阶丹药不可或缺。',
  },
  {
    id: 'immortalJade',
    name: '仙玉',
    icon: '🟩',
    rarity: 5,
    desc: '仙界遗珍，只存在于最凶险的秘境深处。',
  },
];

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
};

export const RARITY_NAMES: Record<number, string> = {
  1: '凡品',
  2: '灵品',
  3: '宝品',
  4: '仙品',
  5: '神品',
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
