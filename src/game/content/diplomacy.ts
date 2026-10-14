/**
 * 外交：六大 NPC 宗门与宗门大战（设定集第 9 章「外交」）
 *
 * 设定集给了六个固定的邻居宗门，各有"特色"与"初始态度"；
 * 关系分五档（敌对 / 冷淡 / 中立 / 友好 / 盟友），靠赠礼、论道、
 * 联姻往上推，靠宣战、劫掠往下掉。
 *
 * 本作的落地取舍（都写在这里，免得日后自己都想不起来为什么）：
 *
 * 1. **不做实时地图进攻**。六大宗门是"关系条 + 一组行动"，而不是
 *    要在世界地图上推兵的关卡 —— 那是另一款游戏。战争在这里表现为
 *    **周期性的"宗门大战"结算**：按双方实力对比掷一次，赢了拿声望与资源，
 *    输了掉弟子与资源。
 * 2. **关系不会自己漂回 0**。放置游戏里"会自然衰减的东西"如果没有
 *    明确的可视化，玩家只会觉得莫名其妙。所以关系只在**事件**里变。
 * 3. **结盟有真实收益**（`ALLIANCE_BONUS`），而不只是"关系好"：
 *    六家全结盟是"称霸仙域"结局的硬条件之一，本身也是一种玩法。
 */
import type { ItemId } from './resources';

/* ------------------------------------------------------------------ */
/* 关系档位                                                            */
/* ------------------------------------------------------------------ */

export interface RelationTierDef {
  min: number;
  name: string;
  /** 该档位能否发起结盟 */
  canAlliance: boolean;
  /** 该档位是否会主动来犯 */
  hostile: boolean;
}

/** 五档关系（从高到低） */
export const RELATION_TIERS: RelationTierDef[] = [
  { min: 60, name: '盟友', canAlliance: true, hostile: false },
  { min: 20, name: '友好', canAlliance: false, hostile: false },
  { min: -20, name: '中立', canAlliance: false, hostile: false },
  { min: -60, name: '冷淡', canAlliance: false, hostile: false },
  { min: -100, name: '敌对', canAlliance: false, hostile: true },
];

export const RELATION_MIN = -100;
export const RELATION_MAX = 100;

/* ------------------------------------------------------------------ */
/* 六大宗门                                                            */
/* ------------------------------------------------------------------ */

export interface NpcSectDef {
  id: string;
  name: string;
  icon: string;
  /** 宗门特色（决定它赠礼回礼与大战产出的偏向） */
  specialty: string;
  desc: string;
  /** 初始关系 */
  initialRelation: number;
  /** 该宗的实力（大战时对面强度的基准，1 = 与本作前期宗门相当） */
  power: number;
  /** 赠礼偏好：给它这些东西，关系涨得更多 */
  favorite: ItemId;
}

export const NPC_SECTS: NpcSectDef[] = [
  {
    id: 'azureCloud',
    name: '青云剑宗',
    icon: '⚔',
    specialty: '剑修',
    desc: '正派魁首，剑修如云。讲规矩，也最看重"面子"。',
    initialRelation: 10,
    power: 1,
    favorite: 'blackIron',
  },
  {
    id: 'elixirValley',
    name: '百草丹谷',
    icon: '⚗',
    specialty: '丹修',
    desc: '天下丹药半出此谷。不问出身，只认灵草。',
    initialRelation: 20,
    power: 0.9,
    favorite: 'herb',
  },
  {
    id: 'beastTamer',
    name: '万兽山庄',
    icon: '🐾',
    specialty: '兽修',
    desc: '驱兽为兵，与妖为友。脾气直，翻脸也快。',
    initialRelation: 0,
    power: 1.1,
    favorite: 'demonCore',
  },
  {
    id: 'netherHall',
    name: '幽冥鬼殿',
    icon: '💀',
    specialty: '鬼修',
    desc: '收魂炼魄，行事诡秘。与它打交道的人都不太干净。',
    initialRelation: -30,
    power: 1.2,
    favorite: 'netherFlame',
  },
  {
    id: 'thunderPavilion',
    name: '天雷阁',
    icon: '⚡',
    specialty: '雷修',
    desc: '以雷淬体，以雷证道。强横，且看不起弱者。',
    initialRelation: -10,
    power: 1.3,
    favorite: 'starSand',
  },
  {
    id: 'starPalace',
    name: '星穹仙宫',
    icon: '🌌',
    specialty: '星辰',
    desc: '自天外而来，高居云上。它的态度取决于你的名声。',
    initialRelation: 0,
    power: 1.5,
    favorite: 'immortalJade',
  },
];

export const NPC_SECT_MAP: Record<string, NpcSectDef> = NPC_SECTS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<string, NpcSectDef>,
);

/* ------------------------------------------------------------------ */
/* 外交行动                                                            */
/* ------------------------------------------------------------------ */

