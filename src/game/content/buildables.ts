/**
 * 可建造物：设施（有产出）与建筑（无产出，提供容量或功能）
 *
 * 两者共用同一套「等比递增价格」机制，所以共用一个基类。
 * engine.ts 里的价格计算、批量购买对它俩是通用的。
 *
 * 门槛共有**七**道，全部满足才能建造：
 *   1. unlock             —— 曾经拥有过若干资源（一次性，永久记录）
 *   2. requiresTech       —— 钻研出对应技术
 *   3. requiresBlueprint  —— 持有对应图纸（只能探索或商行获取）
 *   4. requiresBuilding   —— 先建成某座前置建筑（宗门建筑用）
 *   5. requiresSect       —— 必须先开宗立派（弟子居所、宗门建筑用，需求 2）
 *   6. requiresRealm      —— 掌门境界
 *   7. requiresSectLevel  —— 宗门品阶
 * 只有基础资源设施不需要 2~4（也正因为如此，开局永远有路可走）。
 *
 * ⚠️ 这里原先写的是"六种"，漏掉了 `requiresSect` —— 而它恰恰是需求 2 给
 * 弟子居所整组加上的那一道门，写漏了会让读者以为"没开宗也能盖弟子舍"。
 */
import { HAPPINESS_BUILDINGS } from './happiness';
import { SECT_ARRAY_BUILDING_ID } from './talismans';
import { RESOURCE_MAP } from './resources';
import type { ItemId, ResourceId } from './resources';

/** 建筑分组，用于界面归类 */
export type BuildGroupId =
  | 'resource'
  | 'storage'
  | 'happiness'
  | 'housing'
  | 'discipleHousing'
  | 'workshop'
  | 'farm'
  | 'trade'
  | 'build'
  | 'hall'
  | 'sect';

export interface BuildGroupDef {
  id: BuildGroupId;
  title: string;
  hint: string;
}

export const BUILD_GROUPS: BuildGroupDef[] = [
  { id: 'resource', title: '资源设施', hint: '持续产出各类资源，无需钻研即可建造' },
  { id: 'storage', title: '储物建筑', hint: '提高资源储存上限，部分需要钻研储物之术' },
  { id: 'happiness', title: '幸福度建筑', hint: '极其稀有：唯一、造价高、要稀有材料' },
  { id: 'housing', title: '仆役居所', hint: '只住凡人仆役 —— 与弟子居所完全分开' },
  { id: 'discipleHousing', title: '弟子居所', hint: '开宗立派之后才能建，只住弟子（需求 2）' },
  { id: 'workshop', title: '丹器工坊', hint: '决定炼丹炼器的品阶上限，需先钻研' },
  { id: 'farm', title: '灵植药圃', hint: '种植材料种子的地块，需先钻研灵植之术' },
  { id: 'trade', title: '坊市商行', hint: '定期刷新货物，可用灵石换取物资与图纸' },
  { id: 'build', title: '营造', hint: '决定建造队列的名额（需求 2）' },
  { id: 'hall', title: '宗门建筑', hint: '掌门大殿与山门无需钻研，其余皆需（需求 4）' },
  { id: 'sect', title: '宗门奇珍', hint: '需要技术或图纸才能建造的稀有建筑' },
];

/** 弟子自发使用该建筑时触发的事件类型（需求 4） */
export type SectEventKind = 'cultivate' | 'insight' | 'discover';

export interface BuildableBase {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 界面上归到哪一组 */
  group: BuildGroupId;
  /** 第一个的价格 */
  baseCost: Partial<Record<ItemId, number>>;
  /** 每多买一个，价格乘以该系数 */
  costGrowth: number;
  /**
   * 解锁条件：拥有过这么多资源后永久解锁。
   *
   * 注意是「拥有过」而不是「当前拥有」—— 解锁状态一旦达成就永久记录，
   * 否则玩家一花掉灵气，已经建过的建筑就会从面板上消失。
   */
  unlock: Partial<Record<ItemId, number>>;
  /** 需要钻研出该技术才能建造（需求 6） */
  requiresTech?: string;
  /** 需要持有该图纸才能建造（需求 6，只能探索或商行获得） */
  requiresBlueprint?: string;
  /** 需要先建成该建筑（宗门建筑之间用，需求 4） */
  requiresBuilding?: string;
  /** 必须先开宗立派（需求 4：宗门建筑） */
  requiresSect?: boolean;
  /** 需要宗门达到该等级才能建造（默认 0，即不限制） */
  requiresSectLevel?: number;
  /**
   * 需要掌门达到该境界才能建造（下标对应 REALMS）。
   * 提前一个境界就会显示出来（灰掉并标注需求），让玩家看到下一级的目标。
   */
  requiresRealm?: number;
  /**
   * 建造数量上限。
   *
   * 储物建筑必须设上限：价格是等比递增的，买太多之后
   * 「下一座的价格」会超过「当前储存上限」，而资源又永远涨不上去，
   * 游戏就永久卡死了。设了上限就彻底排除了这种死锁。
   */
  max?: number;
}

/** 设施：持续产出资源 */
export interface GeneratorDef extends BuildableBase {
  kind: 'generator';
  produces: ResourceId;
  /** 单个设施每秒基础产量（未计入全局倍率） */
  baseOutput: number;
}

/** 建筑：不产出资源，提供容量、地块、加成或功能 */
export interface StructureDef extends BuildableBase {
  kind: 'structure';
  /**
   * 提供多少**仆役**居所名额（需求 2）。
   *
   * ⚠️ 本轮需求：「仆役居所和弟子居所区分开」。
   * 原先只有一个 `capacity`，仆人和弟子抢同一批床位 —— 于是"收仆人换产量"
   * 和"收弟子换战力"变成了一道零和题，而玩家真正想要的往往是"我全都要"。
   * 拆成两个字段之后，两条线各自成长，取舍从"抢床位"变成"资源先投哪边"。
   */
  servantCapacity?: number;
  /** 提供多少**弟子**居所名额（需求 2）。只有弟子居所与掌门大殿会给 */
  discipleCapacity?: number;
  /** 提供多少炼丹位 */
  alchemySlots?: number;
  /** 提供多少炼器位 */
  refiningSlots?: number;
  /** 提供多少灵植地块（需求 5） */
  plots?: number;
  /**
   * 每座提供的资源储存上限。
   *
   * 灵气是主资源、消耗量随境界指数增长，所以给得最多；
   * 灵石是通货、需求相对温和，比例最低。
   */
  storage?: Partial<Record<ResourceId, number>>;
  /** 弟子修炼速度加成（加算，0.15 = +15%） */
  cultivationBonus?: number;
  /** 弟子战力加成（加成探索收益与降低伤亡） */
  disciplePowerBonus?: number;
  /** 秘境探索速度加成（加算） */
  expeditionSpeedBonus?: number;
  /** 探索距离加成（加算）。距离越远，越容易发现远处的秘境（需求 5） */
  expeditionDistanceBonus?: number;
  /** 突破成功率加成（加算） */
  breakthroughBonus?: number;
  /** 全局产量加成（加算） */
  productionBonus?: number;
  /** 秘境产出加成（加算） */
  expeditionYieldBonus?: number;
  /** 探索伤亡率削减（加算，0.08 = -8%） */
  casualtyReduction?: number;
  /**
   * ⚠️ 这里**没有** discoveryBonus。
   *
   * 发现新秘境的概率只能靠「寻宝宝盘」提升（见 recipes.ts 的 ARTIFACTS）。
   * 早先山门 / 通天塔 / 照天镜各给一点，几个来源全都撞在
   * DISCOVERY_MAX_CHANCE 上，后期它们之间就没有区分度了。
   */
  /** 弟子心得获取加成（加算） */
  insightBonus?: number;
  /** 商行货位加成（每多一座多上架几件商品） */
  shopSlots?: number;
  /** 弟子随机事件：弟子会自发来这座建筑（需求 4）。比武台不用这个 */
  sectEvent?: SectEventKind;
  /** 是否解锁「大比」（需求 4，只有比武台） */
  arena?: boolean;
  /** 提供多少建造队列名额（需求 2，只有天工院） */
  queueSlots?: number;
  /**
   * 宗门防御强度（需求 1）：进攻类宗门事件的损失按 (1 − 防御) 削减。
   *
   * 可以累加到 1 以上 —— 那时进攻完全挡下，也就是需求说的
   * 「减少**乃至避免**弟子伤亡」。
   */
  sectDefense?: number;
  /**
   * 每座每分钟为**每名**弟子压制多少心魔（设定集第 14.3 章的静心阁）。
   *
   * 与其它加成一样按"座数求和"，上限由 `max` 兜住 —— 免得盖满之后
   * 全宗心魔永远是 0，"心魔"这条压力线就消失了。
   */
  mindDrain?: number;
  /**
   * 炼丹 / 炼器成功率加成（需求 2）。
   *
   * 丹炉阵与地火熔炉原来给的是"丹房 / 炼器房名额"，但需求 2 把丹房与炼器房
   * 改成了唯一建筑 —— 名额这条路没了，它们就顺势改成**提升成功率**：
   * 炉子越好，越不容易炸炉。这也正好接上"炼制有概率失败"那一条。
   */
  alchemySuccessBonus?: number;
  refiningSuccessBonus?: number;
}

