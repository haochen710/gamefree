/**
 * 弟子养成：战斗天赋 / 种田天赋 / 性格 / 忠诚度 / 心魔
 *
 * 对应设定集第 8 章（弟子体系）与第 14 章（修炼·悟道·心魔）。
 *
 * 设计前提：**弟子有三个彼此正交的随机维度**（资质早已有），
 * 加上一个会随时间变化的忠诚度与心魔，于是"这名弟子值不值得留"不再是
 * 只看资质一条 —— 一个极品灵根但性格孤傲、心魔缠身的弟子，可能还不如
 * 一个中品灵根、守道而死忠的弟子好养。
 *
 * ⚠️ 三处关键取舍（都是为了让"人多"不会把曲线顶穿）：
 *
 * 1. **战斗天赋是"每名弟子对自己生效"的**，不是全宗加成。
 *    秘境的伤亡本来就是**逐人掷骰**（见 `expeditions.resolveExpedition`），
 *    所以把 `casualtyReduction` 挂在本人身上最自然，也天然免疫"人多就无敌"。
 *    只有"产出类"的加成（迅猎击伐 / 兽语通晓）才按队伍取**最高一项**，
 *    不叠加 —— 与设定集里"同功法不可叠加，只取最高品级效果"是同一个思路。
 *
 * 2. **种田天赋按"√人数"给全宗加成**，沿用聚灵阵那一套收益递减
 *    （`SPIRIT_ARRAY_CULTIVATION_BONUS`）。线性叠加在这里会立刻失控：
 *    一千名弟子每人 +6% 炼丹成功率，加起来是 +6000%。
 *
 * 3. **忠诚度与心魔的后果都落在"个人"身上**（自己的修行速度、自己的伤亡率、
 *    自己的叛逃），不做全宗惩罚 —— 否则一千人里出一个叛徒就让全宗掉产量，
 *    玩家会觉得莫名其妙。
 */
import type { AptitudeId } from './sect';
import { APTITUDE_ORDER } from './sect';

/* ------------------------------------------------------------------ */
/* 天赋总览（需求 3）                                                   */
/* ------------------------------------------------------------------ */
/*
 * 需求 3 把天赋分成六类：
 *   **战斗天赋 / 战斗辅助天赋 / 炼丹天赋 / 炼器天赋 / 制符天赋 / 种田天赋**
 *
 * 落地方式是"两个槽"（与用户确认过的口径）：
 *   - `Disciple.combatTalent`：**战斗类** —— 从「战斗天赋 + 战斗辅助天赋」里抽；
 *   - `Disciple.farmTalent`：**生产类** —— 从「炼丹 / 炼器 / 制符 / 种田」里抽。
 * 性格（`personality`）继续独立存在，见本文件后面的 PERSONALITIES。
 *
 * 这么分的好处是**派遣**有了明确的对口人：丹房要炼丹天赋、符房要制符天赋，
 * 而战斗辅助天赋（阵道、药理、引路）在探索里各有一席之地。
 */

/** 生产类天赋的四种归属（同时就是四项"技艺"的口径） */
export type TalentKind = 'alchemy' | 'refining' | 'talisman' | 'farm';

export const TALENT_KIND_NAMES: Record<TalentKind, string> = {
  alchemy: '炼丹',
  refining: '炼器',
  talisman: '制符',
  farm: '种田',
};

/* ------------------------------------------------------------------ */
/* 战斗天赋（每名弟子随机 1 项）                                        */
/* ------------------------------------------------------------------ */

export type CombatTalentId =
  | 'ironBody'
  | 'swiftHunt'
  | 'dangerSense'
  | 'bloodlust'
  | 'beastWhisper'
  | 'soulSteady'
  /* ---- 战斗辅助（需求 3 新增） ---- */
  | 'fieldMedic'
  | 'arrayMaster'
  | 'scoutEye'
  | 'pathfinder'
  | 'pillMaster'
  | 'comrade';

