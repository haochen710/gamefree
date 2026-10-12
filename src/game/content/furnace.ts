/**
 * 丹炉与鼎：九件（设定集第 11 章「丹器」）
 *
 * 设定集给的是一条**炼制装备**的进阶线：从粗陶药炉到太初鸿蒙鼎，
 * 越好的炉子炼丹成功率越高、越省时间。
 *
 * ## 落地取舍（重要）
 *
 * 设定集在这条线上同时提了「炼制耗时」与「炼制队列」。本作**没有**引入它们，
 * 理由是这一条会改动核心循环本身：
 *
 *   - 现在炼丹炼器是**瞬时**的（点一下就成，失败就亏材料）。整条产线
 *     （自动合成、丹药喂弟子突破、模拟器的 AI 决策）都建立在这个前提上；
 *   - 一旦炼制变成"排 30 秒队"，玩家离线时的行为、弟子突破的丹药供给、
 *     以及"缺丹卡瓶颈"的节奏全部要重算 —— 而它的收益只是"多一个等待条"。
 *
 * 所以九件炉鼎的差异被落在**三件立刻能感觉到的事**上：
 *   1. `alchemyBonus` / `refiningBonus`：成功率（与原「丹炉阵」同一条加算线）；
 *   2. `batchBonus`：一次炼制多出一件的概率（"好炉子出丹多"）；
 *   3. `refineSpeedBonus`：**自动合成**的速度（那是本作唯一带"速度"的炼制环节，
 *      因此"省时间"这条设定在这里有一个诚实的落点，而不是无处安放）。
 */
import type { ItemId } from './resources';

export interface FurnaceDef {
  id: string;
  name: string;
  icon: string;
  /** 一品~九品（与丹器九品制一致） */
  grade: number;
  desc: string;
  /** 炼丹成功率加成 */
  alchemyBonus: number;
  /** 炼器成功率加成 */
  refiningBonus: number;
  /** 一次炼制多出一件的概率 */
  batchBonus: number;
  /** 自动合成的速度加成 */
  refineSpeedBonus: number;
  /** 解锁（获得）这件炉鼎的花费 */
  cost: Partial<Record<ItemId, number>>;
  /** 需要的炼丹与炼器品阶（炉子不能比手艺高太多） */
  requiresAlchemyTier: number;
  requiresRefiningTier: number;
}

/**
 * 九件炉鼎（设定集第 11 章的九件，本作按品阶一一对应）。
 *
 * 数值刻意**单调但收敛**：九件之间的成功率差总共约 20 个百分点，
 * 因为成功率已经有一条"相差三品必成"的硬规则（需求 2），
 * 炉鼎如果再给一大截，那条规则就会变成摆设。
 */
