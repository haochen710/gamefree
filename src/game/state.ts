/**
 * 游戏状态（一份存档的全部内容）。
 *
 * 状态本身是纯数据，不含任何方法 —— 存档序列化因此很简单，
 * 所有计算逻辑放在 engine / disciples / expeditions / crafting 等模块里。
 */
import Decimal, { D } from './decimal';
import {
  BUILDABLES,
  MATERIAL_IDS,
  RESOURCE_IDS,
  STARTER_REALM_ID,
  ENLIGHTEN_PATH_IDS,
  WEATHER_ROLL_INTERVAL,
  createEmptyBuffs,
  type ActiveBuffs,
  type AptitudeId,
  type MaterialId,
  type ResourceId,
  type ShopOffer,
} from './content';

export type ResourceMap = Record<ResourceId, Decimal>;
export type MaterialMap = Record<MaterialId, Decimal>;
/** 丹药 / 器物的持有数量，都是小整数 */
export type ItemCountMap = Record<string, number>;

/* ------------------------------------------------------------------ */
/* 弟子与秘境                                                          */
/* ------------------------------------------------------------------ */

export type DiscipleStatus = 'idle' | 'exploring';

export interface Disciple {
  id: string;
  name: string;
  aptitude: AptitudeId;
  /** 当前境界下标（对应 REALMS） */
  realmIndex: number;
  /** 在当前境界已修炼的「有效年数」，达到 cultivationYears 即晋升 */
  progress: number;
  /** 年龄（游戏年） */
  age: number;
  status: DiscipleStatus;
  /**
   * 心得（需求 4）：探索归来后积累，直接加快自身修行。
   *
   * 放在弟子身上而不是宗门账上，是因为需求原文说的是
   * 「弟子探索后增加心得，加快进境」—— 出过力的弟子才长进。
   */
  insight: number;
  /** 正在参与的探索 id */
  expeditionId?: string;
}

export interface Expedition {
  id: string;
  realmId: string;
  discipleIds: string[];
  /** 已积累的探索进度（秒，已计入探索速度加成） */
  progress: number;
  /** 完成所需的进度 */
  duration: number;
  /**
   * 这次出去是干什么的（需求 1）。
   *
   * - `realm`：探索一处**已发现的秘境**，掉落好但有冷却；
   * - `survey`：在小区域里做**普通探索** —— 只有还没发现秘境的小区域能做，
   *   必定带回基础材料、有概率带稀有材料与发现新秘境，没有冷却。
   *
   * 两种情况共用同一个队伍队列与计时，所以"派谁出去"始终是同一个取舍。
   */
  kind: 'realm' | 'survey';
}

export interface Sect {
  founded: boolean;
  /** 宗门品阶 1~9 */
  level: number;
  disciples: Disciple[];
  /** 累计招收过的弟子数（含已逐出/陨落） */
  totalRecruited: number;
  /** 驻颜丹累加的寿命加成，0.1 = +10% */
  lifespanBonus: number;
}

/** 宗门记事：突破、陨落、秘境收获等，只保留最近若干条 */
export interface JournalEntry {
  /** 记录时的累计游玩秒数 */
  time: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

export const JOURNAL_LIMIT = 40;

/* ------------------------------------------------------------------ */
/* 个人游历 / 种植 / 钻研 / 商行                                        */
/* ------------------------------------------------------------------ */

/** 掌门亲自出门游历（需求 1）。同一时间只能进行一趟 */
export interface PersonalTravel {
  /**
   * 掌门这次出门是干什么的（需求 5）。
   *
   * - `travel`：去游历目的地（见 travel.ts 的 TRAVEL_REGIONS）；
   * - `realm` ：**独自前往一处已发现的秘境** ——
   *   人少带不了多少东西，但**更容易挑出稀有材料**。
   *
   * 两者共用同一个"掌门不在家"的槽位与产量惩罚，
   * 所以"要不要亲自出去"始终是同一个取舍。
   */
  kind: 'travel' | 'realm';
  /** kind === 'travel' 时是游历目的地 id，kind === 'realm' 时是秘境 id */
  regionId: string;
  /** 已积累的进度（秒） */
  progress: number;
  /** 完成所需的进度 */
  duration: number;
}

/** 一块地里正在长的东西（需求 5） */
export interface Planting {
  id: string;
  material: MaterialId;
  progress: number;
  duration: number;
}

/** 正在钻研的技术（需求 6）。同一时间只能钻研一项 */
export interface ResearchState {
  id: string;
  remaining: number;
}

/** 商行当前货架与刷新倒计时（需求 3） */
export interface ShopState {
  offers: ShopOffer[];
  /** 距离下次刷新还有多少秒 */
  secondsLeft: number;
}

/* ------------------------------------------------------------------ */
/* 主状态                                                              */
/* ------------------------------------------------------------------ */

export interface GameState {
  /** 存档格式版本 */
  version: number;

