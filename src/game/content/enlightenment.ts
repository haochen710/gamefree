/**
 * 感悟（需求 3）
 *
 * 需求原文：
 *   「增加感悟模块，元婴期后，玩家解锁该模块，可以解锁对五行及时空大道的感悟，
 *     感悟分为九个大阶段，每个大阶段十个小阶段，五行可以增加不同基础材料的产出，
 *     时空大道化神期解锁，时间大道可以每隔五年进行一次时空穿梭，
 *     穿梭时间最大为50年（根据感悟等级变化），即一次性结算基础产出收益和其它
 *     需要时间的任务（在对应时间内能完成的），空间大道可以制作空间戒指，
 *     效果为增加弟子和玩家探索产出，随着感悟等级提升，该提升更加明显。
 *     感悟需消耗大量资源和时间」
 *
 * 结构：
 *   七条道（五行 5 条 + 时间 + 空间）
 *     每条 9 个大阶段 × 10 个小阶段 = **90 阶**
 *       小阶段是"刻度"，大阶段是"里程碑"—— 每满 10 阶会有一次明显的跳变，
 *       这样玩家在漫长的 90 阶里始终能看到下一个"整段"在哪。
 *
 * 门槛：五行在元婴期（下标 3）解锁；时空大道在化神期（下标 4）解锁。
 *
 * 五行的五条道**各自绑定一种基础材料** —— 这是刻意的：
 * 基础材料本来就有五种，而"金木水火土"正好一一对应，
 * 玩家不需要记额外的对应表，看一眼名字就知道该修哪条。
 */
import type { MaterialId } from './resources';

export type EnlightenPathId = 'metal' | 'wood' | 'water' | 'fire' | 'earth' | 'time' | 'space';

export interface EnlightenPathDef {
  id: EnlightenPathId;
  name: string;
  icon: string;
  /** '五行' 或 '时空' */
  group: '五行' | '时空';
  desc: string;
  /** 解锁境界（下标） */
  requiresRealm: number;
  /**
   * 这条道加成哪种基础材料的产出（只有五行有）。
   * 时间的"产出"是穿梭，空间的产出是戒指，都走单独的逻辑。
   */
  material?: MaterialId;
}

/** 每个大阶段有几个小阶段 */
export const MINOR_PER_MAJOR = 10;
/** 每条道有几个大阶段 */
export const MAJOR_STAGES = 9;
/** 每条道的总阶数 */
export const MAX_ENLIGHTEN_LEVEL = MAJOR_STAGES * MINOR_PER_MAJOR;

export const ENLIGHTEN_PATHS: EnlightenPathDef[] = [
  {
    id: 'metal',
    name: '金之道',
    icon: '⚔',
    group: '五行',
    desc: '金主肃杀。感悟金行，山中的玄铁会自己往你面前聚。',
    requiresRealm: 3,
    material: 'blackIron',
  },
  {
    id: 'wood',
    name: '木之道',
    icon: '🌳',
    group: '五行',
    desc: '木主生发。感悟木行，灵蚕与药草长得比别处快。',
    requiresRealm: 3,
    material: 'spiritSilk',
  },
  {
    id: 'water',
    name: '水之道',
    icon: '💧',
    group: '五行',
    desc: '水主收藏。感悟水行，寒玉的寒气自然向你这边凝。',
    requiresRealm: 3,
    material: 'coldJade',
  },
  {
    id: 'fire',
    name: '火之道',
    icon: '🔥',
    group: '五行',
    desc: '火主炎上。感悟火行，地底的火髓会顺着你的道意上涌。',
    requiresRealm: 3,
    material: 'fireMarrow',
  },
  {
    id: 'earth',
    name: '土之道',
    icon: '⛰',
    group: '五行',
    desc: '土主承载。感悟土行，妖兽的内丹在你手下格外好取。',
    requiresRealm: 3,
    material: 'demonCore',
  },
  {
    id: 'time',
    name: '时间大道',
    icon: '⏳',
    group: '时空',
    desc: '参透岁月。每满五年可发动一次时空穿梭，一次性结算这段时间里的一切。',
    requiresRealm: 4,
  },
  {
    id: 'space',
    name: '空间大道',
    icon: '🌀',
    group: '时空',
    desc: '参透虚空。可制作空间戒指，弟子与你本人的探索产出都随之提升。',
    requiresRealm: 4,
  },
];

