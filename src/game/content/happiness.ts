/**
 * 幸福度与空间禁制的常量（需求 4 / 5 / 6）
 */

/* ------------------------------------------------------------------ */
/* 幸福度                                                              */
/* ------------------------------------------------------------------ */

/** 幸福度区间：50 是中立点（不加不减） */
export const HAPPINESS_MIN = 0;
export const HAPPINESS_MAX = 100;
export const HAPPINESS_NEUTRAL = 50;

/** 满幸福度时弟子修行 ×1.30 */
export const HAPPINESS_BONUS_AT_MAX = 1.3;
/**
 * 零幸福度时弟子修行 ×0.80。
 *
 * 刻意比增益温和：需求要的是"幸福度低会难受"，不是"幸福度低就没法玩"。
 */
export const HAPPINESS_PENALTY_AT_MIN = 0.8;

/**
 * 幸福度每秒朝目标靠拢的比例（指数逼近）。
 *
 * 0.02/秒 ≈ 一分钟走掉七成差距 —— 玩家做完一件好事（补灵草、清心魔）
 * 大概一分钟后就能看到数值明显变好。
 */
export const HAPPINESS_DRIFT_PER_SECOND = 0.02;

/**
 * 各条动态修正的**幅度**（需求 4：幸福度不该是随机数，而是一面镜子）。
 *
 * 每一条都对应一个玩家能动手改善的东西 —— 这是这一整套数值的意义所在：
 * 你看见幸福度掉了，就知道该去补灵草 / 清心魔 / 少打仗 / 建居所。
 */
export const HAPPINESS_MODIFIERS = {
  /** 忠诚：满忠诚 +18，零忠诚 −18（线性的，以 50 为中立） */
  loyalty: 18,
  /** 心魔：全宗心魔平均 100 时 −16 */
  demon: 16,
  /** 道伤：全员带伤时 −12 */
  injury: 12,
  /** 每多一家交战方 −6 */
  warEach: 6,
  /** 灵草人均达到这个数就算"吃得饱" */
  herbComfortPerHead: 200,
  /** 吃得饱 +6 / 吃不饱 −10（缺粮比富足的影响更大） */
  wellFed: 6,
  hungry: 10,
  /** 居住密度低于这个比例算"住得宽敞" +4 */
  crowdThreshold: 0.8,
  /** 住得宽敞 +4 */
  roomy: 4,
  /** 超过阈值之后，每 100% 满员再 −18 */
  crowd: 18,
  /** 名望每升一段 +3 */
  fameTierEach: 3,
};

/* ------------------------------------------------------------------ */
/* 稀有幸福度建筑（需求 5）                                            */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：「增加宗门获取幸福度的建筑，这些建筑一定得**非常稀有**，
 * 需求的资源多，且**需要稀有材料**」。
 *
 * 所以这三座建筑的口径是：
 *   - **唯一**（max: 1）—— 不是"多盖几座"，而是"你建得起就有一座"；
 *   - 造价里有**进阶与稀有材料**（星砂 / 月华晶 / 妖丹），不只是基础资源；
 *   - 造价高到只有中期以后才可能；
 *   - 每座给一笔固定幸福度基础值。
 *
 * 注意它们**不进** `buildables.ts` 的常规表，而是单独一张表 ——
 * 因为它们的解锁与判定方式（唯一 + 稀有材料）和其它建筑不是一回事。
 */
export interface HappinessBuildingDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 提供的幸福度基础值 */
  happiness: number;
  /** 造价：基础资源 + 稀有材料 */
  cost: Record<string, number>;
  /** 解锁所需掌门境界下标 */
  requiresRealm: number;
  /** 解锁所需的前置技术 */
  requiresTech?: string;
}

export const HAPPINESS_BUILDINGS: HappinessBuildingDef[] = [
  {
    id: 'spiritSpring',
    name: '灵泉汤池',
    icon: '♨',
    desc: '引地脉温泉入山，弟子劳作之余可泡汤解乏。宗门幸福度 +8。',
    happiness: 8,
    cost: { qi: 4e5, wood: 2e4, stone: 1.2e4, herb: 8000, ore: 6000, spiritSilk: 400, starSand: 60 },
    requiresRealm: 3,
  },
  {
    id: 'peachGrove',
    name: '十里桃林',
    icon: '🌸',
    desc: '十里桃花终年不谢，弟子在此论道赏景。宗门幸福度 +12。',
    happiness: 12,
    cost: { qi: 6e7, wood: 4e5, stone: 2e5, herb: 1.5e5, ore: 1e5, spiritSilk: 4000, lunarCrystal: 120, moonDew: 300 },
    requiresRealm: 5,
  },
  {
    id: 'daoPavilion',
    name: '论道天阁',
    icon: '🏯',
    desc: '悬于云海之上的论道之所，能来此一坐便是身份。宗门幸福度 +18。',
    happiness: 18,
    cost: { qi: 8e9, wood: 6e6, stone: 3e6, herb: 2e6, ore: 1.5e6, starSand: 8000, moonDew: 6000, immortalJade: 40, primordialFruit: 1 },
    requiresRealm: 7,
    requiresTech: 'cosmosStorageArt',
  },
];

export const HAPPINESS_BUILDING_MAP: Record<string, HappinessBuildingDef> = HAPPINESS_BUILDINGS.reduce(
  (acc, b) => {
    acc[b.id] = b;
    return acc;
  },
  {} as Record<string, HappinessBuildingDef>,
);

/* ------------------------------------------------------------------ */
/* 空间禁制（需求 6）                                                  */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：「玩家感悟空间大道后，可以对库房类建筑施加增益」。
 *
 * 口径（与用户确认）：**主动施加、可叠加、逐次变贵**。
 *   - 门槛：空间大道感悟 ≥ 1 级；
 *   - 花灵气 + 稀有材料，给**某一座库房**永久 +25% 容量；
 *   - 同一座可以反复施加，每次花费按已施次数递增（指数）。
 */
export const SPATIAL_WARD_CAPACITY_BONUS = 0.25;
/** 第 n 次施加的花费倍率（n 从 0 开始） */
export const SPATIAL_WARD_COST_GROWTH = 2.1;
/** 一次施加的基础花费 */
export const SPATIAL_WARD_BASE_COST = { qi: 2e5, ore: 3000, starSand: 40 };
/** 单座库房最多叠加几次 */
export const SPATIAL_WARD_MAX_STACKS = 8;