  resources: ResourceMap;
  /** 秘境材料，与 resources 分开存 */
  materials: MaterialMap;

  /** 设施与建筑的数量（id -> 个数） */
  buildings: Record<string, number>;
  /**
   * 已永久解锁的建筑 id。
   *
   * 解锁是「达成过就永久记住」，而不是每帧重新按当前资源判断 ——
   * 否则玩家一花掉灵气，已经建了好几座的灵木林就会从面板上凭空消失。
   *
   * 注意：这只记「资源门槛」这一种解锁。技术 / 图纸 / 前置建筑门槛
   * 都是实时判断的（需求 6），因为它们本来就是"有没有"的二值事实。
   */
  unlockedBuildings: Record<string, boolean>;
  /**
   * 已**发现**的秘境 id（需求 1）。
   *
   * 秘境不再是「攒够材料就自动出现」，而是弟子探索或掌门游历时
   * 有概率发现；一旦发现就永久固定在秘境栏，不会因为材料被花掉而消失。
   */
  discoveredRealms: Record<string, boolean>;
  /** 各秘境的冷却剩余秒数（需求 1：每次探索后要隔一段时间才能再探） */
  realmCooldowns: Record<string, number>;
  /**
   * 连续「没发现新秘境」的次数（需求 1 的硬保底）。
   *
   * 达到 DISCOVERY_PITY_FAILURES 时下一次探索必然发现。
   * 它**不参与**发现概率的计算 —— 概率只由寻宝宝盘提升。
   */
  discoveryFailures: number;

  /**
   * 建造队列（需求 2）。
   *
   * 里面存的是可建造物的 id，按顺序自动建造：队首一旦满足门槛且资源够，
   * 就立刻建起来并出队。名额上限见 `engine.getQueueSlots`（3~7）。
   */
  buildQueue: string[];
  /** 天工院的特殊升级等级（0~3），每级 +1 个建造名额（需求 2） */
  tiangongLevel: number;

  /**
   * 善恶值（需求 2）：正 = 善行值，负 = 恶行值，范围 -100~100。
   *
   * 用**一条轴**而不是两个计数器：「又善又恶」没有意义，
   * 而且两个计数器必须时时保证一正一负，反而更容易写错。
   */
  karma: number;
  /** 当前待玩家选择的随机遭遇 id（需求 2）；没有则 null */
  pendingEncounter: string | null;
  /** 距离下一次遭遇判定的累计秒数（需求 2） */
  encounterTimer: number;
  /**
   * 当前这条遭遇还剩多少秒（需求 1：玩家事件 30 秒不选就消失）。
   *
   * 与 `encounterTimer` 是两件事：那个是「下次什么时候遇到」，
   * 这个是「眼前这条还剩多久」。分开存是因为口径完全不同 ——
   * 前者跟着判定周期走，后者是给玩家反应时间的真实秒数。
   */
  encounterDeadline: number;

  /** 感悟：每条道的阶数（0~90），见 content/enlightenment.ts（需求 3） */
  enlightenment: Record<string, number>;
  /** 当前正在感悟的那一阶；没有则 null */
  enlightening: { pathId: string; remaining: number; total: number } | null;
  /** 已制成的空间戒指数（需求 3） */
  spaceRings: number;
  /** 上一次时空穿梭的 playTime（需求 3） */
  lastTimeJump: number;

  /** 丹药库存 */
  pills: ItemCountMap;
  /** 器物库存 */
  artifacts: ItemCountMap;