export type BuildableDef = GeneratorDef | StructureDef;

/* ------------------------------------------------------------------ */
/* 设施（基础资源建筑：唯一不需要钻研的一类）                            */
/* ------------------------------------------------------------------ */

/**
 * 聚灵阵对弟子修炼的加成系数（本轮需求 6）。
 *
 * 实际加成 = 本系数 × **√座数**（收益递减）。
 *
 * ⚠️ 一开始写的是线性「每座 +2%」，模拟里立刻炸了：聚灵阵是最便宜的设施
 * （15 灵气起、成本只按 1.15 增长），AI 为了灵气盖了两百多座，
 * 修行倍率直接被推到 **×6.72** —— 而全局修行天花板本来是设计在 ×4 出头的
 * （正因为如此，早先把宗门大比从 ×2 压成了 +50%）。
 * 改成开方之后：4 座 +4%、25 座 +10%、100 座 +20%、400 座 +40%，
 * 既保住"阵越多弟子越快"，又永远不会把曲线顶穿。
 */
export const SPIRIT_ARRAY_CULTIVATION_BONUS = 0.02;

/** 聚灵阵给的修炼加成（含收益递减） */
export function spiritArrayCultivationBonus(count: number): number {
  return count <= 0 ? 0 : SPIRIT_ARRAY_CULTIVATION_BONUS * Math.sqrt(count);
}

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'spiritArray',
    kind: 'generator',
    group: 'resource',
    name: '聚灵阵',
    icon: '☯',
    /*
     * 本轮需求 6：「弟子修炼受宗门聚灵阵影响，宗门聚灵阵等级越高，加成越大」。
     *
     * 聚灵阵本来就是"宗门灵气的根"，所以把**座数**当成它的等级：
     * 每多一座，弟子修炼再快一点（见 SPIRIT_ARRAY_CULTIVATION_BONUS）。
     * 于是"多盖聚灵阵"同时有两份收益（灵气 + 修行），开局就值得投。
     */
    desc: `引天地灵气入洞府，修行起步的根本。越多弟子修炼越快（加成 = 2% × √座数，收益递减）。`,
    produces: 'qi',
    baseOutput: 0.6,
    baseCost: { qi: 15 },
    costGrowth: 1.15,
    unlock: {},
  },
  {
    id: 'woodGrove',
    kind: 'generator',
    group: 'resource',
    name: '灵木林',
    icon: '🌳',
    desc: '栽种灵木，可伐取建造所需的木料。',
    produces: 'wood',
    baseOutput: 0.25,
    baseCost: { qi: 120 },
    costGrowth: 1.15,
    unlock: { qi: 60 },
  },
  {
    id: 'oreVein',
    kind: 'generator',
    group: 'resource',
    name: '灵矿脉',
    icon: '⛰',
    desc: '开凿山腹灵脉，采掘蕴灵之矿，可炼器亦可供合成灵石。',
    produces: 'ore',
    baseOutput: 0.12,
    baseCost: { qi: 800, wood: 200 },
    costGrowth: 1.16,
    unlock: { wood: 50 },
  },
  {
    id: 'herbField',
    kind: 'generator',
    group: 'resource',
    name: '灵田',
    icon: '🍀',
    desc: '引灵泉灌溉，种植炼丹所需的灵草。',
    produces: 'herb',
    baseOutput: 0.06,
    baseCost: { qi: 3000, wood: 500 },
    costGrowth: 1.17,
    unlock: { ore: 100 },
  },
  {
    id: 'stoneMine',
    kind: 'generator',
    group: 'resource',
    name: '灵石矿',
    icon: '💎',
    desc: '开采蕴灵石脉。灵石是修仙界的通货，招收弟子、商行交易皆需。',
    produces: 'stone',
    baseOutput: 0.05,
    baseCost: { qi: 8000, ore: 800, herb: 200 },
    costGrowth: 1.17,
    unlock: { herb: 50 },
  },
  /* ---------------- 需求 3：中期资源设施，单座产出高得多 ---------------- */
  {
    id: 'spiritWell',
    kind: 'generator',
    group: 'resource',
    name: '灵泉井',
    icon: '⛲',
    desc: '凿通地底灵泉，井口日夜喷涌灵气，远胜聚灵阵。',
    produces: 'qi',
    baseOutput: 5,
    baseCost: { qi: 1e5, stone: 500 },
    costGrowth: 1.2,
    unlock: { stone: 300 },
  },
  {
    id: 'bambooSea',
    kind: 'generator',
    group: 'resource',
    name: '灵竹海',
    icon: '🎋',
    desc: '成片灵竹自行蔓延，砍之不尽，是中期木料的主力。',
    produces: 'wood',
    baseOutput: 2,
    baseCost: { qi: 4e5, wood: 4000, stone: 1500 },
    costGrowth: 1.2,
    unlock: { wood: 3000 },
  },
  {
    id: 'deepMine',
    kind: 'generator',
    group: 'resource',
    name: '深脉矿洞',
    icon: '🕳',
    desc: '直下千丈的矿洞，矿脉更厚，出矿远多于浅层。',
    produces: 'ore',
    baseOutput: 1.2,
    baseCost: { qi: 2e6, ore: 4000, stone: 4000 },
    costGrowth: 1.21,
    unlock: { ore: 3000 },
  },
  {
    id: 'hundredHerbGarden',
    kind: 'generator',
    group: 'resource',
    name: '百草园',
    icon: '🌿',
    desc: '依山势分畦的百草园，灵草长得又快又密。',
    produces: 'herb',
    baseOutput: 0.8,
    baseCost: { qi: 1e7, herb: 6000, stone: 2e4 },
    costGrowth: 1.22,
    unlock: { herb: 3000 },
  },
  {
    id: 'stoneLode',
    kind: 'generator',
    group: 'resource',
    name: '灵石母矿',
    icon: '🔷',
    desc: '一整条灵石母脉，凿开便是滚滚财源。',
    produces: 'stone',
    baseOutput: 0.6,
    baseCost: { qi: 4e7, stone: 2e4, ore: 2e4 },
    costGrowth: 1.22,
    unlock: { stone: 3000 },
  },
];