export interface CombatTalentDef {
  id: CombatTalentId;
  name: string;
  icon: string;
  /** 战斗 or 战斗辅助（需求 3 的分类） */
  family: 'combat' | 'support';
  /** **自己**受到的秘境伤亡率削减（加算，0.035 = -3.5%） */
  casualtyReduction: number;
  /** 秘境产出加成（按队伍取最高一项，不叠加） */
  yieldBonus: number;
  /** 宗门防御贡献（用于宗门防御类事件；按全宗取最高一项） */
  sectDefense: number;
  /** 心魔增长抵抗（0.2 = 心魔涨得慢 20%） */
  demonGuard: number;
  /* ---- 以下四项只有战斗辅助天赋会给（读取点逐个写在括号里） ---- */
  /** 队伍安全加成，取队伍最高（expeditions.resolveExpedition 的 safety） */
  partySafetyBonus?: number;
  /** 秘境发现概率加成（engine.getDiscoveryChance） */
  discoveryBonus?: number;
  /** 探索时长削减（expeditions 的时长结算） */
  travelSpeedBonus?: number;
  /** 丹药栏效果放大（gear.getPartyPillSafety） */
  pillEffectBonus?: number;
  /** 同门陨落时的忠诚损失削减（disciples.settlePartyAfterExpedition） */
  loyaltyLossReduction?: number;
  /** 探索心得加成（expeditions.getExpeditionInsight） */
  insightBonus?: number;
  desc: string;
}

/**
 * 六项战斗天赋（正面硬拼的那一类）。
 *
 * 效果刻意都压在 2~4%：伤亡是**逐人掷骰**的，一个人减 3.5% 就够明显了，
 * 再高会让"带一队铁甲体魄"变成唯一正解。
 */
export const COMBAT_TALENTS: CombatTalentDef[] = [
  {
    id: 'ironBody',
    name: '铁甲体魄',
    icon: '🛡',
    family: 'combat',
    casualtyReduction: 0.035,
    yieldBonus: 0,
    sectDefense: 0.05,
    demonGuard: 0,
    desc: '皮糙肉厚，硬扛得住。自己探索伤亡 −3.5%，宗门防御判定 +5。',
  },
  {
    id: 'swiftHunt',
    name: '迅猎击伐',
    icon: '🏹',
    family: 'combat',
    casualtyReduction: 0.025,
    yieldBonus: 0.04,
    sectDefense: 0,
    demonGuard: 0,
    desc: '出手快而狠，压着妖兽打。自己伤亡 −2.5%；队伍秘境产出 +4%。',
  },
  {
    id: 'dangerSense',
    name: '御险感知',
    icon: '👁',
    family: 'combat',
    casualtyReduction: 0.035,
    yieldBonus: 0,
    sectDefense: 0,
    demonGuard: 0.05,
    desc: '对危险有预感，总能提前避开。自己伤亡 −3.5%，心魔增长 −5%。',
  },
  {
    id: 'bloodlust',
    name: '浴血奋战',
    icon: '🩸',
    family: 'combat',
    casualtyReduction: 0.03,
    yieldBonus: 0.03,
    sectDefense: 0,
    demonGuard: -0.1,
    desc: '越战越勇，但也越战越疯。自己伤亡 −3%、产出 +3%，心魔涨得快 10%。',
  },
  {
    id: 'beastWhisper',
    name: '兽语通晓',
    icon: '🐾',
    family: 'combat',
    casualtyReduction: 0,
    yieldBonus: 0.06,
    sectDefense: 0,
    demonGuard: 0,
    desc: '能听懂妖兽的意思，知道哪里有好东西。队伍秘境产出 +6%。',
  },
  {
    id: 'soulSteady',
    name: '神魂稳固',
    icon: '🧘',
    family: 'combat',
    casualtyReduction: 0.015,
    yieldBonus: 0,
    sectDefense: 0,
    demonGuard: 0.2,
    desc: '心神如渊，不易动摇。自己伤亡 −1.5%，心魔增长 −20%。',
  },
];

