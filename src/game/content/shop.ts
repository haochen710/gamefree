/**
 * 商行（需求 3 / 6）
 *
 * 需求原文：
 *   3. 「增加商行建筑，玩家可在商行换取物资，商行每次售卖一部分资源，
 *       每个游戏时间一个月刷新一次」
 *   6. 「部分稀有建筑需要探索或者商行购买，商行随机刷新商品」
 *
 * 商行卖四类东西：
 *   资源   —— 灵气 / 灵木 / 灵矿 / 灵草，用灵石换，应急用
 *   基础种子 —— 只有基础材料的种子（需求 5 明文限制）
 *   基础材料 —— 让「不想出门」的玩家也有一条慢路子
 *   图纸   —— 稀有建筑的关键，随机刷新，价格不菲
 *
 * 刻意**不卖**稀有材料与稀有种子：那是探索的价值所在。
 */
import { BLUEPRINTS } from './techs';
import { GAME_DAYS_PER_SECOND } from './realms';
import { BASE_MATERIAL_IDS } from './resources';
import { SHOP_SEEDS, shopSeedPrice } from './planting';

export type ShopGoodKind = 'resource' | 'seed' | 'material' | 'blueprint';

export interface ShopGoodDef {
  kind: ShopGoodKind;
  /** ResourceId / MaterialId（种子与材料都用材料 id）/ 图纸 id */
  item: string;
  /** 基础数量，实际数量会按玩家境界倍率放大 */
  baseAmount: number;
  /** 基础价格（灵石），同样按境界倍率放大 */
  basePrice: number;
  /** 抽中权重 */
  weight: number;
}

/** 一条商行货品（会存进存档） */
export interface ShopOffer {
  /** 生成时的唯一 id，用于 React key 与结算 */
  id: string;
  kind: ShopGoodKind;
  item: string;
  amount: number;
  price: number;
  sold: boolean;
}

/** 每次刷新上架几件商品 */
export const SHOP_OFFER_COUNT = 5;

/**
 * 商行刷新间隔。
 *
 * 需求写的是「每个游戏时间一个月刷新一次」，但本作
 * 1 真实秒 = 30 游戏天，一个游戏月只有 **1 真实秒** —— 照字面实现，
 * 商行就变成一台每秒重摇的老虎机，玩家只会一直刷新。
 * 所以换算成游戏时间是 60 个月（5 游戏年），约合 60 真实秒。
 * 想改回字面意思就把这个数字改成 1。
 */
export const SHOP_REFRESH_GAME_MONTHS = 60;
export const GAME_DAYS_PER_MONTH = 30;

export const SHOP_REFRESH_SECONDS =
  (SHOP_REFRESH_GAME_MONTHS * GAME_DAYS_PER_MONTH) / GAME_DAYS_PER_SECOND;

/** 灵石换资源的汇率（基准，实际按境界倍率放大） */
export const SHOP_GOODS: ShopGoodDef[] = [
  /* ---- 资源 ---- */
  { kind: 'resource', item: 'qi', baseAmount: 1200, basePrice: 500, weight: 6 },
  { kind: 'resource', item: 'wood', baseAmount: 600, basePrice: 300, weight: 10 },
  { kind: 'resource', item: 'ore', baseAmount: 600, basePrice: 350, weight: 10 },
  { kind: 'resource', item: 'herb', baseAmount: 500, basePrice: 400, weight: 10 },

  /* ---- 基础材料 ---- */
  ...BASE_MATERIAL_IDS.map((id) => ({
    kind: 'material' as const,
    item: id,
    baseAmount: 8,
    basePrice: 700,
    weight: 6,
  })),

  /* ---- 基础材料种子 ---- */
  ...SHOP_SEEDS.map((seed) => ({
    kind: 'seed' as const,
    item: seed.material,
    baseAmount: 3,
    basePrice: shopSeedPrice(seed),
    weight: 8,
  })),

  /* ---- 图纸：稀有，权重很低 ---- */
  ...BLUEPRINTS.map((bp) => ({
    kind: 'blueprint' as const,
    item: bp.id,
    baseAmount: 1,
    basePrice: 3e4,
    weight: 1,
  })),
];

export const SHOP_GOOD_MAP: Record<string, ShopGoodDef> = SHOP_GOODS.reduce(
  (acc, good) => {
    acc[`${good.kind}:${good.item}`] = good;
    return acc;
  },
  {} as Record<string, ShopGoodDef>,
);
