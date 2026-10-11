/**
 * 丹方与器方（需求 2）
 *
 * 需求原文：「炼丹和炼器材料细分，炼制丹药和器物由基础材料和稀有材料构成。
 *           其中越高等级的丹药和器物，越需要稀有材料，种类也增加。」
 *
 * 因此每一条配方都由三部分构成：
 *   基础资源（灵气 / 灵草 / 灵矿）
 * + 基础材料（妖丹、玄铁、灵蚕丝、地火髓、寒玉）
 * + 稀有材料（月华露 … 鸿蒙道果）
 *
 * 而**稀有材料的种类数随品阶递增** —— 这条规律由 RARE_KINDS_MIN 固化下来，
 * 冒烟测试会逐条检查，谁改配方改坏了会被立刻发现。
 *
 * 三类丹药：
 *   - breakthrough 境界丹：突破大境界时服用，大幅提升成功率（需求 5）
 *   - support      辅助型：增益自身修行
 *   - combat       战斗型：增益弟子与秘境探索
 */
import {
  BASE_MATERIAL_IDS,
  RARE_MATERIAL_IDS,
  type ItemId,
  type MaterialId,
} from './resources';

/* ------------------------------------------------------------------ */
/* 效果                                                                */
/* ------------------------------------------------------------------ */

export type Effect =
  /** 全局产量倍率，持续 duration 秒 */
  | { kind: 'productionBuff'; multiplier: number; duration: number }
  /** 立即回满心神 */
  | { kind: 'restoreMind' }
  /** 立即获得相当于 seconds 秒产量的灵气 */
  | { kind: 'grantQiSeconds'; seconds: number }
  /** 随机一名弟子资质提升一档 */
  | { kind: 'aptitudeUp' }
  /** 全体弟子寿命上限提升 amount（比例，0.1 = +10%），永久累加 */
  | { kind: 'lifespanBonus'; amount: number }
  /** 所有突破成功率永久 +amount */
  | { kind: 'breakthroughBonus'; amount: number }
  /** 立即完成当前境界的所有小境界参悟 */
  | { kind: 'completeLayers' }
  /** 弟子战力倍率，持续 duration 秒 */
  | { kind: 'expeditionPower'; multiplier: number; duration: number }
  /** 探索伤亡率降低 reduction（0.25 = -25%），持续 duration 秒 */
  | { kind: 'expeditionSafety'; reduction: number; duration: number }
  /** 探索速度倍率，持续 duration 秒 */
  | { kind: 'expeditionSpeed'; multiplier: number; duration: number }
  /** 秘境产出倍率，持续 duration 秒 */
  | { kind: 'expeditionYield'; multiplier: number; duration: number }
  /** 立即完成所有进行中的探索 */
  | { kind: 'completeExpeditions' };

/* ------------------------------------------------------------------ */
/* 材料种类数的规律（需求 2 的量化标准）                                 */
/* ------------------------------------------------------------------ */

/**
 * 第 N 品配方至少需要几种**基础材料** / 几种**稀有材料**（下标 = 品阶）。
 *
 * 这就是"越高等级的丹药和器物，越需要稀有材料，种类也增加"的硬性下限：
 *   一品 0 种稀有 → 九品 5 种稀有
 * 下限而不是定值，是为了给个别配方留出特色空间（例如渡劫丹可以用到 6 种）。
 */
export const BASE_KINDS_MIN = [0, 1, 2, 2, 2, 2, 2, 3, 3, 3];
export const RARE_KINDS_MIN = [0, 0, 1, 1, 2, 2, 3, 3, 4, 5];

/** 一条配方里用到了几种基础 / 稀有材料 */
export function countMaterialKinds(cost: Partial<Record<ItemId, number>>): {
  base: number;
  rare: number;
} {
  const baseSet = new Set<MaterialId>(BASE_MATERIAL_IDS);
  const rareSet = new Set<MaterialId>(RARE_MATERIAL_IDS);
  let base = 0;
  let rare = 0;
  for (const id of Object.keys(cost) as ItemId[]) {
    if (baseSet.has(id as MaterialId)) base += 1;
    else if (rareSet.has(id as MaterialId)) rare += 1;
  }
  return { base, rare };
}

