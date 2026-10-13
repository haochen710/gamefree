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
import { BASE_MATERIAL_IDS } from './resources';
import { SHOP_SEEDS, shopSeedPrice } from './planting';

/**
 * 商品种类。
 *
 * 需求 7：「商行不仅可以购买材料和种子、图纸等，**装备、丹药、符箓、法宝**
 * 也可以包含进去」—— 所以后四种也是合法的货品种类。
 * 它们只出现在 RARE_GOODS 里（普通商品池不掺这些）。
 */
export type ShopGoodKind = 'resource' | 'seed' | 'material' | 'blueprint' | 'pill' | 'talisman' | 'gear' | 'artifact';

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
 * 需求写的是「每个游戏时间一个月刷新一次」，但这条**不能**真的挂到日历上：
 *   1. 早先 1 真实秒 = 30 游戏天，一个游戏月只有 1 真实秒 ——
 *      照字面实现，商行就成了一台每秒重摇的老虎机；
 *   2. 需求 1 把日历改成「一年 = 现实 8 分钟」之后，一个游戏月约 39 真实秒，
 *      而原先那句"60 个游戏月"会算出 **39 分钟** —— 货架 39 分钟才换一次，
 *      玩家早就忘了它卖什么。
 *
 * 所以商行刷新**直接按真实秒定义**：就是 60 秒一次。
 * 它的节奏是给坐在屏幕前的人看的，不该跟着世界观日历走。
 */
export const SHOP_REFRESH_SECONDS = 60;
export const GAME_DAYS_PER_MONTH = 30;

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

  /*
   * ---- 进阶资源（需求 4：可用于商行交易） ----
   *
   * 商行**卖**它们，但价格定得很贵（合成才是正路）——
   * 这样"急着用又懒得合成"的玩家有一条应急通道，
   * 又不会让合成这条线失去意义。稀有度越高、权重越低。
   */
  { kind: 'material', item: 'spiritEssence', baseAmount: 3, basePrice: 9000, weight: 4 },
  { kind: 'material', item: 'refinedGold', baseAmount: 2, basePrice: 26000, weight: 3 },
  { kind: 'material', item: 'arrayCore', baseAmount: 2, basePrice: 22000, weight: 3 },

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

/* ------------------------------------------------------------------ */
/* 卖出与商队（需求 7）                                                */
/* ------------------------------------------------------------------ */

/**
 * 卖价 = 买入价 × 40%（与用户确认）。
 *
 * ⚠️ 必须明显小于 1：商行是"方便"，不是印钞机。
 * 40% 彻底堵死"同一轮低买高卖"的套利（买进再卖出必亏 60%），
 * 而"把用不上的材料换成灵石"仍然划算。
 */
export const SELL_RATIO = 0.4;

/** 商队多久来一次（需求 8：所有事件的刷新率都要很低） */
export const CARAVAN_INTERVAL_SECONDS = 12 * 60;
/** 商队停留多久 */
export const CARAVAN_STAY_SECONDS = 5 * 60;
/** 商队最多同时要几样东西 */
export const CARAVAN_MAX_WANTS = 3;

/* ------------------------------------------------------------------ */
/* 稀有货品（需求 7：装备、丹药、符箓、法宝也可以上架）                */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：「商行不仅可以购买材料和种子、图纸等，**装备、丹药、符箓、法宝**
 * 也可以包含进去，但是**很稀有**，而且商行刷新的这些**与玩家等级挂钩**，
 * 等级越高刷新的这些装备啥的**品阶才越高**」。
 *
 * 落地方式：
 *   - 单独一张 RARE_GOODS 表，**不进**普通商品池（否则货架会被它们占满，
 *     普通材料反而买不到了）；
 *   - 每条带 `unlockSectLevel`：**宗门品阶**就是这里的"玩家等级"，
 *     品阶不到就不上架 —— 所以低级宗门不会刷出天纵装备；
 *   - 权重很低（1~3，普通货品是 10 上下），所以它们**很稀有**。
 */
export interface RareGoodDef extends ShopGoodDef {
  /** 需要几品宗门才会刷出（宗门品阶 1~9，1 最低） */
  unlockSectLevel: number;
  /** 显示用的一句话 */
  note: string;
}

