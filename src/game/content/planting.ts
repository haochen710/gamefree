/**
 * 种植（需求 5）
 *
 * 需求原文：「增加种植元素，探索和商行可以获取炼丹或者炼器需要的材料种子，
 *           其中商行只售卖基础材料种子，稀有材料种子只能由探索获取，
 *           概率随机，越高级的材料概率越小。种植的时候可以花费灵气或者灵石催熟。」
 *
 * 于是种子有两条来源，且**刻意不对等**：
 *   商行  → 只卖基础材料种子（花钱就能稳定拿到）
 *   探索  → 才会掉稀有材料种子，权重随稀有度迅速衰减
 *
 * 这逼着玩家去探索，而不是坐在家里用灵石买齐一切。
 * 种植本身是「安全但慢」的材料来源：不会死人，但要占地块、要等，
 * 与秘境的「快但有伤亡」形成对照。
 */
import { MATERIAL_MAP, RARE_MATERIAL_IDS, type MaterialCategory, type MaterialId } from './resources';

export interface SeedDef {
  /** 种子 id 就是材料 id，避免再多一层映射 */
  material: MaterialId;
  name: string;
  icon: string;
  rarity: number;
  category: MaterialCategory;
  /** 从种下到成熟所需秒数 */
  growSeconds: number;
  /** 成熟后收获的材料数量 */
  yield: number;
  /** 探索时的掉落权重（越高级越小） */
  dropWeight: number;
}

/** 稀有度 → 成熟秒数 */
const GROW_SECONDS: Record<number, number> = { 1: 60, 2: 150, 3: 300, 4: 480, 5: 720, 6: 1080 };
/** 稀有度 → 单次收获数量 */
const HARVEST_YIELD: Record<number, number> = { 1: 6, 2: 5, 3: 3, 4: 2, 5: 1, 6: 1 };
/**
 * 稀有度 → 探索掉落权重。按平方衰减：
 * 二品（rarity 2）权重 30，六品（rarity 6）权重 3 —— 只有它的 1/10。
 *
 * 注意这只是「同一个池子里」的相对概率；高级区域会再用 seedMinRarity
 * 把低阶种子筛掉，否则六品种子会被凡品种子稀释到几乎抽不到。
 */
function dropWeightOf(rarity: number): number {
  return Math.max(1, Math.round(120 / (rarity * rarity)));
}

/**
 * 种子表：每一种材料都有对应的种子。
 *
 * 之所以「全都有种子」，是为了让炼丹炼器的材料清单和种子清单一一对应 ——
 * 玩家看到某个丹方缺「九幽魂火」，能立刻知道"这东西能种，但要先探索拿到种子"。
 */
export const SEEDS: SeedDef[] = (Object.keys(MATERIAL_MAP) as MaterialId[]).map((material) => {
  const def = MATERIAL_MAP[material];
  return {
    material,
    name: `${def.name}种子`,
    icon: def.icon,
    rarity: def.rarity,
    category: def.category,
    growSeconds: GROW_SECONDS[def.rarity] ?? 300,
    yield: HARVEST_YIELD[def.rarity] ?? 2,
    dropWeight: dropWeightOf(def.rarity),
  };
});

export const SEED_MAP: Record<string, SeedDef> = SEEDS.reduce(
  (acc, s) => {
    acc[s.material] = s;
    return acc;
  },
  {} as Record<string, SeedDef>,
);

/** 商行出售的种子：只有基础材料的（需求 5 明文限制） */
export const SHOP_SEEDS: SeedDef[] = SEEDS.filter((s) => s.category === 'base');

/**
 * 探索可以掉落的种子：**全部材料**都有机会掉落。
 *
 * 基础材料的种子商行有卖，探索顺手带回来一点也合理；
 * 真正稀缺的是稀有材料的种子，靠 dropWeight 的平方衰减来体现。
 */
export const EXPLORATION_SEEDS: SeedDef[] = SEEDS;

/** 稀有材料的种子，只能靠探索（需求 5 明文限制） */
export const RARE_SEEDS: SeedDef[] = SEEDS.filter((s) => RARE_MATERIAL_IDS.includes(s.material));

/* ------------------------------------------------------------------ */
/* 催熟                                                                */
/* ------------------------------------------------------------------ */

/**
 * 催熟：花灵气或灵石，立刻给作物推进一段生长进度。
 *
 * 两种货币的性价比刻意拉开：
 *   灵气便宜、推得少（每 150 灵气 90 秒）
 *   灵石贵、推得多（每 30 灵石 300 秒）
 * 前期灵气紧张、灵石更紧张，自然会先点灵气那一档。
 */
export const HASTEN_QI_SECONDS = 90;
export const HASTEN_STONE_SECONDS = 300;
export const HASTEN_QI_BASE = 150;
export const HASTEN_STONE_BASE = 30;
/** 每高一档稀有度，催熟价格乘以该系数 */
export const HASTEN_RARITY_GROWTH = 5;

export function hastenQiCost(rarity: number): number {
  return Math.ceil(HASTEN_QI_BASE * Math.pow(HASTEN_RARITY_GROWTH, rarity - 1));
}

export function hastenStoneCost(rarity: number): number {
  return Math.ceil(HASTEN_STONE_BASE * Math.pow(HASTEN_RARITY_GROWTH, rarity - 1));
}

/** 商行里一颗基础材料种子的价格 */
export function shopSeedPrice(seed: SeedDef): number {
  return Math.ceil(120 * Math.pow(4, seed.rarity - 1));
}
