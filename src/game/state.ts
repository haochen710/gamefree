/**
 * 游戏状态（一份存档的全部内容）。
 *
 * 状态本身是纯数据，不含任何方法 —— 这样存档序列化很简单，
 * 计算逻辑全部放在 engine.ts。
 */
import Decimal, { D } from './decimal';
import { GENERATORS, RESOURCE_IDS, type ResourceId } from './content';

export type ResourceMap = Record<ResourceId, Decimal>;

export interface GameState {
  /** 存档格式版本，将来改结构时用来做兼容迁移 */
  version: number;

  resources: ResourceMap;
  /** 设施 id -> 拥有数量 */
  generators: Record<string, number>;

  /** 当前大境界下标（对应 REALMS） */
  realmIndex: number;
  /** 当前大境界内已完成的小境界层数，0 ~ layerCount */
  layer: number;

  /** 道韵：飞升后保留的跨世货币 */
  daoYun: Decimal;
  /** 飞升次数 */
  ascensions: number;

  /** 本世累计获得的灵气（飞升时换算成道韵） */
  totalQi: Decimal;
  /** 历世累计获得的灵气（只用于展示） */
  lifetimeQi: Decimal;

  /** 累计游玩时长（秒） */
  playTime: number;
  /** 上一次存档的真实时间戳（毫秒），用于算离线收益 */
  savedAt: number;
}

export const SAVE_VERSION = 1;

export function createEmptyResources(): ResourceMap {
  const res = {} as ResourceMap;
  for (const id of RESOURCE_IDS) res[id] = D(0);
  return res;
}

export function createEmptyGenerators(): Record<string, number> {
  const gen: Record<string, number> = {};
  for (const g of GENERATORS) gen[g.id] = 0;
  return gen;
}

export function createInitialState(now = Date.now()): GameState {
  const resources = createEmptyResources();
  // 开局给 10 点灵气，聚灵阵要 15 —— 也就是说必须先打坐几下，
  // 让玩家理解"手动获取 → 建立自动产出"这个放置游戏的核心循环。
  resources.qi = D(10);

  return {
    version: SAVE_VERSION,
    resources,
    generators: createEmptyGenerators(),
    realmIndex: 0,
    layer: 0,
    daoYun: D(0),
    ascensions: 0,
    totalQi: D(0),
    lifetimeQi: D(0),
    playTime: 0,
    savedAt: now,
  };
}

/**
 * 飞升：重置修行进度，把本世积累的灵气折算成道韵。
 * 道韵、飞升次数、历世累计灵气会保留。
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