/** 赠礼：花资源换关系 */
export const GIFT_RELATION = 12;
/** 赠到"心头好"时的额外加成 */
export const GIFT_FAVORITE_MULTIPLIER = 2;
/** 赠礼的冷却（每宗各自计） */
export const GIFT_COOLDOWN_SECONDS = 300;
/** 每宗最多赠礼几次（之后关系要靠别的手段） */
export const GIFT_MAX_PER_SECT = 8;

/** 论道：不花资源，但一次只能涨一点点，且路远 */
export const PARLEY_RELATION = 4;
export const PARLEY_COOLDOWN_SECONDS = 900;

/** 结盟所需关系与声望 */
export const ALLIANCE_RELATION = 60;
export const ALLIANCE_FAME = 3000;

/** 结盟的被动收益：每多一个盟友，宗门产出 +3%（上限 6 家 = +18%） */
export const ALLIANCE_PRODUCTION_BONUS = 0.03;

/** 主动宣战：关系直接掉到底，并触发大战 */
export const DECLARE_WAR_RELATION = -100;
/** 第 24 轮（需求 2）：罢兵求和的声望代价，与宣战对称 */
export const MAKE_PEACE_FAME_COST = 20;
/** 停战后关系回升一点（求和总是要带礼物的） */
export const MAKE_PEACE_RELATION = 12;

export const DECLARE_WAR_FAME_COST = 300;

/** 宗门大战的周期（秒）—— 处于战争状态时每这么久打一场 */
export const WAR_BATTLE_INTERVAL = 600;
/** 大战胜负对关系的影响 */
export const WAR_WIN_RELATION = 15;
export const WAR_LOSS_RELATION = -10;

/** 敌对宗门主动来犯的概率（每秒） */
export const HOSTILE_RAID_CHANCE_PER_SECOND = 1 / 3600;

/* ------------------------------------------------------------------ */
/* 礼物清单（赠礼消耗什么）                                             */
/* ------------------------------------------------------------------ */

export interface GiftOption {
  /** 一次赠礼花多少 */
  amount: number;
  /** 关系涨幅（未计心头好加成） */
  relation: number;
  /** 描述 */
  label: string;
}

/**
 * 赠礼的三档价位。
 *
 * 三档而不是"给多少算多少"，是为了让界面能一行放下三个按钮，
 * 也让"该送什么"变成一个真的选择（早期只送得起薄礼）。
 */
export const GIFT_OPTIONS: GiftOption[] = [
  { amount: 200, relation: 8, label: '薄礼' },
  { amount: 2000, relation: 14, label: '厚礼' },
  { amount: 20000, relation: 20, label: '重礼' },
];

/* ------------------------------------------------------------------ */
/* 大战结算                                                             */
/* ------------------------------------------------------------------ */

/** 大战时"我方向战力"折算成强度的系数 */
export const WAR_DEFENSE_POWER_PER_DISCIPLE = 0.02;
/** 大战最低胜率与最高胜率（再强也不该必胜，再弱也有一线生机） */
export const WAR_MIN_WIN_CHANCE = 0.05;
export const WAR_MAX_WIN_CHANCE = 0.92;
/** 战败时弟子的伤亡比例 */
export const WAR_CASUALTY_RATIO = 0.06;
/**
 * 战败时被掠走的资源比例（资源类：灵气/灵木/灵矿/灵石/灵草）。
 *
 * 之所以要有这一条：原注释写着"资源被掠"，实现里却只扣弟子 ——
 * 战败必须真的疼，否则"宣战"就变成一件没有下行风险的事。
 */
export const WAR_LOSS_RESOURCE_RATIO = 0.05;
/** 战胜时的战利品（按对方实力缩放） */
export const WAR_LOOT: { id: ItemId; amount: number }[] = [
  { id: 'starSand', amount: 60 },
  { id: 'lunarCrystal', amount: 20 },
  { id: 'dragonBlood', amount: 12 },
  { id: 'immortalJade', amount: 4 },
];
/** 战胜时损耗的资源 */
export const WAR_RESOURCE_COST = 0.02;

/** 界面用：关系档位 */
export function relationTierOf(relation: number): RelationTierDef {
  for (const tier of RELATION_TIERS) {
    if (relation >= tier.min) return tier;
  }
  return RELATION_TIERS[RELATION_TIERS.length - 1];
}

export function clampRelation(value: number): number {
  return Math.max(RELATION_MIN, Math.min(RELATION_MAX, value));
}

/** 初始的 NPC 关系表 */
export function initialNpcSects(): { id: string; relation: number; gifts: number; alliance: boolean }[] {
  return NPC_SECTS.map((s) => ({
    id: s.id,
    relation: s.initialRelation,
    gifts: 0,
    alliance: false,
  }));
}