export const FURNACES: FurnaceDef[] = [
  {
    id: 'clayStove',
    name: '粗陶药炉',
    icon: '🏺',
    grade: 1,
    desc: '一口粗陶炉子，山野药农也用得起。炼丹 +2%、炼器 +1%。',
    alchemyBonus: 0.02,
    refiningBonus: 0.01,
    batchBonus: 0,
    refineSpeedBonus: 0,
    cost: { qi: 5e3, wood: 600, stone: 300 },
    requiresAlchemyTier: 1,
    requiresRefiningTier: 1,
  },
  {
    id: 'bronzeCauldron',
    name: '青铜丹鼎',
    icon: '🥉',
    grade: 2,
    desc: '青铜铸的三足鼎，火候比陶炉稳得多。炼丹 +4%、炼器 +2%。',
    alchemyBonus: 0.04,
    refiningBonus: 0.02,
    batchBonus: 0.02,
    refineSpeedBonus: 0.05,
    cost: { qi: 4e4, ore: 3000, blackIron: 40 },
    requiresAlchemyTier: 2,
    requiresRefiningTier: 2,
  },
  {
    id: 'spiritJadeCauldron',
    name: '灵玉丹炉',
    icon: '🔮',
    grade: 3,
    desc: '整块灵玉掏空而成，不沾凡火。炼丹 +6%、炼器 +3%，自动合成 +10%。',
    alchemyBonus: 0.06,
    refiningBonus: 0.03,
    batchBonus: 0.03,
    refineSpeedBonus: 0.1,
    cost: { qi: 3e5, ore: 2e4, moonDew: 30, demonCore: 200 },
    requiresAlchemyTier: 3,
    requiresRefiningTier: 3,
  },
  {
    id: 'earthFireCauldron',
    name: '地火熔鼎',
    icon: '🔥',
    grade: 4,
    desc: '引地脉之火入鼎，昼夜不熄。炼丹 +8%、炼器 +5%，出丹多一件的概率 +5%。',
    alchemyBonus: 0.08,
    refiningBonus: 0.05,
    batchBonus: 0.05,
    refineSpeedBonus: 0.15,
    cost: { qi: 2e6, ore: 1e5, fireMarrow: 60, starSand: 40 },
    requiresAlchemyTier: 4,
    requiresRefiningTier: 4,
  },
  {
    id: 'starIronCauldron',
    name: '星辰铁鼎',
    icon: '🌟',
    grade: 5,
    desc: '以天外陨铁铸成，星力自引。炼丹 +10%、炼器 +6%，出丹多一件的概率 +7%。',
    alchemyBonus: 0.1,
    refiningBonus: 0.06,
    batchBonus: 0.07,
    refineSpeedBonus: 0.2,
    cost: { qi: 2e7, ore: 5e5, starSand: 200, lunarCrystal: 80 },
    requiresAlchemyTier: 5,
    requiresRefiningTier: 5,
  },
  {
    id: 'netherFlameFurnace',
    name: '九幽魂炉',
    icon: '💀',
    grade: 6,
    desc: '炉中养着一缕九幽魂火。炼丹 +12%、炼器 +7%，出丹多一件的概率 +9%。',
    alchemyBonus: 0.12,
    refiningBonus: 0.07,
    batchBonus: 0.09,
    refineSpeedBonus: 0.25,
    cost: { qi: 2e8, ore: 2e6, netherFlame: 120, dragonBlood: 60 },
    requiresAlchemyTier: 6,
    requiresRefiningTier: 6,
  },
  {
    id: 'dragonBloodCauldron',
    name: '真龙血鼎',
    icon: '🐉',
    grade: 7,
    desc: '以真龙之血淬炼的鼎，炉火带龙威。炼丹 +14%、炼器 +8%，出丹多一件的概率 +11%。',
    alchemyBonus: 0.14,
    refiningBonus: 0.08,
    batchBonus: 0.11,
    refineSpeedBonus: 0.3,
    cost: { qi: 2e9, ore: 1e7, dragonBlood: 300, immortalJade: 30 },
    requiresAlchemyTier: 7,
    requiresRefiningTier: 7,
  },
  {
    id: 'chaosCauldron',
    name: '鸿蒙混沌鼎',
    icon: '🌀',
    grade: 8,
    desc: '鼎中自成一界混沌。炼丹 +16%、炼器 +9%，出丹多一件的概率 +13%。',
    alchemyBonus: 0.16,
    refiningBonus: 0.09,
    batchBonus: 0.13,
    refineSpeedBonus: 0.35,
    cost: { qi: 2e10, ore: 5e7, chaosQi: 40, immortalJade: 120 },
    requiresAlchemyTier: 8,
    requiresRefiningTier: 8,
  },
  {
    id: 'primordialCauldron',
    name: '太初鸿蒙鼎',
    icon: '☯',
    grade: 9,
    desc: '传说开天辟地时的第一口鼎。炼丹 +20%、炼器 +12%，出丹多一件的概率 +15%。',
    alchemyBonus: 0.2,
    refiningBonus: 0.12,
    batchBonus: 0.15,
    refineSpeedBonus: 0.4,
    cost: { qi: 2e11, ore: 2e8, primordialFruit: 5, chaosQi: 150, immortalJade: 500 },
    requiresAlchemyTier: 9,
    requiresRefiningTier: 9,
  },
];

export const FURNACE_MAP: Record<string, FurnaceDef> = FURNACES.reduce(
  (acc, f) => {
    acc[f.id] = f;
    return acc;
  },
  {} as Record<string, FurnaceDef>,
);

/** 开局默认那口炉子（不花资源，也不占"已获得"列表 —— 它是白送的底线） */
export const DEFAULT_FURNACE_ID = 'clayStove';

/* ------------------------------------------------------------------ */
/* 弟子装备栏（设定集第 8.7 章：五栏）                                   */
/* ------------------------------------------------------------------ */

/** 五个栏位：增益 / 进攻 / 防御 / 丹药 ×2 */
export type GearSlot = 'gain' | 'attack' | 'defense' | 'pill1' | 'pill2';