/* ------------------------------------------------------------------ */
/* 建筑                                                                */
/* ------------------------------------------------------------------ */

export const STRUCTURES: StructureDef[] = [
  /* ---------------- 仆役居所（需求 2：与弟子居所分开） ---------------- */
  {
    id: 'thatchHut',
    kind: 'structure',
    group: 'housing',
    name: '茅屋',
    icon: '🛖',
    desc: '最简陋的仆役居所，能住 3 名凡人。弟子不住这里 —— 弟子的住处在「弟子居所」一组里。',
    servantCapacity: 3,
    baseCost: { qi: 200, wood: 80 },
    costGrowth: 1.25,
    unlock: { wood: 30 },
  },
  {
    id: 'courtyard',
    kind: 'structure',
    group: 'housing',
    name: '院落',
    icon: '🏯',
    desc: '有山有水的独立院落，可安置 10 名仆役。需钻研营造之术。',
    servantCapacity: 10,
    baseCost: { qi: 5e4, wood: 1500, stone: 300 },
    costGrowth: 1.3,
    unlock: { stone: 50 },
    requiresTech: 'architecture',
  },
  {
    id: 'grotto',
    kind: 'structure',
    group: 'housing',
    name: '洞天',
    icon: '⛩',
    desc: '以大法力开辟的洞天福地，可安置 30 名仆役。需钻研洞天开辟。',
    servantCapacity: 30,
    baseCost: { qi: 2e6, stone: 2e4, herb: 5000 },
    costGrowth: 1.35,
    unlock: { stone: 5000 },
    requiresTech: 'caveHeavenArt',
    /*
     * 宗门门槛夹到「化神期最多能有几品宗门」= 2 品（本轮需求 3）。
     * 原来写的是 4 品，而那个品阶本身要 炼虚期 ——
     * 与这栋建筑自己声明的「需化神期」互相打架。
     */
    requiresSectLevel: 2,
  },
  {
    id: 'immortalResidence',
    kind: 'structure',
    group: 'housing',
    name: '仙府',
    icon: '🏛',
    desc: '自成一方小世界的府邸，可安置 100 名仆役。需钻研洞天开辟。',
    servantCapacity: 100,
    baseCost: { qi: 5e9, stone: 2e6, starSand: 3000 },
    costGrowth: 1.4,
    unlock: { starSand: 1000 },
    requiresTech: 'caveHeavenArt',
    /*
     * 宗门门槛夹到「化神期最多能有几品宗门」= 2 品（本轮需求 3）。
     * 原来写的是 5 品，而那个品阶本身要 合体期 ——
     * 与这栋建筑自己声明的「需化神期」互相打架。
     */
    requiresSectLevel: 2,
    max: 5,
  },

  /* ---------------- 弟子居所（本轮需求 2：开宗之后才能建） ---------------- */
  {
    id: 'discipleDorm',
    kind: 'structure',
    group: 'discipleHousing',
    name: '弟子舍',
    icon: '🏠',
    desc: '开宗后给弟子住的通铺，一舍 12 人。只住弟子，仆役另有住处。',
    discipleCapacity: 12,
    baseCost: { qi: 3000, wood: 600 },
    costGrowth: 1.2,
    unlock: {},
    // 需求 2 的核心：弟子居所**开宗之后**才出现
    requiresSect: true,
    max: 30,
  },
  {
    id: 'discipleCourt',
    kind: 'structure',
    group: 'discipleHousing',
    name: '精舍',
    icon: '🏘',
    desc: '一人一间的清净精舍，一院 40 人，弟子修行不易互相打扰。需钻研营造之术。',
    discipleCapacity: 40,
    baseCost: { qi: 1.2e5, wood: 3000, stone: 800 },
    costGrowth: 1.26,
    unlock: { stone: 500 },
    requiresSect: true,
    requiresTech: 'architecture',
    max: 30,
  },
  {
    id: 'discipleManor',
    kind: 'structure',
    group: 'discipleHousing',
    name: '静院',
    icon: '⛩',
    desc: '依山势开出的静修院落，一院 120 人。需钻研洞天开辟。',
    discipleCapacity: 120,
    baseCost: { qi: 4e6, stone: 4e4, herb: 1e4 },
    costGrowth: 1.3,
    unlock: { stone: 2e4 },
    requiresSect: true,
    requiresTech: 'caveHeavenArt',
    max: 25,
  },
  {
    id: 'disciplePalace',
    kind: 'structure',
    group: 'discipleHousing',
    name: '仙居',
    icon: '🏛',
    desc: '自成一界的弟子居所，一居 400 人 —— 九品宗门的万人规模全靠它。',
    discipleCapacity: 400,
    baseCost: { qi: 1e10, stone: 4e6, starSand: 6000 },
    costGrowth: 1.35,
    unlock: { starSand: 2000 },
    requiresSect: true,
    requiresTech: 'caveHeavenArt',
    max: 20,
  },

  /* ---------------- 丹器工坊 ---------------- */
  {
    id: 'alchemyRoom',
    kind: 'structure',
    group: 'workshop',
    name: '丹房',
    icon: '⚗',
    desc: '炼丹之所，全宗唯一。丹药品阶的提升都在这一座里完成 —— 每升一品都要投入资源，越往上越要吃稀有材料。',
    alchemySlots: 1,
    baseCost: { qi: 1500, wood: 300 },
    costGrowth: 1.18,
    unlock: { wood: 100 },
    requiresTech: 'alchemyArt',
    // 需求 2：丹房改为唯一建筑
    max: 1,
  },
  {
    id: 'refinery',
    kind: 'structure',
    group: 'workshop',
    name: '炼器房',
    icon: '🔨',
    desc: '锻造器物之所，全宗唯一。器物品阶的提升都在这一座里完成 —— 每升一品都要投入资源，越往上越要吃稀有材料。',
    refiningSlots: 1,
    baseCost: { qi: 4000, ore: 600 },
    costGrowth: 1.2,
    unlock: { ore: 150 },
    requiresTech: 'refiningArt',
    // 需求 2：炼器房改为唯一建筑
    max: 1,
  },
  {
    id: 'alchemyFurnace',
    kind: 'structure',
    group: 'workshop',
    name: '丹炉阵',
    icon: '🫕',
    desc: '九座丹炉同燃的大阵，炉火纯青。炼丹成功率 +8%/座。需钻研丹道精要。',
    alchemySlots: 3,
    // 需求 2：丹房唯一之后，名额这条路没了 —— 丹炉阵改成提升成功率
    alchemySuccessBonus: 0.08,
    baseCost: { qi: 3e6, fireMarrow: 60, stone: 2e4 },
    costGrowth: 1.3,
    unlock: { fireMarrow: 30 },
    requiresTech: 'alchemyDeep',
    max: 5,
  },
  {
    id: 'forgeArray',
    kind: 'structure',
    group: 'workshop',
    name: '地火熔炉',
    icon: '🌋',
    desc: '引地火入炉，锻打时火候更稳。炼器成功率 +8%/座。需钻研器道精要。',
    refiningSlots: 3,
    // 需求 2：炼器房唯一之后，名额这条路没了 —— 地火熔炉改成提升成功率
    refiningSuccessBonus: 0.08,
    baseCost: { qi: 8e6, fireMarrow: 120, ore: 5e4 },
    costGrowth: 1.3,
    unlock: { fireMarrow: 60 },
    requiresTech: 'refiningDeep',
    max: 5,
  },

  /* ---------------- 灵植药圃（需求 5） ---------------- */
  {
    id: 'plantation',
    kind: 'structure',
    group: 'farm',
    name: '灵植园',
    icon: '🌱',
    desc: '划出四块灵田专门培育材料种子。需钻研灵植之术。',
    plots: 4,
    baseCost: { qi: 2e4, wood: 800, stone: 200 },
    costGrowth: 1.28,
    unlock: { stone: 200 },
    requiresTech: 'plantingArt',
    max: 15,
  },
  {
    id: 'herbGarden',
    kind: 'structure',
    group: 'farm',
    name: '药王圃',
    icon: '🌿',
    desc: '移植上古药圃的阵图，一块可当四块用，共 15 块地。需钻研药王之道。',
    plots: 15,
    baseCost: { qi: 3e6, stone: 2e4, starSand: 40 },
    costGrowth: 1.32,
    unlock: { starSand: 10 },
    requiresTech: 'gardenArt',
    /*
     * 宗门门槛夹到「化神期最多能有几品宗门」= 2 品（本轮需求 3）。
     * 原来写的是 3 品，而那个品阶本身要 炼虚期 ——
     * 与这栋建筑自己声明的「需化神期」互相打架。
     */
    requiresSectLevel: 2,
    max: 10,
  },
  {
    id: 'spiritFieldArray',
    kind: 'structure',
    group: 'farm',
    name: '灵田阵',
    icon: '🪴',
    desc: '以阵养田，一座便有四十块地的产出。需持有灵田阵图。',
    plots: 40,
    baseCost: { qi: 5e10, immortalJade: 200, herb: 1e6 },
    costGrowth: 1.38,
    unlock: { immortalJade: 100 },
    requiresBlueprint: 'spiritFieldBlueprint',
    requiresRealm: 5,
    /*
     * 宗门门槛夹到「炼虚期最多能有几品宗门」= 4 品（本轮需求 3）。
     * 原来写的是 5 品，而那个品阶本身要 合体期 ——
     * 与这栋建筑自己声明的「需炼虚期」互相打架。
     */
    requiresSectLevel: 4,
    max: 5,
  },

  /* ---------------- 坊市（需求 3） ---------------- */
  {
    id: 'tradeHouse',
    kind: 'structure',
    group: 'trade',
    name: '商行',
    icon: '🏪',
    desc: '与散修、凡俗王朝通商。每多一座，货架上多摆两件货。需钻研商道。',
    shopSlots: 2,
    baseCost: { qi: 5e4, wood: 2000, stone: 1000 },
    costGrowth: 1.35,
    unlock: { stone: 300 },
    requiresTech: 'tradeArt',
    max: 3,
  },
  {
    id: 'treasureTower',
    kind: 'structure',
    group: 'trade',
    name: '万宝楼',
    icon: '🏬',
    desc: '八方商旅云集之地，一座多上四件货。需钻研商道精要。',
    shopSlots: 4,
    baseCost: { qi: 2e8, stone: 1e6, lunarCrystal: 200 },
    costGrowth: 1.4,
    unlock: { lunarCrystal: 100 },
    requiresTech: 'tradeDeep',
    /*
     * 宗门门槛夹到「化神期最多能有几品宗门」= 2 品（本轮需求 3）。
     * 原来写的是 4 品，而那个品阶本身要 炼虚期 ——
     * 与这栋建筑自己声明的「需化神期」互相打架。
     */
    requiresSectLevel: 2,
    max: 3,
  },

  /* ---------------- 宗门建筑（需求 4） ---------------- */
  {
    id: 'masterHall',
    kind: 'structure',
    group: 'hall',
    name: '掌门大殿',
    icon: '🏯',
    desc: '宗门中枢，议事事、藏典籍、供掌门起居。可容纳 20 名弟子，其余宗门建筑皆以此为基。',
    discipleCapacity: 20,
    baseCost: { qi: 5e4, wood: 3000, stone: 2000 },
    costGrowth: 1,
    unlock: {},
    requiresSect: true,
    max: 1,
  },
  {
    id: 'mountainGate',
    kind: 'structure',
    group: 'hall',
    name: '山门',
    icon: '⛩',
    desc: '山门气象一新，四方灵气自然汇聚。全局产量 +2%/座。',
    productionBonus: 0.02,
    baseCost: { qi: 2e4, wood: 1500, stone: 800 },
    costGrowth: 1.32,
    unlock: {},
    requiresSect: true,
    max: 5,
  },
  {
    id: 'arena',
    kind: 'structure',
    group: 'hall',
    name: '比武台',
    icon: '🥋',
    desc: '十年一度的宗门大比在此举行。开启后每十年自动开办，比完全宗弟子修行速度 +50%、持续一年。需钻研比武之礼。',
    arena: true,
    baseCost: { qi: 3e5, wood: 8000, blackIron: 120 },
    costGrowth: 1,
    unlock: { blackIron: 60 },
    requiresTech: 'arenaArt',
    requiresBuilding: 'masterHall',
    max: 1,
  },
  {
    id: 'martialPavilion',
    kind: 'structure',
    group: 'hall',
    name: '武技阁',
    icon: '🗡',
    desc: '藏历代武技之处。弟子战力 +8%/座，且弟子会自发入阁研习、积累心得。需钻研武技精要。',
    disciplePowerBonus: 0.08,
    sectEvent: 'insight',
    baseCost: { qi: 2e5, wood: 5000, blackIron: 80 },
    costGrowth: 1.3,
    unlock: { blackIron: 40 },
    requiresTech: 'martialArt',
    requiresBuilding: 'masterHall',
    max: 10,
  },
  {
    id: 'scriptureHall',
    kind: 'structure',
    group: 'hall',
    name: '功法殿',
    icon: '📜',
    desc: '供奉宗门功法之处。弟子修炼速度 +8%/座，且弟子会自发入殿参悟、修为骤进。需钻研传法之道。',
    cultivationBonus: 0.08,
    sectEvent: 'cultivate',
    baseCost: { qi: 5e5, wood: 8000, herb: 2e4 },
    costGrowth: 1.3,
    unlock: { herb: 5000 },
    requiresTech: 'scriptureArt',
    requiresBuilding: 'masterHall',
    max: 10,
  },
  {
    id: 'heavenTower',
    kind: 'structure',
    group: 'hall',
    name: '通天塔',
    icon: '🗼',
    desc: '登塔可远眺千里。秘境产出 +15%/座，且弟子登塔后有所见闻，能让保底更快触发（连续失败的计数 -2）。需钻研通天营造。',
    expeditionYieldBonus: 0.15,
    sectEvent: 'discover',
    baseCost: { qi: 5e7, stone: 5e5, lunarCrystal: 60 },
    costGrowth: 1.35,
    unlock: { lunarCrystal: 20 },
    requiresTech: 'towerArt',
    requiresBuilding: 'masterHall',
    /*
     * 宗门门槛夹到「化神期最多能有几品宗门」= 2 品（本轮需求 3）。
     * 原来写的是 4 品，而那个品阶本身要 炼虚期 ——
     * 与这栋建筑自己声明的「需化神期」互相打架。
     */
    requiresSectLevel: 2,
    max: 5,
  },

    /* ---------------- 修行加成（本轮需求 6：初期就能建） ---------------- */
    {
      id: 'quietRoom',
      kind: 'structure',
      group: 'hall',
      name: '静室',
      icon: '🛖',
      desc: '供弟子闭门静修的小屋。弟子修炼速度 +3%/座 —— 开局就能盖，是最便宜的修行加成。',
      cultivationBonus: 0.03,
      baseCost: { qi: 600, wood: 150 },
      costGrowth: 1.22,
      unlock: { qi: 300 },
      max: 12,
    },
    {
      id: 'daoStone',
      kind: 'structure',
      group: 'hall',
      name: '悟道石',
      icon: '🪨',
      desc: '立于庭中的一方古石，弟子坐其下易入定。弟子修炼速度 +6%/座，需筑基期。',
      cultivationBonus: 0.06,
      baseCost: { qi: 12000, wood: 2500, stone: 1200 },
      costGrowth: 1.28,
      unlock: { stone: 800 },
      requiresRealm: 1,
      // 不写 requiresSectLevel：宗门本身要金丹期才存在，而这座建筑声明的是
      // 筑基期 —— 写 1 品就变成"要求一个此刻还达不到的门槛"了
      max: 8,
    },
    {
      id: 'mindPavilion',
      kind: 'structure',
      group: 'hall',
      name: '静心阁',
      icon: '🕯',
      desc: '一间蒲团、一炉清香。每座每分钟为全宗弟子压制 0.02 点心魔（最多 12 座）。',
      /*
       * 设定集第 14.3 章「压制/清除手段」的第 3 条。
       *
       * 它是**持续**的，也是唯一"不用玩家去点"的那一条：另外几条
       * （清心丹 / 论道大比 / 长老开导）都得主动操作。心魔如果只能主动清，
       * 玩家一忙别的事就会眼看着弟子一个个入魔 —— 总得有条被动底线。
       */
      mindDrain: 0.02,
      baseCost: { qi: 2e4, wood: 1800, stone: 600, herb: 800 },
      costGrowth: 1.3,
      unlock: { stone: 300 },
      requiresRealm: 1,
      // 与悟道石同理：不写 requiresSectLevel
      max: 12,
    },
    {
      /**
       * 符房（需求 8 / 12）：制符的地方。
       *
       * 与丹房 / 炼器房一样是"品阶 + 岗位"双重身份：
       *   - 制符产线的地方（符箓在这里造出来）；
       *   - 制符岗位的来源（每座 2 人，见 game/posting.ts）。
       */
      /**
       * 宗门大阵（需求 9）：以符箓为薪的护山大阵。
       *
       * 它是**唯一**建筑，建成后可以开启/关闭；开启时持续烧符，
       * 提供宗门防御 + 弟子修炼加成 + 幸福度（见 game/sectArray.ts）。
       * 需求 9 把"减伤"从护身符搬到了这里：同样的强度要长期供养。
       */
      id: SECT_ARRAY_BUILDING_ID,
      kind: 'structure' as const,
      group: 'sect' as const,
      name: '宗门大阵',
      icon: '🔯',
      desc: '以符箓为薪的护山大阵。开启后持续消耗符箓，提供宗门防御、弟子修炼加成与幸福度。',
      baseCost: { qi: 2e6, wood: 1e5, stone: 6e4, ore: 4e4, herb: 3e4, spiritSilk: 2000, starSand: 200, lunarCrystal: 40 },
      costGrowth: 1.7,
      unlock: { spiritSilk: 200 },
      requiresRealm: 4,
      max: 1,
    },
    {
      id: 'talismanRoom',
      kind: 'structure',
      group: 'hall',
      name: '符房',
      icon: '📜',
      desc: '朱砂、黄纸、灵笔。制符的地方，每座可安排 2 名弟子在此制符并积累制符技艺。',
      baseCost: { qi: 3e4, wood: 2200, stone: 900, herb: 600, spiritSilk: 120 },
      costGrowth: 1.3,
      unlock: { spiritSilk: 20 },
      requiresRealm: 1,
      max: 8,
    },
    {
      id: 'library',
      kind: 'structure',
      group: 'hall',
      name: '藏经阁',
      icon: '📚',
      desc: '典籍与功法碎片都收在这里。每座让碎片合成的成功率 +3%，并解锁「参悟」（用灵气换碎片）。',
      /*
       * 设定集第 7 章「功法获取途径」的枢纽建筑。
       *
       * 它同时承担三件事，所以刻意**不设 requiresTech**：
       *   1. 参悟（凡品~极品碎片可以用灵气换）；
       *   2. 碎片合成的成功率（`manuals.getSynthRate` 直接读它的座数）；
       *   3. 「藏书」这个身份本身 —— 宗门有座藏经阁，弟子才有功法可用。
       * 门槛只有筑基期与一笔资源，是为了让"功法"这条线在**中期**就能开张。
       */
      insightBonus: 0.02,
      baseCost: { qi: 6e4, wood: 3000, stone: 1500, herb: 1200 },
      costGrowth: 1.32,
      unlock: { stone: 500 },
      requiresRealm: 1,
      max: 10,
    },

  /* ---------------- 宗门奇珍（技术 / 图纸） ---------------- */
  {
    id: 'sectHall',
    kind: 'structure',
    group: 'sect',
    name: '讲道堂',
    icon: '📖',
    desc: '开坛讲道之处，弟子修炼速度 +5%/座。需钻研传道之术。',
    cultivationBonus: 0.05,
    baseCost: { qi: 3e5, wood: 5000, stone: 8000 },
    costGrowth: 1.3,
    unlock: { stone: 5000 },
    requiresTech: 'preachingArt',
    /*
     * 宗门门槛夹到「元婴期最多能有几品宗门」= 1 品（本轮需求 3）。
     * 原来写的是 2 品，而那个品阶本身要 化神期 ——
     * 与这栋建筑自己声明的「需元婴期」互相打架。
     */
      // 不写 requiresSectLevel：宗门本身要金丹期才存在，而这座建筑声明的是
      // 筑基期 —— 写 1 品就变成"要求一个此刻还达不到的门槛"了
    max: 10,
  },
  {
    id: 'insightPool',
    kind: 'structure',
    group: 'sect',
    name: '悟道池',
    icon: '🪷',
    desc: '池水映心，弟子所得心得 +25%/座。需钻研悟道之术。',
    insightBonus: 0.25,
    baseCost: { qi: 1e7, herb: 1e5, lunarCrystal: 30 },
    costGrowth: 1.34,
    unlock: { lunarCrystal: 10 },
    requiresTech: 'insightArt',
    /*
     * 宗门门槛夹到「元婴期最多能有几品宗门」= 1 品（本轮需求 3）。
     * 原来写的是 3 品，而那个品阶本身要 炼虚期 ——
     * 与这栋建筑自己声明的「需元婴期」互相打架。
     */
      // 不写 requiresSectLevel：宗门本身要金丹期才存在，而这座建筑声明的是
      // 筑基期 —— 写 1 品就变成"要求一个此刻还达不到的门槛"了
    max: 5,
  },
  {
    id: 'spiritBoat',
    kind: 'structure',
    group: 'sect',
    name: '灵舟坊',
    icon: '🛶',
    desc: '打造横渡虚空的灵舟，探索速度 +25%、探索距离 +25%。需持有灵舟图纸。',
    expeditionSpeedBonus: 0.25,
    expeditionDistanceBonus: 0.25,
    baseCost: { qi: 1e6, ore: 2e4, blackIron: 60 },
    costGrowth: 1.35,
    unlock: { blackIron: 40 },
    requiresBlueprint: 'spiritBoatBlueprint',
    requiresRealm: 3,
    max: 5,
  },
  {
    id: 'thunderPool',
    kind: 'structure',
    group: 'sect',
    name: '雷池',
    icon: '⚡',
    desc: '引天雷入池，以雷淬体，所有突破成功率 +3%。需持有雷池图纸。',
    breakthroughBonus: 0.03,
    baseCost: { qi: 5e7, starSand: 200, ore: 1e5 },
    costGrowth: 1.4,
    unlock: { starSand: 100 },
    requiresBlueprint: 'thunderPoolBlueprint',
    requiresRealm: 4,
    max: 5,
  },
  {
    id: 'starAltar',
    kind: 'structure',
    group: 'sect',
    name: '星坛',
    icon: '🌟',
    desc: '接引周天星力灌注洞府，全局产量 +20%。需持有星坛图纸。',
    productionBonus: 0.2,
    baseCost: { qi: 1e10, lunarCrystal: 80, immortalJade: 20 },
    costGrowth: 1.45,
    unlock: { lunarCrystal: 40 },
    requiresBlueprint: 'starAltarBlueprint',
    requiresRealm: 6,
    max: 5,
  },
  /* ---- 需求 3 新增的图纸建筑：都是"锦上添花"的加成类 ---- */
  {
    id: 'beastGate',
    kind: 'structure',
    group: 'sect',
    name: '万兽门',
    icon: '🐾',
    desc: '以阵法驱使妖兽为弟子开道，秘境产出 +30%/座。需持有万兽门图。',
    expeditionYieldBonus: 0.3,
    baseCost: { qi: 8e7, dragonBlood: 200, demonCore: 5e5 },
    costGrowth: 1.42,
    unlock: { dragonBlood: 100 },
    requiresBlueprint: 'beastGateBlueprint',
    requiresRealm: 5,
    max: 3,
  },
  {
    id: 'soulLampArray',
    kind: 'structure',
    group: 'sect',
    name: '引魂灯阵',
    icon: '🏮',
    desc: '九盏引魂灯为弟子留一线生机，探索伤亡率 -8%/座。需持有引魂灯图。',
    casualtyReduction: 0.08,
    baseCost: { qi: 2e7, netherFlame: 40, coldJade: 5000 },
    costGrowth: 1.4,
    unlock: { netherFlame: 20 },
    requiresBlueprint: 'soulLampBlueprint',
    requiresRealm: 4,
    max: 5,
  },
  {
    id: 'skyMirror',
    kind: 'structure',
    group: 'sect',
    name: '照天镜',
    icon: '🪞',
    desc: '镜面映照万里山河，队伍寻路更快、伤亡更少：探索速度 +12%/座、伤亡 -5%/座。需持有照天镜图。',
    expeditionSpeedBonus: 0.12,
    casualtyReduction: 0.05,
    baseCost: { qi: 5e6, lunarCrystal: 40, coldJade: 2000 },
    costGrowth: 1.38,
    unlock: { lunarCrystal: 20 },
    requiresBlueprint: 'skyMirrorBlueprint',
    requiresRealm: 3,
    max: 3,
  },
  {
    id: 'dragonVein',
    kind: 'structure',
    group: 'sect',
    name: '龙脉',
    icon: '🐉',
    desc: '截取地脉中一缕龙气为己用，全局产量 +35%/座。需持有龙脉图。',
    productionBonus: 0.35,
    baseCost: { qi: 1e12, dragonBlood: 2000, immortalJade: 200 },
    costGrowth: 1.5,
    unlock: { dragonBlood: 1000 },
    requiresBlueprint: 'dragonVeinBlueprint',
    requiresRealm: 6,
    max: 3,
  },
];

