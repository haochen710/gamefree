/**
 * 境界体系
 *
 * 同一张表同时服务于三方：
 *   - 玩家自己的修行（消耗灵气参悟/突破）
 *   - 弟子的修行（按游戏年数推进）
 *   - 秘境战力与寿元（决定弟子能走多远、探索有多强）
 */

export interface RealmDef {
  name: string;
  /** 本境界有多少层小境界 */
  layerCount: number;
  /** 第 1 层小境界的参悟消耗（灵气） */
  baseLayerCost: number;
  /** 每多一层，消耗乘以该系数 */
  costGrowth: number;
  /** 每层小境界提供的全局产量加成（加算，0.05 = +5%） */
  layerBonus: number;
  /** 身处此境界时的全局产量乘数（已含前面所有境界的累积效果） */
  realmMultiplier: number;
  /** 突破到下一境界所需灵气 */
  breakthroughQi: number;
  /** 突破到下一境界所需丹药数量（丹药 id 见 breakthroughPill） */
  breakthroughPills: number;
  /** 突破该境界时建议服用的境界丹 */
  breakthroughPill: string;
  /** 不吃丹药的基础突破成功率 */
  baseSuccess: number;

  /* ---- 以下服务于弟子与秘境 ---- */
  /** 弟子从本境界修炼到下一境界所需的游戏年数 */
  cultivationYears: number;
  /** 本境界的寿元上限（游戏年）。超过即寿元耗尽而亡 */
  lifespan: number;
  /** 弟子处于本境界时的基础战力 */
  power: number;

  desc: string;
}

export const REALMS: RealmDef[] = [
  {
    name: '炼气期',
    layerCount: 9,
    baseLayerCost: 8,
    costGrowth: 1.75,
    layerBonus: 0.04,
    realmMultiplier: 1,
    breakthroughQi: 600,
    breakthroughPills: 0,
    breakthroughPill: 'foundationPill',
    baseSuccess: 0.8,
    cultivationYears: 50,
    lifespan: 300,
    power: 1,
    desc: '引气入体，初窥门径。',
  },
  {
    name: '筑基期',
    layerCount: 9,
    baseLayerCost: 139,
    costGrowth: 1.85,
    layerBonus: 0.04,
    realmMultiplier: 2.5,
    breakthroughQi: 1.2e4,
    breakthroughPills: 0,
    breakthroughPill: 'goldenCorePill',
    baseSuccess: 0.68,
    cultivationYears: 80,
    lifespan: 700,
    power: 3,
    desc: '筑就道基，从此寿元大增。',
  },
  {
    name: '金丹期',
    layerCount: 9,
    baseLayerCost: 2.17e3,
    costGrowth: 1.9,
    layerBonus: 0.04,
    realmMultiplier: 8,
    breakthroughQi: 1.5e5,
    breakthroughPills: 0,
    breakthroughPill: 'nascentPill',
    baseSuccess: 0.58,
    cultivationYears: 120,
    lifespan: 1500,
    power: 10,
    desc: '结丹成婴之始，一方修士中的翘楚。',
  },
  {
    name: '元婴期',
    layerCount: 9,
    baseLayerCost: 1.3e4,
    costGrowth: 1.95,
    layerBonus: 0.04,
    realmMultiplier: 25,
    breakthroughQi: 8e5,
    breakthroughPills: 0,
    breakthroughPill: 'spiritPill',
    baseSuccess: 0.5,
    cultivationYears: 250,
    lifespan: 3000,
    power: 30,
    desc: '元婴出窍，肉身可弃而神魂不灭。',
  },
  {
    name: '化神期',
    layerCount: 9,
    baseLayerCost: 2.45e5,
    costGrowth: 2.0,
    layerBonus: 0.04,
    realmMultiplier: 80,
    breakthroughQi: 1.2e7,
    breakthroughPills: 0,
    breakthroughPill: 'voidPill',
    baseSuccess: 0.42,
    cultivationYears: 400,
    lifespan: 6000,
    power: 100,
    desc: '神识化虚，可窥天地法则。自此可开宗立派。',
  },
  {
    name: '炼虚期',
    layerCount: 9,
    baseLayerCost: 5.98e6,
    costGrowth: 2.05,
    layerBonus: 0.04,
    realmMultiplier: 250,
    breakthroughQi: 2e8,
    breakthroughPills: 0,
    breakthroughPill: 'unityPill',
    baseSuccess: 0.35,
    cultivationYears: 700,
    lifespan: 12000,
    power: 300,
    desc: '炼化虚空，举手投足皆合天道。',
  },
  {
    name: '合体期',
    layerCount: 9,
    baseLayerCost: 7.5e7,
    costGrowth: 2.1,
    layerBonus: 0.04,
    realmMultiplier: 780,
    breakthroughQi: 3.2e9,
    breakthroughPills: 0,
    breakthroughPill: 'grandPill',
    baseSuccess: 0.3,
    cultivationYears: 1200,
    lifespan: 24000,
    power: 1000,
    desc: '法体合一，已非凡俗之身。',
  },
  {
    name: '大乘期',
    layerCount: 9,
    baseLayerCost: 7.7e8,
    costGrowth: 2.15,
    layerBonus: 0.04,
    realmMultiplier: 2400,
    breakthroughQi: 6e10,
    breakthroughPills: 0,
    breakthroughPill: 'tribulationPill',
    baseSuccess: 0.25,
    cultivationYears: 2000,
    lifespan: 50000,
    power: 3000,
    desc: '大乘圆满，只待雷劫加身。',
  },
  {
    name: '渡劫期',
    layerCount: 9,
    baseLayerCost: 8.7e9,
    costGrowth: 2.2,
    layerBonus: 0.04,
    realmMultiplier: 7200,
    breakthroughQi: 1.2e12,
    breakthroughPills: 0,
    breakthroughPill: 'ascensionPill',
    baseSuccess: 0.18,
    cultivationYears: 5000,
    lifespan: 100000,
    power: 10000,
    desc: '九重雷劫，过则登仙。',
  },
  {
    name: '仙人',
    layerCount: 1,
    baseLayerCost: 2.36e12,
    costGrowth: 2.5,
    layerBonus: 0.1,
    realmMultiplier: 19683,
    breakthroughQi: 0,
    breakthroughPills: 0,
    breakthroughPill: '',
    baseSuccess: 1,
    cultivationYears: 0,
    lifespan: Infinity,
    power: 30000,
    desc: '跳出三界外，不在五行中。此界已是尽头。',
  },
];

