/**
 * 秘境（需求 1 / 5）
 *
 * 需求原文：
 *   「秘境设计为弟子或者玩家探索发现，发现后固定在秘境栏，
 *     每次探索后需要隔一段时间才能再次探索。秘境探索有境界限制，
 *     并且人越多最终获取的资源越多。」
 *   「每个区域1-2个秘境……只有一个小区域秘境有三个以上，为资源富集区……
 *     资源富集区内有一个产出该大区特产的秘境。」
 *
 * 现在的结构：
 *   大区域（6）→ 小区域（96）→ 秘境（每小区域 1~2 处，资源富集区 3 处，共 150 处）
 *
 * 秘境不再是「攒够材料就自动出现」，而是**探索中发现**的：
 *   - 每处秘境挂在一个小区域下（见 map.ts），小区域有境界门槛；
 *   - 小区域里**还没发现秘境时只能"普通探索"**（见 expeditions.ts 的 survey）；
 *   - 弟子探索或掌门游历时有概率发现新秘境，发现后永久固定；
 *   - 每次探索完毕该秘境进入冷却，冷却结束才能再探；
 *   - 派遣人数在 minParty~maxParty 之间自由决定，人越多总产出越高。
 *
 * ⚠️ 150 处秘境当然不可能逐个手写数值，三层生成：
 *   MAP_REGIONS（在哪儿、门槛多少）→ regionTier（门槛+1 = 1~9 档）
 *     → TIER_STATS / TIER_POOLS / PROFILE_PICKS
 * 每处秘境只声明「在哪个小区域、第几处、什么路数」，数值由 buildRealm 算出来。
 *
 * 结算的核心公式（在 expeditions.ts 里实现）：
 *   战力比 = 队伍总战力 / 秘境推荐战力
 *   人数系数 = 1 + (人数 - minParty) × PARTY_YIELD_PER_EXTRA
 *   产出   = 基础 × clamp(战力比, 0.5, 3) × 人数系数 × 增益 × 随机浮动
 *   伤亡率 = 基础伤亡率 / 战力比 × (1 - 减免)
 */
import {
  MAJOR_REGION_MAP,
  MAP_REGIONS,
  RICH_SUB_INDEX,
  regionIndex,
  regionTier,
  REALMS_PER_MAJOR,
  subRealmCount,
  type MapRegionDef,
  type RealmProfile,
} from './map';
import { REALMS } from './realms';
import { SECT_LEVELS } from './sect';
import { MATERIAL_MAP, type ItemId, type MaterialId } from './resources';

export type { RealmProfile };

export interface LootEntry {
  item: ItemId;
  /** 基础数量 */
  amount: number;
  /** 掉落权重（同一次探索里按权重抽取若干项） */
  weight: number;
  /** 是否必定掉落 */
  guaranteed?: boolean;
}

export interface PillLootEntry {
  pill: string;
  amount: number;
  weight: number;
}

export interface SecretRealmDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 所在的小区域（见 map.ts） */
  regionId: string;
  /** 区域档次 1~9 */
  tier: number;
  /** 推荐战力 */
  requiredPower: number;
  /** 一次探索所需的进度秒数（受探索速度加成影响） */
  duration: number;
  /** 至少派遣几名弟子 */
  minParty: number;
  /** 最多能派遣几名弟子（人越多产出越高） */
  maxParty: number;
  /** 弟子境界下限（第 25 轮起：大区域门槛 + 在大区域里的序号，同区域严格递增） */
  minRealm: number;
  /**
   * 弟子境界**上限**（第 25 轮需求 4）。
   *
   * 玩家原话：「秘境设定最高境界要求，不超过该秘境最低境界要求两个大境界」。
   * 所以它恒等于 `minRealm + REALM_SPAN_MAX`（= min + 2）。
   * 境界高于此数的弟子**进不去** —— 低阶秘境会随着你变强而"过期"，
   * 这也让"该去哪一层"成为每次都要重新看的决定。
   */
  maxRealm: number;
  /** 一次探索结束后的冷却秒数 */
  cooldown: number;
  /** 基础伤亡率 */
  baseCasualty: number;
  loot: LootEntry[];
  pillLoot?: PillLootEntry[];
  seedChance: number;
  seedMinRarity: number;
  seedMaxRarity: number;
  blueprintChance: number;
  discoveryWeight: number;
  requiresSectLevel?: number;
  /**
   * 是不是「特产秘境」：产出所属大区域的独有特产。
   *
   * 每个大区域的**资源富集区**里恰好有一处，是那种材料最稳、最多的来源。
   */
  specialty?: MaterialId;
  /** 在本小区域里排第几处（0 起） */
  rank: number;
  /**
   * 开启这处秘境需要一次性花费的资源（需求 1）。
   *
   * 需求原文：「资源富集区的秘境开启需要花费一定资源」。
   * 所以只有**资源富集区**（每个大区域下标 15 的那个小区域）里的秘境带这个字段：
   * 发现之后还不能直接探，得先花一笔把阵眼立起来。
   * 这笔钱按档次递增，而且吃的是**进阶资源**（阵枢）——
   * 于是"想动富集区，先去合成"这条链路也就成立了。
   */
  unlockCost?: Partial<Record<ItemId, number>>;
}