/**
 * 六项**战斗辅助**天赋（需求 3 新增）。
 *
 * 与上面那六项的区别：它们**不给自己减伤**，而是让"这一队人"
 * 更安全、更快、找到更多东西、或者让身后的人更稳。
 * 所以效果全部按"队伍取最高一项"结算 —— 带一个阵道天成就够了。
 */
export const COMBAT_SUPPORT_TALENTS: CombatTalentDef[] = [
  {
    id: 'fieldMedic',
    name: '疗伤圣手',
    icon: '🩹',
    family: 'support',
    casualtyReduction: 0,
    yieldBonus: 0,
    sectDefense: 0,
    demonGuard: 0,
    partySafetyBonus: 0.02,
    desc: '同袍受伤有人包扎。全队探索伤亡 −2%。',
  },
  {
    id: 'arrayMaster',
    name: '阵道天成',
    icon: '🔯',
    family: 'support',
    casualtyReduction: 0,
    yieldBonus: 0,
    sectDefense: 0.03,
    demonGuard: 0,
    partySafetyBonus: 0.04,
    desc: '随手就能布下护身阵。全队探索伤亡 −4%，宗门防御 +3。',
  },
  {
    id: 'scoutEye',
    name: '洞察先机',
    icon: '🔭',
    family: 'support',
    casualtyReduction: 0,
    yieldBonus: 0,
    sectDefense: 0,
    demonGuard: 0,
    discoveryBonus: 0.15,
    desc: '一眼看出山势水脉的异常。发现新秘境的概率 +15%。',
  },
  {
    id: 'pathfinder',
    name: '引路之人',
    icon: '🧭',
    family: 'support',
    casualtyReduction: 0,
    yieldBonus: 0,
    sectDefense: 0,
    demonGuard: 0,
    travelSpeedBonus: 0.08,
    desc: '走过一遍的路记得清清楚楚。探索用时 −8%。',
  },
  {
    id: 'pillMaster',
    name: '药理通神',
    icon: '💊',
    family: 'support',
    casualtyReduction: 0,
    yieldBonus: 0,
    sectDefense: 0,
    demonGuard: 0,
    pillEffectBonus: 0.5,
    desc: '知道丹药该怎么吃才最顶用。队伍丹药栏的效果 +50%。',
  },
  {
    id: 'comrade',
    name: '同袍之义',
    icon: '🤝',
    family: 'support',
    casualtyReduction: 0.01,
    yieldBonus: 0,
    sectDefense: 0,
    demonGuard: 0.05,
    loyaltyLossReduction: 0.5,
    insightBonus: 0.1,
    desc: '有他在，队伍散不了。同门陨落时忠诚损失减半，探索心得 +10%。',
  },
];

/** 战斗类天赋（含辅助）的查表 */
export const COMBAT_TALENT_MAP: Record<string, CombatTalentDef> = [
  ...COMBAT_TALENTS,
  ...COMBAT_SUPPORT_TALENTS,
].reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, CombatTalentDef>,
);

export const COMBAT_TALENT_IDS: CombatTalentId[] = [
  ...COMBAT_TALENTS.map((t) => t.id),
  ...COMBAT_SUPPORT_TALENTS.map((t) => t.id),
];

/* ------------------------------------------------------------------ */
/* 生产天赋（炼丹 / 炼器 / 制符 / 种田，每名弟子随机 1 项）              */
/* ------------------------------------------------------------------ */

export type FarmTalentId =
  /* 炼丹 */
  | 'furnaceAdept'
  | 'pillHeart'
  | 'herbLore'
  /* 炼器 */
  | 'forgeAdept'
  | 'firePrecision'
  | 'oreSense'
  /* 制符 */
  | 'talismanAdept'
  | 'brushMaster'
  | 'inkSense'
  /* 种田 */
  | 'herbWhisper'
  | 'soilMaster'
  | 'springSense'
  | 'keenEye';