export const GEAR_SLOTS: GearSlot[] = ['gain', 'attack', 'defense', 'pill1', 'pill2'];

export const GEAR_SLOT_NAMES: Record<GearSlot, string> = {
  gain: '增益栏',
  attack: '进攻栏',
  defense: '防御栏',
  pill1: '丹药栏·一',
  pill2: '丹药栏·二',
};

/** 装备的大类（决定它能进哪个栏位） */
export type GearKind = 'gain' | 'attack' | 'defense' | 'pill';

export interface GearDef {
  id: string;
  name: string;
  icon: string;
  kind: GearKind;
  /** 品阶 1~5（凡/良/上/极/天纵），与功法同一套口径 */
  grade: 1 | 2 | 3 | 4 | 5;
  desc: string;
  /** 需要弟子达到的境界下标 */
  minRealm: number;
  /* ---- 效果（每一条都注明读取点） ---- */
  /** 弟子战力加成（加算进 getPartyPower） */
  power: number;
  /** 该弟子秘境伤亡削减 */
  casualtyReduction: number;
  /** 弟子修行速度加算 */
  cultivationBonus: number;
  /** 出战时一次性提供的队伍安全加成（丹药栏） */
  safety: number;
  /** 获得这件装备的花费（在「工坊」页炼制） */
  cost: Partial<Record<ItemId, number>>;
}

/**
 * 装备清单：三个"栏位大类"各三档，加上丹药两类共 11 件。
 *
 * 为什么不直接复用已有的**器物**（artifacts）？
 * 因为器物是**掌门/全宗**层面、按次数消耗的一次性道具（`carry`），
 * 而弟子装备是**挂在人身上、长期生效、可拆卸**的东西。两者的生命周期
 * 完全不同，硬合成一个系统只会让两边的规则互相污染。
 */