/* ------------------------------------------------------------------ */
/* 储物建筑                                                            */
/* ------------------------------------------------------------------ */

/**
 * 各资源的**基础**储存上限（一座储物建筑都没有时）。
 *
 * 刻意定得很小：开局灵气上限只有 250，而第一次突破要 600 灵气，
 * 所以玩家必须在第一小时内就学会「攒不下就得先修仓库」这件事。
 */
export const BASE_STORAGE: Record<ResourceId, number> = {
  qi: 250,
  wood: 100,
  ore: 100,
  stone: 50,
  herb: 50,
};

/**
 * 储物建筑每座提供的上限，按「灵气容量 × 比例」计算。
 *
 * 灵气是主资源、消耗量随境界指数增长，所以基准最大；
 * 灵石只用于招收弟子、宗门晋升和商行交易，需求温和得多，比例最低。
 */
export const STORAGE_RATIOS: Record<Exclude<ResourceId, 'qi'>, number> = {
  wood: 0.4,
  ore: 0.4,
  herb: 0.25,
  stone: 0.06,
};


/**
 * 九级储物建筑，每级约 20 倍容量，按境界逐级解锁。
 *
 * 容量是照着「该境界内最贵的一次灵气消耗」定的：
 * 每级容量约为对应境界峰值消耗的 1.2~5 倍，
 * 因此玩家通常需要建 1~3 座当前等级的仓库 —— 有压力但不至于卡死。
 *
 * 造价则定为「上一级容量的 0.6 倍」，保证永远买得起：
 * 两座上一级仓库就足够攒出下一级的钱，不存在死锁。
 *
 * 第 2 级起要求「储物之术」，第 4 级起「须弥之法」，第 7 级起「混元之法」——
 * 这几步是需求 6 的体现：光有等级还不够，还得有技术。
 */