/** 全部道的 id（存档清洗与初始化用） */
export const ENLIGHTEN_PATH_IDS: EnlightenPathId[] = ENLIGHTEN_PATHS.map((p) => p.id);

export const ENLIGHTEN_PATH_MAP: Record<string, EnlightenPathDef> = ENLIGHTEN_PATHS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, EnlightenPathDef>,
);

/* ------------------------------------------------------------------ */
/* 数值                                                                */
/* ------------------------------------------------------------------ */

/** 五行：每个小阶段给对应基础材料的产出加成 */
export const ELEMENT_BONUS_PER_LEVEL = 0.015;
/** 空间大道：每个小阶段给探索产出的加成（被动那部分） */
export const SPACE_BONUS_PER_LEVEL = 0.005;
/** 空间戒指：每枚额外给的探索产出加成 */
export const SPACE_RING_BONUS = 0.05;
/** 最多能做几枚空间戒指（每个大阶段一枚） */
export const MAX_SPACE_RINGS = MAJOR_STAGES;

/** 时间大道：最短和最长能穿梭多少年 */
export const TIME_JUMP_MIN_YEARS = 5;
export const TIME_JUMP_MAX_YEARS = 50;
/** 每隔多少**游戏年**才能再穿梭一次（需求原文：「每隔五年」） */
export const TIME_JUMP_COOLDOWN_YEARS = 5;

/**
 * 感悟一阶的耗时（真实秒）。
 *
 * 需求要求「感悟需消耗大量资源和时间」，所以基数和增长都给得狠：
 * 第 1 阶 45 秒、第 45 阶约 4 小时、第 90 阶约 3 天。
 * 一条道全修满是一条贯穿整局的长线，而不是一次点击。
 */
export function enlightenSeconds(level: number): number {
  return Math.round(45 * Math.pow(1.045, level));
}

/**
 * 感悟一阶的花费。随阶数指数增长，并且**横跨全部三种玩法**：
 * 灵气（修行）、材料（探索/种植）、进阶资源（合成，需求 4）。
 * 这样"修感悟"就自然成为中后期的主要资源出口，而不是又一条独立支线。
 */
export function enlightenCost(
  _path: EnlightenPathDef,
  level: number,
): { qi: number; herb: number; ore: number; stone: number; refined: number } {
  const base = Math.pow(1.075, level);
  return {
    qi: Math.round(2e4 * base),
    herb: Math.round(1500 * base),
    ore: Math.round(1200 * base),
    stone: Math.round(600 * base),
    // 进阶资源每 5 阶要一次，且只要 1 个 —— 它是"卡点"不是"堆量"
    refined: level % 5 === 4 ? 1 + Math.floor(level / 30) : 0,
  };
}

/** 该道在第几大阶段第几小阶段（都从 1 起，0 阶时返回 0/0） */
export function stageOf(level: number): { major: number; minor: number } {
  if (level <= 0) return { major: 0, minor: 0 };
  return { major: Math.floor((level - 1) / MINOR_PER_MAJOR) + 1, minor: ((level - 1) % MINOR_PER_MAJOR) + 1 };
}

/** 时间大道当前一次能穿梭多少年 */
export function timeJumpYears(level: number): number {
  const span = TIME_JUMP_MAX_YEARS - TIME_JUMP_MIN_YEARS;
  return Math.round(TIME_JUMP_MIN_YEARS + (span * level) / MAX_ENLIGHTEN_LEVEL);
}

/** 制作 n 枚空间戒指的花费 */
export function spaceRingCost(index: number): { stone: number; arrayCore: number; refinedGold: number; qi: number } {
  const base = Math.pow(2.2, index);
  return {
    stone: Math.round(5e4 * base),
    arrayCore: Math.round(20 * base),
    refinedGold: Math.round(10 * base),
    qi: Math.round(5e7 * base),
  };
}