/* ------------------------------------------------------------------ */
/* 人数与掉落的通用常量                                                 */
/* ------------------------------------------------------------------ */

/** 每次探索从掉落表里抽取的条目数，还会随人数增加 */
export const LOOT_ROLLS = 3;
/** 每多派一名弟子（超出 minParty）增加的抽取条目数，上限 LOOT_ROLLS_MAX */
export const LOOT_ROLLS_PER_EXTRA = 1;
export const LOOT_ROLLS_MAX = 6;
/** 每多派一名弟子（超出 minParty）的总产量加成 */
export const PARTY_YIELD_PER_EXTRA = 0.4;
/** 秘境掉落成品丹药的概率 */
export const PILL_DROP_CHANCE = 0.15;
/** 一次探索最多带回几种种子 */
export const SEED_ROLLS = 1;
/**
 * 图纸只会从「5 档及以上」的秘境里掉出来。
 *
 * ⚠️ 早先这里是按 `minRealm >= 3` 判的，但需求 5 把 minRealm 的语义改成了
 * 「所属大区域的解锁境界」（同一个大区里所有秘境都一样），
 * 它就不再能当"深浅"的代理了。所以改按**档次**判 ——
 * 而 blueprintChance 本来就是逐档配的（1~4 档为 0）。
 */
export const MIN_TIER_FOR_BLUEPRINT = 5;

/* ------------------------------------------------------------------ */
/* 普通探索（需求 1：小区域还没发现秘境时唯一能做的事）                  */
/* ------------------------------------------------------------------ */

/** 普通探索必掉的基础材料种类（下限 / 上限） */
export const SURVEY_BASE_KINDS_MIN = 1;
export const SURVEY_BASE_KINDS_MAX = 2;
/** 普通探索掉出稀有材料的概率 */
export const SURVEY_RARE_CHANCE = 0.3;
/** 普通探索的时长 = 该小区域秘境时长的这个比例（比正经探秘境快） */
export const SURVEY_DURATION_RATIO = 0.55;
/** 普通探索的基础产量倍率：它不该比探秘境更赚，否则没人去探秘境 */
export const SURVEY_YIELD_MULT = 0.65;
/** 普通探索最多派几个人 */
export const SURVEY_MAX_PARTY = 4;
/** 普通探索没有冷却 —— 它本来就是"还没找到秘境时的日常活计" */

/* ------------------------------------------------------------------ */
/* 区域档次 → 秘境数值                                                  */
/* ------------------------------------------------------------------ */

interface TierStat {
  powerMult: number;
  duration: number;
  cooldown: number;
  casualty: number;
  seedChance: number;
  seedMinRarity: number;
  seedMaxRarity: number;
  blueprintChance: number;
  minParty: number;
  maxParty: number;
  sectLevel: number;
}

/**
 * 九档秘境数值。档次 = 小区域的境界门槛 + 1。
 *
 * 推荐战力锚定在「本区域境界的弟子基础战力 × powerMult」上，而不是写死绝对数字 ——
 * 否则加了新境界、弟子战力整体上台阶之后，150 处秘境的推荐战力会全部失准。
 */
const TIER_STATS: Record<number, TierStat> = {
  1: { powerMult: 2, duration: 120, cooldown: 90, casualty: 0.02, seedChance: 0.3, seedMinRarity: 1, seedMaxRarity: 2, blueprintChance: 0, minParty: 1, maxParty: 4, sectLevel: 0 },
  2: { powerMult: 3, duration: 200, cooldown: 150, casualty: 0.04, seedChance: 0.35, seedMinRarity: 1, seedMaxRarity: 3, blueprintChance: 0, minParty: 1, maxParty: 5, sectLevel: 0 },
  3: { powerMult: 4, duration: 340, cooldown: 250, casualty: 0.07, seedChance: 0.4, seedMinRarity: 2, seedMaxRarity: 3, blueprintChance: 0, minParty: 2, maxParty: 6, sectLevel: 0 },
  4: { powerMult: 5, duration: 560, cooldown: 400, casualty: 0.11, seedChance: 0.45, seedMinRarity: 2, seedMaxRarity: 4, blueprintChance: 0, minParty: 2, maxParty: 7, sectLevel: 0 },
  5: { powerMult: 6, duration: 900, cooldown: 650, casualty: 0.16, seedChance: 0.5, seedMinRarity: 3, seedMaxRarity: 5, blueprintChance: 0.05, minParty: 3, maxParty: 8, sectLevel: 0 },
  6: { powerMult: 7, duration: 1450, cooldown: 1000, casualty: 0.21, seedChance: 0.55, seedMinRarity: 3, seedMaxRarity: 5, blueprintChance: 0.07, minParty: 3, maxParty: 9, sectLevel: 2 },
  7: { powerMult: 8, duration: 2300, cooldown: 1550, casualty: 0.27, seedChance: 0.6, seedMinRarity: 4, seedMaxRarity: 6, blueprintChance: 0.09, minParty: 4, maxParty: 10, sectLevel: 3 },
  8: { powerMult: 9, duration: 3600, cooldown: 2400, casualty: 0.33, seedChance: 0.62, seedMinRarity: 4, seedMaxRarity: 6, blueprintChance: 0.12, minParty: 4, maxParty: 12, sectLevel: 5 },
  9: { powerMult: 10, duration: 5600, cooldown: 3600, casualty: 0.4, seedChance: 0.65, seedMinRarity: 5, seedMaxRarity: 6, blueprintChance: 0.15, minParty: 5, maxParty: 14, sectLevel: 7 },
};