/**
 * 生产天赋作用在哪个数字上。
 *
 * ⚠️ 每一条都必须有**唯一读取点**（本作已经栽过六次"声明了没人读"）：
 *   alchemyRate / refiningRate / talismanRate → crafting.getCraftSuccessRate
 *   alchemyBatch / refiningBatch / talismanYield → 炼制产出的批量结算
 *   herb / qi → engine.getProduction
 *   rareDrop → manuals.rollFragmentDrop
 *   plantingSpeed → planting.plantSeed
 */
export type FarmTalentTarget =
  | 'alchemyRate'
  | 'alchemyBatch'
  | 'refiningRate'
  | 'refiningBatch'
  | 'talismanRate'
  | 'talismanYield'
  | 'herb'
  | 'qi'
  | 'rareDrop'
  | 'plantingSpeed';

export interface FarmTalentDef {
  id: FarmTalentId;
  name: string;
  icon: string;
  /** 四种归属（决定它能被派到哪座设施对口） */
  kind: TalentKind;
  target: FarmTalentTarget;
  /** 每 √人数 提供的加成（沿用聚灵阵那套收益递减） */
  rate: number;
  desc: string;
}

export const FARM_TALENTS: FarmTalentDef[] = [
  /* ---------------- 炼丹 ---------------- */
  {
    id: 'furnaceAdept',
    name: '炉火通灵',
    icon: '🔥',
    kind: 'alchemy',
    target: 'alchemyRate',
    rate: 0.004,
    desc: '与炉火有感应。全宗炼丹成功率 +0.4%/√人。',
  },
  {
    id: 'pillHeart',
    name: '丹心妙手',
    icon: '⚗',
    kind: 'alchemy',
    target: 'alchemyBatch',
    rate: 0.02,
    desc: '一炉能出双份。炼丹批量产出概率 +2%/√人。',
  },
  {
    id: 'herbLore',
    name: '药性通晓',
    icon: '🌿',
    kind: 'alchemy',
    target: 'alchemyRate',
    rate: 0.006,
    desc: '熟知药性配比。全宗炼丹成功率 +0.6%/√人。',
  },
  /* ---------------- 炼器 ---------------- */
  {
    id: 'forgeAdept',
    name: '锻器巧手',
    icon: '🔨',
    kind: 'refining',
    target: 'refiningRate',
    rate: 0.004,
    desc: '手上功夫细。全宗炼器成功率 +0.4%/√人。',
  },
  {
    id: 'firePrecision',
    name: '火候精准',
    icon: '🌡',
    kind: 'refining',
    target: 'refiningBatch',
    rate: 0.02,
    desc: '火候分毫不差。炼器批量产出概率 +2%/√人。',
  },
  {
    id: 'oreSense',
    name: '辨矿之眼',
    icon: '⛏',
    kind: 'refining',
    target: 'refiningRate',
    rate: 0.006,
    desc: '一眼看出矿料的品相。全宗炼器成功率 +0.6%/√人。',
  },
  /* ---------------- 制符 ---------------- */
  {
    id: 'talismanAdept',
    name: '符箓天成',
    icon: '📜',
    kind: 'talisman',
    target: 'talismanRate',
    rate: 0.005,
    desc: '下笔自成符。全宗制符成功率 +0.5%/√人。',
  },
  {
    id: 'brushMaster',
    name: '笔走龙蛇',
    icon: '🖌',
    kind: 'talisman',
    target: 'talismanYield',
    rate: 0.05,
    desc: '一笔画到底不停顿。制符产出 +5%/√人。',
  },
  {
    id: 'inkSense',
    name: '朱砂通神',
    icon: '🖍',
    kind: 'talisman',
    target: 'talismanRate',
    rate: 0.004,
    desc: '知道什么朱砂配什么符。全宗制符成功率 +0.4%/√人。',
  },
  /* ---------------- 种田 ---------------- */
  {
    id: 'herbWhisper',
    name: '灵草亲和',
    icon: '🌱',
    kind: 'farm',
    target: 'herb',
    rate: 0.015,
    desc: '灵草在他手里长得格外好。全宗灵草产量 +1.5%/√人。',
  },
  {
    id: 'soilMaster',
    name: '沃土专精',
    icon: '🪴',
    kind: 'farm',
    target: 'plantingSpeed',
    rate: 0.005,
    desc: '知道怎么养地。灵植成熟时间 −0.5%/√人。',
  },
  {
    id: 'springSense',
    name: '灵泉感悟',
    icon: '💧',
    kind: 'farm',
    target: 'qi',
    rate: 0.01,
    desc: '能听出地下灵脉的走向。全宗灵气产量 +1%/√人。',
  },
  {
    id: 'keenEye',
    name: '慧眼辨材',
    icon: '👁',
    kind: 'farm',
    target: 'rareDrop',
    rate: 0.006,
    desc: '一眼看出哪块石头里有东西。稀有材料掉落 +0.6%/√人。',
  },
];

