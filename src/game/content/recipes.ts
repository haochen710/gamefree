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
// 技术 id 在 content/techs.ts 里就是普通 string（没有窄化的联合类型），所以这里也用 string

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
  /**
   * 探索伤亡率降低 reduction，**按次**生效（需求 2 的保命丹）。
   *
   * 与上面那条的区别是"不算时间，算次数"：下一次探索结算时用掉，
   * 不管中间过了多久。高档次秘境的基础伤亡到 40%，
   * 用限时覆盖它意味着玩家得掐着表打，按次则不用 —— 磕一颗就放心这一趟。
   */
  | { kind: 'expeditionSafety'; reduction: number; once: true }
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
  /* ---------------- 境界丹（突破用） ----------------
   *
   * ⚠️ 本轮需求 9 把这一组的**品阶整体下调了一档**（原来是 realm + 2，现在是 realm + 1）：
   *   突破用丹      改前  改后
   *   炼气→筑基      二品  一品
   *   筑基→金丹      三品  二品
   *   金丹→元婴      四品  三品
   *   元婴→化神      五品  四品
   *   化神→炼虚      六品  五品
   *   炼虚→合体      七品  六品
   *   合体→大乘      八品  七品
   *   大乘→渡劫      九品  八品
   *   渡劫→仙人      九品  九品
   *
   * 为什么必须动：品阶同时是**炼丹术的门槛**（`alchemyTier >= pill.tier`）。
   * 丹药变成硬门槛之后，"realm + 2"意味着每次突破都要先把炼丹术升到
   * **当前境界储存上限的尽头**——模拟器里第一次跑就死在两处：
   * 筑基期要升三品（3e5 灵气 vs 上限 3.2e5，还要 2 份当时根本合不出的灵液），
   * 化神期要升六品（120 份北境特产月华晶）。
   * 改成 +1 之后，每一档炼丹术都在**当前境界内**轻松够得着，
   * 真正的门槛回到丹药**本身**的用料上 —— 那才是需求 9 要的"对丹药需求强烈"。
   *
   * 顺带一提：这也更贴设定集 —— 那张表里「炼气突破丹」正是一品。
   *
   * ⚠️⚠️ 用料也整体压到了「一次突破 = 一次秘境产出的一小部分」的量级。
   * 需求 9 之前，一颗突破丹一辈子只炼一颗（还是可选的），所以旧数字
   * 是按"一次性大件"定的 —— 大乘丹要 400 份龙血、200 份仙玉。
   * 现在**每次大境界突破都要一颗，弟子也一样要**：一个六百人的宗门
   * 光是破境就要几千颗，那些数字直接把游戏变成"永远在凑龙血"。
   * 新口径：稀有材料 ≈ 对应档次秘境一次产出的 1/3 上下，
   * 灵气 ≈ 该境界储存上限的 3~6%。于是丹药仍然是"必须去凑"的东西，
   * 但凑的是**几十份**而不是**几百份**。
   */
  {
    id: 'foundationPill',
    name: '筑基丹',
    icon: '🟤',
    tier: 1,
    category: 'breakthrough',
    desc: '助修士凝练道基。突破至筑基期时服用，成功率大增。',
    cost: { herb: 100, demonCore: 10, spiritSilk: 4, moonDew: 2, qi: 2e3 },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'goldenCorePill',
    name: '凝金丹',
    icon: '🟡',
    tier: 2,
    category: 'breakthrough',
    desc: '以妖丹为引凝结金丹。突破至金丹期时服用。',
    cost: { herb: 300, demonCore: 15, blackIron: 10, moonDew: 4, qi: 2e4 },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'nascentPill',
    name: '化婴丹',
    icon: '🟠',
    tier: 3,
    category: 'breakthrough',
    desc: '金丹化婴之关键。突破至元婴期时服用。',
    cost: { herb: 800, blackIron: 40, fireMarrow: 6, moonDew: 5, starSand: 8, qi: 3e5 },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'spiritPill',
    name: '化神丹',
    icon: '🔵',
    tier: 4,
    category: 'breakthrough',
    desc: '神识化虚之资。突破至化神期时服用。',
    cost: {
      herb: 2000,
      fireMarrow: 20,
      coldJade: 10,
      starSand: 25,
      lunarCrystal: 4,
      qi: 4e6,
      spiritEssence: 2,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'voidPill',
    name: '炼虚丹',
    icon: '🟣',
    tier: 5,
    category: 'breakthrough',
    desc: '炼化虚空之凭依。突破至炼虚期时服用。',
    cost: {
      herb: 5000,
      coldJade: 25,
      fireMarrow: 30,
      starSand: 60,
      lunarCrystal: 8,
      dragonBlood: 10,
      qi: 6e7,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'unityPill',
    name: '合体丹',
    icon: '🟢',
    tier: 6,
    category: 'breakthrough',
    desc: '法体合一之契机。突破至合体期时服用。',
    cost: {
      herb: 1.2e4,
      fireMarrow: 35,
      coldJade: 40,
      spiritSilk: 120,
      lunarCrystal: 12,
      dragonBlood: 40,
      immortalJade: 4,
      qi: 1.2e9,
      spiritEssence: 15,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'grandPill',
    name: '大乘丹',
    icon: '🔶',
    tier: 7,
    category: 'breakthrough',
    desc: '大乘圆满之关窍。突破至大乘期时服用。',
    cost: {
      herb: 3e4,
      fireMarrow: 80,
      coldJade: 60,
      spiritSilk: 150,
      lunarCrystal: 20,
      dragonBlood: 80,
      netherFlame: 12,
      immortalJade: 12,
      spiritEssence: 50,
      qi: 2.4e10,
    },
    effect: { kind: 'productionBuff', multiplier: 1, duration: 0 },
  },
  {
    id: 'tribulationPill',
    name: '渡劫丹',
    icon: '⚡',
    tier: 8,
    category: 'breakthrough',
    desc: '抵御九重雷劫。突破至渡劫期时服用。',
    cost: {
      herb: 8e4,
      fireMarrow: 150,
      coldJade: 100,
      spiritSilk: 200,
      lunarCrystal: 40,
      dragonBlood: 120,
      netherFlame: 25,
      immortalJade: 40,
      chaosQi: 8,
      spiritEssence: 120,
      qi: 4e11,
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
      fireMarrow: 200,
      coldJade: 150,
      spiritSilk: 300,
      lunarCrystal: 80,
      dragonBlood: 250,
      netherFlame: 60,
      immortalJade: 100,
      chaosQi: 20,
      primordialFruit: 5,
      spiritEssence: 400,
      qi: 3e12,
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
    /**
     * 需求 2：「增加可以增加弟子探索存活率的丹药」。
     *
     * 铁骨丹是**限时**的（10 分钟、−25%），这一颗是**按次**的：
     * 一次探索直接免掉四成伤亡，且不设时限，下次探索才消耗。
     * 两者分工很清楚 —— 挂机用铁骨丹（覆盖一段时间里的所有探索），
     * 手动闯九档秘境前磕一颗保命丹（那一次几乎不会死人）。
     *
     * 之所以做成按次而不是又一颗限时丹：高档次秘境的基础伤亡到 40%，
     * 用"限时"来覆盖它意味着玩家得算准时间，而按次不需要算。
     */
    id: 'lifeGuardPill',
    name: '保命丹',
    icon: '💊',
    tier: 4,
    category: 'combat',
    desc: '一丹护一程：下一次探索的伤亡率降低 40%（不设时限，探索一次后消耗）。',
    cost: {
      herb: 900,
      demonCore: 80,
      coldJade: 200,
      spiritSilk: 300,
      spiritEssence: 3,
      moonDew: 120,
      lunarCrystal: 8,
      qi: 2e6,
    },
    effect: { kind: 'expeditionSafety', reduction: 0.4, once: true },
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

/**
 * 可携带器物的耐久信息（需求 2）。
 *
 * 需求原文：「影响弟子探索的器物有使用次数限制，达到限制后损毁，需要重新炼制」。
 * 所以这类器物每探索一次消耗 1 次，次数归零就从库存里消失。
 */
export interface CarrySpec {
  /** 总共能用几次 */
  charges: number;
}

export interface ArtifactDef {
  id: string;
  name: string;
  icon: string;
  tier: number;
  category: 'combat' | 'support';
  desc: string;
  cost: Partial<Record<ItemId, number>>;
  effect: ArtifactEffect;
  /**
   * 有这一项就是「**可携带器物**」（需求 2）：弟子出门探索时会自动带上，
   * 每探索一次消耗一次，用完即毁，得重新炼。
   *
   * 效果仍然写在 `effect` 里（产出加成 / 伤亡减免），额外加这一项只是让
   * "这东西会用坏"成为器物自身的属性，而不是散在别处的特判。
   */
  carry?: CarrySpec;
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

  /* ----------------------------------------------------------------
   * 需求 2 新增：更多器物 + 可携带器物
   *
   * 需求原文：「器物种类有点少了，再增加一些，部分特殊器物可以让弟子
   * 探索时携带，增加产出或者降低伤亡率……影响弟子探索的器物有使用次数
   * 限制，达到限制后损毁，需要重新炼制」。
   *
   * 下面带 `carry` 的五件是**消耗品**：每次探索各消耗 1 次，用完即毁。
   * 它们的效果和前九件**故意重叠**（产出 / 安全 / 速度 / 战力），
   * 因为需求要的不是"更强的数值"，而是"给弟子配装"这件事本身：
   * 前九件是永久资产（炼一次用一辈子），这几件是要反复补的消耗。
   *
   * 耐久越短的效果越强 —— 轻身符能用 12 次但只 +20% 速度，
   * 虚空镜只够 5 次却 +35% 产出。这样"该炼哪一件"永远是个取舍。
   * ---------------------------------------------------------------- */
  {
    id: 'lightTalisman',
    name: '轻身符',
    icon: '🪶',
    tier: 2,
    category: 'support',
    desc: '贴上便身轻如燕，弟子探索速度 +20%。可携带，12 次后符纸自燃。',
    cost: { spiritSilk: 80, blackIron: 30, moonDew: 6, qi: 3e4 },
    effect: { kind: 'expeditionSpeed', bonus: 0.2 },
    carry: { charges: 12 },
  },
  {
    id: 'harvestPouch',
    name: '采灵袋',
    icon: '👝',
    tier: 3,
    category: 'support',
    desc: '袋口刻着聚物之阵，弟子秘境产出 +20%。可携带，10 次后袋底磨穿。',
    cost: { spiritSilk: 300, coldJade: 120, demonCore: 60, moonDew: 20, stone: 4000, qi: 3e5 },
    effect: { kind: 'expeditionYield', bonus: 0.2 },
    carry: { charges: 10 },
  },
  {
    id: 'soulLantern',
    name: '引魂灯',
    icon: '🏮',
    tier: 4,
    category: 'support',
    desc: '灯在则魂不散，弟子探索伤亡率 −18%。可携带，8 次后灯油耗尽。',
    cost: { netherFlame: 20, moonDew: 60, coldJade: 400, spiritSilk: 800, refinedGold: 4, qi: 2e6 },
    effect: { kind: 'expeditionSafety', reduction: 0.18 },
    carry: { charges: 8 },
  },
  {
    id: 'beastBanner',
    name: '御兽幡',
    icon: '🚩',
    tier: 5,
    category: 'combat',
    desc: '幡动则群兽随行，弟子战力 +30%。可携带，6 次后兽魂散去。',
    cost: { demonCore: 900, fireMarrow: 600, spiritSilk: 1500, starSand: 40, moonDew: 200, refinedGold: 12, qi: 5e7 },
    effect: { kind: 'combat', bonus: 0.3 },
    carry: { charges: 6 },
  },
  {
    id: 'starChart',
    name: '周天星图',
    icon: '🌌',
    tier: 6,
    category: 'support',
    desc: '把星象和地脉对上，发现新秘境的概率 +3.5%。它不会坏，但铸一张极贵。',
    cost: {
      starSand: 900,
      lunarCrystal: 200,
      dragonBlood: 40,
      coldJade: 1200,
      blackIron: 2000,
      arrayCore: 40,
      refinedGold: 60,
      ore: 4e5,
      qi: 2e9,
    },
    effect: { kind: 'discovery', bonus: 0.035 },
  },
  {
    id: 'voidMirror',
    name: '虚空镜',
    icon: '🪞',
    tier: 7,
    category: 'support',
    desc: '镜中自成一方小天地，弟子秘境产出 +35%。可携带，5 次后镜面碎裂。',
    cost: {
      lunarCrystal: 400,
      starSand: 1500,
      dragonBlood: 80,
      coldJade: 900,
      spiritSilk: 3000,
      demonCore: 1500,
      refinedGold: 120,
      arrayCore: 80,
      netherFlame: 120,
      ore: 8e5,
      qi: 6e9,
    },
    effect: { kind: 'expeditionYield', bonus: 0.35 },
    carry: { charges: 5 },
  },
  {
    id: 'lifeRobe',
    name: '长生法衣',
    icon: '🥋',
    tier: 8,
    category: 'support',
    desc: '衣上绣满护命符箓，弟子探索伤亡率 −30%。可携带，4 次后符箓燃尽。',
    cost: {
      spiritSilk: 6000,
      immortalJade: 120,
      lunarCrystal: 500,
      netherFlame: 60,
      starSand: 2000,
      fireMarrow: 3000,
      demonCore: 4000,
      coldJade: 2500,
      refinedGold: 400,
      arrayCore: 200,
      dragonBlood: 400,
      qi: 3e11,
    },
    effect: { kind: 'expeditionSafety', reduction: 0.3 },
    carry: { charges: 4 },
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

/**
 * 炼丹 / 炼器品阶。
 *
 * ⚠️ 需求 2 把这一套改了两处：
 *   1. **丹房与炼器房改为唯一建筑** —— 所以"要几座丹房才能升到几品"
 *      （原来的 `ALCHEMY_SLOT_REQUIREMENT`）整条规矩作废了，升品只看资源。
 *      下面那两个数组保留只为兼容旧存档的读法，不再参与判定。
 *   2. **升品越到高级越要吃稀有材料**：原来的花费只到 `immortalJade`，
 *      现在从第 4 品起一路吃**进阶资源**（灵液 / 精金，见需求 4 的合成系统），
 *      高品还要 `chaosQi` / `primordialFruit`。
 *
 * ⚠️⚠️ 本轮需求 9 又改了一次**定价的口径**，这一条很关键：
 *
 * 需求 9 让「大境界突破必须服对应境界丹」，于是**炼丹术品阶从"可选的后期爱好"
 * 变成了主线必经之路** —— 要突破到第 N+1 个境界，就得先把炼丹术升到 N+2 品。
 * 而下面这些数字原本是按"可选沉没成本"定的：每升高一品几乎要吃满**当前境界的
 * 全部储存上限**（例如三品要 3e5 灵气，而筑基期的上限正好只有 3.2e5）。
 * 后果是模拟器里第一次出现了**真死锁**：攒不满、又不能不升，卡死在筑基期。
 *
 * 所以本轮把灵气花费统一压到"该品阶对应境界储存上限的约 25%"：
 *  品阶  用它的境界   该境界储存上限      新花费
 *   2     炼气期        2.0e4           5e3
 *   3     筑基期        3.2e5           8e4
 *   4     金丹期        5.3e6           1.3e6
 *   5     元婴期        1.1e8           2.6e7
 *   6     化神期        2.1e9           5e8
 *   7     炼虚期        4.2e10          1e10
 *   8     合体期        8.4e11          2e11
 *   9     大乘期        1.7e13          4e12
 * 材料那部分**不动** —— 那才是"吃稀有材料"的味道所在；被压的是纯粹的灵气门槛。
 *
 * ⚠️⚠️⚠️ 材料也被压了一轮，原因同上、而且更要紧：
 * 这些数字当初是按"一次高阶秘境能出多少"随手定的（例如 6 品要 120 份月华晶），
 * 而月华晶是**北境特产**、一次秘境也就出 5~22 份 —— 那是"想升就慢慢攒"的定价。
 * 一旦升品必须在突破前完成，它就变成了**几十趟**的硬墙：模拟器里 5 个种子有 4 个
 * 卡死在化神期、后面 27 天什么都没发生。现在按"对应境界大约 2~3 趟秘境"来定，
 * 进阶资源（灵液 / 精金）也同步减半 —— 它代表"你得把合成线跑起来"，
 * 而不是"你得跑一百次合成"。
 */
export const ALCHEMY_SLOT_REQUIREMENT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const REFINING_SLOT_REQUIREMENT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** 提升到第 tier 品阶的炼丹术所需的消耗 */
export const ALCHEMY_TIER_COST: Record<number, Partial<Record<ItemId, number>>> = {
  2: { herb: 400, qi: 5e3 },
  // ⚠️ 三品**不吃**灵液：灵液要筑基期才能熬（见 refine.ts），
  // 而三品正是筑基期要用的那一品 —— 一旦这里要灵液，就变成"想升三品先得有灵液、
  // 想要灵液先得升三品"。本文件的注释一直写着"从第 4 品起吃进阶资源"，
  // 数据却把它放在了三品，这一轮把它改回注释说的样子。
  3: { herb: 1200, demonCore: 60, qi: 8e4 },
  4: { herb: 4000, blackIron: 200, spiritEssence: 10, qi: 1.3e6 },
  5: { herb: 1.2e4, starSand: 160, spiritEssence: 40, qi: 2.6e7 },
  6: { herb: 4e4, starSand: 300, lunarCrystal: 30, spiritEssence: 80, qi: 5e8 },
  7: { herb: 1.2e5, dragonBlood: 80, lunarCrystal: 100, spiritEssence: 150, qi: 1e10 },
  8: { herb: 4e5, dragonBlood: 200, netherFlame: 60, spiritEssence: 300, qi: 2e11 },
  9: { herb: 1.2e6, immortalJade: 100, netherFlame: 200, spiritEssence: 600, primordialFruit: 3, qi: 4e12 },
};

/** 提升到第 tier 品阶的炼器术所需的消耗 */
export const REFINING_TIER_COST: Record<number, Partial<Record<ItemId, number>>> = {
  2: { ore: 2000, qi: 5e3 },
  // 同上：精金要金丹期才能炼，所以它从三品挪到四品
  3: { ore: 6000, demonCore: 80, qi: 1e5 },
  4: { ore: 2e4, blackIron: 300, refinedGold: 8, qi: 1.6e6 },
  5: { ore: 6e4, starSand: 240, refinedGold: 30, qi: 3e7 },
  6: { ore: 2e5, starSand: 500, lunarCrystal: 30, refinedGold: 120, qi: 6e8 },
  7: { ore: 6e5, dragonBlood: 120, lunarCrystal: 100, refinedGold: 320, qi: 1.2e10 },
  8: { ore: 2e6, dragonBlood: 250, netherFlame: 80, refinedGold: 900, qi: 2.4e11 },
  9: { ore: 6e6, immortalJade: 130, netherFlame: 250, refinedGold: 800, chaosQi: 20, qi: 5e12 },
};

export const MAX_CRAFT_TIER = 9;

/**
 * 升到第 N 品需要先钻研的技术（需求 6）。
 *
 * 需求原文：「丹房和炼器房可以升级……这俩升级需要钻研**对应等级的技术**」。
 *
 * 现有的技术里没有"炼丹术·三品"这种逐品技术，只有三段式的道术进阶，
 * 所以这里把品阶**归到最近的那一段**：
 *   入门（炼丹入门 / 炼器入门） → 2~4 品
 *   精要（丹道精要 / 器道精要） → 5~6 品
 *   极致（药王之道 / 通天营造） → 7~9 品
 * 这样"想练高品丹，先得把这条道术读上去"，而且用的都是本来就在树里的技术，
 * 不必为两座建筑凭空长出十六个技术来。
 */
export const ALCHEMY_TIER_TECH: Record<number, string> = {
  2: 'alchemyArt',
  3: 'alchemyArt',
  4: 'alchemyArt',
  5: 'alchemyDeep',
  6: 'alchemyDeep',
  7: 'gardenArt',
  8: 'gardenArt',
  9: 'gardenArt',
};

export const REFINING_TIER_TECH: Record<number, string> = {
  2: 'refiningArt',
  3: 'refiningArt',
  4: 'refiningArt',
  5: 'refiningDeep',
  6: 'refiningDeep',
  7: 'towerArt',
  8: 'towerArt',
  9: 'towerArt',
};

/* ------------------------------------------------------------------ */
/* 炼制成功率（需求 2）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 各品阶的**基础成功率**（下标 = 品阶）。
 *
 * 需求原文：「炼制对应等级的丹药或者器物并不能百分百成功，有概率失败……
 * 丹药和器物的等级越高，基础成功率越低。」
 *
 * 所以一品 100%（新手不该被卡）、九品只有 28%。
 */
export const CRAFT_BASE_SUCCESS: number[] = [0, 1, 0.95, 0.88, 0.8, 0.7, 0.6, 0.5, 0.39, 0.28];

/**
 * 炼制比自己品阶低的丹药时的加成，**每差一品 +12%**。
 *
 * 需求原文：「炼制更低品阶的则有加成，**相差三个品阶的时候成功率达到百分百**」。
 * 这条不是"算出来刚好接近 1"，而是**硬规则**：差 ≥ 3 品直接返回 1，
 * 见 `getCraftSuccessRate`。否则"百分之百"会随着基础成功率被改动而失效。
 */
export const CRAFT_MASTER_GAP_BONUS = 0.12;

/** 「差三品必成」这个门槛（需求明文） */
export const CRAFT_MASTER_GAP = 3;

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
  /**
   * 这一次的伤亡削减是不是**按次**的（需求 2 的保命丹）。
   *
   * 为 true 时 `safetyReduction` 不受 `safetySeconds` 管：它会在
   * **下一次探索结算时**被用掉并清零，中间隔多久都有效。
   * 之所以要单独一个标志位，而不是把 duration 设成天文数字 ——
   * 那样它会永远生效，一颗丹药护一辈子，显然不是需求的意思。
   */
  safetyOnce: boolean;
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
    safetyOnce: false,
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
  // 按次的那一颗（保命丹）不看时间，只等下一次探索来把它用掉
  if (next.safetySeconds <= 0 && !next.safetyOnce) next.safetyReduction = 0;
  if (next.yieldSeconds <= 0) next.yieldMultiplier = 1;
  if (next.speedSeconds <= 0) next.speedMultiplier = 1;

  return next;
}