interface PoolEntry {
  item: ItemId;
  amount: number;
  weight: number;
}

/**
 * 每档的掉落池。覆盖全部 13 种材料：低档只出基础材料与月华露，
 * 越往后越往稀有材料上走（星辰砂 → 太阴玄晶/龙血 → 九幽魂火/仙玉 → 混沌紫气/鸿蒙道果）。
 */
const TIER_POOLS: Record<number, PoolEntry[]> = {
  1: [
    { item: 'herb', amount: 120, weight: 5 },
    { item: 'demonCore', amount: 6, weight: 3 },
    { item: 'spiritSilk', amount: 4, weight: 2 },
    { item: 'moonDew', amount: 2, weight: 2 },
  ],
  2: [
    { item: 'herb', amount: 320, weight: 5 },
    { item: 'demonCore', amount: 22, weight: 3 },
    { item: 'blackIron', amount: 10, weight: 3 },
    { item: 'spiritSilk', amount: 9, weight: 2 },
    { item: 'moonDew', amount: 4, weight: 2 },
  ],
  3: [
    { item: 'herb', amount: 900, weight: 4 },
    { item: 'demonCore', amount: 70, weight: 3 },
    { item: 'blackIron', amount: 34, weight: 3 },
    { item: 'fireMarrow', amount: 7, weight: 2 },
    { item: 'coldJade', amount: 6, weight: 2 },
    { item: 'starSand', amount: 4, weight: 2 },
  ],
  4: [
    { item: 'ore', amount: 2400, weight: 3 },
    { item: 'demonCore', amount: 220, weight: 2 },
    { item: 'blackIron', amount: 110, weight: 3 },
    { item: 'fireMarrow', amount: 22, weight: 2 },
    { item: 'coldJade', amount: 20, weight: 2 },
    { item: 'starSand', amount: 16, weight: 2 },
  ],
  5: [
    { item: 'herb', amount: 6000, weight: 3 },
    { item: 'blackIron', amount: 420, weight: 3 },
    { item: 'fireMarrow', amount: 70, weight: 2 },
    { item: 'coldJade', amount: 60, weight: 2 },
    { item: 'starSand', amount: 70, weight: 3 },
    { item: 'lunarCrystal', amount: 5, weight: 2 },
  ],
  6: [
    { item: 'starSand', amount: 220, weight: 3 },
    { item: 'coldJade', amount: 240, weight: 2 },
    { item: 'lunarCrystal', amount: 22, weight: 3 },
    { item: 'dragonBlood', amount: 10, weight: 2 },
    { item: 'netherFlame', amount: 2, weight: 1 },
  ],
  7: [
    { item: 'starSand', amount: 650, weight: 3 },
    { item: 'lunarCrystal', amount: 65, weight: 3 },
    { item: 'dragonBlood', amount: 42, weight: 2 },
    { item: 'netherFlame', amount: 9, weight: 2 },
    { item: 'immortalJade', amount: 3, weight: 2 },
  ],
  8: [
    { item: 'lunarCrystal', amount: 210, weight: 3 },
    { item: 'dragonBlood', amount: 130, weight: 3 },
    { item: 'netherFlame', amount: 32, weight: 2 },
    { item: 'immortalJade', amount: 13, weight: 2 },
    { item: 'chaosQi', amount: 2, weight: 1 },
  ],
  9: [
    { item: 'dragonBlood', amount: 420, weight: 3 },
    { item: 'netherFlame', amount: 110, weight: 2 },
    { item: 'immortalJade', amount: 45, weight: 2 },
    { item: 'chaosQi', amount: 9, weight: 2 },
    { item: 'primordialFruit', amount: 1, weight: 1 },
  ],
};

/** 每档可能直接掉的成品丹药 */
const TIER_PILLS: Record<number, PillLootEntry[]> = {
  1: [{ pill: 'qiGatheringPill', amount: 1, weight: 3 }],
  2: [
    { pill: 'qiGatheringPill', amount: 1, weight: 3 },
    { pill: 'calmPill', amount: 1, weight: 2 },
  ],
  3: [
    { pill: 'foundationPill', amount: 1, weight: 3 },
    { pill: 'temperPill', amount: 1, weight: 2 },
  ],
  4: [
    { pill: 'goldenCorePill', amount: 1, weight: 3 },
    { pill: 'ironBonePill', amount: 1, weight: 2 },
  ],
  5: [
    { pill: 'nascentPill', amount: 1, weight: 3 },
    { pill: 'bloodPill', amount: 1, weight: 2 },
  ],
  6: [
    { pill: 'spiritPill', amount: 1, weight: 3 },
    { pill: 'warPill', amount: 1, weight: 2 },
  ],
  7: [
    { pill: 'voidPill', amount: 1, weight: 3 },
    { pill: 'windPill', amount: 1, weight: 2 },
  ],
  8: [
    { pill: 'unityPill', amount: 1, weight: 3 },
    { pill: 'breakerPill', amount: 1, weight: 2 },
  ],
  9: [
    { pill: 'tribulationPill', amount: 1, weight: 2 },
    { pill: 'ascensionPill', amount: 1, weight: 1 },
  ],
};