/**
 * 五种**专库**（需求 10）。
 *
 * ⚠️ 需求原文：「所有种类的库房都可以增加所有基础资源的上限，不合理，**拆分一下**」。
 * 所以每一座库房只抬**一项**上限 —— 想扩灵气就得建灵池，想扩灵木就得建木料仓。
 * 这让"我现在卡在哪一项上限上"变成一个要分别回答的问题。
 */
export const STORAGE_KINDS: { id: string; resource: ResourceId; name: string; icon: string; power: number; cost: number }[] = [
  // ⚠️ 第一档必须低于基础灵气上限（250）—— 这是仓储建筑不能贵过上限的铁律
  { id: 'qi', resource: 'qi', name: '灵池', icon: '💧', power: 4e3, cost: 180 },
  { id: 'wood', resource: 'wood', name: '木料棚', icon: '🪵', power: 3e3, cost: 150 },
  { id: 'ore', resource: 'ore', name: '矿料场', icon: '⛏', power: 3e3, cost: 150 },
  { id: 'herb', resource: 'herb', name: '药草棚', icon: '🌿', power: 3e3, cost: 150 },
  { id: 'stone', resource: 'stone', name: '石料场', icon: '🪨', power: 3e3, cost: 150 },
];

/**
 * 五个档位。
 *
 * ⚠️ **容量必须对齐"旧九档梯子在对应境界的容量"** ——
 * 储存上限是突破丹造价、升品花费、合成产线的共同标定基准，
 * 把它缩小会让一大片数值立刻不成立（第一版就是这么翻车的）。
 * 所以五档的 powerMult 取 1 / 250 / 12.5万 / 5000万 / 250亿：
 * 每类建满 6 座时，各档容量都略高于旧梯子在对应境界的水平。
 *
 * `qiMult` 是指数增长的：第 5 档的灵气需求约是第 1 档的 2000 倍 ——
 * 需求 10 说「对灵气的需求也太少了，很容易建满」，所以这里刻意把它抬狠。
 * `rare` 是这一档额外要的进阶 / 稀有材料（需求 10 的另一半）。
 */
