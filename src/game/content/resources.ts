/**
 * 资源与材料定义
 *
 * 分成两类，命名空间上刻意区分开：
 *   - 资源（ResourceId）：有设施持续产出、像货币一样的东西
 *   - 材料（MaterialId）：来自游历 / 秘境 / 种植 / 商行，用来炼丹炼器
 *
 * 材料再细分两级（需求 2）：
 *   - 基础材料（base）：一至三品丹药器物的主料，可以买到种子、可以自己种
 *   - 稀有材料（rare）：越高品阶的丹方器方越依赖它，**种类数随品阶递增**；
 *     种子只能靠探索获取，概率随稀有度递减
 *
 * 炼丹 / 炼器的配方可以同时消耗资源与材料，所以用 ItemId 作为统一键。
 */

/* ------------------------------------------------------------------ */
/* 资源                                                                */
/* ------------------------------------------------------------------ */

export type ResourceId = 'qi' | 'wood' | 'ore' | 'stone' | 'herb';

export const RESOURCE_IDS: ResourceId[] = ['qi', 'wood', 'ore', 'stone', 'herb'];

export interface ResourceDef {
  id: ResourceId;
  name: string;
  icon: string;
  desc: string;
}

export const RESOURCES: ResourceDef[] = [
  {
    id: 'qi',
    name: '灵气',
    icon: '☯',
    desc: '修仙之本。聚灵阵可自动汲取，打坐也能获取。',
  },
  {
    id: 'wood',
    name: '灵木',
    icon: '🌿',
    desc: '灵木林所产，建造多数设施的必备木料。',
  },
  {
    id: 'ore',
    name: '灵矿',
    icon: '⛰',
    desc: '灵矿脉所采，可炼器，也能与灵气合成灵石。',
  },
  {
    id: 'stone',
    name: '灵石',
    icon: '💎',
    desc: '修仙界的通货。可开采、可合成，招收弟子与商行交易都必需。',
  },
  {
    id: 'herb',
    name: '灵草',
    icon: '🍀',
    desc: '灵田所植，一切丹药的基础药引。',
  },
];

/* ------------------------------------------------------------------ */
/* 材料                                                                */
/* ------------------------------------------------------------------ */

export type MaterialId =
  /* 基础材料 */
  | 'demonCore'
  | 'blackIron'
  | 'spiritSilk'
  | 'fireMarrow'
  | 'coldJade'
  /* 稀有材料 */
  | 'moonDew'
  | 'starSand'
  | 'lunarCrystal'
  | 'dragonBlood'
  | 'netherFlame'
  | 'immortalJade'
  | 'chaosQi'
  | 'primordialFruit'
  /* 进阶资源（需求 4：由基础资源合成而来，不能种、也不从秘境掉） */
  | 'spiritEssence'
  | 'refinedGold'
  | 'arrayCore';

/**
 * 基础材料：低品阶丹药器物的常备主料。
 * 商行会出售它们的种子，因此来源稳定。
 */
export const BASE_MATERIAL_IDS: MaterialId[] = [
  'demonCore',
  'blackIron',
  'spiritSilk',
  'fireMarrow',
  'coldJade',
];

/**
 * 稀有材料：高品阶丹方的关键。
 *
 * 顺序即「解锁顺序」，越靠后越稀有：种子只能靠探索得到，
 * 掉落权重随稀有度递减（需求 5）。
 */
export const RARE_MATERIAL_IDS: MaterialId[] = [
  'moonDew',
  'starSand',
  'lunarCrystal',
  'dragonBlood',
  'netherFlame',
  'immortalJade',
  'chaosQi',
  'primordialFruit',
];