const PROFILE_PICKS: Record<RealmProfile, ItemId[]> = {
  herb: ['herb', 'moonDew', 'coldJade'],
  ore: ['ore', 'blackIron', 'fireMarrow', 'starSand'],
  beast: ['demonCore', 'spiritSilk', 'dragonBlood'],
  ruin: ['blackIron', 'lunarCrystal', 'immortalJade', 'netherFlame'],
  frost: ['coldJade', 'lunarCrystal', 'moonDew'],
  void: ['chaosQi', 'netherFlame', 'immortalJade', 'starSand'],
  heaven: ['primordialFruit', 'immortalJade', 'chaosQi', 'dragonBlood'],
};

/** 秘境名后缀：让 150 处秘境的名字读起来不重样，又能一眼看出它偏产什么 */
const PROFILE_SUFFIX: Record<RealmProfile, string> = {
  herb: '药圃',
  ore: '矿窟',
  beast: '兽巢',
  ruin: '古殿',
  frost: '冰窟',
  void: '虚空裂隙',
  heaven: '云台',
};

/** 副路数：每小区域的第二处秘境换个路数，避免同一片地方掉的东西完全一样 */
const SECONDARY_FLAVOR: RealmProfile[] = ['ore', 'beast', 'ruin', 'herb', 'frost', 'void'];

/** 六个大区域的特产秘境名（手写，因为它们是每条线最值钱的那一处） */
const SPECIALTY_REALM_NAME: Record<string, string> = {
  eastMountains: '万灵祖脉',
  southFrontier: '龙骸血池',
  westDesert: '坠星渊底',
  northReach: '太阴寒宫',
  centralState: '玉京仙库',
  boundlessSea: '归墟紫渊',
};

/* ------------------------------------------------------------------ */
/* 构建                                                                */
/* ------------------------------------------------------------------ */

/** 开局就已知的秘境：东部群山第一处，宗门草创时的试炼地 */
export const STARTER_REALM_ID = 'eastMountains_0_r0';

function buildLoot(
  tier: number,
  profile: RealmProfile,
  amountScale: number,
  specialty: MaterialId | null,
): LootEntry[] {
  const pool = TIER_POOLS[tier];
  const picks = PROFILE_PICKS[profile];

  const signature = Math.max(
    0,
    pool.findIndex((entry) => picks.includes(entry.item)),
  );

  const loot: LootEntry[] = [
    {
      item: pool[signature].item,
      amount: Math.max(1, Math.round(pool[signature].amount * amountScale * 1.4)),
      weight: 1,
      guaranteed: true,
    },
  ];

  pool.forEach((entry, index) => {
    if (index === signature) return;
    loot.push({
      item: entry.item,
      amount: Math.max(1, Math.round(entry.amount * amountScale)),
      weight: entry.weight * (picks.includes(entry.item) ? 2.5 : 1),
    });
  });

  /*
   * 特产秘境：该大区域的特产**必定掉落**，而且量远大于别处。
   *
   * 这是"每个大区域一种特产"这条需求的落点 —— 想要大量龙血，
   * 就得去南疆的资源富集区，而不是随便哪个秘境里碰运气。
   */
  if (specialty) {
    const sameItem = loot.find((entry) => entry.item === specialty);
    if (sameItem) {
      sameItem.guaranteed = true;
      sameItem.amount = Math.max(sameItem.amount, Math.round(sameItem.amount * 3));
    } else {
      const base = TIER_POOLS[tier].find((e) => e.item === specialty)?.amount ?? 10;
      loot.unshift({
        item: specialty,
        amount: Math.max(1, Math.round(base * amountScale * 3)),
        weight: 1,
        guaranteed: true,
      });
    }
  }

  return loot;
}

/**
 * 秘境境界区间的**跨度上限**（第 25 轮需求 4）。
 *
 * 玩家原话：「秘境设定最高境界要求，不超过该秘境最低境界要求两个大境界」。
 * 所以 `maxRealm = minRealm + 2`，一处秘境最多横跨三个大境界。
 *
 * ⚠️ 它必须定义在**用到它的生成器之前** —— 否则模块初始化时 `SECRET_REALMS`
 * 会读到 TDZ 里的 `undefined`，算出 `maxRealm = NaN`（而这个 NaN 不会报错，
 * 只会让 `>= minRealm` 这类比较静默变 false，冒烟抓了一阵才认出来）。
 */
export const REALM_SPAN_MAX = 2;

