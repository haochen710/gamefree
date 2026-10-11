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
  SECRET_REALMS,
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
   * 注意：这只记「资源门槛」这一种解锁。技术 / 图纸门槛是实时判断的
   * （需求 6），因为它们本来就是"有没有"的二值事实。
   */
  unlockedBuildings: Record<string, boolean>;
  /**
   * 已永久解锁的秘境 id。
   *
   * 和建筑同理：秘境的门槛是「拥有过若干秘境材料」，
   * 而材料会被炼丹消耗掉。如果按当前持有量实时判断，
   * 玩家一炼丹，整片秘境就会从探索列表里消失。
   */
  unlockedRealms: Record<string, boolean>;

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

export const SAVE_VERSION = 3;

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

/** 初始已发现的秘境：没有任何材料门槛的那几处 */
export function createEmptyUnlockedRealms(): Record<string, boolean> {
  const unlocked: Record<string, boolean> = {};
  for (const def of SECRET_REALMS) {
    if (Object.keys(def.unlock).length === 0) unlocked[def.id] = true;
  }
  return unlocked;
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
    unlockedRealms: createEmptyUnlockedRealms(),
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
 * 技术、图纸与种子是「知识」，跟着神魂一起带走。
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
  };
}
