/**
 * 钻研系统（需求 6）
 *
 * 需求原文：「除了基础资源建筑，其余建筑需要钻研技术或者图纸解锁，并不止依靠玩家等级。
 *           技术和图纸需要跟玩家等级挂钩，部分稀有建筑需要探索或者商行购买。」
 *
 * 于是建筑的门槛从「一条」变成「三条并行」：
 *   技术（TECHS）      —— 自己钻研，需要境界 + 灵石 + 前置技术，钻研需要时间
 *   图纸（BLUEPRINTS） —— 自己做不出来，只能探索或商行购买
 *   境界 / 宗门品阶    —— 原来的门槛仍然保留
 *
 * 只有基础资源设施（聚灵阵、灵木林、灵矿脉、灵田、灵石矿）不需要任何钻研，
 * 保证开局永远有路可走，不会出现"一个建筑都建不了"的死锁。
 */
import type { ItemId } from './resources';

/* ------------------------------------------------------------------ */
/* 技术                                                                */
/* ------------------------------------------------------------------ */

export interface TechDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 钻研所需的玩家境界下标（对应 REALMS） */
  requiresRealm: number;
  /** 钻研消耗（在开始钻研时一次性扣除） */
  cost: Partial<Record<ItemId, number>>;
  /** 钻研耗时（真实秒）。钻研同一时间只能进行一项 */
  seconds: number;
  /** 前置技术 */
  requires: string[];
}

/**
 * 技术表。
 *
 * 造价刻意压在「商行 / 游历能赚到」的量级上 ——
 * 灵石的早期来源是个人游历（需求 1），
 * 所以第一条技术（炼丹入门）只要 100 灵石，出门走一趟就能凑齐。
 */
export const TECHS: TechDef[] = [
  {
    id: 'alchemyArt',
    name: '炼丹入门',
    icon: '⚗',
    desc: '辨识药性、掌握火候，可建丹房开炉炼丹。',
    requiresRealm: 0,
    cost: { stone: 100, herb: 50 },
    seconds: 20,
    requires: [],
  },
  {
    id: 'refiningArt',
    name: '炼器入门',
    icon: '🔨',
    desc: '锻打淬火之法，可建炼器房铸造器物。',
    requiresRealm: 0,
    cost: { stone: 150, ore: 150 },
    seconds: 25,
    requires: [],
  },
  {
    id: 'storageArt',
    name: '储物之术',
    icon: '👝',
    desc: '在器物上铭刻须弥纹，可建造更精妙的储物之所。',
    requiresRealm: 1,
    cost: { stone: 500, wood: 200 },
    seconds: 45,
    requires: [],
  },
  {
    id: 'architecture',
    name: '营造之术',
    icon: '🏯',
    desc: '依山就势、引灵入宅，可建造真正的院落。',
    requiresRealm: 1,
    cost: { stone: 400, wood: 300 },
    seconds: 40,
    requires: [],
  },
  {
    id: 'tradeArt',
    name: '商道',
    icon: '🏪',
    desc: '与散修、凡俗王朝通商，可开设商行。',
    requiresRealm: 2,
    cost: { stone: 2500, wood: 600 },
    seconds: 90,
    requires: ['architecture'],
  },
  {
    id: 'plantingArt',
    name: '灵植之术',
    icon: '🌱',
    desc: '以灵泉灌溉、以阵法催生，可开辟灵植园种植灵材。',
    requiresRealm: 2,
    cost: { stone: 2000, herb: 400 },
    seconds: 90,
    requires: ['alchemyArt'],
  },
  {
    id: 'preachingArt',
    name: '传道之术',
    icon: '📖',
    desc: '开坛讲道、点化迷津，弟子修行事半功倍。',
    requiresRealm: 3,
    cost: { stone: 1e4, wood: 1500 },
    seconds: 150,
    requires: ['architecture'],
  },
  {
    id: 'voidStorageArt',
    name: '须弥之法',
    icon: '🕳',
    desc: '芥子纳须弥，可开辟自成一界的储物空间。',
    requiresRealm: 3,
    cost: { stone: 3e4, starSand: 20 },
    seconds: 200,
    requires: ['storageArt'],
  },
  {
    id: 'caveHeavenArt',
    name: '洞天开辟',
    icon: '⛩',
    desc: '以大法力割裂空间，开辟洞天福地。',
    requiresRealm: 4,
    cost: { stone: 3e5, starSand: 60 },
    seconds: 300,
    requires: ['architecture'],
  },
  {
    id: 'cosmosStorageArt',
    name: '混元之法',
    icon: '🔮',
    desc: '以混元一气重铸储物之所，可容纳一域之资。',
    requiresRealm: 6,
    cost: { stone: 2e6, immortalJade: 30 },
    seconds: 400,
    requires: ['voidStorageArt'],
  },
  {
    id: 'gardenArt',
    name: '药王之道',
    icon: '🌿',
    desc: '移植上古药圃的阵图，一圃可当十圃之用。',
    requiresRealm: 4,
    cost: { stone: 8e4, herb: 6000 },
    seconds: 300,
    requires: ['plantingArt'],
  },
];

export const TECH_MAP: Record<string, TechDef> = TECHS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, TechDef>,
);

/* ------------------------------------------------------------------ */
/* 图纸                                                                */
/* ------------------------------------------------------------------ */

export interface BlueprintDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /**
   * 需要掌门达到该境界，图纸才会出现（需求 6：「技术和图纸需要跟玩家等级挂钩」）。
   *
   * 与它解锁的建筑的 requiresRealm 保持一致 —— 拿到图纸就能立刻建，
   * 不会出现"捡到一张用不了的图，在背包里躺两天"的挫败感。
   */
  requiresRealm: number;
  /** 界面提示：去哪儿找 */
  source: string;
}

/**
 * 图纸。
 *
 * 与技术的区别：图纸**钻研不出来**，只能从探索或商行得到。
 * 刻意只用来解锁「锦上添花」的稀有建筑（加成类），
 * 绝不用来解锁储物、居所这类卡进度的东西 ——
 * 否则运气不好就会卡死在原地。
 */
export const BLUEPRINTS: BlueprintDef[] = [
  {
    id: 'spiritBoatBlueprint',
    name: '灵舟图纸',
    icon: '🛶',
    desc: '上古修士横渡虚空的灵舟构造图，可建灵舟坊加快出行。',
    requiresRealm: 3,
    source: '元婴期后，秘境探索或商行',
  },
  {
    id: 'thunderPoolBlueprint',
    name: '雷池图纸',
    icon: '⚡',
    desc: '引天雷入池、以雷淬体的阵图，可建雷池助益突破。',
    requiresRealm: 4,
    source: '化神期后，秘境探索或商行',
  },
  {
    id: 'starAltarBlueprint',
    name: '星坛图纸',
    icon: '🌟',
    desc: '接引周天星力的祭坛图样，可建星坛增益全局产量。',
    requiresRealm: 6,
    source: '合体期后，秘境探索或商行',
  },
];

export const BLUEPRINT_MAP: Record<string, BlueprintDef> = BLUEPRINTS.reduce(
  (acc, b) => {
    acc[b.id] = b;
    return acc;
  },
  {} as Record<string, BlueprintDef>,
);
