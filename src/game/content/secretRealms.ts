/**
 * 秘境（需求 1 / 5）
 *
 * 需求原文：
 *   1.「秘境设计为弟子或者玩家探索发现，发现后固定在秘境栏，
 *      每次探索后需要隔一段时间才能再次探索。秘境探索有境界限制，
 *      并且人越多最终获取的资源越多。」
 *   5.「设计一个地图，并划分不同区域，玩家或者弟子只有等级高了，
 *      才能去更远的地域探索」
 *
 * 后续需求把地图扩到 **18 个区域、每区 2~3 处秘境**（共 44 处）。
 *
 * 秘境不再是「攒够材料就自动出现」，而是**探索中发现**的：
 *   - 每处秘境挂在地图的一个区域下（见 map.ts），区域有境界门槛；
 *   - 弟子探索或掌门游历时有概率发现新秘境，发现后永久固定在秘境栏；
 *   - 每次探索完毕该秘境进入冷却，冷却结束才能再探；
 *   - 派遣人数在 minParty~maxParty 之间自由决定，人越多总产出越高。
 *
 * ⚠️ 44 处秘境要是逐个手写推荐战力/时长/冷却/伤亡/掉落，改平衡时没人找得全。
 * 所以这里拆成三层：
 *   REGION_ROWS(map.ts) → 区域档次 tier(1~9) → TIER_STATS / TIER_POOLS
 * 每处秘境只声明「我在哪个区域、我是什么路数（profile）」，rank 由表内顺序推出，
 * 具体数值由 buildRealm 算出来。想调平衡只改那两张表。
 *
 * 结算的核心公式（在 expeditions.ts 里实现）：
 *   战力比 = 队伍总战力 / 秘境推荐战力
 *   人数系数 = 1 + (人数 - minParty) × PARTY_YIELD_PER_EXTRA
 *   产出   = 基础 × clamp(战力比, 0.5, 3) × 人数系数 × 增益 × 随机浮动
 *   伤亡率 = 基础伤亡率 / 战力比 × (1 - 减免)
 */
import { MAP_REGION_MAP, regionIndex, regionTier, type MapRegionDef } from './map';
import { REALMS } from './realms';
import type { ItemId } from './resources';

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
  /** 所在的地图区域（见 map.ts）。区域门槛是探索的第一道门 */
  regionId: string;
  /** 区域档次 1~9，由区域在地图上的位置推出 */
  tier: number;
  /** 推荐战力 */
  requiredPower: number;
  /** 一次探索所需的进度秒数（受探索速度加成影响） */
  duration: number;
  /** 至少派遣几名弟子 */
  minParty: number;
  /** 最多能派遣几名弟子（人越多产出越高，见 PARTY_YIELD_PER_EXTRA） */
  maxParty: number;
  /** 弟子境界下限 */
  minRealm: number;
  /** 一次探索结束后的冷却秒数（需求 1：隔一段时间才能再探） */
  cooldown: number;
  /** 基础伤亡率 */
  baseCasualty: number;
  loot: LootEntry[];
  /** 小概率直接掉成品丹药 */
  pillLoot?: PillLootEntry[];
  /** 带回材料种子的概率（需求 5） */
  seedChance: number;
  /** 此地最低会掉几级稀有度的种子（默认 1） */
  seedMinRarity: number;
  /** 该秘境最多能掉出多少级的种子稀有度 */
  seedMaxRarity: number;
  /** 掉落图纸的概率（需求 6）。0 表示此地不出图纸 */
  blueprintChance: number;
  /** 发现难度权重：数字越大越容易被抽到（同区域内越靠后的秘境给越小的值） */
  discoveryWeight: number;
  requiresSectLevel?: number;
}

/* ------------------------------------------------------------------ */
/* 人数与掉落的通用常量                                                 */
/* ------------------------------------------------------------------ */

/** 每次探索从掉落表里抽取的条目数，还会随人数增加 */
export const LOOT_ROLLS = 3;