export const FARM_TALENT_MAP: Record<string, FarmTalentDef> = FARM_TALENTS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, FarmTalentDef>,
);

export const FARM_TALENT_IDS: FarmTalentId[] = FARM_TALENTS.map((t) => t.id);

/** 某一类生产天赋（炼丹 / 炼器 / 制符 / 种田）的清单 */
export function farmTalentsOfKind(kind: TalentKind): FarmTalentDef[] {
  return FARM_TALENTS.filter((t) => t.kind === kind);
}

/**
 * 收益递减：`rate × √count`。
 *
 * 与聚灵阵、功法碎片的加成同一个形状 —— 本作只有这一种"人数加成"的曲线，
 * 玩家学一次就够（100 人 = 10 倍单件，1000 人 = 31.6 倍）。
 */
export function farmTalentBonus(count: number, rate: number): number {
  if (count <= 0) return 0;
  return rate * Math.sqrt(count);
}

/* ------------------------------------------------------------------ */
/* 性格（永久固定）                                                     */
/* ------------------------------------------------------------------ */

export type PersonalityId = 'dao' | 'warlike' | 'greedy' | 'serene' | 'proud' | 'renyi';

export interface PersonalityDef {
  id: PersonalityId;
  name: string;
  icon: string;
  /** 修炼速度加成（加算进该弟子的修行倍率） */
  cultivationBonus: number;
  /** 自己受到的秘境伤亡率削减 */
  casualtyReduction: number;
  /** 秘境产出加成（按队伍取最高一项） */
  yieldBonus: number;
  /** 忠诚低于它就可能在任务途中叛逃；0 = 永不叛逃 */
  desertBelow: number;
  /** 忠诚度下限（守道 / 恬淡锁定 20） */
  loyaltyFloor: number;
  /** 忠诚衰减倍率（>1 掉得快） */
  decayMult: number;
  /** 忠诚增长倍率（重义的赏赐翻倍） */
  gainMult: number;
  /** 心魔增长倍率 */
  demonMult: number;
  /** 心魔抵抗（正数=涨得慢；孤傲是负数） */
  demonGuard: number;
  /** 同伴陨落时忠诚额外下跌的倍率（重义翻倍） */
  allyDeathMult: number;
  /** 宗门防御贡献（全宗取最高一项，不叠加） */
  sectDefense: number;
  /** 是否拒绝高风险任务（高危秘境不派它去） */
  refuseHighRisk: boolean;
  desc: string;
}