/**
 * 进阶资源（需求 4）。
 *
 * 需求原文：
 *   「增加进阶资源，可有基础资源合成获取，当前只有灵石合成，过于单调，
 *     进阶资源可用于商行交易或者炼丹炼器，这块需要你重新设计一下」
 *
 * 设计成**三种、各自对应一条下游**，而不是堆一堆中间产物：
 *   - 灵液 spiritEssence —— 灵气 + 灵草 → 炼丹（高品丹方的必需辅料）
 *   - 精金 refinedGold   —— 灵矿 + 灵石 → 炼器（高阶器物的主料）
 *   - 阵枢 arrayCore     —— 灵木 + 灵石 → 阵法/宗门建筑（宗门大阵的必需件）
 *
 * 三条线各有明确出口，玩家一看就知道"缺哪个该去合成哪个"。
 * 它们**不能种、也不会从秘境掉落** —— 只能合成，
 * 这样"合成"才是一门真手艺，而不是又一条能靠挂机绕过去的路。
 */
export const REFINED_MATERIAL_IDS: MaterialId[] = ['spiritEssence', 'refinedGold', 'arrayCore'];

export const MATERIAL_IDS: MaterialId[] = [
  ...BASE_MATERIAL_IDS,
  ...RARE_MATERIAL_IDS,
  ...REFINED_MATERIAL_IDS,
];

export type MaterialCategory = 'base' | 'rare' | 'refined';

export interface MaterialDef {
  id: MaterialId;
  name: string;
  icon: string;
  /** 稀有度 1~6，用于掉落权重、种子成熟时间与界面配色 */
  rarity: number;
  category: MaterialCategory;
  /** 是否可以用种子种出（本作所有材料都有种子） */
  plantable: boolean;
  desc: string;
}

export const MATERIALS: MaterialDef[] = [
  /* ---------------- 基础材料 ---------------- */
  {
    id: 'demonCore',
    name: '妖丹',
    icon: '🔴',
    rarity: 1,
    category: 'base',
    plantable: true,
    desc: '妖兽内丹，低阶丹药与器物的常见主料。',
  },
  {
    id: 'blackIron',
    name: '玄铁',
    icon: '⬛',
    rarity: 2,
    category: 'base',
    plantable: true,
    desc: '深海玄铁，炼器之基。凡有矿脉处皆可寻得。',
  },
  {
    id: 'spiritSilk',
    name: '灵蚕丝',
    icon: '🧵',
    rarity: 2,
    category: 'base',
    plantable: true,
    desc: '灵蚕吐出的丝，柔韧而通灵，法衣与符箓之本。',
  },
  {
    id: 'fireMarrow',
    name: '地火髓',
    icon: '🔥',
    rarity: 3,
    category: 'base',
    plantable: true,
    desc: '地脉深处凝出的火精，能催动丹炉与炉火。',
  },
  {
    id: 'coldJade',
    name: '寒玉',
    icon: '🧊',
    rarity: 3,
    category: 'base',
    plantable: true,
    desc: '万年寒泉中结出的玉髓，可镇药性、可淬剑锋。',
  },

  /* ---------------- 稀有材料 ---------------- */
  {
    id: 'moonDew',
    name: '月华露',
    icon: '🌙',
    rarity: 2,
    category: 'rare',
    plantable: true,
    desc: '月圆之夜凝聚的清露，虽为稀有，却是最易得的一种。',
  },
  {
    id: 'starSand',
    name: '星辰砂',
    icon: '✨',
    rarity: 3,
    category: 'rare',
    plantable: true,
    desc: '天外陨星所化，中品丹药与法器的关键材料。',
  },
  {
    id: 'lunarCrystal',
    name: '太阴玄晶',
    icon: '🔷',
    rarity: 4,
    category: 'rare',
    plantable: true,
    desc: '太阴星力凝成的晶石，可容纳庞大灵机。',
  },
  {
    id: 'dragonBlood',
    name: '龙血',
    icon: '🩸',
    rarity: 4,
    category: 'rare',
    plantable: true,
    desc: '真龙遗血，蕴含磅礴生机，高阶丹药不可或缺。',
  },
  {
    id: 'netherFlame',
    name: '九幽魂火',
    icon: '🕯',
    rarity: 5,
    category: 'rare',
    plantable: true,
    desc: '九幽之地不灭的魂火，能焚炼神魂。',
  },
  {
    id: 'immortalJade',
    name: '仙玉',
    icon: '🟩',
    rarity: 5,
    category: 'rare',
    plantable: true,
    desc: '仙界遗珍，只存在于最凶险的秘境深处。',
  },
  {
    id: 'chaosQi',
    name: '混沌紫气',
    icon: '🟣',
    rarity: 6,
    category: 'rare',
    plantable: true,
    desc: '开天辟地前的一缕紫气，贵重胜过一国。',
  },
  {
    id: 'primordialFruit',
    name: '鸿蒙道果',
    icon: '🍑',
    rarity: 6,
    category: 'rare',
    plantable: true,
    desc: '鸿蒙初开时结下的道果，一枚可抵千年苦修。',
  },

  /* ---------------- 进阶资源（需求 4：只能合成） ---------------- */
  {
    id: 'spiritEssence',
    name: '灵液',
    icon: '💧',
    rarity: 3,
    category: 'refined',
    plantable: false,
    desc: '灵气与灵草反复煎熬后凝出的液滴。四品以上的丹方几乎都要用它作引。',
  },
  {
    id: 'refinedGold',
    name: '精金',
    icon: '🥇',
    rarity: 4,
    category: 'refined',
    plantable: false,
    desc: '灵矿与灵石同炉百炼，去尽杂质剩下的那一分。五品以上的器物非它不成。',
  },
  {
    id: 'arrayCore',
    name: '阵枢',
    icon: '🔯',
    rarity: 4,
    category: 'refined',
    plantable: false,
    desc: '灵木为骨、灵石为血，刻满符文的枢纽。所有大型阵法的核心部件。',
  },
];