export const GEARS: GearDef[] = [
  /* ---- 增益栏（修行 / 心得） ---- */
  {
    id: 'jadePendant',
    name: '凝神玉佩',
    icon: '🪬',
    kind: 'gain',
    grade: 1,
    minRealm: 0,
    desc: '静心凝神的玉佩。修行速度 +4%。',
    power: 0,
    casualtyReduction: 0,
    cultivationBonus: 0.04,
    safety: 0,
    cost: { qi: 2e4, herb: 2000, moonDew: 5 },
  },
  {
    id: 'spiritCrown',
    name: '聚灵冠',
    icon: '👑',
    kind: 'gain',
    grade: 3,
    minRealm: 2,
    /* 文案原本还写着「心得获取 +10%」—— GearDef 里没有这个字段，
       装备也不参与心得结算（心得加成全在建筑那一侧）。如实删掉。 */
    desc: '聚拢灵气的头冠。修行速度 +9%。',
    power: 0,
    casualtyReduction: 0,
    cultivationBonus: 0.09,
    safety: 0,
    cost: { qi: 6e5, herb: 4e4, starSand: 40, spiritSilk: 200 },
  },
  {
    id: 'daoSeal',
    name: '悟道印',
    icon: '🔱',
    kind: 'gain',
    grade: 5,
    minRealm: 4,
    desc: '一方刻着道纹的古印。修行速度 +16%。',
    power: 0,
    casualtyReduction: 0,
    cultivationBonus: 0.16,
    safety: 0,
    cost: { qi: 4e8, immortalJade: 40, chaosQi: 10, primordialFruit: 1 },
  },

  /* ---- 进攻栏（战力 / 产出） ---- */
  {
    id: 'ironSword',
    name: '玄铁剑',
    icon: '🗡',
    kind: 'attack',
    grade: 1,
    minRealm: 0,
    desc: '一柄普通的玄铁剑。战力 +6。',
    power: 6,
    casualtyReduction: 0,
    cultivationBonus: 0,
    safety: 0,
    cost: { qi: 1.5e4, ore: 1500, blackIron: 30 },
  },
  {
    id: 'talismanBlade',
    name: '符箓飞刃',
    icon: '⚔',
    kind: 'attack',
    grade: 3,
    minRealm: 2,
    desc: '一叠自走飞刃。战力 +30，自己伤亡 −2%。',
    power: 30,
    casualtyReduction: 0.02,
    cultivationBonus: 0,
    safety: 0,
    cost: { qi: 5e5, ore: 3e4, starSand: 30, spiritSilk: 150 },
  },
  {
    id: 'immortalTreasure',
    name: '仙家重宝',
    icon: '💠',
    kind: 'attack',
    grade: 5,
    minRealm: 4,
    desc: '一件来路不明的仙家重宝。战力 +160，自己伤亡 −4%。',
    power: 160,
    casualtyReduction: 0.04,
    cultivationBonus: 0,
    safety: 0,
    cost: { qi: 3e8, immortalJade: 30, dragonBlood: 80, chaosQi: 8 },
  },

  /* ---- 防御栏（伤亡削减） ---- */
  {
    id: 'hideArmor',
    name: '妖兽皮甲',
    icon: '🛡',
    kind: 'defense',
    grade: 1,
    minRealm: 0,
    desc: '妖皮缝制的护甲。伤亡 −3%。',
    power: 0,
    casualtyReduction: 0.03,
    cultivationBonus: 0,
    safety: 0,
    cost: { qi: 1.2e4, ore: 1200, demonCore: 40 },
  },
  {
    id: 'spiritRobe',
    name: '灵蚕宝衣',
    icon: '🥋',
    kind: 'defense',
    grade: 3,
    minRealm: 2,
    desc: '灵蚕丝织成的宝衣。伤亡 −5%，战力 +12。',
    power: 12,
    casualtyReduction: 0.05,
    cultivationBonus: 0,
    safety: 0,
    cost: { qi: 4e5, ore: 2e4, spiritSilk: 300, coldJade: 40 },
  },
  {
    id: 'starArmor',
    name: '星穹法衣',
    icon: '🌌',
    kind: 'defense',
    grade: 5,
    minRealm: 4,
    desc: '以星砂织成的法衣。伤亡 −9%，战力 +50。',
    power: 50,
    casualtyReduction: 0.09,
    cultivationBonus: 0,
    safety: 0,
    cost: { qi: 2.5e8, immortalJade: 25, starSand: 300, lunarCrystal: 120 },
  },

  /* ---- 丹药栏（出战一次性护命） ---- */
  {
    id: 'safetyPill',
    name: '保命丹',
    icon: '💊',
    kind: 'pill',
    grade: 1,
    minRealm: 0,
    desc: '出战时自动服下：全队伤亡 −4%（一次性）。',
    power: 0,
    casualtyReduction: 0,
    cultivationBonus: 0,
    safety: 0.04,
    cost: { qi: 8e3, herb: 800, demonCore: 20 },
  },
  {
    id: 'bloodPill',
    name: '返魂丹',
    icon: '❤️',
    kind: 'pill',
    grade: 3,
    minRealm: 2,
    desc: '出战时自动服下：全队伤亡 −8%（一次性）。',
    power: 0,
    casualtyReduction: 0,
    cultivationBonus: 0,
    safety: 0.08,
    cost: { qi: 3e5, herb: 3e4, dragonBlood: 20, moonDew: 40 },
  },
];

export const GEAR_MAP: Record<string, GearDef> = GEARS.reduce(
  (acc, g) => {
    acc[g.id] = g;
    return acc;
  },
  {} as Record<string, GearDef>,
);

/** 某个大类能进哪些栏位 */
export function slotsForKind(kind: GearKind): GearSlot[] {
  if (kind === 'pill') return ['pill1', 'pill2'];
  return [kind];
}

/** 界面上的一栏里放什么（用于展示与校验共用一份判断） */
export function slotAccepts(slot: GearSlot, kind: GearKind): boolean {
  if (slot === 'pill1' || slot === 'pill2') return kind === 'pill';
  return slot === kind;
}

/**
 * 弟子陨落时装备的回收率（与功法的 60% 对齐）。
 *
 * 原本**没有**这一条：功法会回收、装备直接消失 —— 于是实测终盘是
 * "累计发出 1774 件、库存 0 件"。不对称本身不是错，但既然功法能捡回来，
 * 装备（同样是随身之物）一起捡回来更符合直觉，也让"炼装备"这件事
 * 不至于变成填不满的坑。设定集没写这一条，所以这里是**本作自己的决定**。
 */
export const GEAR_SALVAGE_RATE = 0.6;

export const GEAR_GRADE_NAMES: Record<number, string> = {
  1: '凡品',
  2: '良品',
  3: '上品',
  4: '极品',
  5: '天纵',
};