/**
 * 每多派一名弟子（超出 minParty）增加的抽取条目数，上限 LOOT_ROLLS_MAX。
 *
 * 「人越多最终获取的资源越多」有两种体现：
 *   1. 每多一人，数量系数 +40%（PARTY_YIELD_PER_EXTRA）
 *   2. 每多一人，多抽一条掉落
 * 两条叠加，所以多带人不是浪费。
 */
export const LOOT_ROLLS_PER_EXTRA = 1;
export const LOOT_ROLLS_MAX = 6;

/** 每多派一名弟子（超出 minParty）的总产量加成 */
export const PARTY_YIELD_PER_EXTRA = 0.4;

/**
 * 秘境掉落成品丹药的概率。
 *
 * 这是调平衡时踩过的坑：如果每次探索必掉一颗丹药，
 * 挂机几天就能囤几百颗境界丹，炼丹系统（需要提升炼丹品阶才能炼高阶丹）
 * 就完全失去意义了。所以限定成小概率掉落。
 */
export const PILL_DROP_CHANCE = 0.15;

/** 一次探索最多带回几种种子 */
export const SEED_ROLLS = 1;

/** 图纸只会从「元婴期以上」的秘境里掉出来 —— 那里才有资格谈论上古传承 */
export const MIN_REALM_FOR_BLUEPRINT = 3;

/* ------------------------------------------------------------------ */
/* 区域档次 → 秘境数值                                                  */
/* ------------------------------------------------------------------ */

interface TierStat {
  /** 推荐战力 = 该区域境界的弟子基础战力 × 这个倍数 */
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
  /** 需要几品宗门（0 = 不限） */
  sectLevel: number;
}

/**
 * 九档秘境数值。
 *
 * 推荐战力刻意锚定在「本区域境界的弟子基础战力 × powerMult」上，
 * 而不是写死一个绝对数字 —— 否则加了新境界、弟子战力整体上台阶之后，
 * 44 处秘境的推荐战力会全部失准。倍数从 2 缓升到 10，
 * 意思是越深处越需要靠器物、丹药、宗门建筑把弟子堆上去。
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
 * 每档的掉落池。
 *
 * 覆盖了全部 13 种材料：低档只出基础材料与月华露，
 * 越往后越往稀有材料上走（星辰砂 → 太阴玄晶/龙血 → 九幽魂火/仙玉 → 混沌紫气/鸿蒙道果）。
 * 这样「越高品阶的丹方越需要稀有材料」在获取端也对得上。
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

/** 秘境的路数：决定它偏向产出哪一类材料（只影响权重与必掉项） */
export type RealmProfile = 'herb' | 'ore' | 'beast' | 'ruin' | 'frost' | 'void' | 'heaven';

const PROFILE_PICKS: Record<RealmProfile, ItemId[]> = {
  herb: ['herb', 'moonDew', 'coldJade'],
  ore: ['ore', 'blackIron', 'fireMarrow', 'starSand'],
  beast: ['demonCore', 'spiritSilk', 'dragonBlood'],
  ruin: ['blackIron', 'lunarCrystal', 'immortalJade', 'netherFlame'],
  frost: ['coldJade', 'lunarCrystal', 'moonDew'],
  void: ['chaosQi', 'netherFlame', 'immortalJade', 'starSand'],
  heaven: ['primordialFruit', 'immortalJade', 'chaosQi', 'dragonBlood'],
};

/* ------------------------------------------------------------------ */
/* 44 处秘境：只声明"在哪儿、什么路数"                                   */
/* ------------------------------------------------------------------ */

/** 紧凑的秘境定义表：id / 名称 / 图标 / 所属区域 / 路数 / 说明 */
type RealmRow = [
  id: string,
  name: string,
  icon: string,
  regionId: string,
  profile: RealmProfile,
  desc: string,
];