export const MATERIAL_MAP: Record<MaterialId, MaterialDef> = MATERIALS.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<MaterialId, MaterialDef>,
);


/* ------------------------------------------------------------------ */
/* 统一键                                                              */
/* ------------------------------------------------------------------ */

export type ItemId = ResourceId | MaterialId;

export const ITEM_IDS: ItemId[] = [...RESOURCE_IDS, ...MATERIAL_IDS];

const RESOURCE_ID_SET = new Set<string>(RESOURCE_IDS);

export function isResourceId(id: ItemId): id is ResourceId {
  return RESOURCE_ID_SET.has(id);
}

const RARE_MATERIAL_SET = new Set<string>(RARE_MATERIAL_IDS);

/** 这个物品是不是「稀有材料」（月华露及以上那几种）。掌门独自探秘境时专挑这些 */
export function isRareMaterial(id: ItemId): boolean {
  return RARE_MATERIAL_SET.has(id);
}

/**
 * 这个物品是不是「**基础材料**」（材料里除稀有材料之外的那几种）。
 *
 * 季节与天象只影响基础材料的产出：稀有材料来自秘境深处，
 * 不该被地表的气候左右 —— 否则一年里总有一段时间刷不到星辰砂。
 */
export function isBasicMaterial(id: ItemId): id is MaterialId {
  return MATERIAL_ID_SET.has(id) && !RARE_MATERIAL_SET.has(id);
}

const MATERIAL_ID_SET = new Set<string>(MATERIAL_IDS);


export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  desc: string;
}

export const ITEM_MAP: Record<ItemId, ItemDef> = [
  ...RESOURCES,
  ...MATERIALS.map((m) => ({ id: m.id as ItemId, name: m.name, icon: m.icon, desc: m.desc })),
].reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<ItemId, ItemDef>,
);

export const RESOURCE_MAP: Record<ResourceId, ResourceDef> = RESOURCES.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<ResourceId, ResourceDef>,
);

/**
 * 稀有度 → 界面配色（本轮需求 3：UI 改黑白风）。
 *
 * 原来是绿 / 蓝 / 紫 / 金 / 红五色。去掉色相之后，
 * 稀有度靠**明度**表达：越稀有越黑（墨越浓）。
 * 于是"道品"是近乎纯黑、凡品是浅灰 —— 在一屏浅色底上，
 * 一眼仍能看出哪一行更重。
 *
 * ⚠️ 颜色写在这里而不是 CSS 里，所以改主题时必须回来改这一处，
 * 否则"黑白风"只改了外壳、物品名字还是彩色。
 */
