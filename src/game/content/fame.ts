/**
 * 声望与山门先天特质（设定集第 9 章「声望」/ 第 1 章「开局」）
 *
 * ## 声望
 *
 * 0~10000 的一条**外部评价线**：它不涨修为、不涨产出，涨的是"别人怎么看你"，
 * 而这份看法换来两样东西 —— **五大段位的名头**与**声望商店**里的东西。
 *
 * 为什么要有它：本作到中期会出现一个"什么都不缺、只是慢"的阶段。声望
 * 把"去难的地方、打该打的仗、做善事"变成了看得见的收益，而不是只体现在
 * 材料栏里多几个数字。
 *
 * ## 先天特质
 *
 * 开局三选一，是本作唯一一处**永久且不可更改**的选择（其余所有系统都能反悔）——
 * 因为一局游戏需要有一件"我这一把走哪条路"的事。完成任一周目结局后
 * 再解锁三种"传承特质"，让重开有理由。
 */
import type { ItemId } from './resources';

/* ------------------------------------------------------------------ */
/* 声望                                                                */
/* ------------------------------------------------------------------ */

export const FAME_MAX = 10000;

export interface FameTierDef {
  id: string;
  /** 达到该段位所需声望 */
  min: number;
  name: string;
  icon: string;
  desc: string;
  /** 招收弟子的花费折扣（0.1 = −10%） */
  recruitDiscount: number;
  /** 商行买入折扣 */
  shopDiscount: number;
}

/**
 * 五档段位（设定集：无名小卒 → 小有名气 → 一方豪强 → 名震天下 → 威震仙域）。
 *
 * 段位不是纯称号：招人与商行两处给折扣，因为"名气"在修仙界最直接的
 * 兑现方式就是"别人愿意给你便宜"。折扣刻意都压在 10% 以内 ——
 * 它是一条顺手的奖励，不该变成第二个经济系统。
 */
export const FAME_TIERS: FameTierDef[] = [
  {
    id: 'nobody',
    min: 0,
    name: '无名小卒',
    icon: '·',
    desc: '山门外无人知晓。',
    recruitDiscount: 0,
    shopDiscount: 0,
  },
  {
    id: 'known',
    min: 1000,
    name: '小有名气',
    icon: '◦',
    desc: '方圆千里偶尔有人提起你的道号。招收弟子 −5%，商行 −3%。',
    recruitDiscount: 0.05,
    shopDiscount: 0.03,
  },
  {
    id: 'power',
    min: 3000,
    name: '一方豪强',
    icon: '◌',
    desc: '一州之地，无人敢轻慢。招收弟子 −10%，商行 −6%。',
    recruitDiscount: 0.1,
    shopDiscount: 0.06,
  },
  {
    id: 'world',
    min: 6000,
    name: '名震天下',
    icon: '○',
    desc: '仙域各宗皆闻其名。招收弟子 −15%，商行 −9%。',
    recruitDiscount: 0.15,
    shopDiscount: 0.09,
  },
  {
    id: 'domain',
    min: 9000,
    name: '威震仙域',
    icon: '◉',
    desc: '一言可动仙域风云。招收弟子 −20%，商行 −12%。',
    recruitDiscount: 0.2,
    shopDiscount: 0.12,
  },
];

export const FAME_TIER_MAP: Record<string, FameTierDef> = FAME_TIERS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, FameTierDef>,
);

/** 声望来源（设定集第 9 章：探索 / 大战 / 善行 / 大比） */
export const FAME_PER_REALM_TIER = 4; // × 秘境档次
export const FAME_PER_SURVEY = 1;
export const FAME_PER_BATTLE_WIN = 120;
export const FAME_PER_BATTLE_LOSS = -30;
export const FAME_PER_ARENA = 15;
export const FAME_PER_KARMA_POINT = 2;
/** 单次结算的声望变动上限（防止极端事件一次顶到满级） */
export const FAME_GAIN_CAP = 400;

/** 收徒 / 商行的段位折扣 */
export const FAME_RECRUIT_DISCOUNT_MAX = 0.2;

/* ------------------------------------------------------------------ */
/* 声望商店                                                            */
/* ------------------------------------------------------------------ */

export const FAME_SHOP_REFRESH_SECONDS = 600;
export const FAME_SHOP_SLOTS = 4;