/**
 * 秘境境界区间的**基准**（第 25 轮需求 3 / 4）。
 *
 * = 大区域门槛下移两档（下限夹在 0）：
 *   - 大区域门槛 ≥ 2 时下移两档，让同一大区域里的 6 处能用 spot 拉开而不越界；
 *   - 门槛 0 / 1 的两个大区域（东部群山、南疆）基准就是 0，
 *     否则只靠 spot 会撞在 0 上出现重复。
 * 6 处秘境因此**严格递增**：门槛 3 的大区域是 1,2,3,4,5,6，依此类推。
 */
function baseRealm(region: MapRegionDef): number {
  const majorRealm = MAJOR_REGION_MAP[region.majorId]?.requiresRealm ?? 0;
  return Math.max(0, majorRealm >= 2 ? majorRealm - 2 : 0);
}

/** 境界下标夹到合法范围（0..8） */
function clampRealm(value: number): number {
  return Math.min(REALMS.length - 1, Math.max(0, value));
}

function buildRealm(
  region: MapRegionDef,
  rank: number,
  profile: RealmProfile,
  specialty: MaterialId | null,
  /** 该秘境在自己大区域里排第几（0..5）——第 25 轮用来错开最低境界 */
  spot = 0,
): SecretRealmDef {
  /*
   * 第 25 轮：先把这处秘境的境界区间算出来（下面好几处都要用）。
   * `spot` 让同一大区域里的 6 处**严格递增、互不相同**。
   */
  const minRealm = clampRealm(baseRealm(region) + spot);
  const maxRealm = clampRealm(baseRealm(region) + spot + REALM_SPAN_MAX);
  return buildRealmBody(region, rank, profile, specialty, spot, minRealm, maxRealm);
}

function buildRealmBody(
  region: MapRegionDef,
  rank: number,
  profile: RealmProfile,
  specialty: MaterialId | null,
  spot: number,
  minRealm: number,
  maxRealm: number,
): SecretRealmDef {
  void spot;
  const tier = regionTier(region.id);
  const stat = TIER_STATS[tier];
  const globalIndex = Math.max(0, regionIndex(region.id));
  const major = MAJOR_REGION_MAP[region.majorId];

  const powerScale = 1 + 0.6 * rank;
  // 全局序号越靠后产量越高：同一档次里也有远近之分
  const amountScale = (1 + 0.004 * globalIndex) * (1 + 0.15 * rank);

  const basePower = REALMS[Math.min(region.requiresRealm, REALMS.length - 1)].power;
  const requiredPower = Math.max(1, Math.round(basePower * stat.powerMult * powerScale));

  const rankWeightFactor = [1, 0.8, 0.6][rank] ?? 0.5;
  const discoveryWeight =
    rank === 0 && region.id === 'eastMountains_0' ? 0 : Math.max(1, Math.round((12 - tier) * rankWeightFactor));

  const isSpecialty = specialty !== null;
  const name = isSpecialty
    ? SPECIALTY_REALM_NAME[region.majorId] ?? `${region.name}·特产秘境`
    : `${region.name}·${PROFILE_SUFFIX[profile]}`;

  return {
    id: `${region.id}_r${rank}`,
    name,
    icon: isSpecialty ? '💎' : region.icon,
    desc: isSpecialty
      ? `${region.name}深处的那一处，是${major?.name ?? ''}唯一稳定产出${MATERIAL_MAP[specialty as MaterialId]?.name ?? ''}的地方。`
      : `${region.name}里的一处${PROFILE_SUFFIX[profile]}。`,
    regionId: region.id,
    tier,
    requiredPower,
    duration: Math.round(stat.duration * (1 + 0.15 * rank)),
    minParty: stat.minParty,
    maxParty: stat.maxParty,
    /*
     * 弟子境界门槛（需求 5）：「大区秘境所需最低等级为解锁等级」。
     *
     * 所以取的是**所属大区域的解锁境界**，而不是这个小区域自己的门槛：
     * 只要大区域开了（掌门能飞过去），弟子就该能进去；
     * 至于这一片里靠后的几个小区域更难，那是**战力**（requiredPower）的事，
     * 不该再用境界卡一道 —— 否则就会出现"掌门化神了，弟子却还要元婴"
     * 这种把玩家挡在门外的怪规定。
     */
    /*
     * 第 25 轮（需求 3）：「区域的不同秘境所需的最低境界要求不同」。
     *
     * 原来是 `minRealm = 大区域门槛` —— 同一个大区域里 6 处**完全一样**；真正
     * 拉开差距的是 `effectiveMinRealm` 里"小区域门槛 − 1"那条，所以打印出来
     * 是 0,0,0,1,2,3 这种**带重复**的序列。
     *
     * 现在按"在大区域里排第几"（spot）错开：大区域门槛 ≥ 2 时基准**下移两档**
     * 再加 spot，于是每个大区域里的 6 处**严格递增、互不相同**。
     *
     * ⚠️ 为什么是下移而不是上移：上移会把"炼丹升品要的前置材料"推迟到够不着的
     * 地方 —— 实测直接打红了两条材料链断言（化神丹的太阴玄晶、炼虚丹的龙血、
     * 合体丹的仙玉……）。下移两档则让材料**更早**到手，同时把区间拉开。
     */
    minRealm,
    maxRealm,
    cooldown: Math.round(stat.cooldown * (1 + 0.2 * rank)),
    /*
     * 需求 2：「等级越高的秘境，死亡率越高」。
     *
     * 上限从 0.35 抬到 0.45：档次 9 的 0.40 得能真的落到数值上，
     * 否则九档秘境和八档一样危险（都被 0.35 压平），高档次就丢了一半压力。
     * 同一档里 rank 每高一位再多 1% —— 深处比浅处更险。
     */
    baseCasualty: Math.min(0.45, stat.casualty + rank * 0.01),
    loot: buildLoot(tier, profile, amountScale, specialty),
    pillLoot: TIER_PILLS[tier],
    seedChance: stat.seedChance,
    seedMinRarity: stat.seedMinRarity,
    seedMaxRarity: stat.seedMaxRarity,
    blueprintChance: stat.blueprintChance,
    discoveryWeight,
    /*
     * 宗门品阶门槛 —— **必须夹住**（本轮需求 3 修的倒挂）。
     *
     * 原来的写法是直接取 `TIER_STATS[tier].sectLevel`，而 `tier` 来自**小区域**的档次、
     * `minRealm` 来自**大区域**的门槛 —— 两者能差三四个境界。于是出现了
     * 「龙骸血池（需筑基期）却要求 2 品宗门，而 2 品宗门本身要化神期」这种条目：
     * 同一处秘境的两个门槛互相打架，实际开放时间被硬拖到化神，
     * 而界面上写的还是"需筑基期"。全库 67 处都是这么来的。
     *
     * 现在按「**这个境界最多能有几品宗门**」夹一次：
     * 秘境声明自己在境界 R 开放，那它就不可能要求一个 R 时根本达不到的宗门品阶。
     */
    requiresSectLevel: capSectLevelByRealm(
      stat.sectLevel,
      /*
       * 第 25 轮：这里原来拿**大区域**的门槛来夹，而 `minRealm` 现在是
       * "大区域门槛下移两档 + 在大区域里的序号"，两者不再相等 ——
       * 于是又冒出「碎星滩·虚空裂隙（需元婴期）却要 2 品宗门（需化神期）」
       * 这种倒挂。夹的依据必须是**这处秘境自己的下限**（`minRealm`），
       * 这也正是下面那条注释说的「声明在境界 R 开放，就不可能要求 R 时
       * 根本达不到的品阶」。
       */
      minRealm,
    ),
    specialty: specialty ?? undefined,
    // 需求 1：资源富集区的秘境要先花钱"开启"
    unlockCost: region.index >= RICH_SUB_INDEX ? buildUnlockCost(tier, rank, isSpecialty) : undefined,
    rank,
  };
}