export const PERSONALITIES: PersonalityDef[] = [
  {
    id: 'dao',
    name: '守道',
    icon: '📿',
    cultivationBonus: 0,
    casualtyReduction: 0,
    yieldBonus: 0,
    desertBelow: 0,
    loyaltyFloor: 20,
    decayMult: 0.25,
    gainMult: 1,
    demonMult: 0.6,
    demonGuard: 0.1,
    allyDeathMult: 1,
    sectDefense: 0,
    refuseHighRisk: false,
    desc: '道心坚定，宠辱不惊。忠诚度衰减极慢，且锁死 20 以上 —— 永不叛逃。',
  },
  {
    id: 'warlike',
    name: '好战',
    icon: '⚔',
    cultivationBonus: 0,
    casualtyReduction: 0.02,
    yieldBonus: 0,
    desertBelow: 20,
    loyaltyFloor: 0,
    decayMult: 1.2,
    gainMult: 1,
    demonMult: 1.3,
    demonGuard: 0,
    allyDeathMult: 1,
    sectDefense: 0.06,
    refuseHighRisk: false,
    desc: '见血就兴奋。自己伤亡 −2%、宗门防御 +6，但心魔涨得快 30%。',
  },
  {
    id: 'greedy',
    name: '贪利',
    icon: '💰',
    cultivationBonus: 0,
    casualtyReduction: 0,
    yieldBonus: 0.04,
    desertBelow: 40,
    loyaltyFloor: 0,
    decayMult: 2,
    gainMult: 1,
    demonMult: 1.2,
    demonGuard: 0,
    allyDeathMult: 1,
    sectDefense: 0,
    refuseHighRisk: false,
    desc: '无利不起早。队伍秘境产出 +4%，但忠诚掉得快一倍，且忠诚 < 40 就可能带着材料叛逃。',
  },
  {
    id: 'serene',
    name: '恬淡',
    icon: '🍃',
    cultivationBonus: 0.02,
    casualtyReduction: 0,
    yieldBonus: 0,
    desertBelow: 0,
    loyaltyFloor: 20,
    decayMult: 0.5,
    gainMult: 1,
    demonMult: 0.2,
    demonGuard: 0.15,
    allyDeathMult: 1,
    sectDefense: 0,
    refuseHighRisk: true,
    desc: '不争不抢，只爱清静。修炼 +2%、几乎不生心魔、忠诚锁死 20；**拒绝高风险秘境**。',
  },
  {
    id: 'proud',
    name: '孤傲',
    icon: '🦅',
    cultivationBonus: 0.03,
    casualtyReduction: 0,
    yieldBonus: 0,
    desertBelow: 20,
    loyaltyFloor: 0,
    decayMult: 1.3,
    gainMult: 0.5,
    demonGuard: -0.1,
    demonMult: 1.1,
    allyDeathMult: 1,
    sectDefense: 0,
    refuseHighRisk: false,
    desc: '不肯低头。修炼 +3%，但赏赐只涨一半忠诚、衰减快 30%，心魔也更容易缠身。',
  },
  {
    id: 'renyi',
    name: '重义',
    icon: '🤝',
    cultivationBonus: 0,
    casualtyReduction: 0,
    yieldBonus: 0,
    desertBelow: 15,
    loyaltyFloor: 0,
    decayMult: 1,
    gainMult: 2,
    demonGuard: 0,
    demonMult: 1,
    allyDeathMult: 2,
    sectDefense: 0,
    refuseHighRisk: false,
    desc: '恩义看得比命重。赏赐带来的忠诚翻倍，但同门陨落时忠诚也跌得双倍。',
  },
];

export const PERSONALITY_MAP: Record<PersonalityId, PersonalityDef> = PERSONALITIES.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<PersonalityId, PersonalityDef>,
);

export const PERSONALITY_IDS: PersonalityId[] = PERSONALITIES.map((p) => p.id);

/* ------------------------------------------------------------------ */
/* 忠诚度                                                              */
/* ------------------------------------------------------------------ */

