/**
 * 季节与天象（需求 1）
 *
 * 需求原文：「增加季节系统，不同季节对基础材料产出有不同影响，
 *           同时增加各种天象事件，可以提供不同的增益或者减益」
 *
 * 拆成两层：
 *   1. **季节** —— 四季轮转，每季对**不同资源与基础材料**给出不同的产出加成。
 *      它是可预期的节奏：知道现在是冬天，就该去囤寒玉、别指望灵草。
 *   2. **天象** —— 随机出现、持续几十秒的全局增益或减益。
 *      它是不可预期的意外：血月来了妖丹翻倍但要小心伤亡。
 *
 * ⚠️ 关于时长的一个刻意偏离：
 * 游戏内的日历走得极快（`GAME_DAYS_PER_SECOND = 30`，一个游戏年只有约 12 真实秒）。
 * 如果按"一季 = 四分之一个游戏年"来做，每季只有 3 秒，界面上会闪得看不清。
 * 所以季节与天象**按真实秒计**：一季 90 秒（一整轮 6 分钟），天象 45~60 秒。
 * 这是为了让玩家真的能感知到它 —— 与商行刷新、大比的偏离是同一类处理。
 *
 * ⚠️ 天象**不会**提供发现秘境的概率加成：那条线只有寻宝宝盘能碰（见 recipes.ts）。
 */
import type { MaterialId, ResourceId } from './resources';

/* ------------------------------------------------------------------ */
/* 季节                                                                */
/* ------------------------------------------------------------------ */

/** 每一季持续多少真实秒 */
export const SEASON_SECONDS = 90;

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SeasonDef {
  id: SeasonId;
  name: string;
  icon: string;
  desc: string;
  /** 基础资源产出加成（加算，0.4 = +40%） */
  resources: Partial<Record<ResourceId, number>>;
  /** 基础材料产出加成：作用于灵植收获、秘境产出、游历收获 */
  materials: Partial<Record<MaterialId, number>>;
}

/**
 * 四季。
 *
 * 每一季都刻意**同时给出正负**：没有哪一季是纯粹的好或坏，
 * 否则玩家只会等到那"最好的季节"再干活，其余时间什么都不做。
 * 四季的正负搭配也让"现在该囤什么"成为一个真的选择。
 */
export const SEASONS: SeasonDef[] = [
  {
    id: 'spring',
    name: '春',
    icon: '🌸',
    desc: '万物生发，草木最先知道。灵草与灵木长得飞快，但寒气消退、寒玉难寻。',
    resources: { herb: 0.45, wood: 0.3, qi: 0.1 },
    materials: { demonCore: 0.15, coldJade: -0.25 },
  },
  {
    id: 'summer',
    name: '夏',
    icon: '☀️',
    desc: '火气炎盛，地火自地脉上涌。灵气与地火髓丰收，寒玉却几乎绝迹。',
    resources: { qi: 0.3, ore: 0.1 },
    materials: { fireMarrow: 0.45, coldJade: -0.4 },
  },
  {
    id: 'autumn',
    name: '秋',
    icon: '🍂',
    desc: '收获之季，矿脉与灵石产量最高；只是天地肃杀，灵气略薄。',
    resources: { ore: 0.35, stone: 0.3, qi: -0.1 },
    materials: { spiritSilk: 0.25, blackIron: 0.25 },
  },
  {
    id: 'winter',
    name: '冬',
    icon: '❄️',
    desc: '收藏蛰伏，寒气凝玉。寒玉与灵石最丰，草木与妖兽却都躲了起来。',
    resources: { stone: 0.2, herb: -0.35, wood: -0.2 },
    materials: { coldJade: 0.5, demonCore: -0.25 },
  },
];

export const SEASON_MAP: Record<string, SeasonDef> = SEASONS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<string, SeasonDef>,
);

/* ------------------------------------------------------------------ */
/* 天象                                                                */
/* ------------------------------------------------------------------ */

/** 每隔多少秒判定一次是否出现新天象 */
export const WEATHER_ROLL_INTERVAL = 40;
/** 每次判定的出现概率 */
export const WEATHER_CHANCE = 0.4;

export type WeatherTone = 'good' | 'bad' | 'mixed';

export interface WeatherEffects {
  /** 全局产量（加算） */
  production?: number;
  /** 弟子修行速度（加算） */
  cultivation?: number;
  /** 秘境产出（加算） */
  expeditionYield?: number;
  /** 探索速度（加算） */
  expeditionSpeed?: number;
  /**
   * ⚠️ 这里**故意没有** casualty（伤亡率）字段。
   *
   * 一开始血月与罡风确实带 +40% / +25% 的伤亡加成，看着很像"双刃剑"，
   * 但实测直接导致**弟子全灭**（30 天模拟结束时存活 0、累计招收 2110）。
   * 原因是伤亡本身是个正反馈：多死几个 → 队伍凑不满人 → 战力比下降 →
   * 伤亡率进一步升高 → 死得更多。天象这种随机事件不该有能力把宗门掀翻，
   * 所以改成用"修行变慢 / 搜刮变粗"来做代价 —— 双刃剑的意味还在，但不会雪崩。
   */
  /** 突破成功率（加算） */
  breakthrough?: number;
  /** 指定资源的产出加成（加算） */
  resources?: Partial<Record<ResourceId, number>>;
  /** 指定基础材料的产出加成（加算） */
  materials?: Partial<Record<MaterialId, number>>;
}