const REALM_ROWS: RealmRow[] = [
  /* ---- 近郊山野（炼气） ---- */
  ['sunsetValley', '落霞谷', '🌄', 'nearHills', 'beast', '谷中妖兽多为炼气期，是新入门的弟子练手之处。'],
  ['wolfRavine', '野狼涧', '🐺', 'nearHills', 'beast', '涧中狼群成患，附近凡俗村落久已不敢靠近。'],
  ['herbSlope', '药草坡', '🌿', 'nearHills', 'herb', '向阳的缓坡上，野生灵草长势极好。'],

  /* ---- 荒村古道（炼气） ---- */
  ['ruinedVillage', '荒村遗址', '🏚', 'wildRoad', 'herb', '村人早已迁走，屋舍间的药圃却还活着。'],
  ['stoneQuarry', '采石旧场', '🪨', 'wildRoad', 'ore', '废弃多年的采石场，石壁里还能凿出灵矿。'],

  /* ---- 迷雾边陲（筑基） ---- */
  ['blackWindRidge', '黑风岭', '🌫', 'mistyFrontier', 'beast', '常年黑风怒号，岭中隐匿筑基期妖兽。'],
  ['mistLake', '迷雾灵湖', '🌁', 'mistyFrontier', 'herb', '湖面白雾不散，湖心岛上生着成片灵草。'],

  /* ---- 断魂崖（筑基） ---- */
  ['soulCliffRuins', '蚀骨洞', '💀', 'soulCliff', 'ruin', '崖壁上千疮百孔，尽是前人开凿的洞窟。'],
  ['boneGarden', '白骨园', '🦴', 'soulCliff', 'ruin', '白骨堆积如林，正中却生着一株不知名的树。'],
  ['coldSpringCave', '寒泉洞', '🧊', 'soulCliff', 'frost', '洞中寒泉彻骨，泉底沉着点点寒玉。'],

  /* ---- 烈焰荒原（金丹） ---- */
  ['emberPit', '地火谷', '🌋', 'scorchedWilds', 'ore', '地火自谷底喷涌，火光映红半边天。'],
  ['fireMarrowCave', '地火髓窟', '🔥', 'scorchedWilds', 'ore', '深入谷底的洞窟，壁上凝着厚厚的地火髓。'],

  /* ---- 万骨泽（金丹） ---- */
  ['marshOfBones', '白骨泥沼', '🪦', 'boneMarsh', 'ruin', '淤泥之下全是断骨，走一步陷一步。'],
  ['boneField', '万骨战场', '⚔', 'boneMarsh', 'ruin', '上古修士大战之地，怨气凝而不散，遍地残兵断刃。'],
  ['plagueMist', '瘟瘴泽', '☠', 'boneMarsh', 'herb', '瘴气弥漫，却也因此长出了外界难寻的药草。'],

  /* ---- 星陨深渊（元婴） ---- */
  ['starfallAbyss', '坠星渊底', '☄', 'starfallDeep', 'ore', '天外星辰坠落之所，渊底遍是星辰砂。'],
  ['meteorField', '陨星原', '🌠', 'starfallDeep', 'ore', '大大小小的陨星散落一地，捡都捡不完。'],

  /* ---- 寒泉幽谷（元婴） ---- */
  ['iceCrystalCave', '玄晶冰窟', '💠', 'iceValley', 'frost', '万载寒冰凝成的洞窟，太阴玄晶就长在冰里。'],
  ['frozenAbyss', '万载寒渊', '❄', 'iceValley', 'frost', '渊底的水早已冻成玉，敲下一块便是寒玉。'],

  /* ---- 幽冥虚空（化神） ---- */
  ['netherSea', '幽冥血海', '🌊', 'netherVoid', 'beast', '血海翻涌，海底沉睡着上古真龙遗骸，九幽魂火在水面飘荡。'],
  ['ghostTide', '阴潮滩', '👻', 'netherVoid', 'ruin', '潮水退去后，滩上留下许多不愿散去的影子。'],
  ['soulAltar', '祭魂坛', '🕯', 'netherVoid', 'ruin', '不知谁人在此立坛祭魂，坛上魂火百年不熄。'],

  /* ---- 血海孤岛（化神） ---- */
  ['bloodPalace', '血宫', '🩸', 'bloodIsles', 'beast', '血海中央的宫殿，宫墙竟是用龙血浇成的。'],
  ['dragonGrave', '真龙葬地', '🐉', 'bloodIsles', 'beast', '龙骸盘踞成山，龙骨缝隙里全是凝固的龙血。'],

  /* ---- 古仙遗迹（化神） ---- */
  ['immortalRuin', '仙宫遗迹', '🏛', 'ancientRuin', 'ruin', '殿宇半塌，仙玉嵌在残柱上，依旧温润。'],
  ['swordTomb', '剑冢', '🗡', 'ancientRuin', 'ore', '万千断剑插在土里，剑锋上的寒光未散。'],
  ['ancientPillGarden', '古药圃', '🪷', 'ancientRuin', 'herb', '上古丹修留下的药圃，阵纹至今仍在运转。'],

  /* ---- 太虚仙径（炼虚） ---- */
  ['voidParadise', '太虚仙境', '🌌', 'voidCorridor', 'void', '仙宫正殿悬在虚空正中，殿门一开便有仙玉滚落。'],
  ['cloudTerrace', '云台', '🛕', 'voidCorridor', 'heaven', '仙宫最高处的一方云台，据说能听见上界的声音。'],

  /* ---- 虚空回廊（炼虚） ---- */
  ['corridorRuins', '无尽回廊', '🌀', 'starCorridor', 'void', '回廊望不到尽头，两侧是无数个同样的自己。'],
  ['starGate', '星门', '🪐', 'starCorridor', 'void', '一道由星砂凝成的门，门后不知通向哪里。'],
  ['mirrorRealm', '镜界', '🪞', 'starCorridor', 'void', '整片空间光滑如镜，踩上去会碎成千万片。'],

  /* ---- 界外混沌（合体） ---- */
  ['primordialRuins', '鸿蒙遗境', '🌀', 'outerChaos', 'void', '开天辟地时残留的一角，法则残缺，紫气自裂隙中溢出。'],
  ['chaosWhirl', '混沌漩涡', '🌪', 'outerChaos', 'void', '混沌之气卷成的漩涡，靠得太近就会被撕碎。'],

  /* ---- 鸿蒙残界（合体） ---- */
  ['chaosTide', '混沌潮汐', '🌊', 'primordialRemnant', 'void', '混沌之海一涨一落，留下满地凝结的紫气。'],
  ['originSpring', '太初灵泉', '⛲', 'primordialRemnant', 'heaven', '开天辟地时的第一眼灵泉，泉水至今未干。'],
  ['lawFragment', '法则残片', '🔮', 'primordialRemnant', 'void', '半空中悬着几片破碎的法则，映出已被抹去的世界。'],

  /* ---- 星海尽头（大乘） ---- */
  ['starSeaRuins', '虚无之涯', '✨', 'starSeaEnd', 'void', '星海到此断绝，脚下是彻底的空，连光都留不住。'],
  ['starRaftWreck', '星槎遗骸', '🛶', 'starSeaEnd', 'void', '一艘横渡星海的古舟残骸，舱中仙玉成堆。'],

  /* ---- 上界云台（大乘） ---- */
  ['gateOfHeaven', '上界之门', '🚪', 'heavenTerrace', 'heaven', '传说中的仙门。门后即是上界，多少修士有去无回。'],
  ['heavenPalace', '云台仙阙', '🏯', 'heavenTerrace', 'heaven', '云台之上的宫阙，梁柱皆由道果化成的木料所筑。'],
  ['immortalBanquet', '仙宴遗址', '🍑', 'heavenTerrace', 'herb', '仙人宴饮过的地方，席上的道果竟还留着一枚。'],

  /* ---- 九霄雷渊（渡劫） ---- */
  ['thunderAbyssPit', '雷渊绝底', '⚡', 'thunderAbyss', 'heaven', '渊底积着化不开的雷浆，每一滴都是一道劫雷。'],
  ['tribulationPeak', '渡劫峰', '⛰', 'thunderAbyss', 'heaven', '峰顶寸草不生，只有一道道被雷劈出的焦痕。'],
];