/**
 * 把宗门品阶门槛夹到「这个境界实际能达到的品阶」以内（本轮需求 3）。
 *
 * 宗门每升一品都有境界要求（见 `SECT_LEVELS`），所以某个境界 R 时
 * 最高只能有 `maxSectLevelAt(R)` 品。秘境要求更高的品阶 = 要求一个还做不到的东西。
 *
 * 注意 R 比较小的时候结果是 0（连 1 品都要金丹期，而开宗本身就要金丹）——
 * 那正好说明"这些秘境在早期不该有宗门门槛"，返回 `undefined` 即可。
 */
function capSectLevelByRealm(wanted: number, minRealm: number): number | undefined {
  if (wanted <= 0) return undefined;
  let max = 0;
  for (let level = 1; level <= SECT_LEVELS.length; level += 1) {
    if ((SECT_LEVELS[level - 1]?.requiresRealm ?? 99) <= minRealm) max = level;
  }
  const capped = Math.min(wanted, max);
  return capped > 0 ? capped : undefined;
}

/**
 * 资源富集区秘境的开启花费（需求 1）。
 *
 * 设计意图有三条：
 *   1. **和档次挂钩**：越深处的富集区越贵，前期不会被它挡住；
 *   2. **吃进阶资源**（阵枢）：把"想开富集区 → 先去合成"这条链路接上，
 *      和需求 4 的合成系统形成闭环；
 *   3. **特产秘境更贵**：它是该大区域最值钱的一处，门槛自然该高一点。
 */
function buildUnlockCost(
  tier: number,
  rank: number,
  isSpecialty: boolean,
): Partial<Record<ItemId, number>> {
  const base = Math.pow(3.2, tier - 3);
  const rankMult = 1 + rank * 0.5;
  const specMult = isSpecialty ? 2.5 : 1;
  return {
    qi: Math.round(5e5 * base * rankMult * specMult),
    stone: Math.round(2e4 * base * rankMult * specMult),
    ore: Math.round(1e4 * base * rankMult * specMult),
    arrayCore: Math.max(1, Math.round(5 * Math.pow(2.1, tier - 3) * rankMult * specMult)),
  };
}