export interface WeatherDef {
  id: string;
  name: string;
  icon: string;
  /** 好 / 坏 / 双刃剑，只用于界面配色 */
  tone: WeatherTone;
  desc: string;
  /** 抽取权重 */
  weight: number;
  /** 持续真实秒数 */
  duration: number;
  effects: WeatherEffects;
}

/**
 * 天象表。
 *
 * `mixed` 那几条是有意做成双刃剑的 —— 纯增益的天象只会让玩家"等它出现"，
 * 而双刃剑（血月、天雷、罡风）会逼玩家在当下决定要不要冒这个险。
 * 注意这里没有任何一条提供发现秘境的概率。
 */
export const WEATHERS: WeatherDef[] = [
  {
    id: 'purpleQi',
    name: '紫气东来',
    icon: '🌅',
    tone: 'good',
    desc: '东方紫气绵延三万里，天地灵气一时极盛。',
    weight: 8,
    duration: 60,
    effects: { production: 0.4 },
  },
  {
    id: 'spiritRain',
    name: '灵雨',
    icon: '🌧',
    tone: 'good',
    desc: '灵雨如丝，落地即化为灵气，草木疯长。',
    weight: 8,
    duration: 60,
    effects: { cultivation: 0.2, resources: { herb: 0.6, wood: 0.6 } },
  },
  {
    id: 'auspiciousCloud',
    name: '祥云瑞霭',
    icon: '🌈',
    tone: 'good',
    desc: '五色祥云覆于山门之上，是难得的吉兆。',
    weight: 6,
    duration: 60,
    effects: { production: 0.25, cultivation: 0.25 },
  },
  {
    id: 'starfall',
    name: '星辰坠落',
    icon: '☄',
    tone: 'good',
    desc: '天外星辰拖着长尾坠入荒野，渊底又添新砂。',
    weight: 5,
    duration: 60,
    effects: { expeditionYield: 0.6, resources: { ore: 0.4 } },
  },
  {
    id: 'wildfire',
    name: '地火喷涌',
    icon: '🔥',
    tone: 'good',
    desc: '地脉开裂，地火涌出地表，矿物被烧得通红。',
    weight: 5,
    duration: 60,
    effects: { materials: { fireMarrow: 0.7, blackIron: 0.7 }, resources: { herb: -0.25 } },
  },
  {
    id: 'bloodMoon',
    name: '血月当空',
    icon: '🌕',
    tone: 'mixed',
    desc: '月色如血，妖兽尽出。妖丹遍地可捡，但满门心神不宁、修行迟滞。',
    weight: 6,
    duration: 60,
    effects: { materials: { demonCore: 1 }, cultivation: -0.15 },
  },
  {
    id: 'thunderCloud',
    name: '天雷劫云',
    icon: '⚡',
    tone: 'mixed',
    desc: '劫云压顶，雷声隐隐。此时参悟事半功倍，但天地灵气被压得极低。',
    weight: 6,
    duration: 45,
    effects: { breakthrough: 0.15, production: -0.2 },
  },
  {
    id: 'galeWind',
    name: '九天罡风',
    icon: '🌪',
    tone: 'mixed',
    desc: '罡风自九天而下，行程极快，但走得急就搜刮得粗。',
    weight: 5,
    duration: 45,
    effects: { expeditionSpeed: 0.6, expeditionYield: -0.2 },
  },
  {
    id: 'thickFog',
    name: '弥天大雾',
    icon: '🌫',
    tone: 'bad',
    desc: '大雾锁山，辨不清方向，探索与收获都大受影响。',
    weight: 6,
    duration: 45,
    effects: { expeditionSpeed: -0.45, expeditionYield: -0.25 },
  },
  {
    id: 'bitterCold',
    name: '极寒之潮',
    icon: '🧊',
    tone: 'bad',
    desc: '寒气自北方席卷而来，灵气凝滞，弟子修行也慢了下来。',
    weight: 6,
    duration: 60,
    effects: { production: -0.25, cultivation: -0.2 },
  },
];

export const WEATHER_MAP: Record<string, WeatherDef> = WEATHERS.reduce(
  (acc, w) => {
    acc[w.id] = w;
    return acc;
  },
  {} as Record<string, WeatherDef>,
);

/** 天象配色（界面用） */
export const WEATHER_TONE_LABEL: Record<WeatherTone, string> = {
  good: '吉',
  bad: '凶',
  mixed: '双刃',
};