/* ------------------------------------------------------------------ */
/* 构建                                                                */
/* ------------------------------------------------------------------ */

/** 开局就已知的秘境：宗门草创时的第一处试炼地 */
export const STARTER_REALM_ID = 'sunsetValley';

function buildLoot(tier: number, profile: RealmProfile, amountScale: number): LootEntry[] {
  const pool = TIER_POOLS[tier];
  const picks = PROFILE_PICKS[profile];

  // 本路数偏好的材料里，取第一个出现在本档池子里的作为"招牌"，必掉
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
      // 偏好材料权重 ×2.5：同一档次的秘境因为路数不同，产出倾向明显不同
      weight: entry.weight * (picks.includes(entry.item) ? 2.5 : 1),
    });
  });

  return loot;
}

function buildRealm(row: RealmRow, rank: number): SecretRealmDef {
  const [id, name, icon, regionId, profile, desc] = row;
  const region: MapRegionDef = MAP_REGION_MAP[regionId] ?? MAP_REGION_MAP.nearHills;
  const tier = regionTier(region.id);
  const stat = TIER_STATS[tier];
  const indexInMap = Math.max(0, regionIndex(region.id));

  // 同档次的两个区域之间、以及同区域内的第 2/3 处，都要拉开差距
  const powerScale = 1 + 0.6 * rank;
  const amountScale = (1 + 0.35 * (indexInMap % 2)) * (1 + 0.15 * rank);

  const basePower = REALMS[Math.min(region.requiresRealm, REALMS.length - 1)].power;
  const requiredPower = Math.max(1, Math.round(basePower * stat.powerMult * powerScale));

  const rankWeightFactor = [1, 0.8, 0.6][rank] ?? 0.5;
  const discoveryWeight =
    id === STARTER_REALM_ID ? 0 : Math.max(1, Math.round((12 - tier) * rankWeightFactor));

  return {
    id,
    name,
    icon,
    desc,
    regionId: region.id,
    tier,
    requiredPower,
    duration: Math.round(stat.duration * (1 + 0.15 * rank)),
    minParty: stat.minParty,
    maxParty: stat.maxParty,
    // 弟子门槛比区域门槛松一级：刚能抵达的区域不至于立刻无人可派
    minRealm: Math.max(0, region.requiresRealm - 1),
    cooldown: Math.round(stat.cooldown * (1 + 0.2 * rank)),
    baseCasualty: Math.min(0.35, stat.casualty + rank * 0.01),
    loot: buildLoot(tier, profile, amountScale),
    pillLoot: TIER_PILLS[tier],
    seedChance: stat.seedChance,
    seedMinRarity: stat.seedMinRarity,
    seedMaxRarity: stat.seedMaxRarity,
    blueprintChance: stat.blueprintChance,
    discoveryWeight,
    requiresSectLevel: stat.sectLevel > 0 ? stat.sectLevel : undefined,
  };
}

