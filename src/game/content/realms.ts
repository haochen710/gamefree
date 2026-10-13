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
  /*
   * ⚠️ 这里原来还有一个 `breakthroughPills: number`（"突破要几颗丹"）：
   * 10 个境界**全写 0**，而且**全仓库没有一处读它** —— 实际消耗固定为 1 颗
   * （`engine.breakthrough` 与 `disciples.tickDisciples` 各自扣 1）。
   * 声明了、赋了 0、没人读，正是「死配置」那一类坑，本轮删掉。
   */
  /** 突破该境界时**必须**服用的境界丹 */
  breakthroughPill: string;
  /**
   * **未服丹**的基础突破成功率。
   *
   * 需求 9 之后丹药是硬门槛，所以这个数玩家看不到成品率 ——
   * 它只参与 `丹药加成 = (1 − baseSuccess) × 62%` 的计算。
   */
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

/**
 * 进度放缓系数（需求 16：当前游戏进度过快，而且**越到后面越慢**）。
 *
 * 这两个表按境界下标逐项变大，作用在两处闸门上：
 *   - `progressQiScale`：掌门突破所需的灵气；
 *   - `progressYearScale`：弟子推进一个境界所需的修为。
 *
 * 为什么用"系数表"而不是直接改九行数字：改数字会同时改变界面上
 * 每一处"还需 X 灵气"的读数，而系数表让"慢了多少"这件事本身有一个
 * 可以调整、可以解释、也可以一键回退的地方。
 *
 * 曲线形状：前三个境界基本不动（新手期不能劝退），从元婴期开始加速变陡，
 * 渡劫期约为炼气期的 6 倍 —— 所以"越到后面越慢"是**真的越到后面越慢**。
 */
/*
 * ⚠️ 标定口径：以**带 AI 的模拟读数**为准。
 * 补上符箓与派遣的 AI 之后，游戏反而快了 5 天（聚灵符 ×2 产量、
 * 破境符加成功率、派遣抬高炼制成功率）—— 那些收益是玩家真的会用的，
 * 所以后期系数得按"系统都在用"的情况抬。前三项仍不动：新手期不能劝退。
 */
// 第 22 轮：后几档放缓一档（炼制变难 + 库房变贵之后，境界阶梯要提速）
export const PROGRESS_QI_SCALE: number[] = [1, 1, 1.15, 1.6, 2.6, 4, 5.8, 8, 11];
/*
 * ⚠️ 弟子那条线要乘得更狠：需求 9 同时把"探索心得"抬了 1.7 倍，
 * 而弟子的修行速度基本等于心得 × 建筑加成。系数不够大的话，
 * 弟子会比掌门跑得还快（实测弟子一度比掌门先进渡劫）。
 */
export const PROGRESS_YEAR_SCALE: number[] = [1, 1, 1.5, 2.4, 4, 6, 9, 13, 19];

/** 掌门突破所需灵气的实际值（已含进度系数） */
export function scaledBreakthroughQi(index: number): number {
  const realm = REALMS[index];
  if (!realm) return 0;
  return realm.breakthroughQi * (PROGRESS_QI_SCALE[index] ?? 1);
}

/** 弟子推进一个境界所需的实际修为（已含进度系数） */
export function scaledCultivationYears(index: number): number {
  const realm = REALMS[index];
  if (!realm) return 0;
  return realm.cultivationYears * (PROGRESS_YEAR_SCALE[index] ?? 1);
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
    breakthroughPill: 'foundationPill',
    baseSuccess: 0.8,
    cultivationYears: 50,
    lifespan: 60,
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
    breakthroughPill: 'goldenCorePill',
    baseSuccess: 0.68,
    cultivationYears: 80,
    lifespan: 150,
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
    breakthroughPill: 'nascentPill',
    baseSuccess: 0.58,
    cultivationYears: 120,
    lifespan: 400,
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
    breakthroughPill: 'spiritPill',
    baseSuccess: 0.5,
    cultivationYears: 250,
    lifespan: 900,
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
    breakthroughPill: 'voidPill',
    baseSuccess: 0.42,
    cultivationYears: 400,
    lifespan: 2000,
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
    breakthroughPill: 'unityPill',
    baseSuccess: 0.35,
    cultivationYears: 700,
    lifespan: 4500,
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
    breakthroughPill: 'grandPill',
    baseSuccess: 0.3,
    cultivationYears: 1200,
    lifespan: 10000,
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
    breakthroughPill: 'tribulationPill',
    baseSuccess: 0.25,
    cultivationYears: 2000,
    lifespan: 22000,
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
    breakthroughPill: 'ascensionPill',
    baseSuccess: 0.18,
    cultivationYears: 5000,
    lifespan: 50000,
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

/**
 * 突破丹的加成 = **未服丹时差的那一截的 62%**。
 *
 * ⚠️ 本轮需求 9：「玩家和弟子突破应当对**丹药的需求很强烈**，
 * 取消突破失败后叠加概率的设定」。所以这里做了两件事：
 *
 *   1. **丹药从"可选加成"变成"硬门槛"** —— 没有对应境界丹，连试都不能试
 *      （见 `engine.getBreakthroughStatus`）。这是需求的那半句"需求很强烈"。
 *   2. 加成改成"补掉剩余差距的 62%"，而不是原来那个固定的 +35 个百分点。
 *
 * 为什么用"补差距"而不是固定值：固定值在高境界会失真 ——
 * 渡劫期基础只有 18%，+35 也只是 53%；而炼气期 80% + 35 直接撞上限，
 * 于是"这颗丹值不值"在低境界看不出来、在高境界又救不了命。
 * 补差距的形式让丹药**在每一个境界都同样关键**：
 *   炼气 80% → 92%、金丹 58% → 84%、渡劫 18% → 69%。
 * （`baseSuccess` 从此是**无丹药**的成功率；没丹药压根不允许突破，
 *   所以这个数只用来算"丹药补了多少"，不会直接展示给玩家。）
 */
export const BREAKTHROUGH_PILL_GAP_RECOVERY = 0.62;

/**
 * 成功率上限（对齐设定集第 6、16 章的「总成功率上限 95%」）。
 *
 * 留 5% 的失败余地：一个"必定成功"的按钮会让丹药与所有加成同时失去意义。
 */
export const BREAKTHROUGH_MAX_SUCCESS = 0.95;

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
 *   2. **弟子寿元**：`lifespan` 是以**游戏年**计的（炼气 60 年、渡劫 5 万年），
 *      所以日历一慢，寿元对应的真实时间也慢了 39 倍 ——
 *      炼气弟子从"活 1 小时"变成"活 8 小时"，化神以上在 30 天模拟里基本不会老死。
 *      这是"年"这个单位被拉长的必然结果，不是 bug。
 *      （⚠️ 这里原先写的是"炼气 300 年、渡劫 10 万年"，那是改日历**之前**的旧表，
 *        与本文件下面的 `lifespan` 已经对不上了。）
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