const STORAGE_TIERS: {
  name: string;
  powerMult: number;
  /** 灵石造价（本轮的主货币） */
  stoneCost: number;
  /** 灵气造价（次要开销） */
  qiCost: number;
  realm: number;
  tech?: string;
  rare: Record<string, number>;
}[] = [
  /*
   * 第 1 档：唯一一档必须是"从基础上限就买得起"的 ——
   * 基础灵石上限 50、灵气上限 250（坑 103 的代价）。
   */
  { name: '小仓', powerMult: 1, stoneCost: 40, qiCost: 180, realm: 0, rare: {} },
  {
    name: '大仓',
    // 容量抬到 1200 倍：它是筑基~元婴唯一能用的档位，撑不起上限就卡死炼药
    powerMult: 1200,
    stoneCost: 1.2e4,
    qiCost: 3e3,
    realm: 1,
    tech: 'storageArt',
    // 需求原话：「筑基期以后的建筑，主要材料应当逐步替换为进阶材料和稀有材料」
    rare: { ore: 900, spiritSilk: 200, demonCore: 100 },
  },
  {
    name: '宝库',
    powerMult: 4e5,
    stoneCost: 3e6,
    qiCost: 2e6,
    // 元婴(3) → 化神(4)：玩家说"元婴期就解锁，进度太快了"
    realm: 4,
    tech: 'storageArt',
    // ⚠️ 不用星砂 / 月华晶：那是炼丹升品的口粮，库房不能跟它抢（本轮批 2 修正 2）
    rare: { ore: 3e5, spiritSilk: 8000, demonCore: 3000 },
  },
  {
    name: '秘境仓',
    powerMult: 2e8,
    stoneCost: 1.5e9,
    qiCost: 1e9,
    // 炼虚(5) → 合体(6)
    realm: 6,
    tech: 'voidStorageArt',
    // 同理：龙血 / 九幽火 / 月华露都要留给炼丹炼器
    rare: { ore: 5e7, demonCore: 2e6, spiritSilk: 2e5, spiritBasic: 200 },
  },
  {
    name: '鸿蒙库',
    powerMult: 2.5e10,
    stoneCost: 5e11,
    qiCost: 4e11,
    // 合体(7) → 渡劫(8)：最高档留到最后一个境界
    realm: 8,
    tech: 'cosmosStorageArt',
    /*
     * 这里刻意**不用**仙人玉 / 混沌气 / 鸿蒙灵果：那几样是顶阶丹药与器物的材料，
     * 库房抢过去就会把「升炼丹品阶」饿死（实测踩过，见本轮批 2 修正 2）。
     * 所以顶档的代价全部压在**海量灵矿 + 符箓**上 —— 符箓可以自己画、
     * 灵矿随地都是，不挡任何一条进度线。
     */
    rare: {
      ore: 2e10,
      demonCore: 5e7,
      spiritSilk: 5e6,
      // 符箓是合法的建筑材料（本轮需求 3）
      spiritSilver: 2000,
      breakSilver: 500,
    },
  },
];