export const SECRET_REALMS: SecretRealmDef[] = MAP_REGIONS.flatMap((region) => {
  const count = subRealmCount(region.index);
  if (count <= 0) return [];
  const major = MAJOR_REGION_MAP[region.majorId];
  const primaryFlavor: RealmProfile = major?.flavor ?? 'herb';
  /*
   * 第 23 轮：每个大区域只有 6 处秘境，所以这 6 处必须**各不相同**。
   *
   * 玩家原话：「重复产出的相同秘境太多」——旧版每小区域主路数都是同一个
   * （于是「XX·药圃」满屏）。现在把这 6 处按"主路数 + 五种副路数各一次"轮换，
   * 并把大区域特产放在**最后那处**（它同时也是境界最高的一处）。
   */
  const others = SECONDARY_FLAVOR.filter((f) => f !== primaryFlavor);
  const rotation: RealmProfile[] = [primaryFlavor, ...others];
  // 该小区域在自己大区域里排第几个（0..5）
  const spot = Math.floor(region.index / 3);

  return Array.from({ length: count }, (_, rank) => {
    // 最后一处是特产秘境（专产该大区域的特产材料）
    // 每个小区域只出 1 处，所以 rank 恒为 0 —— 用 spot 来算位置
    const isSpecialtySpot = spot === REALMS_PER_MAJOR - 1;
    const specialty = isSpecialtySpot ? (major?.specialty ?? null) : null;
    const profile = rotation[spot % rotation.length] ?? primaryFlavor;
    return buildRealm(region, rank, profile, specialty, spot);
  });
});

export const SECRET_REALM_MAP: Record<string, SecretRealmDef> = SECRET_REALMS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, SecretRealmDef>,
);

/** 预先按小区域分好组，界面按区域渲染时不用每次 filter */
const REALMS_BY_REGION: Record<string, SecretRealmDef[]> = SECRET_REALMS.reduce(
  (acc, realm) => {
    (acc[realm.regionId] = acc[realm.regionId] ?? []).push(realm);
    return acc;
  },
  {} as Record<string, SecretRealmDef[]>,
);

export function realmsOfRegion(regionId: string): SecretRealmDef[] {
  return REALMS_BY_REGION[regionId] ?? [];
}

/** 该小区域一共几处秘境（含已发现与未发现） */
export function realmCountOfRegion(regionId: string): number {
  return realmsOfRegion(regionId).length;
}

/** 该大区域的六处特产秘境 */
export function specialtyRealms(): SecretRealmDef[] {
  return SECRET_REALMS.filter((r) => r.specialty);
}

/* ------------------------------------------------------------------ */
/* 普通探索的掉落（需求 1）                                             */
/* ------------------------------------------------------------------ */

/**
 * 普通探索的产出：**必定**给基础材料，**有概率**给稀有材料。
 *
 * 它和探秘境的区别不只是"有没有秘境"，还有两点刻意设计：
 *   1. 产出比同档秘境低（`SURVEY_YIELD_MULT`），否则没人愿意费劲找秘境；
 *   2. 但它是**稳定**的 —— 秘境有冷却，普通探索没有，
 *      所以"秘境都在冷却里"的时候它正好补上这段空窗。
 */
export function getSurveyLoot(tier: number): { base: PoolEntry[]; rare: PoolEntry[] } {
  const pool = TIER_POOLS[Math.min(9, Math.max(1, tier))];
  const base: PoolEntry[] = [];
  const rare: PoolEntry[] = [];
  for (const entry of pool) {
    if (RARE_ITEM_SET.has(entry.item)) rare.push(entry);
    else base.push(entry);
  }
  // 灵气/材料池里没有的东西就用灵草兜底，保证"必定产出基础材料"永远成立
  if (base.length === 0) base.push({ item: 'herb', amount: 200, weight: 1 });
  return { base, rare };
}

const RARE_ITEM_SET = new Set<string>(
  Object.values(MATERIAL_MAP)
    .filter((m) => m.category === 'rare')
    .map((m) => m.id),
);

/* ------------------------------------------------------------------ */
/* 发现机制（需求 1）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 一次探索结算时的「发现新秘境」基础概率。
 *
 * 这是**没有做任何投入**时的概率。玩家能主动提升它的手段只有一种：
 * 装备「寻宝宝盘」（见 recipes.ts 的 ARTIFACTS，七品炼器 + 超稀有材料）。
 */
// 需求 8：事件刷新率调低 —— 秘境也不是那么容易被撞见的
// 需求 8 让事件变稀；但发现率是进度主杠杆，所以只收一点（0.15 → 0.12）
export const DISCOVERY_BASE_CHANCE = 0.12;

/**
 * 连续失败多少次之后，下一次必然发现。
 *
 * ⚠️ 这里刻意把保底做成「硬保底」而不是「累积概率」：
 * 累积概率会直接写进 `getDiscoveryChance()`，于是"发现概率"就不止
 * 寻宝宝盘一个来源了；硬保底是**另一条独立机制**，只在连续失败太多次时兜底。
 *
 * 没有保底是不行的：小区域在没发现秘境之前只能普通探索，
 * 而秘境是稀有材料的稳定来源 —— 运气差的玩家会一直卡在门外。
 */
export const DISCOVERY_PITY_FAILURES = 10;

/**
 * 发现概率总上限，保留 25% 的运气成分，免得"发现"退化成"按顺序解锁"。
 * 现在只有寻宝宝盘一条路能往上加，所以这个上限是给宝盘准备的终点。
 */