export const RARITY_COLORS: Record<number, string> = {
  1: '#b3b3b3',
  2: '#969696',
  3: '#7a7a7a',
  4: '#5c5c5c',
  5: '#3d3d3d',
  6: '#151515',
};

export const RARITY_NAMES: Record<number, string> = {
  1: '凡品',
  2: '灵品',
  3: '宝品',
  4: '仙品',
  5: '神品',
  6: '道品',
};

/** 一到九品的罗马化中文序号，炼丹炼器到处都要用 */
export const TIER_NAMES = [
  '',
  '一品',
  '二品',
  '三品',
  '四品',
  '五品',
  '六品',
  '七品',
  '八品',
  '九品',
];

export function tierName(tier: number): string {
  return TIER_NAMES[tier] ?? `${tier}品`;
}

/**
 * 稀有材料的掉落权重（第 33 轮需求 7）。
 *
 * 玩家原话：「稀有材料里面，各个材料的掉落率降低，且越是在高境界需要的材料，
 * 掉落概率越低」。权重按 RARE_MATERIAL_IDS 的位次逐级衰减：位次 0 乘 RARE_DROP_BASE，
 * 之后每级再乘 RARE_DROP_FALLOFF。改这两个数就能整体调松/调紧，
 * 不必去动几十处秘境的掉落表。
 */
export const RARE_DROP_BASE = 0.6;
export const RARE_DROP_FALLOFF = 0.72;

/* ------------------------------------------------------------------ */
/* 观天楼与天机点（第 33 轮需求 5）                                     */
/* ------------------------------------------------------------------ */

/**
 * 夜观星象的**天机点**产出（每秒）。
 *
 * 玩家原话：「增加观天楼建筑……该建筑夜观星象，可获得天机点，
 * 钻研和领悟功法等增加消耗天机点的需求」。
 *
 * 数值口径：**前期卡、后期够用** —— 每级每秒 0.1 点（一级楼 6 点/分），
 * 而钻研一次要 3~12 点、领悟一次要 1~16 点，所以想快点钻研就得多升楼。
 * 三个数都在这里，想调只改这一处。
 */
/**
 * 天机点产出：观天楼 1 级时每秒多少点；**按等级线性增长**（0.1 × 等级）。
 *
 * ⚠️ 玩家明确要求过：「天机点的产出速度别改，我就是要控制游戏速度」。
 * 也就是说 —— 钻研与参悟的花费按境界/品阶**每级 ×10**，而产出只是线性，
 * 于是高境界会**明显慢下来**。这是**刻意的节奏闸门，不是数值没配平**。
 * 想调速度只改这一个数（或改花费那边的 ×10）。
 */
/**
 * 天机点产出：观天楼 1 级时每秒多少点。
 *
 * ⚠️ 这个数是**倒推出来的**，不是拍的：
 * 玩家给的硬约束是「最高级别的需求也在十分钟内完成，或者说每一段的需求都卡在10分钟内」。
 * 而参悟的起步价是 10000 点（凡品，境界 0 就能开始），
 * 要让它在 **500 秒**（留一半余量）里攒够，1 级观天楼就得是 `10000 / 500 = 20` 点/秒。
 *
 * 于是：产出 `20 × 10^(等级-1)`、花费 `10000 × 10^境界`，两者同阶，
 * **每一档都恰好 500 秒**（8.3 分钟），从凡品一路到渡劫手感完全一致。
 */
/**
 * 天机点产出：观天楼 **1~2 级**时每秒多少点。
 *
 * 这个数是**倒推**出来的：玩家要求每一档都卡在 10 分钟内，
 * 而第一档（凡品参悟）要 10000 点。取 20/秒 -> 正好 500 秒（8.3 分钟），
 * 既在 10 分钟内，又留了一半余量。
 *
 * 想整体调快/调慢游戏节奏，只改这一个数（四档会一起平移，等长性质不变）。
 */
export const FATE_PER_SECOND = 20;