  /* ---- 修行 ---- */
  realmIndex: number;
  /** 当前大境界内已完成的小境界层数 */
  layer: number;
  /** 每个境界累积的突破失败保底加成 */
  breakthroughPity: number[];
  /** 全局突破成功率永久加成（例如固本丹） */
  globalBreakthroughBonus: number;

  /** 心神，打坐消耗 */
  mind: number;
  /** 距离下一点心神回复的秒数进度 */
  mindProgress: number;

  /* ---- 仆人与道伤 ---- */
  /** 各工种的仆人数（id -> 人数） */
  servants: Record<string, number>;
  /** 道伤剩余秒数。大于 0 时无法突破，且全局产量下降 */
  injurySeconds: number;

  /* ---- 个人游历（需求 1） ---- */
  personalTravel: PersonalTravel | null;

  /* ---- 自动合成（需求 4） ---- */
  /** 自动合成档位，0 表示关闭；见 AUTO_REFINE_RATES */
  autoRefineLevel: number;
  /** 自动合成的凑整进度，攒够 1 次就合成一批 */
  autoRefineProgress: number;

  /* ---- 种植（需求 5） ---- */
  /** 各材料的种子数量（材料 id -> 颗数） */
  seeds: Record<string, number>;
  /** 正在生长的作物 */
  plantings: Planting[];
  /** 用于生成作物 id 的自增计数器 */
  nextPlantingId: number;

  /* ---- 钻研与图纸（需求 6） ---- */
  /** 已钻研出的技术 */
  techs: Record<string, boolean>;
  /** 正在钻研的技术 */
  research: ResearchState | null;
  /** 已获得的图纸 */
  blueprints: Record<string, boolean>;

  /* ---- 宗门活动（需求 4） ---- */
  /** 比武台是否开启 —— 需求明文「由玩家决定是否开启」 */
  arenaEnabled: boolean;
  /** 距离下次大比的秒数 */
  arenaTimer: number;
  /** 大比带来的全宗修行加速剩余秒数 */
  arenaBuffSeconds: number;
  /** 距离下次宗门随机事件判定的秒数 */
  sectEventTimer: number;

  /* ---- 季节与天象（需求 1） ---- */
  /** 当前季节下标（0 春 / 1 夏 / 2 秋 / 3 冬） */
  season: number;
  /** 本季已经过去的秒数 */
  seasonSeconds: number;
  /** 当前天象 id；没有天象时为 null */
  weatherId: string | null;
  /** 当前天象剩余秒数 */
  weatherSeconds: number;
  /** 距离下次天象判定的秒数 */
  weatherTimer: number;

  /* ---- 商行（需求 3） ---- */
  shop: ShopState;

  /* ---- 转世 ---- */
  daoYun: Decimal;
  ascensions: number;
  totalQi: Decimal;
  lifetimeQi: Decimal;

  /* ---- 宗门 ---- */
  sect: Sect;
  expeditions: Expedition[];
  journal: JournalEntry[];

  /* ---- 炼丹炼器 ---- */
  alchemyTier: number;
  refiningTier: number;

  /* ---- 增益 ---- */
  buffs: ActiveBuffs;

  /* ---- 杂项 ---- */
  playTime: number;
  savedAt: number;
  nextDiscipleId: number;
}

export const SAVE_VERSION = 4;

/* ------------------------------------------------------------------ */
/* 工厂                                                                */
/* ------------------------------------------------------------------ */

export function createEmptyResources(): ResourceMap {
  const res = {} as ResourceMap;
  for (const id of RESOURCE_IDS) res[id] = D(0);
  return res;
}

export function createEmptyMaterials(): MaterialMap {
  const mat = {} as MaterialMap;
  for (const id of MATERIAL_IDS) mat[id] = D(0);
  return mat;
}

export function createEmptyBuildings(): Record<string, number> {
  const b: Record<string, number> = {};
  for (const def of BUILDABLES) b[def.id] = 0;
  return b;
}

/**
 * 初始解锁状态：没有任何解锁条件的建筑（如聚灵阵）开局就可见。
 * 其余的交由 engine.refreshUnlocks 在游戏过程中逐个解锁。
 */
export function createEmptyUnlocked(): Record<string, boolean> {
  const unlocked: Record<string, boolean> = {};
  for (const def of BUILDABLES) {
    if (Object.keys(def.unlock).length === 0) unlocked[def.id] = true;
  }
  return unlocked;
}

/**
 * 初始已发现的秘境。
 *
 * 只有落霞谷 —— 宗门草创时的第一处试炼地必须现成，
 * 否则「发现秘境」这件事本身就成了开局的第一道随机卡点。
 */
export function createEmptyDiscoveredRealms(): Record<string, boolean> {
  return { [STARTER_REALM_ID]: true };
}

export function createEmptySect(): Sect {
  return {
    founded: false,
    level: 1,
    disciples: [],
    totalRecruited: 0,
    lifespanBonus: 0,
  };
}

export function createEmptyShop(): ShopState {
  return { offers: [], secondsLeft: 0 };
}

function createEmptyEnlightenment(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ENLIGHTEN_PATH_IDS) out[id] = 0;
  return out;
}