export const SECRET_REALMS: SecretRealmDef[] = REALM_ROWS.map((row, index) => {
  const regionId = row[3];
  // rank = 本区域内的第几处（内容表里按区域顺序排列，数一数就行）
  const rank = REALM_ROWS.slice(0, index).filter((prev) => prev[3] === regionId).length;
  return buildRealm(row, rank);
});

export const SECRET_REALM_MAP: Record<string, SecretRealmDef> = SECRET_REALMS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, SecretRealmDef>,
);

/** 预先按区域分好组，界面按区域渲染时不用每次 filter */
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
 * - 累积概率会直接写进 `getDiscoveryChance()`，于是"发现概率"就不止
 *   寻宝宝盘一个来源了，几种建筑堆在一起谁也看不出区别；
 * - 硬保底是**另一条独立机制**：概率公式里没有它，它只在连续失败太多次时
 *   兜一次底。所以「发现概率只能靠寻宝宝盘提升」这句话是真的。
 *
 * 没有保底是不行的：秘境是稀有材料的唯一来源，运气差的玩家可能永远开不出
 * 下一处，而他又没有足够的材料去做宝盘 —— 那就是死锁。
 */
export const DISCOVERY_PITY_FAILURES = 10;

/**
 * 发现概率总上限。
 *
 * 满配（十几座寻宝宝盘）时会被这里砍住 —— 保留 25% 的运气成分，
 * 免得"发现"退化成"按顺序解锁"。注意它**不再是**若干建筑的公共天花板：
 * 现在只有寻宝宝盘一条路能往上加，所以这个上限是给宝盘准备的终点，
 * 而不是让几种建筑挤在一起失去区分度。
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