export type FameGoodKind = 'fragment' | 'material' | 'manual';

export interface FameGoodDef {
  id: string;
  kind: FameGoodKind;
  name: string;
  icon: string;
  desc: string;
  /** 兑换所需声望 */
  price: number;
  /** 数量 */
  amount: number;
  /** 只在这些段位以上出现（按 id） */
  minTier?: string;
  /** 抽中权重 */
  weight: number;
  /** kind 为 fragment / manual 时的功法 id */
  manualId?: string;
  /** kind 为 material 时的材料 id */
  materialId?: ItemId;
}

/**
 * 声望商店的货架。
 *
 * 这里卖三样东西，各自对应一个"后期缺什么"的答案：
 *   - **功法碎片 / 整本功法**：功法那条线最缺的就是碎片；
 *   - **稀有材料**：深秘境才出的东西（星辰砂 / 太阴玄晶 / 仙玉）；
 *   - **丹药**：直接给成品，省掉排队炼制的现实时间。
 *
 * ⚠️ 价格刻意从"一次探索的声望收益"（约 20~40）往上推：
 * 一档货 = 几趟秘境，所以它是"攒一攒就能换"的东西，而不是摆设。
 */
export const FAME_GOODS: FameGoodDef[] = [
  {
    id: 'fameFragmentCommon',
    kind: 'fragment',
    name: '凡品功法碎片',
    icon: '📜',
    desc: '随机一本凡品功法的碎片 ×2。',
    price: 60,
    amount: 2,
    weight: 10,
  },
  {
    id: 'fameFragmentFine',
    kind: 'fragment',
    name: '良品功法碎片',
    icon: '📘',
    desc: '随机一本良品功法的碎片 ×2。',
    price: 140,
    amount: 2,
    weight: 8,
  },
  {
    id: 'fameFragmentRare',
    kind: 'fragment',
    name: '上品功法碎片',
    icon: '📗',
    desc: '随机一册上品功法的碎片 ×2。',
    price: 320,
    amount: 2,
    minTier: 'known',
    weight: 6,
  },
  {
    id: 'fameFragmentEpic',
    kind: 'fragment',
    name: '极品功法碎片',
    icon: '📙',
    desc: '随机一册极品功法的碎片 ×2。',
    price: 700,
    amount: 2,
    minTier: 'power',
    weight: 4,
  },
  {
    id: 'fameMaterialStarSand',
    kind: 'material',
    name: '星辰砂',
    icon: '✨',
    desc: '来自天外陨铁的细砂，高阶丹药与器物都要用。',
    price: 120,
    amount: 20,
    materialId: 'starSand',
    weight: 8,
  },
  {
    id: 'fameMaterialLunarCrystal',
    kind: 'material',
    name: '太阴玄晶',
    icon: '🌙',
    desc: '月华凝成的晶石，寒属性器物的主料。',
    price: 260,
    amount: 10,
    materialId: 'lunarCrystal',
    minTier: 'known',
    weight: 6,
  },
  {
    id: 'fameMaterialImmortalJade',
    kind: 'material',
    name: '仙玉',
    icon: '💎',
    desc: '仙域通用的硬通货，后期的门槛材料。',
    price: 600,
    amount: 5,
    materialId: 'immortalJade',
    minTier: 'power',
    weight: 5,
  },
  {
    id: 'fameMaterialPrimordial',
    kind: 'material',
    name: '鸿蒙道果',
    icon: '🍇',
    desc: '传说中开天辟地时留下的果子，九品丹药的钥匙。',
    price: 1800,
    amount: 1,
    materialId: 'primordialFruit',
    minTier: 'world',
    weight: 2,
  },
];

export const FAME_GOOD_MAP: Record<string, FameGoodDef> = FAME_GOODS.reduce(
  (acc, g) => {
    acc[g.id] = g;
    return acc;
  },
  {} as Record<string, FameGoodDef>,
);

/* ------------------------------------------------------------------ */
/* 山门先天特质                                                        */
/* ------------------------------------------------------------------ */

/**
 * 先天特质的**机器可读**效果表。
 *
 * ⚠️ 为什么要把它做成字段，而不是只写在 `desc` 里：
 * 本作已经栽过六次"界面写着 +5、代码里没人读"的跟头。把数值放进
 * `effects` 之后，**聚合函数只有一个来源**（`engine.getTraitEffect`），
 * 界面与逻辑读的是同一张表，不可能再各说各话。
 */