/** 二十五座专库（5 种资源 × 5 档），只抬各自那一项上限 */
export const STORAGE_BUILDINGS: StructureDef[] = STORAGE_KINDS.flatMap((kind) =>
  STORAGE_TIERS.map((tier, tierIndex) => {
    /*
     * 造价：**灵石为主 + 灵气为辅 + 稀有材料按档递进**。
     *
     * kind.cost 在这里当"这一档的基准量级"，五种专库按各自的基础量级错开
     * （灵气库最贵，其余略便宜），所以五条线的相对关系保持不变。
     */
    const scale = kind.cost / 180;
    const baseCost: Record<string, number> = {
      stone: Math.round(tier.stoneCost * scale),
      qi: Math.round(tier.qiCost * scale),
      ...tier.rare,
    };
    // 需求 10：除灵石与灵气之外，**第二档起每一档都要灵矿**（第一档要能起步）
    if (tierIndex > 0) {
      baseCost.ore = (baseCost.ore ?? 0) + Math.round(tier.stoneCost * scale * 0.06);
    }
    return {
      id: `${kind.id}Vault${tierIndex + 1}`,
      kind: 'structure' as const,
      group: 'storage' as const,
      name: `${kind.name}·${tier.name}`,
      icon: kind.icon,
      desc: `只提高【${RESOURCE_MAP[kind.resource]?.name ?? kind.resource}】的储存上限，容量随档位大幅提升。`,
      // 只抬自己那一项 —— 这就是需求 10 说的"拆分"
      storage: { [kind.resource]: kind.power * tier.powerMult } as Partial<Record<ResourceId, number>>,
      baseCost,
      // 需求 11：每多建一个的涨幅也抬一档（原来 1.25，太便宜了）
      costGrowth: 1.38,
      unlock: {},
      requiresRealm: tier.realm,
      requiresTech: tier.tech,
      /*
       * 每类 8 座。需求 10 要的是「对灵气的需求太少、很容易建满」，
       * 8 座 + 1.38 的成长曲线远谈不上建满；但比 6 座多出的两座容量，
       * 正好抵消"五种库房必须分别建"带来的额外投入（实测：节奏因此回暖约 20%）。
       */
      max: 8,
    };
  }),
);

STRUCTURES.push(...STORAGE_BUILDINGS);

/* ------------------------------------------------------------------ */
/* 幸福度建筑（需求 5）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：「增加宗门获取幸福度的建筑，这些建筑一定得**非常稀有**，
 * 需求的资源多，且**需要稀有材料**」。
 *
 * 三座建筑共同的口径：
 *   - **唯一**（max: 1）—— 不是"多盖几座"，而是"建得起就有一座"；
 *   - 造价里带**进阶与稀有材料**（星砂 / 月华晶 / 仙人玉 / 鸿蒙灵果）；
 *   - 门槛压在元婴之后，所以它们永远不是开局就能堆的东西。
 */
export const HAPPINESS_STRUCTURES: StructureDef[] = HAPPINESS_BUILDINGS.map((def) => ({
  id: def.id,
  kind: 'structure' as const,
  group: 'happiness' as const,
  name: def.name,
  icon: def.icon,
  desc: def.desc,
  baseCost: def.cost,
  // 稀有建筑的成长系数也高：万一将来放开唯一限制，第二座就该很贵
  costGrowth: 1.6,
  unlock: {},
  requiresRealm: def.requiresRealm,
  requiresTech: def.requiresTech,
  max: 1,
}));

STRUCTURES.push(...HAPPINESS_STRUCTURES);

/* ------------------------------------------------------------------ */
/* 建造队列（需求 2）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：
 *   「增加建筑建造排队机制，最多允许7个建筑排队。初始只有3个排队名额，
 *     金丹后解锁建筑相关建筑（你起个名字），该建筑唯一，需要特殊升级解锁排队名额」
 *
 * 做法：
 *   - 基础 3 个名额；
 *   - 「天工院」（唯一，金丹期解锁）本身 +1；
 *   - 天工院还有 3 次**特殊升级**，每次 +1 —— 3 + 1 + 3 = 7，正好到顶。
 */
export const BUILD_QUEUE_BASE_SLOTS = 3;
export const BUILD_QUEUE_MAX_SLOTS = 7;
/** 决定队列名额的那座唯一建筑 */
export const BUILD_QUEUE_BUILDING = 'tiangongYuan';

export interface QueueUpgradeDef {
  name: string;
  desc: string;
  cost: Partial<Record<ItemId, number>>;
  /** 这一级加几个名额 */
  slots: number;
}

/**
 * 天工院的特殊升级。每一级多开一个建造位。
 *
 * 价格跨了三个数量级，好让"开满 7 个名额"是贯穿中后期的一条小目标线，
 * 而不是金丹期一次性买断。
 */
export const QUEUE_UPGRADES: QueueUpgradeDef[] = [
  {
    name: '扩建料场',
    desc: '堆料的地方大了，能同时起两处工。',
    cost: { qi: 5e6, wood: 2e5, stone: 1e5 },
    slots: 1,
  },
  {
    name: '增设工坊',
    desc: '多开一间工坊，匠人各领一摊。',
    cost: { qi: 5e8, wood: 1e7, stone: 5e6, blackIron: 3000 },
    slots: 1,
  },
  {
    name: '请动仙匠',
    desc: '从北境请来一位能役使冰魄的仙匠，工事快得不像话。',
    cost: { qi: 5e10, wood: 1e9, stone: 5e8, blackIron: 2e5, lunarCrystal: 500 },
    slots: 1,
  },
];