export function createInitialState(now = Date.now()): GameState {
  const resources = createEmptyResources();
  // 开局给 10 点灵气，聚灵阵要 15 —— 必须先打坐几下，
  // 让玩家理解"手动获取 → 建立自动产出"这个放置游戏的核心循环。
  resources.qi = D(10);

  return {
    version: SAVE_VERSION,
    resources,
    materials: createEmptyMaterials(),
    buildings: createEmptyBuildings(),
    unlockedBuildings: createEmptyUnlocked(),
    discoveredRealms: createEmptyDiscoveredRealms(),
    realmCooldowns: {},
    buildQueue: [],
    tiangongLevel: 0,
    karma: 0,
    pendingEncounter: null,
    encounterTimer: 0,
    encounterDeadline: 0,
    enlightenment: createEmptyEnlightenment(),
    enlightening: null,
    spaceRings: 0,
    lastTimeJump: 0,
    discoveryFailures: 0,
    pills: {},
    artifacts: {},
    realmIndex: 0,
    layer: 0,
    breakthroughPity: [],
    globalBreakthroughBonus: 0,
    mind: 20,
    mindProgress: 0,
    servants: {},
    injurySeconds: 0,
    personalTravel: null,
    autoRefineLevel: 0,
    autoRefineProgress: 0,
    seeds: {},
    plantings: [],
    nextPlantingId: 1,
    techs: {},
    research: null,
    blueprints: {},
    arenaEnabled: false,
    arenaTimer: 0,
    arenaBuffSeconds: 0,
    sectEventTimer: 0,
    // 开局定在春天：灵草与灵木的第一波加成能让新手期顺一点
    season: 0,
    seasonSeconds: 0,
    weatherId: null,
    weatherSeconds: 0,
    weatherTimer: WEATHER_ROLL_INTERVAL,
    shop: createEmptyShop(),
    daoYun: D(0),
    ascensions: 0,
    totalQi: D(0),
    lifetimeQi: D(0),
    sect: createEmptySect(),
    expeditions: [],
    journal: [],
    alchemyTier: 1,
    refiningTier: 1,
    buffs: createEmptyBuffs(),
    playTime: 0,
    savedAt: now,
    nextDiscipleId: 1,
  };
}

/**
 * 飞升：重置修行进度，把本世积累的灵气折算成道韵。
 *
 * 道韵、飞升次数、历世累计灵气保留。
 * 宗门与弟子一并遣散 —— 否则"转世重修"就没有代价了。
 * 技术、图纸、种子、已发现的秘境是「知识」，跟着神魂一起带走。
 */
export function createAscendedState(state: GameState, daoYunGain: Decimal, now = Date.now()): GameState {
  const fresh = createInitialState(now);
  return {
    ...fresh,
    daoYun: state.daoYun.add(daoYunGain),
    ascensions: state.ascensions + 1,
    lifetimeQi: state.lifetimeQi,
    playTime: state.playTime,
    // 钻研出的技术与图纸属于"道"，转世不忘
    techs: { ...state.techs },
    blueprints: { ...state.blueprints },
    // 种子也留一部分：否则每次飞升都要重新收集稀有种子，太惩罚
    seeds: { ...state.seeds },
    // 走过的地方记得路 —— 已发现的秘境也算"知识"
    discoveredRealms: { ...state.discoveredRealms },
  };
}