export interface TraitEffects {
  /** 灵气产出乘数（读取点：engine.getProduction） */
  qiMult?: number;
  /** 灵草产出乘数（engine.getProduction） */
  herbMult?: number;
  /** 灵植成熟时间乘数（planting.plantSeed，>1 表示更快） */
  plantingSpeedMult?: number;
  /** 功法碎片掉落概率乘数（manuals.rollFragmentDrop） */
  fragmentMult?: number;
  /** 宗门防御加算（encounter.getSectDefense） */
  sectDefense?: number;
  /** 弟子伤亡率乘数（expeditions.resolveExpedition） */
  casualtyMult?: number;
  /** 商行买入乘数（shop.getOfferPrice） */
  shopBuyMult?: number;
  /** 掌门突破成功率加算（engine.getSuccessRate） */
  breakthroughBonus?: number;
  /** 弟子修行速度的加算项（disciples.getDiscipleSpeed） */
  cultivationBonus?: number;
  /** 新弟子资质上偏一档（disciples.rollDisciple） */
  aptitudeUp?: boolean;
  /** 炼丹成功率加算（crafting.getCraftSuccessRate） */
  alchemyBonus?: number;
  /** 炼丹双倍产出概率（crafting.craftPill） */
  alchemyDoubleChance?: number;
}

export interface TraitDef {
  id: string;
  name: string;
  icon: string;
  /** 一句话说清它给什么 */
  desc: string;
  /** 详细的数值解释（界面 tooltip） */
  detail: string;
  /** 需要先通关一次才解锁（值为解锁说明） */
  legacy?: string;
  /** 机器可读的效果（见 TraitEffects 的注释：这是唯一的数值来源） */
  effects: TraitEffects;
}

/**
 * 九个先天特质：六个开局可选，三个是"通关过一次之后才能选"的传承特质。
 *
 * 每一条都在 `effects` 里写明数值，而 `engine.getTraitEffect` 是唯一的读取口。
 */
export const TRAITS: TraitDef[] = [
  {
    id: 'spiritVein',
    name: '灵脉福地',
    icon: '⛰',
    desc: '山门下有一条灵脉。灵气产出 +25%。',
    detail: '灵气产出 ×1.25',
    effects: { qiMult: 1.25 },
  },
  {
    id: 'herbGarden',
    name: '药圃天成',
    icon: '🌿',
    desc: '后山有一片野生药圃。灵草产出 +25%，灵植成熟快 10%。',
    detail: '灵草产出 ×1.25 · 灵植成熟时间 ×0.9',
    effects: { herbMult: 1.25, plantingSpeedMult: 1.1 },
  },
  {
    id: 'scriptureVault',
    name: '藏经古阁',
    icon: '📚',
    desc: '前人留下的一座残破藏经阁。功法碎片掉落率 +50%。',
    detail: '秘境 / 探索的碎片掉落概率 ×1.5',
    effects: { fragmentMult: 1.5 },
  },
  {
    id: 'ironArmy',
    name: '铁血军魂',
    icon: '⚔',
    desc: '开山祖师是行伍出身。宗门防御 +0.15，弟子伤亡 −2%。',
    detail: '宗门防御 +0.15 · 弟子伤亡率 ×0.98',
    effects: { sectDefense: 0.15, casualtyMult: 0.98 },
  },
  {
    id: 'merchantRoad',
    name: '商道通达',
    icon: '🪙',
    /*
     * ⚠️ 这一条原本还写着「卖出 +15%」，但**本作的商行只买不卖**
     * （shop.ts 里没有任何出售结算）—— 那个效果即使实现出来也没有读取点。
     * 与其留一个永远不生效的数字，不如把文案改成实话。
     */
    desc: '山门外就是通商要道。商行买入 −15%。',
    detail: '商行买入 ×0.85',
    effects: { shopBuyMult: 0.85 },
  },
  {
    id: 'starGazing',
    name: '星象亲和',
    icon: '🌌',
    desc: '山门正对星穹。掌门突破成功率 +6%，弟子修行 +5%。',
    detail: '掌门突破成功率 +0.06 · 弟子修行速度加算 +0.05',
    effects: { breakthroughBonus: 0.06, cultivationBonus: 0.05 },
  },
  {
    id: 'ancientBlood',
    name: '上古血脉',
    icon: '🩸',
    desc: '祖师身上流着上古大能的血。新弟子的资质整体高一档。',
    detail: '招收弟子的资质抽取向上偏一档',
    legacy: '完成任一周目结局后解锁',
    effects: { aptitudeUp: true },
  },
  {
    id: 'pillFurnace',
    name: '丹鼎天成',
    icon: '⚗',
    desc: '山门地火自燃。炼丹成功率 +12%，丹药产出翻倍概率 +10%。',
    detail: '炼丹成功率 +0.12 · 炼丹产出 ×2 的概率 +0.1',
    legacy: '完成任一周目结局后解锁',
    effects: { alchemyBonus: 0.12, alchemyDoubleChance: 0.1 },
  },
  {
    id: 'eternalSpring',
    name: '万载灵泉',
    icon: '💧',
    desc: '一眼万年不涸的灵泉。灵气产出 +15%，且弟子修行 +8%。',
    detail: '灵气产出 ×1.15 · 弟子修行速度加算 +0.08',
    legacy: '完成任一周目结局后解锁',
    effects: { qiMult: 1.15, cultivationBonus: 0.08 },
  },
];