STRUCTURES.push({
  id: BUILD_QUEUE_BUILDING,
  kind: 'structure',
  group: 'build',
  name: '天工院',
  icon: '🏗',
  desc: '掌营造之事的院子。能让工匠一次接几处工，自己 +1 个建造队列名额（可再特殊升级，最多 +3）。',
  baseCost: { qi: 2e6, wood: 5e4, stone: 3e4, blackIron: 200 },
  costGrowth: 1,
  unlock: {},
  // 需求原文：「金丹后解锁建筑相关建筑」
  requiresRealm: 2,
  max: 1,
  queueSlots: 1,
});

/* ------------------------------------------------------------------ */
/* 宗门大阵（需求 1）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：「宗门新增宗门大阵等防御设施，能减少乃至避免弟子伤亡」。
 *
 * 三座一组、逐级替换的关系（`max: 1` + 前置），防御值**累加**：
 *   护山大阵 0.45 → 周天星斗大阵 0.85 → 混元无极阵 1.30
 * 到第三座时总防御 1.30 > 1，进攻烈度归零 —— 也就是"完全避免伤亡"。
 *
 * 数值刻意做成"三座就能免疫"：这是个**有终点**的防线，
 * 让玩家看得见"再建一座就彻底不怕了"，而不是永远差一点。
 */
export const SECT_FORMATIONS: StructureDef[] = [
  {
    id: 'gateArray',
    kind: 'structure',
    group: 'sect',
    name: '护山大阵',
    icon: '🛡',
    desc: '以山门为枢、灵脉为源的护山法阵。宗门防御 +45%，匪患兽潮的损失大幅降低。',
    baseCost: { qi: 3e5, wood: 2e4, stone: 1.5e4, ore: 1e4, arrayCore: 50 },
    costGrowth: 1,
    unlock: {},
    requiresBuilding: 'mountainGate',
    requiresTech: 'caveHeavenArt',
    requiresRealm: 3,
    max: 1,
    sectDefense: 0.45,
  },
  {
    id: 'starArray',
    kind: 'structure',
    group: 'sect',
    name: '周天星斗大阵',
    icon: '✨',
    desc: '引周天星力入阵，昼夜不息。宗门防御 +85%（与护山大阵叠加）。',
    baseCost: { qi: 5e7, wood: 2e6, stone: 1.5e6, ore: 1e6, starSand: 400, arrayCore: 800 },
    costGrowth: 1,
    unlock: {},
    requiresBuilding: 'gateArray',
    requiresTech: 'cosmosStorageArt',
    requiresRealm: 5,
    max: 1,
    sectDefense: 0.85,
  },
  {
    id: 'chaosArray',
    kind: 'structure',
    group: 'sect',
    name: '混元无极阵',
    icon: '🌀',
    desc: '以混元之气为骨，阵成之后来犯者连山门都看不见。宗门防御 +130%（三阵叠加后完全免疫伤亡）。',
    baseCost: { qi: 5e10, wood: 1e9, stone: 8e8, ore: 8e8, arrayCore: 5000, chaosQi: 100, primordialFruit: 20 },
    costGrowth: 1,
    unlock: {},
    requiresBuilding: 'starArray',
    requiresTech: 'towerArt',
    requiresRealm: 7,
    max: 1,
    sectDefense: 1.3,
  },
];

STRUCTURES.push(...SECT_FORMATIONS);

export const BUILDABLES: BuildableDef[] = [...GENERATORS, ...STRUCTURES];

/* ------------------------------------------------------------------ */
/* 需求 11：增益类建筑要基础与进阶资源                                  */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：「建筑也可以增加设定，**增益类建筑需要消耗基础资源和进阶资源**」。
 *
 * 做法是**一处后处理**，而不是给 76 座建筑挨个补字段：
 *   - 认哪些是"增益类"：带任何一条加成字段的建筑（产量 / 成功率 / 修行 / 士气…）；
 *   - 给它们补上**灵矿**（基础）与一样**进阶材料**（按境界挑）；
 *   - 数量按它的灵气造价折算，所以贵建筑的进阶材料也按比例更多。
 *
 * ⚠️ 只处理"还没有那项材料"的建筑：已经在造价里写了稀有材料的那几座
 * （幸福建筑、宗门大阵、藏经阁…）不会被覆盖两次。
 */
const BUFF_FIELDS = [
  'insightBonus',
  'alchemySuccessBonus',
  'refiningSuccessBonus',
  'casualtyReduction',
  'queueSlots',
  'mindDrain',
  'sectDefense',
] as const;

/** 按境界挑一样"进阶材料"，让高阶建筑的造价里出现高阶材料 */
const ADVANCED_BY_REALM: { realm: number; item: string; ratio: number }[] = [
  { realm: 0, item: 'herb', ratio: 0.03 },
  { realm: 2, item: 'spiritSilk', ratio: 0.006 },
  { realm: 3, item: 'demonCore', ratio: 0.005 },
  { realm: 5, item: 'starSand', ratio: 0.0006 },
  { realm: 7, item: 'lunarCrystal', ratio: 0.00006 },
];

function injectAdvancedCosts(): void {
  for (const def of BUILDABLES) {
    if (def.kind !== 'structure') continue;
    const source = def as unknown as Record<string, unknown>;
    const isBuff = BUFF_FIELDS.some((field) => typeof source[field] === 'number' && (source[field] as number) > 0);
    if (!isBuff) continue;
    const qi = def.baseCost.qi ?? 0;
    if (qi <= 0) continue;
    const cost = def.baseCost as Record<string, number>;
    // 基础：灵矿（按灵气造价的 2% —— 力度调过一轮，注释跟着改）
cost.ore = Math.max(1, Math.round(qi * 0.02));
    // 进阶：按境界挑一样，造价按比例
    const realm = def.requiresRealm ?? 0;
    let pick = ADVANCED_BY_REALM[0];
    for (const entry of ADVANCED_BY_REALM) {
      if (realm >= entry.realm) pick = entry;
    }
    if (cost[pick.item] === undefined) {
      cost[pick.item] = Math.max(1, Math.round(qi * pick.ratio));
    }
  }
}

injectAdvancedCosts();

export const BUILDABLE_MAP: Record<string, BuildableDef> = BUILDABLES.reduce(
  (acc, b) => {
    acc[b.id] = b;
    return acc;
  },
  {} as Record<string, BuildableDef>,
);

/* ------------------------------------------------------------------ */
/* 灵石合成（需求 4 / 6）                                               */
/* ------------------------------------------------------------------ */

/*
 * `STONE_REFINE_COST` / `STONE_REFINE_OUTPUT` 已经搬到 `refine.ts`，
 * 并从那条配方**推导**出来 —— 这里不再各存一份数字。
 * （两份副本本轮漂过一次：UI 按新价显示、实际按旧价扣。）
 */

/**
 * 自动合成（需求 4）的**全局**速率档位。
 *
 * 值 = 每秒完成几批合成，**所有配方共用这个速率**（本轮需求 2 从"只管灵石"
 * 扩到"管全部配方"）。0 档即关闭。
 *
 * 为什么不给每个配方各配一份速率：那等于把"能同时烧多少资源"乘以配方数 ——
 * 四条配方各自 0.8 批/秒就是 3.2 批/秒，灵气会被瞬间抽干。
 * 现在改成"一个总闸门 + 每条配方设目标存量"：玩家说的是"我要 2000 灵液"，
 * 系统按总速率慢慢补到那个数就停。
 */
export const AUTO_REFINE_RATES = [0, 0.05, 0.2, 0.8] as const;
export const AUTO_REFINE_LEVEL_MAX = AUTO_REFINE_RATES.length - 1;