const RARE_POOL: { item: string; kind: ShopGoodKind; basePrice: number; note: string; unlockSectLevel: number; weight?: number }[] = [
  /* ---- 丹药：成品直接买，省一炉火 -------------------------------- */
  { item: 'foundationPill', kind: 'pill', basePrice: 4e4, note: '筑基丹：突破筑基的敲门砖', unlockSectLevel: 2 },
  { item: 'goldenCorePill', kind: 'pill', basePrice: 6e5, note: '金丹：结丹期的必需品', unlockSectLevel: 3 },
  { item: 'nascentPill', kind: 'pill', basePrice: 4e6, note: '元婴丹：化婴之资', unlockSectLevel: 4 },
  { item: 'spiritPill', kind: 'pill', basePrice: 5e7, note: '化神丹：神魂蜕变', unlockSectLevel: 5 },
  { item: 'voidPill', kind: 'pill', basePrice: 8e8, note: '炼虚丹：触及虚空', unlockSectLevel: 6 },
  { item: 'unityPill', kind: 'pill', basePrice: 2e10, note: '合体丹：法体合一', unlockSectLevel: 7 },
  { item: 'tribulationPill', kind: 'pill', basePrice: 5e11, note: '渡劫丹：直面天劫', unlockSectLevel: 8 },
  // 保命丹与返魂丹是弟子装备栏里的消耗品，商行偶尔也会带几颗
  { item: 'safetyPill', kind: 'pill', basePrice: 2e5, note: '保命丹：一趟探索免死', unlockSectLevel: 3, weight: 2 },
  { item: 'bloodPill', kind: 'pill', basePrice: 9e6, note: '返魂丹：高阶护命', unlockSectLevel: 6, weight: 2 },

  /* ---- 符箓：稀有，且按品阶解锁 ---------------------------------- */
  { item: 'spiritBasic', kind: 'talisman', basePrice: 3e4, note: '聚灵符：限时抬产量', unlockSectLevel: 2, weight: 2 },
  { item: 'spiritSilver', kind: 'talisman', basePrice: 5e5, note: '银纹聚灵符', unlockSectLevel: 4 },
  { item: 'breakSilver', kind: 'talisman', basePrice: 8e5, note: '银纹破境符：突破成功率 +5%', unlockSectLevel: 4 },
  { item: 'spiritGold', kind: 'talisman', basePrice: 9e6, note: '金篆聚灵符：产量 ×2', unlockSectLevel: 6 },
  { item: 'breakGold', kind: 'talisman', basePrice: 1.4e7, note: '金篆破境符：突破成功率 +8%', unlockSectLevel: 6 },

  /* ---- 装备：弟子五栏的成品（id 就是 GEARS 里的那些） ------------- */
  { item: 'jadePendant', kind: 'gear', basePrice: 6e4, note: '凝神玉佩：增益栏', unlockSectLevel: 2 },
  { item: 'spiritCrown', kind: 'gear', basePrice: 4e5, note: '聚灵冠：增益栏（修行加成）', unlockSectLevel: 3 },
  { item: 'daoSeal', kind: 'gear', basePrice: 5e6, note: '悟道印：高阶增益栏', unlockSectLevel: 5 },
  { item: 'ironSword', kind: 'gear', basePrice: 3e4, note: '玄铁剑：进攻栏', unlockSectLevel: 2, weight: 2 },
  { item: 'talismanBlade', kind: 'gear', basePrice: 8e5, note: '符箓飞刃：进攻栏', unlockSectLevel: 4 },
  { item: 'immortalTreasure', kind: 'gear', basePrice: 6e9, note: '仙家重宝：顶阶进攻栏', unlockSectLevel: 8 },
  { item: 'hideArmor', kind: 'gear', basePrice: 2e4, note: '妖兽皮甲：防御栏（降伤亡）', unlockSectLevel: 2, weight: 2 },
  { item: 'spiritRobe', kind: 'gear', basePrice: 9e5, note: '灵蚕宝衣：防御栏', unlockSectLevel: 4 },
  { item: 'starArmor', kind: 'gear', basePrice: 7e8, note: '星穹法衣：高阶防御栏', unlockSectLevel: 7 },

  /* ---- 法宝（器物）：设定集里"每名弟子最多持有一件"的那类 ---------- */
  { item: 'compass', kind: 'artifact', basePrice: 1.2e5, note: '洞天罗盘：提高发现秘境概率', unlockSectLevel: 3 },
  { item: 'jadePendant', kind: 'artifact', basePrice: 6e4, note: '聚灵玉佩', unlockSectLevel: 2, weight: 1 },
  { item: 'ward', kind: 'artifact', basePrice: 9e5, note: '护身玉符：探索更安全', unlockSectLevel: 4 },
  { item: 'heavyBlade', kind: 'artifact', basePrice: 8e6, note: '玄铁重剑：战力加成', unlockSectLevel: 5 },
  { item: 'cosmosBag', kind: 'artifact', basePrice: 6e8, note: '乾坤袋：探索产出加成', unlockSectLevel: 6 },
  { item: 'immortalSword', kind: 'artifact', basePrice: 3e11, note: '斩仙剑：顶阶法宝', unlockSectLevel: 8 },
];

/**
 * 稀有货品。
 *
 * ⚠️ baseAmount 一律是 1：这些东西"很稀有"，一档一件。
 * 权重 1~2 也很低 —— 与普通货品（权重 10 上下）相比，它们只是偶尔露面。
 */
export const RARE_GOODS: RareGoodDef[] = RARE_POOL.map((entry) => ({
  kind: entry.kind,
  item: entry.item,
  baseAmount: 1,
  basePrice: entry.basePrice,
  weight: entry.weight ?? 1,
  unlockSectLevel: entry.unlockSectLevel,
  note: entry.note,
}));

export const RARE_GOOD_MAP: Record<string, RareGoodDef> = RARE_GOODS.reduce(
  (acc, good) => {
    acc[good.item] = good;
    return acc;
  },
  {} as Record<string, RareGoodDef>,
);

/** 当前宗门品阶能刷出的稀有货品 */
export function rareGoodsForSectLevel(sectLevel: number): RareGoodDef[] {
  return RARE_GOODS.filter((good) => good.unlockSectLevel <= sectLevel);
}