export const DISCOVERY_MAX_CHANCE = 0.6;

/* ------------------------------------------------------------------ */
/* 结算上下限                                                          */
/* ------------------------------------------------------------------ */

/** 伤亡率上限，避免高难度直接把队伍全灭 */
export const MAX_CASUALTY_RATE = 0.6;

/* ------------------------------------------------------------------ */
/* 需求 9：队伍规模 / 危险度 / 境界压制                                 */
/* ------------------------------------------------------------------ */

/**
 * 队伍规模固定在这个区间，具体人数由玩家选。
 *
 * 下限对**人手不足的早期宗门**会自动放宽：effectiveMinParty 取
 * 「12 与能派出的空闲弟子数」里较小的那个。否则开局只有 3 个弟子时
 * 所有秘境都进不去，游戏直接死在这里 —— 需求要的是"队伍要大"，
 * 不是"早期不许玩"。
 */
export const PARTY_SIZE_MIN = 12;
export const PARTY_SIZE_MAX = 20;

/** 探索时长与冷却的整体倍率（需求 9：两者都要增加） */
export const EXPEDITION_DURATION_SCALE = 1.9;
export const EXPEDITION_COOLDOWN_SCALE = 2.6;

/** 弟子每次探索获得的心得倍率（需求 9：从探索获取的经验增加） */
export const EXPEDITION_INSIGHT_SCALE = 1.7;

/**
 * 一个秘境被探索多少次之后危险度归零（需求 9 的"危险度进度条"）。
 *
 * 取 12 是配着"循环上限 10 次"来的：挂满一轮循环之后这处秘境基本就熟了，
 * 玩家的体感是"这地方我摸透了"。
 */
/**
 * 把一处秘境**摸到没有危险**需要探多少次（第 26 轮需求 1）。
 *
 * 玩家原话：
 *   「秘境危险度降低应该是有变化的，境界要求越高的秘境，降低难度越大，
 *     比如初始练气秘境需要 64 次，最高等级的秘境则需要 512 次，中间的变化你看着来」。
 *
 * 所以按**档次**做等比插值：1 档 **64 次** → 9 档 **512 次**（正好 8 倍），
 * 每档 ×8^(1/8) ≈ ×1.297，中间几档是
 *   64 / 83 / 108 / 140 / 181 / 235 / 305 / 395 / 512。
 *
 * 为什么选等比而不是等差：档次本身是按境界指数铺开的（第 N 档的产出与门槛
 * 都是乘法级的），等差会让"低档太磨、高档太便宜"——两条曲线对不上。
 *
 * ⚠️ 原来的常数是**所有档次统一 12 次**，等于"越难的秘境越容易摸透"，
 * 与它的危险度完全脱节。现在难度直接体现在"要刷多久才熟"上。
 */
export const RUNS_TO_SAFE_BASE = 64;
export const RUNS_TO_SAFE_TOP = 512;
/** 最高档次（用来算中间档的等比系数） */
const RUNS_TO_SAFE_MAX_TIER = 9;

/** 某个档次要探多少次才彻底没有危险 */
export function runsToSafeOfTier(tier: number): number {
  const clamped = Math.min(Math.max(1, Math.round(tier)), RUNS_TO_SAFE_MAX_TIER);
  if (clamped <= 1) return RUNS_TO_SAFE_BASE;
  if (clamped >= RUNS_TO_SAFE_MAX_TIER) return RUNS_TO_SAFE_TOP;
  const ratio = Math.pow(RUNS_TO_SAFE_TOP / RUNS_TO_SAFE_BASE, 1 / (RUNS_TO_SAFE_MAX_TIER - 1));
  return Math.round(RUNS_TO_SAFE_BASE * Math.pow(ratio, clamped - 1));
}

/**
 * @deprecated 第 26 轮起按档次取值（见 `runsToSafeOfTier`）。
 * 保留这个名字只是因为老文档与老注释还在引用它，**不要再用它算危险度**。
 */
export const RUNS_TO_SAFE = RUNS_TO_SAFE_BASE;

/** 境界压制：每高出一个大境界，个人伤亡额外削减多少 */
export const REALM_OVERMATCH_REDUCTION = 0.35;
/** 高出两个大境界 → 完全不会伤亡（需求 9 明文） */
export const REALM_SAFE_GAP = 2;

/**
 * 需求 13：战力不足时伤亡率的额外惩罚上限。
 *
 * 缺口越大越接近这个倍数（缺口 100% 时就是这么多倍）。取 2 而不是更高，
 * 是因为队伍级伤亡已经被 `MAX_CASUALTY_RATE` 封顶 —— 再高也只是更快撞上天花板，
 * 而"派弱队去硬闯"的代价本来就够明显了。
 */
export const UNDERPOWERED_MAX_PENALTY = 2;
/** 单次探索的产量浮动范围 */
export const YIELD_VARIANCE_MIN = 0.8;
export const YIELD_VARIANCE_MAX = 1.2;
/** 战力不足时的最低产量系数 */
export const MIN_YIELD_FACTOR = 0.5;
/** 战力碾压时的最高产量系数 */
export const MAX_YIELD_FACTOR = 3;