export const LOYALTY_MIN = 0;
export const LOYALTY_MAX = 100;
/** 天纵弟子的忠诚下限（设定集第 8.6 章） */
export const LOYALTY_FLOOR_HEAVEN = 30;

export interface LoyaltyTierDef {
  /** 该档的下限（含） */
  min: number;
  name: string;
  /** 自己受到的伤亡率削减 */
  casualtyReduction: number;
  /** 修炼速度加成（负数即离心拖慢修行） */
  cultivationBonus: number;
  /** 心魔增长倍率 */
  demonMult: number;
  /** 是否永不叛逃 */
  neverDesert: boolean;
}

/** 从高到低排列，取第一个满足 min 的档 */
export const LOYALTY_TIERS: LoyaltyTierDef[] = [
  { min: 90, name: '死忠', casualtyReduction: 0.02, cultivationBonus: 0.05, demonMult: 0.8, neverDesert: true },
  { min: 70, name: '忠心', casualtyReduction: 0, cultivationBonus: 0.02, demonMult: 1, neverDesert: false },
  { min: 40, name: '寻常', casualtyReduction: 0, cultivationBonus: 0, demonMult: 1, neverDesert: false },
  { min: 20, name: '离心', casualtyReduction: 0, cultivationBonus: -0.05, demonMult: 1.2, neverDesert: false },
  { min: 0, name: '叛离', casualtyReduction: 0, cultivationBonus: -0.12, demonMult: 1.5, neverDesert: false },
];

export function loyaltyTierOf(loyalty: number): LoyaltyTierDef {
  for (const tier of LOYALTY_TIERS) {
    if (loyalty >= tier.min) return tier;
  }
  return LOYALTY_TIERS[LOYALTY_TIERS.length - 1];
}

/** 按资质决定的初始忠诚度区间（设定集第 8.6 章） */
export const LOYALTY_INITIAL: Record<AptitudeId, [number, number]> = {
  mortal: [60, 75],
  low: [65, 80],
  mid: [70, 85],
  high: [75, 90],
  excellent: [80, 95],
  heaven: [85, 95],
};

/** 秘境圆满归来：忠诚 +（这是唯一稳定的正向来源） */
export const LOYALTY_GAIN_EXPEDITION = 3;
/** 同小队弟子陨落 */
export const LOYALTY_LOSS_ALLY_DEATH = 5;
/** 指派高危秘境（基础伤亡 ≥ 这个值的档次）时的不满 */
export const LOYALTY_LOSS_HIGH_RISK = 4;
/** 判定"高危"的伤亡率门槛 */
export const HIGH_RISK_CASUALTY = 0.3;
/**
 * 闲置多久掉 1 点忠诚（真实秒）。
 *
 * ⚠️ 这个数**曾经是 900（15 分钟）**，实测直接把整个宗门拖垮：
 * 千人宗门里九成弟子一辈子轮不到一次派遣，于是"闲置"才是常态，
 * 30 天下来每人掉 2900 点 —— 全宗清一色落到各自的下限（叛离 239 人）。
 * 那不是在表达"冷落弟子"，那是在说"这个字段永远是最低值"。
 * 现在改成 **2 小时 1 点**：一天纯挂机掉 12 点，一周左右摸到闲置地板，
 * 而一次圆满归来 +3 —— 只要还在用这个人，就不会掉下去。
 */
export const LOYALTY_IDLE_DECAY_SECONDS = 7200;
/** 每次闲置判定掉多少 */
export const LOYALTY_IDLE_DECAY = 1;
/**
 * 闲置掉忠诚的**地板**（45 = 寻常档下沿）。
 *
 * 这是本轮最重要的一处修正：光靠"被冷落"不该掉到离心与叛离。
 * 闲置只把人磨到"寻常"，再往下必须真的发生事情 ——
 * 同门陨落（−5）、被派去极危之地（−4）、贪利的双倍衰减。
 * 这样界面上出现"离心"才是有信息量的：**这个人身上出过事**，
 * 而不是"我有一千个人，所以一千个人都离心"。
 */
