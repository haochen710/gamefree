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
  subRealmCount,
  type MapRegionDef,
  type RealmProfile,
} from './map';
import { REALMS } from './realms';
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
  /** 弟子境界下限 */
  minRealm: number;
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
  2: { powerMult: 3, duration: 240, cooldown: 180, casualty: 0.04, seedChance: 0.35, seedMinRarity: 1, seedMaxRarity: 3, blueprintChance: 0, minParty: 1, maxParty: 5, sectLevel: 0 },
  3: { powerMult: 4, duration: 420, cooldown: 300, casualty: 0.06, seedChance: 0.4, seedMinRarity: 2, seedMaxRarity: 3, blueprintChance: 0, minParty: 2, maxParty: 6, sectLevel: 0 },
  4: { powerMult: 5, duration: 700, cooldown: 500, casualty: 0.09, seedChance: 0.45, seedMinRarity: 2, seedMaxRarity: 4, blueprintChance: 0, minParty: 2, maxParty: 7, sectLevel: 0 },
  5: { powerMult: 6, duration: 1000, cooldown: 700, casualty: 0.12, seedChance: 0.5, seedMinRarity: 3, seedMaxRarity: 5, blueprintChance: 0.05, minParty: 3, maxParty: 8, sectLevel: 0 },
  6: { powerMult: 7, duration: 1400, cooldown: 950, casualty: 0.15, seedChance: 0.55, seedMinRarity: 3, seedMaxRarity: 5, blueprintChance: 0.07, minParty: 3, maxParty: 9, sectLevel: 2 },
  7: { powerMult: 8, duration: 1900, cooldown: 1300, casualty: 0.18, seedChance: 0.6, seedMinRarity: 4, seedMaxRarity: 6, blueprintChance: 0.09, minParty: 4, maxParty: 10, sectLevel: 3 },
  8: { powerMult: 9, duration: 2500, cooldown: 1700, casualty: 0.22, seedChance: 0.62, seedMinRarity: 4, seedMaxRarity: 6, blueprintChance: 0.12, minParty: 4, maxParty: 12, sectLevel: 5 },
  9: { powerMult: 10, duration: 3200, cooldown: 2200, casualty: 0.26, seedChance: 0.65, seedMinRarity: 5, seedMaxRarity: 6, blueprintChance: 0.15, minParty: 5, maxParty: 14, sectLevel: 7 },
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

function buildRealm(
  region: MapRegionDef,
  rank: number,
  profile: RealmProfile,
  specialty: MaterialId | null,
): SecretRealmDef {
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
    minRealm: Math.max(0, MAJOR_REGION_MAP[region.majorId]?.requiresRealm ?? 0),
    cooldown: Math.round(stat.cooldown * (1 + 0.2 * rank)),
    baseCasualty: Math.min(0.35, stat.casualty + rank * 0.01),
    loot: buildLoot(tier, profile, amountScale, specialty),
    pillLoot: TIER_PILLS[tier],
    seedChance: stat.seedChance,
    seedMinRarity: stat.seedMinRarity,
    seedMaxRarity: stat.seedMaxRarity,
    blueprintChance: stat.blueprintChance,
    discoveryWeight,
    requiresSectLevel: stat.sectLevel > 0 ? stat.sectLevel : undefined,
    specialty: specialty ?? undefined,
    rank,
  };
}

export const SECRET_REALMS: SecretRealmDef[] = MAP_REGIONS.flatMap((region) => {
  const count = subRealmCount(region.index);
  const major = MAJOR_REGION_MAP[region.majorId];
  const primaryFlavor: RealmProfile = major?.flavor ?? 'herb';
  // 副路数要**避开**主路数，否则同一小区域里两处秘境会撞名（都叫「XX·药圃」）
  const others = SECONDARY_FLAVOR.filter((f) => f !== primaryFlavor);

  return Array.from({ length: count }, (_, rank) => {
    // 资源富集区的第一处是特产秘境，其余按主/副路数交替
    const specialty =
      region.index >= RICH_SUB_INDEX && rank === 0 ? (major?.specialty ?? null) : null;
    const profile: RealmProfile =
      rank === 0
        ? primaryFlavor
        : others[((major?.index ?? 0) * 3 + region.index + rank) % others.length];
    return buildRealm(region, rank, profile, specialty);
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
export const DISCOVERY_BASE_CHANCE = 0.15;

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
export const DISCOVERY_MAX_CHANCE = 0.75;

/* ------------------------------------------------------------------ */
/* 结算上下限                                                          */
/* ------------------------------------------------------------------ */

/** 伤亡率上限，避免高难度直接把队伍全灭 */
export const MAX_CASUALTY_RATE = 0.6;
/** 单次探索的产量浮动范围 */
export const YIELD_VARIANCE_MIN = 0.8;
export const YIELD_VARIANCE_MAX = 1.2;
/** 战力不足时的最低产量系数 */
export const MIN_YIELD_FACTOR = 0.5;
/** 战力碾压时的最高产量系数 */
export const MAX_YIELD_FACTOR = 3;
