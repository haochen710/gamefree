/**
 * 游戏状态（一份存档的全部内容）。
 *
 * 状态本身是纯数据，不含任何方法 —— 存档序列化因此很简单，
 * 所有计算逻辑放在 engine / disciples / expeditions / crafting 里。
 */
import Decimal, { D } from './decimal';
import {
  BUILDABLES,
  MATERIAL_IDS,
  RESOURCE_IDS,
  createEmptyBuffs,
  type ActiveBuffs,
  type AptitudeId,
  type MaterialId,
  type ResourceId,
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

export const SAVE_VERSION = 2;

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

export function createEmptySect(): Sect {
  return {
    founded: false,
    level: 1,
    disciples: [],
    totalRecruited: 0,
    lifespanBonus: 0,
  };
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
    pills: {},
    artifacts: {},
    realmIndex: 0,
    layer: 0,
    breakthroughPity: [],
    globalBreakthroughBonus: 0,
    mind: 20,
    mindProgress: 0,
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
 */
export function createAscendedState(state: GameState, daoYunGain: Decimal, now = Date.now()): GameState {
  const fresh = createInitialState(now);
  return {
    ...fresh,
    daoYun: state.daoYun.add(daoYunGain),
    ascensions: state.ascensions + 1,
    lifetimeQi: state.lifetimeQi,
    playTime: state.playTime,
  };
}