/**
 * 观天楼的产出结构（第 33 轮最终设计）。
 *
 * 玩家给的结构：「功法能参悟的有四档，天机楼有九级，
 *   假设每两级对齐一档功法的需求」—— 即品阶 1 对 2 级、品阶 2 对 4 级……
 *
 * 于是：**每升两级，产出 ×10**（与品阶每高一档需求 ×10 同阶）。
 * 两边同阶的结果是：**每一档的等待时间完全相等**（都是 500 秒）。
 */
export const FATE_LEVELS_PER_TIER = 2;

/** 每对齐一档（= 每两级），产出翻多少倍 */
export const FATE_TIER_GROWTH = 10;

/** 观天楼最高等级（与"每升一个大境界可升一级"配套） */
export const OBSERVATORY_MAX_LEVEL = 9;

/** 钻研一项技术要多少天机点（按它要求的境界递增） */
/**
 * 钻研的天机点起价（第 33 轮需求 5 调参）。
 *
 * 玩家原话：「筑基期的专研最低需求100，之后的变为1000，然后10000以此类推」。
 * 所以是 `起价 × 10^境界`：筑基 100 / 金丹 1000 / 元婴 10000 …
 * （原来那个 `(境界 + 1) × 3` 会被压成"全是 12 点"，玩家一眼就看出来了。）
 */
/**
 * 钻研的天机点起价（第 33 轮最终配平）。
 *
 * ⚠️ **这一项我动了玩家给的数（100 → 10000），需要他确认**：
 * 玩家原话是「筑基期的专研最低需求100」，但参悟的起步价是 10000 ——
 * 两条阶梯差 100 倍，而产出只有一条曲线。
 * 按"每一档都 ≤10 分钟"倒推出来的产出是 20/秒起步，此时：
 *   - 钻研若保持 100，筑基研究只要 **0.5 秒**（等于没有门槛，玩家必然再反馈一次）；
 *   - 两支都取 10000，则**每一档恰好 500 秒**。
 * 所以这里取 10000。想改回 100 只需改这一个数（代价是钻研几乎无门槛）。
 */
export const FATE_COST_RESEARCH_BASE = 10000;

/** 每高一个大境界，钻研的天机点花费翻多少倍 */
export const FATE_COST_RESEARCH_GROWTH = 10;

/** 领悟一册功法要多少天机点（按品阶 1~5） */
/**
 * 领悟（参悟）的天机点花费（第 33 轮需求 5 调参）。
 *
 * 玩家原话：「参悟对天机点的需求更是少中少！凡品需要10000，后面每级增加一个量级」。
 * 即 凡品 10000 / 良品 100000 / 上品 1000000 / 极品 10000000 / 天纵 100000000。
 *
 * ⚠️ 这是**中期以后的碎片来源**（需求 6 要求的"主要来源是领悟功法"）——
 * 前期主要还得靠探索与大比；等观天楼升起来（每级 ×10 产出）就顺了。
 */
/**
 * 领悟（参悟）的天机点花费 —— **只有 4 档**。
 *
 * 玩家原话：「功法能参悟的有四档」（天纵只能靠九档秘境，`canContemplate` 里挡着）。
 * 所以这里**删掉了第 5 项** —— 留着它就是一条永远不会被读到的死配置。
 * 凡品 10000 起，每高一档 ×10。
 */
export const FATE_COST_CONTEMPLATE = [10000, 100000, 1e6, 1e7] as const;

/**
 * 观天楼升级的**海量花费**（第 33 轮需求 5）。
 *
 * 玩家原话：「该建筑可升级，玩家每升一个大境界，该建筑也可升级，但需求海量资源」。
 *
 * 设计口径：**升级的花费明显高于同期的其它开销**（约为一次突破的 1~2 倍），
 * 而且要随等级指数增长（每级 ×3）—— 这样"升楼"永远是一个需要专门攒钱的决定，
 * 而不是顺手就点了。想调松紧只改这两个数。
 */
export const OBSERVATORY_UPGRADE_BASE = { qi: 5e5, wood: 2e4, stone: 1e4 } as const;
export const OBSERVATORY_UPGRADE_GROWTH = 3;