export const FINAL_REALM_INDEX = REALMS.length - 1;

/** 飞升所需的最低境界（化神期）。开宗与飞升已经拆成两个常量，见下 */
export const ASCENSION_MIN_REALM = 4;
/**
 * 开宗立派所需的最低境界。
 *
 * 需求 3：「金丹就可创建宗门」。原先这里是 4（化神），
 * 与 ASCENSION_MIN_REALM 共用一个值 —— 降到金丹之后必须拆开，
 * 否则金丹期就能飞升了。
 */
export const SECT_MIN_REALM = 2;

/* ------------------------------------------------------------------ */
/* 突破成功率                                                          */
/* ------------------------------------------------------------------ */

/** 服用对应的境界丹，突破成功率提升多少 */
export const BREAKTHROUGH_PILL_BONUS = 0.35;
/** 每次失败累积的保底加成（失败也长经验，避免卡死） */
export const BREAKTHROUGH_FAIL_BONUS = 0.05;
/** 保底加成上限 */
export const BREAKTHROUGH_FAIL_BONUS_CAP = 0.5;
/** 成功率上限，留一点失败余地 */
export const BREAKTHROUGH_MAX_SUCCESS = 0.98;

/* ------------------------------------------------------------------ */
/* 突破失败的代价（按境界分级）                                          */
/* ------------------------------------------------------------------ */

/**
 * 从该境界起，突破失败会留下「道伤」。
 *
 * 更低的境界（炼气 / 筑基 / 金丹）突破失败**没有任何负面影响**：
 * 灵气全额返还，也没有冷却 —— 前期是教学阶段，不该惩罚玩家。
 */
export const INJURY_FROM_REALM = 3; // 元婴期

/**
 * 各境界突破失败后的道伤持续时间（秒）。
 *
 * 道伤期间：无法再次突破，且全局产量下降（见 INJURY_PRODUCTION_PENALTY）。
 * 时间随境界递增，但都控制在「还能忍受」的范围内 ——
 * 放置游戏不该让玩家无事可做几小时。
 */
export const INJURY_SECONDS: Record<number, number> = {
  3: 120, // 元婴期 → 化神期：2 分钟
  4: 300, // 化神期 → 炼虚期：5 分钟
  5: 600, // 炼虚期 → 合体期：10 分钟
  6: 1200, // 合体期 → 大乘期：20 分钟
  7: 2400, // 大乘期 → 渡劫期：40 分钟
  8: 3600, // 渡劫期 → 仙人：60 分钟
};

