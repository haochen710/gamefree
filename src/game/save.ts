/**
 * 存档：localStorage 自动存档、导出/导入存档码、离线收益结算。
 *
 * 设计要点：
 * 1. Decimal 不能直接 JSON 化，统一转成字符串保存；
 * 2. 读档一律当作"不可信输入"处理（玩家可能粘贴乱码），
 *    任何字段非法都退回默认值，绝不让坏存档把游戏卡死；
 * 3. 离线收益按 50% 效率结算，最多结算 8 小时。
 */
import Decimal, { D } from './decimal';
import { FINAL_REALM_INDEX, GENERATORS, REALMS, RESOURCE_IDS, type ResourceId } from './content';
import { getProduction } from './engine';
import {
  createEmptyGenerators,
  createEmptyResources,
  SAVE_VERSION,
  type GameState,
  type ResourceMap,
} from './state';

export const SAVE_KEY = 'xiantu.save.v1';

/** 离线最多结算 8 小时 */
export const MAX_OFFLINE_SECONDS = 8 * 3600;
/** 离线收益效率（打对折，鼓励回来手动经营） */
export const OFFLINE_EFFICIENCY = 0.5;
/** 离开不足 1 分钟就不弹结算窗了 */
export const MIN_OFFLINE_SECONDS = 60;

/* ------------------------------------------------------------------ */
/* 序列化                                                              */
/* ------------------------------------------------------------------ */

/** 存档的磁盘格式，键名故意用缩写，导出码更短 */
export interface SerializedGame {
  v: number;
  /** savedAt，毫秒 */
  at: number;
  /** resources */
  r: Record<string, string>;
  /** generators */
  g: Record<string, number>;
  /** realmIndex / layer */
  ri: number;
  li: number;
  /** daoYun */
  dy: string;
  /** ascensions */
  asc: number;
  /** totalQi / lifetimeQi */
  tq: string;
  lq: string;
  /** playTime */
  pt: number;
}

export function serialize(state: GameState): SerializedGame {
  const r: Record<string, string> = {};
  for (const id of RESOURCE_IDS) r[id] = state.resources[id].toString();

  return {
    v: SAVE_VERSION,
    at: state.savedAt,
    r,
    g: { ...state.generators },
    ri: state.realmIndex,
    li: state.layer,
    dy: state.daoYun.toString(),
    asc: state.ascensions,
    tq: state.totalQi.toString(),
    lq: state.lifetimeQi.toString(),
    pt: state.playTime,
  };
}

/** 把任意输入安全地转成非负 Decimal，失败则用 fallback */
function toDec(value: unknown, fallback = 0): Decimal {
  let d: Decimal | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    d = D(value);
  } else if (typeof value === 'string' && value.trim() !== '') {
    d = new Decimal(value.trim());
  }
  if (d === null) return D(fallback);

  // 注意：这里不能用 toNumber() 判断有效性 —— 合法的大数（1e400）
  // 转成 number 就是 Infinity，会被误判成坏数据。
  const text = d.toString();
  if (text === 'NaN' || text === 'Infinity' || text === '-Infinity') return D(fallback);
  if (d.lt(0)) return D(fallback);
  return d;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function deserialize(raw: unknown): GameState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const data = raw as Partial<SerializedGame>;
  if (typeof data.v !== 'number') return null;

  const resources = createEmptyResources();
  const rawResources = (data.r ?? {}) as Record<string, unknown>;
  for (const id of RESOURCE_IDS) {
    resources[id] = toDec(rawResources[id], 0);
  }

  const generators = createEmptyGenerators();
  const rawGenerators = (data.g ?? {}) as Record<string, unknown>;
  for (const def of GENERATORS) {
    const count = rawGenerators[def.id];
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      generators[def.id] = Math.floor(count);
    }
  }

  const realmIndex = toInt(data.ri, 0, 0, FINAL_REALM_INDEX);
  const layerCount = REALMS[realmIndex].layerCount;
  const layer = toInt(data.li, 0, 0, layerCount);

  const now = Date.now();
  return {
    version: SAVE_VERSION,
    resources,
    generators,
    realmIndex,
    layer,
    daoYun: toDec(data.dy, 0),
    ascensions: toInt(data.asc, 0, 0, Number.MAX_SAFE_INTEGER),
    totalQi: toDec(data.tq, 0),
    lifetimeQi: toDec(data.lq, 0),
    playTime: toInt(data.pt, 0, 0, Number.MAX_SAFE_INTEGER),
    savedAt: toInt(data.at, now, 0, Number.MAX_SAFE_INTEGER),
  };
}

/* ------------------------------------------------------------------ */
/* localStorage                                                        */
/* ------------------------------------------------------------------ */

export function saveToLocal(state: GameState): boolean {
  try {
    const payload = serialize({ ...state, savedAt: Date.now() });
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    // 隐私模式、存储配额满等情况会抛异常，不该让游戏崩掉
    console.warn('[仙途] 存档失败：', err);
    return false;
  }
}

export function loadFromLocal(): GameState | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (!text) return null;
    return deserialize(JSON.parse(text));
  } catch (err) {
    console.warn('[仙途] 读档失败：', err);
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    console.warn('[仙途] 清档失败：', err);
  }
}

/* ------------------------------------------------------------------ */
/* 导出 / 导入存档码                                                    */
/* ------------------------------------------------------------------ */

/**
 * 导出成一串可复制的文本。
 * 先 encodeURIComponent 再 btoa，是为了让中文和特殊字符也能安全编码
 * （encodeURIComponent 的输出是纯 ASCII，正好喂给 btoa）。
 */
export function exportCode(state: GameState): string {
  try {
    return btoa(encodeURIComponent(JSON.stringify(serialize({ ...state, savedAt: Date.now() }))));
  } catch (err) {
    console.warn('[仙途] 导出失败：', err);
    return '';
  }
}

export function importCode(code: string): GameState | null {
  try {
    const cleaned = code.replace(/\s+/g, '');
    if (!cleaned) return null;
    const json = decodeURIComponent(atob(cleaned));
    return deserialize(JSON.parse(json));
  } catch (err) {
    console.warn('[仙途] 导入失败：', err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 离线收益                                                            */
/* ------------------------------------------------------------------ */

export interface OfflineReport {
  seconds: number;
  gains: ResourceMap;
}

export function applyOffline(
  state: GameState,
  now = Date.now(),
): { state: GameState; report: OfflineReport | null } {
  const elapsed = (now - state.savedAt) / 1000;
  const seconds = Math.min(Math.max(Number.isFinite(elapsed) ? elapsed : 0, 0), MAX_OFFLINE_SECONDS);

  if (seconds < MIN_OFFLINE_SECONDS) {
    return { state: { ...state, savedAt: now }, report: null };
  }

  const production = getProduction(state);
  const resources = { ...state.resources };
  const gains = createEmptyResources();

  for (const id of RESOURCE_IDS) {
    const gain = production[id as ResourceId].mul(seconds * OFFLINE_EFFICIENCY);
    gains[id] = gain;
    resources[id] = resources[id].add(gain);
  }

  const gainedQi = gains.qi;
  return {
    state: {
      ...state,
      resources,
      totalQi: state.totalQi.add(gainedQi),
      lifetimeQi: state.lifetimeQi.add(gainedQi),
      savedAt: now,
    },
    report: { seconds, gains },
  };
}