export const LOYALTY_NEGLECT_FLOOR = 45;
/** 叛逃判定：低于阈值的弟子在每次探索结算时的叛逃概率 */
export const DESERT_CHANCE = 0.05;
/**
 * 叛逃时按这个比例卷走仓库里的**每一味**材料。
 *
 * ⚠️ 只有**贪利**性格会卷东西（见 `disciples.rollDesertion` 的 `greedy` 判定），
 * 与资质、境界、天赋都无关 —— 这条注释原来写的是"天纵弟子会带走多少"，
 * 与实现不符（天纵只是忠诚下限高，不代表会偷东西）。
 * 比例取 1%：它是一次真实的损失，但不至于让一次叛逃抹掉半座仓库。
 */
export const DESERT_LOOT_RATIO = 0.01;

/* ------------------------------------------------------------------ */
/* 心魔                                                                */
/* ------------------------------------------------------------------ */

export const DEMON_MIN = 0;
export const DEMON_MAX = 100;

export interface DemonTierDef {
  min: number;
  name: string;
  /** 修炼速度倍率 */
  cultivationMult: number;
  /** 是否会拒绝派遣（不参与探索） */
  refuseTask: boolean;
}
/*
 * ⚠️ 这里原本还有一个 `breakthroughPenalty`（"心魔高了突破失败概率上升"）。
 * 它被**删掉**了，因为本作的弟子突破不掷骰 —— `tickDisciples` 攒满修为就破境，
 * 唯一门槛是那颗境界丹。于是那条字段永远读不到，属于"声明了却没人用"。
 * 设定集那句话在本作用**修行速度下降**来表达：修得慢，破境自然就晚。
 */

export const DEMON_TIERS: DemonTierDef[] = [
  { min: 86, name: '心魔深重', cultivationMult: 0.75, refuseTask: true },
  { min: 61, name: '心魔滋长', cultivationMult: 0.9, refuseTask: true },
  { min: 31, name: '心神躁动', cultivationMult: 0.96, refuseTask: false },
  { min: 0, name: '心神稳固', cultivationMult: 1, refuseTask: false },
];

export function demonTierOf(demon: number): DemonTierDef {
  for (const tier of DEMON_TIERS) {
    if (demon >= tier.min) return tier;
  }
  return DEMON_TIERS[DEMON_TIERS.length - 1];
}

/** 同门陨落：心神受创 */
export const DEMON_PER_ALLY_DEATH = 1.5;
/** 平安归来：心神稍定 */
export const DEMON_RELIEF_PER_EXPEDITION = 0.6;
/** 自己破境成功：心病自消一分 */
export const DEMON_RELIEF_PER_BREAKTHROUGH = 3;
/** 论道大比：全宗静心 */
export const DEMON_RELIEF_ARENA = 5;
/** 清心丹：一次压下去的量 */
export const DEMON_RELIEF_PILL = 15;

/** 炼丹成功率 / 炼器成功率的种田天赋加成用哪个 target */
export const FARM_TALENT_TARGET_ALCHEMY = 'alchemyRate' as const;
export const FARM_TALENT_TARGET_REFINING = 'refiningRate' as const;

/** 资质 → 该资质的忠诚下限（天纵特殊，见 LOYALTY_FLOOR_HEAVEN） */
export function loyaltyFloorOf(aptitude: AptitudeId, personality: PersonalityDef): number {
  const byAptitude = aptitude === 'heaven' ? LOYALTY_FLOOR_HEAVEN : 0;
  // 两种下限取较高的那个：天纵 30、守道/恬淡 20
  return Math.max(byAptitude, personality.loyaltyFloor);
}

/** 资质序号（用于界面与测试里排序） */
export function aptitudeIndexOf(aptitude: AptitudeId): number {
  return APTITUDE_ORDER.indexOf(aptitude);
}