export const TRAIT_MAP: Record<string, TraitDef> = TRAITS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, TraitDef>,
);

/** 开局给出的候选特质个数（设定集：开局三选一） */
export const TRAIT_OFFER_COUNT = 3;

/* ------------------------------------------------------------------ */
/* 结局（设定集第 10 章）                                              */
/* ------------------------------------------------------------------ */

export type EndingId = 'ascend' | 'dominate' | 'hermit' | 'ruin';

export interface EndingDef {
  id: EndingId;
  name: string;
  icon: string;
  /** 达成条件的一句话说明 */
  condition: string;
  /** 结局文本 */
  text: string;
  /** 周目奖励：下一局开局额外的道韵 */
  daoYunReward: number;
}

/**
 * 四个结局。
 *
 * 前三个是"赢"，第四个是"输" —— 一个只有赢面的游戏是不会有紧张感的，
 * 而"宗门覆灭"必须是玩家自己能看出来正在逼近的（弟子归零 / 声望归零且欠债），
 * 所以它不会突然弹出来，而是在状态栏里一直挂着。
 */
export const ENDINGS: EndingDef[] = [
  {
    id: 'ascend',
    name: '飞升成仙',
    icon: '🌠',
    condition: '掌门修至渡劫圆满，服下飞升丹，破界飞升。',
    text: '你踏碎虚空，回望山门如芥子。弟子们仰头看着那道白光，知道祖师成了传说。',
    daoYunReward: 100,
  },
  {
    id: 'dominate',
    name: '称霸仙域',
    icon: '👑',
    condition: '声望 ≥ 9000（威震仙域），且六大宗门或结盟或臣服。',
    text: '仙域诸宗的名字第一次被写在同一张盟书上，你的道号在最上面。',
    daoYunReward: 150,
  },
  {
    id: 'hermit',
    name: '隐世传承',
    icon: '🍃',
    condition: '宗门品阶 ≥ 八品、声望 ≥ 6000，且从未主动宣战。',
    text: '你封了山门，把万卷功法与弟子名册埋进后山。千年后有人挖到它们，那是另一个故事的开头。',
    daoYunReward: 120,
  },
  {
    id: 'ruin',
    name: '宗门覆灭',
    icon: '🥀',
    condition: '弟子归零，或声望跌至 0 且资源枯竭。',
    text: '山门最后一块匾掉下来的时候，没有人接。',
    daoYunReward: 30,
  },
];

export const ENDING_MAP: Record<EndingId, EndingDef> = ENDINGS.reduce(
  (acc, e) => {
    acc[e.id] = e;
    return acc;
  },
  {} as Record<EndingId, EndingDef>,
);

/** 称霸仙域 / 隐世传承 的声望门槛 */
export const DOMINATE_FAME = 9000;
export const HERMIT_FAME = 6000;
export const HERMIT_SECT_LEVEL = 8;