/* ------------------------------------------------------------------ */
/* 配方                                                                */
/* ------------------------------------------------------------------ */

export type PillCategory = 'breakthrough' | 'support' | 'combat';

export interface PillDef {
  id: string;
  name: string;
  icon: string;
  /** 品阶 1~9 */
  tier: number;
  category: PillCategory;
  desc: string;
  cost: Partial<Record<ItemId, number>>;
  effect: Effect;
}

export const PILLS: PillDef[] = [
  /* ---------------- 境界丹（突破用） ---------------- */
  {
    id: 'foundationPill',
    name: '筑基丹',
    icon: '🟤',
    tier: 2,
    category: 'breakthrough',
    desc: '助修士凝练道基。突破至筑基期时服用，成功率大增。',
    cost: { herb: 100, demonCore: 10, spiritSilk: 4, moonDew: 2, qi: 5e3 },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'goldenCorePill',
    name: '凝金丹',
    icon: '🟡',
    tier: 3,
    category: 'breakthrough',
    desc: '以妖丹为引凝结金丹。突破至金丹期时服用。',
    cost: { herb: 300, demonCore: 30, blackIron: 20, moonDew: 6, qi: 1e5 },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'nascentPill',
    name: '化婴丹',
    icon: '🟠',
    tier: 4,
    category: 'breakthrough',
    desc: '金丹化婴之关键。突破至元婴期时服用。',
    cost: { herb: 800, blackIron: 80, fireMarrow: 12, moonDew: 10, starSand: 12, qi: 2e6 },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'spiritPill',
    name: '化神丹',
    icon: '🔵',
    tier: 5,
    category: 'breakthrough',
    desc: '神识化虚之资。突破至化神期时服用。',
    cost: {
      herb: 2000,
      fireMarrow: 40,
      coldJade: 20,
      starSand: 60,
      lunarCrystal: 8,
      qi: 4e7,
      spiritEssence: 6,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'voidPill',
    name: '炼虚丹',
    icon: '🟣',
    tier: 6,
    category: 'breakthrough',
    desc: '炼化虚空之凭依。突破至炼虚期时服用。',
    cost: {
      herb: 5000,
      coldJade: 60,
      fireMarrow: 80,
      starSand: 150,
      lunarCrystal: 25,
      dragonBlood: 30,
      qi: 8e8,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'unityPill',
    name: '合体丹',
    icon: '🟢',
    tier: 7,
    category: 'breakthrough',
    desc: '法体合一之契机。突破至合体期时服用。',
    cost: {
      herb: 1.2e4,
      fireMarrow: 100,
      coldJade: 120,
      spiritSilk: 400,
      lunarCrystal: 50,
      dragonBlood: 150,
      immortalJade: 20,
      qi: 1.6e10,
      spiritEssence: 60,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'grandPill',
    name: '大乘丹',
    icon: '🔶',
    tier: 8,
    category: 'breakthrough',
    desc: '大乘圆满之关窍。突破至大乘期时服用。',
    cost: {
      herb: 3e4,
      fireMarrow: 300,
      coldJade: 200,
      spiritSilk: 500,
      lunarCrystal: 80,
      dragonBlood: 400,
      netherFlame: 40,
      immortalJade: 60,
      spiritEssence: 260,
      qi: 3e11,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'tribulationPill',
    name: '渡劫丹',
    icon: '⚡',
    tier: 9,
    category: 'breakthrough',
    desc: '抵御九重雷劫。突破至渡劫期时服用。',
    cost: {
      herb: 8e4,
      fireMarrow: 600,
      coldJade: 400,
      spiritSilk: 800,
      lunarCrystal: 200,
      dragonBlood: 600,
      netherFlame: 120,
      immortalJade: 200,
      chaosQi: 30,
      spiritEssence: 900,
      qi: 6e12,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'ascensionPill',
    name: '飞升丹',
    icon: '🌟',
    tier: 9,
    category: 'breakthrough',
    desc: '传说中打开仙门的最后一味。突破至仙人时服用。',
    cost: {
      herb: 2e5,
      fireMarrow: 1000,
      coldJade: 700,
      spiritSilk: 1500,
      lunarCrystal: 500,
      dragonBlood: 1500,
      netherFlame: 400,
      immortalJade: 600,
      chaosQi: 80,
      primordialFruit: 15,
      spiritEssence: 2500,
      qi: 1.2e14,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },

  /* ---------------- 辅助型 ---------------- */
  {
    id: 'qiGatheringPill',
    name: '聚气丹',
    icon: '🫧',
    tier: 1,
    category: 'support',
    desc: '服下后气血翻涌，吸纳灵气速度大涨。',
    cost: { herb: 30, demonCore: 3, qi: 1e3 },
    effect: { kind: 'productionBuff', multiplier: 1.5, duration: 300 },
  },
  {
    id: 'calmPill',
    name: '静心丹',
    icon: '🧘',
    tier: 2,
    category: 'support',
    desc: '宁神静气，立即回满心神。',
    cost: { herb: 120, demonCore: 10, spiritSilk: 6, moonDew: 3, qi: 8e3 },
    effect: { kind: 'restoreMind' },
  },
  {
    id: 'nurturePill',
    name: '培元丹',
    icon: '💠',
    tier: 3,
    category: 'support',
    desc: '固本培元，立即获得相当于 5 分钟产量的灵气。',
    cost: { herb: 400, demonCore: 40, blackIron: 20, moonDew: 8, starSand: 4, qi: 2e5 },
    effect: { kind: 'grantQiSeconds', seconds: 300 },
  },
  {
    id: 'marrowPill',
    name: '洗髓丹',
    icon: '🦴',
    tier: 4,
    category: 'support',
    desc: '洗涤经脉，随机一名弟子的资质提升一档。',
    cost: {
      herb: 1000,
      blackIron: 100,
      fireMarrow: 20,
      starSand: 30,
      lunarCrystal: 6,
      qi: 5e6,
    },
    effect: { kind: 'aptitudeUp' },
  },
  {
    id: 'youthPill',
    name: '驻颜丹',
    icon: '🌸',
    tier: 5,
    category: 'support',
    desc: '青春永驻，全体弟子的寿元上限永久提升 10%。',
    cost: {
      herb: 3000,
      fireMarrow: 60,
      coldJade: 30,
      starSand: 90,
      lunarCrystal: 12,
      qi: 1e8,
    },
    effect: { kind: 'lifespanBonus', amount: 0.1 },
  },
  {
    id: 'insightPill',
    name: '悟道丹',
    icon: '🌀',
    tier: 6,
    category: 'support',
    desc: '顿悟天地至理，立即获得相当于 20 分钟产量的灵气。',
    cost: {
      herb: 8000,
      coldJade: 80,
      fireMarrow: 100,
      lunarCrystal: 40,
      dragonBlood: 50,
      netherFlame: 8,
      qi: 2e9,
    },
    effect: { kind: 'grantQiSeconds', seconds: 1200 },
  },
  {
    id: 'rootPill',
    name: '固本丹',
    icon: '🪨',
    tier: 7,
    category: 'support',
    desc: '稳固道基，此后所有突破的成功率永久 +5%。',
    cost: {
      herb: 1e4,
      fireMarrow: 120,
      coldJade: 100,
      spiritSilk: 300,
      starSand: 300,
      dragonBlood: 100,
      netherFlame: 25,
      immortalJade: 15,
      qi: 2e10,
    },
    effect: { kind: 'breakthroughBonus', amount: 0.05 },
  },
  {
    id: 'creationPill',
    name: '造化丹',
    icon: '☄',
    tier: 8,
    category: 'support',
    desc: '夺天地之造化，全局产量提升至 3 倍，持续 10 分钟。',
    cost: {
      herb: 5e4,
      fireMarrow: 400,
      coldJade: 250,
      spiritSilk: 800,
      lunarCrystal: 100,
      dragonBlood: 300,
      netherFlame: 80,
      immortalJade: 40,
      chaosQi: 15,
      qi: 1e12,
    },
    effect: { kind: 'productionBuff', multiplier: 3, duration: 600 },
  },
  {
    id: 'nineTurnPill',
    name: '九转金丹',
    icon: '🏵',
    tier: 9,
    category: 'support',
    desc: '九转方成，服下即刻圆满当前境界的所有小境界。',
    cost: {
      herb: 1.5e5,
      fireMarrow: 1000,
      coldJade: 600,
      spiritSilk: 2000,
      lunarCrystal: 250,
      dragonBlood: 800,
      netherFlame: 200,
      immortalJade: 300,
      chaosQi: 50,
      primordialFruit: 10,
      qi: 1e13,
    },
    effect: { kind: 'completeLayers' },
  },

  /* ---------------- 战斗型 ---------------- */
  {
    id: 'temperPill',
    name: '淬体丹',
    icon: '💪',
    tier: 1,
    category: 'combat',
    desc: '淬炼肉身，弟子战力提升 10%，持续 10 分钟。',
    cost: { herb: 40, demonCore: 6, qi: 2e3 },
    effect: { kind: 'expeditionPower', multiplier: 1.1, duration: 600 },
  },
  {
    id: 'ironBonePill',
    name: '铁骨丹',
    icon: '🛡',
    tier: 2,
    category: 'combat',
    desc: '筋骨如铁，探索伤亡率降低 25%，持续 10 分钟。',
    cost: { herb: 150, demonCore: 15, blackIron: 10, spiritSilk: 8, moonDew: 4, qi: 1e4 },
    effect: { kind: 'expeditionSafety', reduction: 0.25, duration: 600 },
  },
  {
    id: 'bloodPill',
    name: '狂血丹',
    icon: '🩸',
    tier: 3,
    category: 'combat',
    desc: '血气沸腾，秘境产出提升 50%，持续 10 分钟。',
    cost: { herb: 500, demonCore: 50, blackIron: 30, moonDew: 10, starSand: 6, qi: 3e5 },
    effect: { kind: 'expeditionYield', multiplier: 1.5, duration: 600 },
  },
  {
    id: 'warPill',
    name: '血战丹',
    icon: '⚔',
    tier: 4,
    category: 'combat',
    desc: '置之死地而后生，弟子战力提升 30%，持续 10 分钟。',
    cost: {
      herb: 1200,
      blackIron: 100,
      fireMarrow: 25,
      moonDew: 12,
      starSand: 40,
      qi: 6e6,
    },
    effect: { kind: 'expeditionPower', multiplier: 1.3, duration: 600 },
  },
  {
    id: 'windPill',
    name: '御风丹',
    icon: '🌪',
    tier: 5,
    category: 'combat',
    desc: '身轻如燕，探索速度提升 50%，持续 10 分钟。',
    cost: {
      herb: 2500,
      fireMarrow: 50,
      coldJade: 25,
      starSand: 100,
      lunarCrystal: 15,
      qi: 1e8,
    },
    effect: { kind: 'expeditionSpeed', multiplier: 1.5, duration: 600 },
  },
  {
    id: 'breakerPill',
    name: '破军丹',
    icon: '💥',
    tier: 6,
    category: 'combat',
    desc: '破军之势不可挡，秘境产出提升 100%，持续 10 分钟。',
    cost: {
      herb: 6000,
      coldJade: 70,
      fireMarrow: 120,
      lunarCrystal: 45,
      dragonBlood: 70,
      netherFlame: 10,
      qi: 1.5e9,
    },
    effect: { kind: 'expeditionYield', multiplier: 2, duration: 600 },
  },
  {
    id: 'tiangangPill',
    name: '天罡丹',
    icon: '🔰',
    tier: 7,
    category: 'combat',
    desc: '天罡护体，探索期间弟子免疫伤亡，持续 10 分钟。',
    cost: {
      herb: 1.5e4,
      fireMarrow: 200,
      coldJade: 150,
      spiritSilk: 500,
      starSand: 400,
      dragonBlood: 120,
      immortalJade: 15,
      qi: 2e10,
    },
    effect: { kind: 'expeditionSafety', reduction: 1, duration: 600 },
  },
  {
    id: 'demonSlayerPill',
    name: '灭魔丹',
    icon: '🗡',
    tier: 8,
    category: 'combat',
    desc: '荡平诸魔，立即完成所有进行中的秘境探索。',
    cost: {
      herb: 4e4,
      fireMarrow: 500,
      coldJade: 300,
      spiritSilk: 1000,
      lunarCrystal: 120,
      dragonBlood: 350,
      netherFlame: 100,
      immortalJade: 50,
      qi: 5e11,
    },
    effect: { kind: 'completeExpeditions' },
  },
  {
    id: 'immortalPill',
    name: '仙灵丹',
    icon: '👑',
    tier: 9,
    category: 'combat',
    desc: '仙灵附体，弟子战力翻倍且免疫伤亡，持续 10 分钟。',
    cost: {
      herb: 1e5,
      fireMarrow: 1200,
      coldJade: 700,
      spiritSilk: 2500,
      lunarCrystal: 300,
      dragonBlood: 900,
      netherFlame: 250,
      immortalJade: 400,
      chaosQi: 60,
      primordialFruit: 12,
      qi: 8e12,
    },
    effect: { kind: 'expeditionPower', multiplier: 2, duration: 600 },
  },
];

export const PILL_MAP: Record<string, PillDef> = PILLS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, PillDef>,
);

/* ------------------------------------------------------------------ */
/* 器物                                                                */
/* ------------------------------------------------------------------ */

export type ArtifactEffect =
  /** 弟子战力 +bonus */
  | { kind: 'combat'; bonus: number }
  /** 全局产量 +bonus */
  | { kind: 'production'; bonus: number }
  /** 探索速度 +bonus */
  | { kind: 'expeditionSpeed'; bonus: number }
  /** 探索伤亡率 -reduction */
  | { kind: 'expeditionSafety'; reduction: number }
  /** 秘境产出 +bonus */
  | { kind: 'expeditionYield'; bonus: number }
  /**
   * 发现新秘境的概率 +bonus（每次探索结算时生效）。
   *
   * 这是**全游戏唯一**能提升发现概率的东西 —— 山门 / 通天塔 / 照天镜
   * 都已经不再提供发现加成了。原因见 secretRealms.ts 的
   * DISCOVERY_MAX_CHANCE 注释：几个建筑都往同一个上限上挤，
   * 后期它们之间就没有区分度了。
   */
  | { kind: 'discovery'; bonus: number };

export interface ArtifactDef {
  id: string;
  name: string;
  icon: string;
  tier: number;
  category: 'combat' | 'support';
  desc: string;
  cost: Partial<Record<ItemId, number>>;
  effect: ArtifactEffect;
}

export const ARTIFACTS: ArtifactDef[] = [
  {
    id: 'ironSword',
    name: '铁剑',
    icon: '🗡',
    tier: 1,
    category: 'combat',
    desc: '凡铁所铸，聊胜于无。持有可使弟子战力 +5%。',
    cost: { demonCore: 20, ore: 500, qi: 1e4 },
    effect: { kind: 'combat', bonus: 0.05 },
  },
  {
    id: 'jadePendant',
    name: '聚灵玉佩',
    icon: '🧿',
    tier: 2,
    category: 'support',
    desc: '随身佩戴可聚拢灵气，全局产量 +8%。',
    cost: { demonCore: 50, spiritSilk: 12, moonDew: 6, ore: 1500, qi: 5e4 },
    effect: { kind: 'production', bonus: 0.08 },
  },
  {
    id: 'spiritSword',
    name: '灵剑',
    icon: '⚔',
    tier: 3,
    category: 'combat',
    desc: '剑身蕴灵，弟子战力 +12%。',
    cost: { blackIron: 40, spiritSilk: 20, moonDew: 12, starSand: 10, ore: 5000, qi: 1e6 },
    effect: { kind: 'combat', bonus: 0.12 },
  },
  {
    id: 'compass',
    name: '洞天罗盘',
    icon: '🌀',
    tier: 4,
    category: 'support',
    desc: '可勘破秘境路径，探索速度 +25%。',
    cost: {
      blackIron: 150,
      fireMarrow: 30,
      moonDew: 15,
      starSand: 60,
      ore: 2e4,
      qi: 5e6,
    },
    effect: { kind: 'expeditionSpeed', bonus: 0.25 },
  },
  {
    id: 'heavyBlade',
    name: '玄铁重剑',
    icon: '🔪',
    tier: 5,
    category: 'combat',
    desc: '重剑无锋，大巧不工。弟子战力 +25%。',
    cost: {
      fireMarrow: 80,
      refinedGold: 6,
      coldJade: 50,
      starSand: 200,
      lunarCrystal: 30,
      ore: 6e4,
      qi: 1e8,
    },
    effect: { kind: 'combat', bonus: 0.25 },
  },
  {
    id: 'ward',
    name: '护身玉符',
    icon: '🔱',
    tier: 6,
    category: 'support',
    desc: '危急时刻自动护主，探索伤亡率 -30%。',
    cost: {
      coldJade: 120,
      refinedGold: 10,
      fireMarrow: 150,
      lunarCrystal: 60,
      dragonBlood: 50,
      netherFlame: 15,
      ore: 2e5,
      qi: 2e9,
    },
    effect: { kind: 'expeditionSafety', reduction: 0.3 },
  },
  {
    id: 'immortalSword',
    name: '斩仙剑',
    icon: '🌠',
    tier: 7,
    category: 'combat',
    desc: '一剑光寒十九洲。弟子战力 +50%。',
    cost: {
      fireMarrow: 300,
      refinedGold: 40,
      coldJade: 200,
      spiritSilk: 600,
      starSand: 500,
      dragonBlood: 200,
      netherFlame: 40,
      immortalJade: 30,
      ore: 5e5,
      qi: 1e10,
    },
    effect: { kind: 'combat', bonus: 0.5 },
  },
  {
    id: 'cosmosBag',
    name: '乾坤袋',
    icon: '🎒',
    tier: 8,
    category: 'support',
    desc: '内有乾坤，可多带回五成秘境收获。',
    cost: {
      fireMarrow: 700,
      refinedGold: 30,
      coldJade: 450,
      spiritSilk: 1500,
      lunarCrystal: 150,
      dragonBlood: 400,
      netherFlame: 100,
      immortalJade: 80,
      ore: 1e6,
      qi: 1e12,
    },
    effect: { kind: 'expeditionYield', bonus: 0.5 },
  },
  {
    id: 'godSword',
    name: '弑神剑',
    icon: '🗡',
    tier: 9,
    category: 'combat',
    desc: '传自上古凶兵，弟子战力 +100%。',
    cost: {
      fireMarrow: 1500,
      coldJade: 900,
      spiritSilk: 3000,
      lunarCrystal: 400,
      dragonBlood: 1200,
      netherFlame: 300,
      immortalJade: 800,
      chaosQi: 70,
      primordialFruit: 12,
      ore: 3e6,
      qi: 1e13,
    },
    effect: { kind: 'combat', bonus: 1 },
  },
  {
    id: 'treasureCompass',
    name: '寻宝宝盘',
    icon: '🧭',
    tier: 7,
    category: 'support',
    desc:
      '以仙玉为盘、魂火为针，能循着天地间的宝气找到藏起来的秘境。' +
      '每持有一面，发现新秘境的概率 +4%。**这是唯一能提升发现概率的东西。**',
    // 刻意做成全器物里最贵的一档：七品炼器才能铸，且要吃五样稀有材料。
    // 它是"发现"这条线上的唯一投入口，所以贵一点才合理 ——
    // 便宜的代价是整个发现机制退化成"建几座建筑就自动开图"。
    // （基础材料也要凑够三种：品阶下限规则要求七品配方至少有 3 种基础材料。）
    cost: {
      blackIron: 9000,
      spiritSilk: 6000,
      fireMarrow: 3500,
      coldJade: 2500,
      lunarCrystal: 500,
      dragonBlood: 600,
      netherFlame: 180,
      immortalJade: 150,
      chaosQi: 12,
      ore: 2e6,
      qi: 5e12,
    },
    effect: { kind: 'discovery', bonus: 0.04 },
  },
];

export const ARTIFACT_MAP: Record<string, ArtifactDef> = ARTIFACTS.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<string, ArtifactDef>,
);

/* ------------------------------------------------------------------ */
/* 炼丹 / 炼器品阶                                                      */
/* ------------------------------------------------------------------ */

/** 掌握第 tier 品阶炼丹术所需的丹房数量（下标 = 品阶） */
export const ALCHEMY_SLOT_REQUIREMENT = [0, 0, 1, 2, 4, 6, 9, 12, 16, 20];

/** 掌握第 tier 品阶炼器术所需的炼器房数量（下标 = 品阶） */
export const REFINING_SLOT_REQUIREMENT = [0, 0, 1, 2, 4, 6, 9, 12, 16, 20];

/** 提升到第 tier 品阶的炼丹术所需的消耗 */
export const ALCHEMY_TIER_COST: Record<number, Partial<Record<ItemId, number>>> = {
  2: { herb: 200, qi: 2e4 },
  3: { herb: 600, demonCore: 30, qi: 3e5 },
  4: { herb: 2000, blackIron: 100, qi: 5e6 },
  5: { herb: 6000, starSand: 80, qi: 8e7 },
  6: { herb: 2e4, starSand: 250, qi: 1.5e9 },
  7: { herb: 6e4, dragonBlood: 100, qi: 3e10 },
  8: { herb: 2e5, dragonBlood: 300, qi: 6e11 },
  9: { herb: 6e5, immortalJade: 150, qi: 1e13 },
};

/** 提升到第 tier 品阶的炼器术所需的消耗 */
export const REFINING_TIER_COST: Record<number, Partial<Record<ItemId, number>>> = {
  2: { ore: 1000, qi: 3e4 },
  3: { ore: 3000, demonCore: 40, qi: 5e5 },
  4: { ore: 1e4, blackIron: 150, qi: 8e6 },
  5: { ore: 3e4, starSand: 120, qi: 1.2e8 },
  6: { ore: 1e5, starSand: 350, qi: 2e9 },
  7: { ore: 3e5, dragonBlood: 150, qi: 4e10 },
  8: { ore: 1e6, dragonBlood: 400, qi: 8e11 },
  9: { ore: 3e6, immortalJade: 200, qi: 1.5e13 },
};

export const MAX_CRAFT_TIER = 9;

/* ------------------------------------------------------------------ */
/* 丹药增益（BUFF）                                                     */
/* ------------------------------------------------------------------ */

/**
 * 临时增益。
 *
 * 持续时间统一用「剩余秒数」而不是时间戳 —— 这样离线结算时
 * 只要按离线秒数扣减就能正确消耗增益，不必依赖真实时钟。
 *
 * 同类增益取最强的一条生效，不叠加 —— 否则玩家会囤几十颗造化丹一口气吃。
 */
export interface ActiveBuffs {
  /** 全局产量倍率 */
  productionMultiplier: number;
  productionSeconds: number;
  /** 弟子战力倍率 */
  powerMultiplier: number;
  powerSeconds: number;
  /** 伤亡率削减 0~1 */
  safetyReduction: number;
  safetySeconds: number;
  /** 秘境产出倍率 */
  yieldMultiplier: number;
  yieldSeconds: number;
  /** 探索速度倍率 */
  speedMultiplier: number;
  speedSeconds: number;
}

export function createEmptyBuffs(): ActiveBuffs {
  return {
    productionMultiplier: 1,
    productionSeconds: 0,
    powerMultiplier: 1,
    powerSeconds: 0,
    safetyReduction: 0,
    safetySeconds: 0,
    yieldMultiplier: 1,
    yieldSeconds: 0,
    speedMultiplier: 1,
    speedSeconds: 0,
  };
}

/**
 * 推进增益计时，返回新的 buffs。
 * 剩余时间归零时把倍率复位，避免"一次性增益永久生效"这类经典 bug。
 */
export function tickBuffs(buffs: ActiveBuffs, dt: number): ActiveBuffs {
  if (dt <= 0) return buffs;

  const next: ActiveBuffs = {
    ...buffs,
    productionSeconds: Math.max(0, buffs.productionSeconds - dt),
    powerSeconds: Math.max(0, buffs.powerSeconds - dt),
    safetySeconds: Math.max(0, buffs.safetySeconds - dt),
    yieldSeconds: Math.max(0, buffs.yieldSeconds - dt),
    speedSeconds: Math.max(0, buffs.speedSeconds - dt),
  };

  if (next.productionSeconds <= 0) next.productionMultiplier = 1;
  if (next.powerSeconds <= 0) next.powerMultiplier = 1;
  if (next.safetySeconds <= 0) next.safetyReduction = 0;
  if (next.yieldSeconds <= 0) next.yieldMultiplier = 1;
  if (next.speedSeconds <= 0) next.speedMultiplier = 1;

  return next;
}