/** 道伤未愈时，突破失败没有对应配置的兜底时长 */
export const INJURY_FALLBACK_SECONDS = 300;

/**
 * 道伤期间的全局产量惩罚（0.25 = 减产 25%）。
 *
 * 「萎靡不振」的具象化：不只是突破不了，连修行速度都受影响。
 * 想温和一点就改成 0。
 */
export const INJURY_PRODUCTION_PENALTY = 0.25;

/* ------------------------------------------------------------------ */
/* 飞升                                                                */
/* ------------------------------------------------------------------ */

/** 每点「道韵」提供的全局产量加成 */
export const DAO_YUN_BONUS = 0.05;
/**
 * 飞升结算：本世累计灵气 → 道韵
 *     道韵 = floor( (本世灵气 / DAO_YUN_DIVISOR) ^ DAO_YUN_EXPONENT )
 */
export const DAO_YUN_DIVISOR = 1e5;
export const DAO_YUN_EXPONENT = 0.5;

/* ------------------------------------------------------------------ */
/* 手动打坐（需求 1：必须限流）                                         */
/* ------------------------------------------------------------------ */

/**
 * 打坐消耗「心神」。心神有上限、按固定间隔回复，
 * 因此手动点击的收益被硬性封顶，无法靠疯狂点击大幅加速游戏。
 *
 * 每秒最多打坐 1/6 次，每次给 1.5 秒的灵气产量
 * → 满负荷手动也只相当于约 25% 的产量加成。
 */
export const MIND_MAX = 20;
export const MIND_REGEN_SECONDS = 6;
export const MEDITATE_COST = 1;
export const MEDITATE_MIN_QI = 3;
export const MEDITATE_SECONDS = 1.5;

/* ------------------------------------------------------------------ */
/* 游戏内时间                                                          */
/* ------------------------------------------------------------------ */

/**
 * 纪年（需求 1）：**一年 = 现实 8 分钟，一季 = 现实 2 分钟**。
 *
 * 所以游戏内日历的速度是 `365 / 480` 游戏天每秒（约 0.76 天/秒）——
 * 比起早先的 30 天/秒慢了约 39 倍。这一条是需求明文规定的，
 * 它同时决定了三件事，改之前要想清楚：
 *
 *   1. **季节**：一季 = 480 / 4 = 120 真实秒（见 seasons.ts 的 SEASON_SECONDS）。
 *      上一轮因为"一个游戏年只有 12 秒"而不敢把季节挂到日历上，现在可以了。
 *   2. **弟子寿元**：`lifespan` 是以**游戏年**计的（炼气 300 年、渡劫 10 万年），
 *      所以日历一慢，寿元对应的真实时间也慢了 39 倍 ——
 *      炼气弟子从"活 1 小时"变成"活 40 小时"，化神以上在 30 天模拟里基本不会老死。
 *      这是"年"这个单位被拉长的必然结果，不是 bug。
 *   3. ⚠️ **商行刷新与大比间隔不能跟着日历走**：它们的节奏是给真人看的，
 *      跟着日历一慢就会变成"40 分钟刷新一次货架"，所以那两个改成直接按真实秒定义。
 */
export const SECONDS_PER_GAME_YEAR = 8 * 60;
export const GAME_DAYS_PER_YEAR = 365;
export const GAME_DAYS_PER_SECOND = GAME_DAYS_PER_YEAR / SECONDS_PER_GAME_YEAR;

/** 一个游戏日等于多少真实秒（纪年展示用） */
export const SECONDS_PER_GAME_DAY = 1 / GAME_DAYS_PER_SECOND;

/**
 * 当前是第几年（从 1 开始）。
 *
 * 用 `playTime` 而不是单独记一个年份：年份本来就是时间的函数，
 * 存两份必然会漂移（读档、离线结算都是坑）。
 */
export function gameYearOf(playTime: number): number {
  return Math.floor(playTime / SECONDS_PER_GAME_YEAR) + 1;
}

/** 今年已经过了多少（0~1），界面画"年度进度"用 */
export function yearProgressOf(playTime: number): number {
  return (playTime % SECONDS_PER_GAME_YEAR) / SECONDS_PER_GAME_YEAR;
}
