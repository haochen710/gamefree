/**
 * 存档：localStorage 自动存档、导出/导入存档码、离线收益结算。
 *
 * 三条铁律：
 * 1. Decimal 不能直接 JSON 化，统一转成字符串；
 * 2. 读档一律当作「不可信输入」（玩家可能粘贴乱码、也可能导入旧版存档），
 *    任何字段非法都退回默认值，绝不让坏存档把游戏卡死；
 * 3. 读档后要跑一次一致性修复（弟子状态与探索列表对齐等）。
 */
import Decimal, { D } from './decimal';
import { gameRandom, type RandomSource } from './random';
import {
  APTITUDE_ORDER,
  AUTO_REFINE_LEVEL_MAX,
  BLUEPRINT_MAP,
  BUILDABLES,
  DISCOVERY_PITY_CAP,
  FINAL_REALM_INDEX,
  INSIGHT_MAX,
  ITEM_MAP,
  MATERIAL_IDS,
  MATERIAL_MAP,
  PILL_MAP,
  REALMS,
  RESOURCE_IDS,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  SEED_MAP,
  SERVANT_JOB_MAP,
  SHOP_GOOD_MAP,
  TECHS,
  TECH_MAP,
  TRAVEL_REGION_MAP,
  createEmptyBuffs,
  type ActiveBuffs,
  type AptitudeId,
  type ItemId,
  type MaterialId,
  type ResourceId,
  type ShopOffer,
} from './content';
import { ARENA_INTERVAL_SECONDS } from './sectActivity';
import { applyTick } from './tick';
import { refreshUnlocks } from './engine';
import {
  JOURNAL_LIMIT,
  SAVE_VERSION,
  createEmptyBuildings,
  createEmptyMaterials,
  createEmptyResources,
  createEmptySect,
  createEmptyShop,
  createEmptyUnlocked,
  createEmptyDiscoveredRealms,
  createInitialState,
  type Disciple,
  type Expedition,
  type GameState,
  type JournalEntry,
  type MaterialMap,
  type PersonalTravel,
  type Planting,
  type ResearchState,
  type ResourceMap,
  type ShopState,
} from './state';

export const SAVE_KEY = 'xiantu.save.v2';
/** v1 存档的键名，用于平滑升级 */
export const LEGACY_SAVE_KEY = 'xiantu.save.v1';

/** 离线最多结算 8 小时 */
export const MAX_OFFLINE_SECONDS = 8 * 3600;
/** 离线期间一切按该效率推进（含弟子修炼与增益计时） */
export const OFFLINE_EFFICIENCY = 0.5;
/** 离开不足 1 分钟就不弹结算窗 */
export const MIN_OFFLINE_SECONDS = 60;

/* ------------------------------------------------------------------ */
/* 序列化                                                              */
/* ------------------------------------------------------------------ */

/** 键名故意用缩写，导出码更短 */
export interface SerializedGame {
  v: number;
  at: number;
  /** resources */
  r: Record<string, string>;
  /** materials */
  m: Record<string, string>;
  /** buildings */
  b: Record<string, number>;
  /** unlockedBuildings */
  ub: Record<string, boolean>;
  /** discoveredRealms（需求 1：探索中发现） */
  ur: Record<string, boolean>;
  /** pills */
  pl: Record<string, number>;
  /** artifacts */
  ar: Record<string, number>;
  ri: number;
  li: number;
  bp: number[];
  gb: number;
  mi: number;
  mp: number;
  /** servants：各工种的仆人数 */
  sv: Record<string, number>;
  /** injurySeconds：道伤剩余秒数 */
  inj: number;
  /** personalTravel：掌门游历（需求 1） */
  pv?: PersonalTravel | null;
  /** autoRefineLevel / autoRefineProgress：自动合成（需求 4） */
  au?: number;
  ap?: number;
  /** seeds：材料种子（需求 5） */
  sd?: Record<string, number>;
  /** plantings / nextPlantingId：地块（需求 5） */
  pg?: Planting[];
  npi?: number;
  /** techs / research：钻研（需求 6） */
  tc?: Record<string, boolean>;
  rs?: ResearchState | null;
  /** blueprints：图纸（需求 6） */
  bpr?: Record<string, boolean>;
  /** shop：商行货架（需求 3） */
  sh?: ShopState;
  /** realmCooldowns：各秘境的冷却剩余秒数（需求 1） */
  rc?: Record<string, number>;
  /** discoveryPity：发现新秘境的保底累积（需求 1） */
  dp?: number;
  /** arenaEnabled / arenaTimer / arenaBuffSeconds：宗门大比（需求 4） */
  ae?: boolean;
  arn?: number;
  arb?: number;
  /** sectEventTimer：距离下次宗门随机事件的秒数（需求 4） */
  se?: number;
  dy: string;
  asc: number;
  tq: string;
  lq: string;
  /** sect */
  sec: {
    f: boolean;
    lv: number;
    d: Disciple[];
    tr: number;
    lb: number;
  };
  ex: Expedition[];
  jr: JournalEntry[];
  al: number;
  rf: number;
  bf: ActiveBuffs;
  pt: number;
  nid: number;
}

export function serialize(state: GameState): SerializedGame {
  const r: Record<string, string> = {};
  for (const id of RESOURCE_IDS) r[id] = state.resources[id].toString();

  const m: Record<string, string> = {};
  for (const id of MATERIAL_IDS) m[id] = state.materials[id].toString();

  return {
    v: SAVE_VERSION,
    at: state.savedAt,
    r,
    m,
    b: { ...state.buildings },
    ub: { ...state.unlockedBuildings },
    ur: { ...state.discoveredRealms },
    pl: { ...state.pills },
    ar: { ...state.artifacts },
    ri: state.realmIndex,
    li: state.layer,
    bp: [...state.breakthroughPity],
    gb: state.globalBreakthroughBonus,
    mi: state.mind,
    mp: state.mindProgress,
    sv: { ...state.servants },
    inj: state.injurySeconds,
    pv: state.personalTravel,
    au: state.autoRefineLevel,
    ap: state.autoRefineProgress,
    sd: { ...state.seeds },
    pg: state.plantings,
    npi: state.nextPlantingId,
    tc: { ...state.techs },
    rs: state.research,
    bpr: { ...state.blueprints },
    sh: state.shop,
    rc: { ...state.realmCooldowns },
    dp: state.discoveryPity,
    ae: state.arenaEnabled,
    arn: state.arenaTimer,
    arb: state.arenaBuffSeconds,
    se: state.sectEventTimer,
    dy: state.daoYun.toString(),
    asc: state.ascensions,
    tq: state.totalQi.toString(),
    lq: state.lifetimeQi.toString(),
    sec: {
      f: state.sect.founded,
      lv: state.sect.level,
      d: state.sect.disciples,
      tr: state.sect.totalRecruited,
      lb: state.sect.lifespanBonus,
    },
    ex: state.expeditions,
    jr: state.journal,
    al: state.alchemyTier,
    rf: state.refiningTier,
    bf: state.buffs,
    pt: state.playTime,
    nid: state.nextDiscipleId,
  };
}

/* ------------------------------------------------------------------ */
/* 读档校验                                                            */
/* ------------------------------------------------------------------ */

/** 把任意输入安全转成非负 Decimal */
function toDec(value: unknown, fallback = 0): Decimal {
  let d: Decimal | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    d = D(value);
  } else if (typeof value === 'string' && value.trim() !== '') {
    d = new Decimal(value.trim());
  }
  if (d === null) return D(fallback);

  // 不能靠 toNumber() 判有效性：合法大数（1e400）转 number 就是 Infinity
  const text = d.toString();
  if (text === 'NaN' || text === 'Infinity' || text === '-Infinity') return D(fallback);
  if (d.lt(0)) return D(fallback);
  return d;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function toFloat(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function toCountMap(raw: unknown, min = 0, max = 1e12): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > min) {
      out[key] = Math.min(Math.floor(value), max);
    }
  }
  return out;
}

function sanitizeDisciple(raw: unknown, index: number): Disciple | null {
  if (raw === null || typeof raw !== 'object') return null;
  const d = raw as Partial<Disciple>;
  if (typeof d.id !== 'string' || typeof d.name !== 'string') return null;

  const aptitude: AptitudeId = APTITUDE_ORDER.includes(d.aptitude as AptitudeId)
    ? (d.aptitude as AptitudeId)
    : 'mortal';

  return {
    id: d.id,
    name: d.name.slice(0, 24) || `弟子${index + 1}`,
    aptitude,
    realmIndex: toInt(d.realmIndex, 0, 0, FINAL_REALM_INDEX),
    progress: toFloat(d.progress, 0, 0, 1e9),
    age: toFloat(d.age, 16, 0, 1e9),
    insight: toFloat(d.insight, 0, 0, INSIGHT_MAX),
    // status 交给 repairState 依据探索列表重新推导，这里先一律置空闲
    status: 'idle',
  };
}

function sanitizeExpedition(raw: unknown): Expedition | null {
  if (raw === null || typeof raw !== 'object') return null;
  const e = raw as Partial<Expedition>;
  if (typeof e.realmId !== 'string' || !SECRET_REALM_MAP[e.realmId]) return null;
  if (!Array.isArray(e.discipleIds)) return null;

  const ids = e.discipleIds.filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return null;

  const def = SECRET_REALM_MAP[e.realmId];
  return {
    id: typeof e.id === 'string' ? e.id : `e_${e.realmId}_${ids[0]}`,
    realmId: e.realmId,
    discipleIds: ids,
    progress: toFloat(e.progress, 0, 0, 1e9),
    duration: toFloat(e.duration, def.duration, 1, 1e9),
  };
}

function sanitizeJournal(raw: unknown): JournalEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: JournalEntry[] = [];
  for (const entry of raw.slice(0, JOURNAL_LIMIT)) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Partial<JournalEntry>;
    if (typeof e.text !== 'string') continue;
    out.push({
      time: toFloat(e.time, 0, 0, 1e12),
      text: e.text.slice(0, 120),
      kind: e.kind === 'good' || e.kind === 'bad' ? e.kind : 'info',
    });
  }
  return out;
}

function sanitizeBuffs(raw: unknown): ActiveBuffs {
  const base = createEmptyBuffs();
  if (raw === null || typeof raw !== 'object') return base;
  const b = raw as Partial<ActiveBuffs>;
  return {
    productionMultiplier: toFloat(b.productionMultiplier, 1, 1, 1e6),
    productionSeconds: toFloat(b.productionSeconds, 0, 0, 1e9),
    powerMultiplier: toFloat(b.powerMultiplier, 1, 1, 1e6),
    powerSeconds: toFloat(b.powerSeconds, 0, 0, 1e9),
    safetyReduction: toFloat(b.safetyReduction, 0, 0, 1),
    safetySeconds: toFloat(b.safetySeconds, 0, 0, 1e9),
    yieldMultiplier: toFloat(b.yieldMultiplier, 1, 1, 1e6),
    yieldSeconds: toFloat(b.yieldSeconds, 0, 0, 1e9),
    speedMultiplier: toFloat(b.speedMultiplier, 1, 1, 1e6),
    speedSeconds: toFloat(b.speedSeconds, 0, 0, 1e9),
  };
}

/**
 * 一致性修复：弟子状态与探索列表互相对齐。
 *
 * 手动编辑过存档、或存档在探索途中被中断，都可能出现
 * "弟子标记为探索中但找不到对应队伍"这类不一致，修好再进入游戏。
 */
function repairState(state: GameState): GameState {
  const exploring = new Map<string, string>();
  for (const e of state.expeditions) {
    for (const id of e.discipleIds) exploring.set(id, e.id);
  }

  const disciples = state.sect.disciples.map((d) => {
    const expeditionId = exploring.get(d.id);
    return expeditionId
      ? { ...d, status: 'exploring' as const, expeditionId }
      : { ...d, status: 'idle' as const, expeditionId: undefined };
  });

  const known = new Set(disciples.map((d) => d.id));
  const expeditions = state.expeditions
    .map((e) => ({ ...e, discipleIds: e.discipleIds.filter((id) => known.has(id)) }))
    .filter((e) => e.discipleIds.length > 0);

  return { ...state, sect: { ...state.sect, disciples }, expeditions };
}

/* ------------------------------------------------------------------ */
/* 新增字段的读档校验                                                   */
/* ------------------------------------------------------------------ */

/** 只保留已知 key 的布尔表（技术 / 图纸） */
function toBoolMap(raw: unknown, allowed: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (raw === null || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  for (const key of allowed) {
    if (source[key] === true) out[key] = true;
  }
  return out;
}

/** 种子表：只保留已知材料，数量取正整并设上限 */
function toSeedMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in SEED_MAP)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    out[key] = Math.min(Math.floor(value), 1e9);
  }
  return out;
}

function sanitizeTravel(raw: unknown): PersonalTravel | null {
  if (raw === null || typeof raw !== 'object') return null;
  const t = raw as Partial<PersonalTravel>;
  if (typeof t.regionId !== 'string' || !TRAVEL_REGION_MAP[t.regionId]) return null;

  const def = TRAVEL_REGION_MAP[t.regionId];
  return {
    regionId: t.regionId,
    progress: toFloat(t.progress, 0, 0, 1e9),
    duration: toFloat(t.duration, def.duration, 1, 1e9),
  };
}

function sanitizePlantings(raw: unknown, nextId: number): Planting[] {
  if (!Array.isArray(raw)) return [];
  const out: Planting[] = [];
  for (let i = 0; i < raw.length && i < 500; i += 1) {
    const entry = raw[i];
    if (entry === null || typeof entry !== 'object') continue;
    const p = entry as Partial<Planting>;
    if (typeof p.material !== 'string' || !(p.material in MATERIAL_MAP)) continue;

    const seed = SEED_MAP[p.material];
    out.push({
      id: typeof p.id === 'string' && p.id ? p.id : `p${nextId + i}`,
      material: p.material as MaterialId,
      progress: toFloat(p.progress, 0, 0, 1e9),
      duration: toFloat(p.duration, seed?.growSeconds ?? 300, 1, 1e9),
    });
  }
  return out;
}

/** 秘境冷却表：只保留已知秘境，剩余时间取正数并设上限 */
function sanitizeCooldowns(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SECRET_REALM_MAP[id]) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    out[id] = Math.min(value, 1e6);
  }
  return out;
}

function sanitizeResearch(raw: unknown): ResearchState | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Partial<ResearchState>;
  if (typeof r.id !== 'string' || !TECH_MAP[r.id]) return null;
  return {
    id: r.id,
    remaining: toFloat(r.remaining, TECH_MAP[r.id].seconds, 0, 1e9),
  };
}

function sanitizeShop(raw: unknown): ShopState {
  const empty = createEmptyShop();
  if (raw === null || typeof raw !== 'object') return empty;
  const s = raw as Partial<ShopState>;
  const offers: ShopOffer[] = [];

  if (Array.isArray(s.offers)) {
    for (let i = 0; i < s.offers.length && i < 40; i += 1) {
      const entry = s.offers[i];
      if (entry === null || typeof entry !== 'object') continue;
      const o = entry as Partial<ShopOffer>;
      if (typeof o.item !== 'string') continue;
      // 商品必须在货品表里，且图纸不能是已经拿到的
      const good = SHOP_GOOD_MAP[`${o.kind}:${o.item}`];
      if (!good) continue;
      offers.push({
        id: typeof o.id === 'string' && o.id ? o.id : `o${i}`,
        kind: good.kind,
        item: good.item,
        amount: toInt(o.amount, good.baseAmount, 1, 1e12),
        price: toInt(o.price, good.basePrice, 1, 1e15),
        sold: o.sold === true,
      });
    }
  }

  return {
    offers,
    secondsLeft: toFloat(s.secondsLeft, 0, 0, 1e9),
  };
}

/** 兼容 v1 存档：那版把丹药当成资源，设施存在 g 字段里 */
function migrateFromV1(raw: Record<string, unknown>): Record<string, unknown> {
  const legacyResources = (raw.r ?? {}) as Record<string, unknown>;
  const legacyBuildings = (raw.g ?? {}) as Record<string, unknown>;

  // v1 的「丹药」是通用资源，v2 已经没有这个资源了，
  // 折算成等量的聚气丹还给玩家，避免升级后凭空少东西。
  const legacyPills = Math.max(0, Math.floor(Number(legacyResources.pill) || 0));

  return {
    v: SAVE_VERSION,
    at: raw.at,
    r: {
      qi: legacyResources.qi,
      wood: legacyResources.wood,
      ore: legacyResources.ore,
      stone: 0,
      herb: 0,
    },
    m: {},
    b: legacyBuildings,
    pl: legacyPills > 0 ? { qiGatheringPill: legacyPills } : {},
    ar: {},
    ri: raw.ri,
    li: raw.li,
    dy: raw.dy,
    asc: raw.asc,
    tq: raw.tq,
    lq: raw.lq,
    pt: raw.pt,
  };
}

export function deserialize(raw: unknown): GameState | null {
  if (raw === null || typeof raw !== 'object') return null;
  let data = raw as Record<string, unknown>;
  if (typeof data.v !== 'number') return null;

  // v1 → 当前版本迁移。
  // 必须精确判断「是不是 v1」：早先写的是 data.v < SAVE_VERSION，
  // 一旦 SAVE_VERSION 从 2 升到 3，所有 v2 存档都会被当成 v1 洗掉。
  if (data.v < 2) data = migrateFromV1(data);

  const fresh = createInitialState();

  /* ---- 资源与材料 ---- */
  const resources: ResourceMap = createEmptyResources();
  const rawResources = (data.r ?? {}) as Record<string, unknown>;
  for (const id of RESOURCE_IDS) resources[id] = toDec(rawResources[id], 0);

  const materials: MaterialMap = createEmptyMaterials();
  const rawMaterials = (data.m ?? {}) as Record<string, unknown>;
  for (const id of MATERIAL_IDS) materials[id] = toDec(rawMaterials[id], 0);

  /* ---- 建筑 ---- */
  const buildings = createEmptyBuildings();
  const rawBuildings = (data.b ?? data.g ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(buildings)) {
    const value = rawBuildings[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      buildings[key] = Math.min(Math.floor(value), 1e9);
    }
  }

  /* ---- 已解锁建筑 ---- */
  // 三种来源都算解锁：存档里明确记着的、已经建过的（兼容没有 ub 字段的旧存档）、
  // 以及当前资源就满足条件的（下面 refreshUnlocks 会补上）
  const unlockedBuildings = createEmptyUnlocked();
  const rawUnlocked = (data.ub ?? {}) as Record<string, unknown>;
  for (const def of BUILDABLES) {
    if (rawUnlocked[def.id] === true || (buildings[def.id] ?? 0) > 0) {
      unlockedBuildings[def.id] = true;
    }
  }

  /* ---- 已发现的秘境（需求 1：发现机制） ---- */
  // 存档里明确记着「已发现」的，一律保留。
  // 兼容 v3 及更早的存档：那一版秘境是「攒够材料自动解锁」的，
  // 只要玩家现在还留着任何一项材料（或曾经把材料炼掉过），
  // 就按「已发现」处理 —— 升级不该让玩家丢掉已经走过的地图。
  const discoveredRealms = createEmptyDiscoveredRealms();
  const rawRealms = (data.ur ?? {}) as Record<string, unknown>;
  const hasLegacyRealmData = Object.keys(rawRealms).length > 0;
  for (const def of SECRET_REALMS) {
    if (rawRealms[def.id] === true) {
      discoveredRealms[def.id] = true;
    }
  }
  if (hasLegacyRealmData) {
    // 旧存档只记了「解锁过」的，没记「哪些是初始就有」的 —— 全部保留即可
    for (const [id, value] of Object.entries(rawRealms)) {
      if (value === true && SECRET_REALM_MAP[id]) discoveredRealms[id] = true;
    }
  }

  /* ---- 丹药与器物 ---- */
  const pills = toCountMap(data.pl);
  const artifacts = toCountMap(data.ar);

  /* ---- 境界 ---- */
  const realmIndex = toInt(data.ri, 0, 0, FINAL_REALM_INDEX);
  const layer = toInt(data.li, 0, 0, REALMS[realmIndex].layerCount);

  const pityRaw = Array.isArray(data.bp) ? data.bp : [];
  const breakthroughPity = pityRaw
    .slice(0, REALMS.length)
    .map((value) => toFloat(value, 0, 0, 1));

  /* ---- 宗门 ---- */
  const rawSect = (data.sec ?? {}) as Record<string, unknown>;
  const disciplesRaw = Array.isArray(rawSect.d) ? rawSect.d : [];
  const disciples: Disciple[] = [];
  for (let i = 0; i < disciplesRaw.length && i < 500; i += 1) {
    const d = sanitizeDisciple(disciplesRaw[i], i);
    if (d) disciples.push(d);
  }

  const sect = {
    ...createEmptySect(),
    founded: rawSect.f === true,
    level: toInt(rawSect.lv, 1, 1, 9),
    disciples,
    totalRecruited: toInt(rawSect.tr, disciples.length, 0, 1e9),
    lifespanBonus: toFloat(rawSect.lb, 0, 0, 1e4),
  };

  const expeditions: Expedition[] = [];
  if (Array.isArray(data.ex)) {
    for (const raw of data.ex.slice(0, 50)) {
      const e = sanitizeExpedition(raw);
      if (e) expeditions.push(e);
    }
  }

  const now = Date.now();

  /* ---- 仆人：只保留已知工种，且数量必须为正整数 ---- */
  const servants: Record<string, number> = {};
  const rawServants = (data.sv ?? {}) as Record<string, unknown>;
  for (const [job, count] of Object.entries(rawServants)) {
    if (!(job in SERVANT_JOB_MAP)) continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    servants[job] = Math.min(Math.floor(count), 1e6);
  }

  /* ---- 新增字段（需求 1 / 3 / 4 / 5 / 6） ---- */
  const nextPlantingId = toInt(data.npi, 1, 1, Number.MAX_SAFE_INTEGER);
  const plantings = sanitizePlantings(data.pg, nextPlantingId);

  const state: GameState = {
    version: SAVE_VERSION,
    resources,
    materials,
    buildings,
    unlockedBuildings,
    discoveredRealms,
    pills,
    artifacts,
    realmIndex,
    layer,
    breakthroughPity,
    globalBreakthroughBonus: toFloat(data.gb, 0, 0, 10),
    mind: toFloat(data.mi, fresh.mind, 0, 1e6),
    mindProgress: toFloat(data.mp, 0, 0, 1e6),
    servants,
    injurySeconds: toFloat(data.inj, 0, 0, 1e9),
    personalTravel: sanitizeTravel(data.pv),
    autoRefineLevel: toInt(data.au, 0, 0, AUTO_REFINE_LEVEL_MAX),
    autoRefineProgress: toFloat(data.ap, 0, 0, 1e6),
    seeds: toSeedMap(data.sd),
    plantings,
    nextPlantingId,
    techs: toBoolMap(data.tc, TECHS.map((t) => t.id)),
    research: sanitizeResearch(data.rs),
    blueprints: toBoolMap(data.bpr, Object.keys(BLUEPRINT_MAP)),
    shop: sanitizeShop(data.sh),
    realmCooldowns: sanitizeCooldowns(data.rc),
    discoveryPity: toFloat(data.dp, 0, 0, DISCOVERY_PITY_CAP),
    arenaEnabled: data.ae === true,
    arenaTimer: toFloat(data.arn, ARENA_INTERVAL_SECONDS, 0, 1e9),
    arenaBuffSeconds: toFloat(data.arb, 0, 0, 1e9),
    sectEventTimer: toFloat(data.se, 0, 0, 1e9),
    daoYun: toDec(data.dy, 0),
    ascensions: toInt(data.asc, 0, 0, Number.MAX_SAFE_INTEGER),
    totalQi: toDec(data.tq, 0),
    lifetimeQi: toDec(data.lq, 0),
    sect,
    expeditions,
    journal: sanitizeJournal(data.jr),
    alchemyTier: toInt(data.al, 1, 1, 9),
    refiningTier: toInt(data.rf, 1, 1, 9),
    buffs: sanitizeBuffs(data.bf),
    playTime: toInt(data.pt, 0, 0, Number.MAX_SAFE_INTEGER),
    savedAt: toInt(data.at, now, 0, Number.MAX_SAFE_INTEGER),
    nextDiscipleId: toInt(data.nid, disciples.length + 1, 1, Number.MAX_SAFE_INTEGER),
  };

  return refreshUnlocks(repairState(state));
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
    // 隐私模式、配额满等情况会抛异常，不该让游戏崩掉
    console.warn('[仙途] 存档失败：', err);
    return false;
  }
}

export function loadFromLocal(): GameState | null {
  try {
    const text = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(LEGACY_SAVE_KEY);
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
    localStorage.removeItem(LEGACY_SAVE_KEY);
  } catch (err) {
    console.warn('[仙途] 清档失败：', err);
  }
}

/* ------------------------------------------------------------------ */
/* 导出 / 导入存档码                                                    */
/* ------------------------------------------------------------------ */

/** 先 encodeURIComponent 再 btoa，让中文和特殊字符也能安全编码 */
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

export interface OfflineLoot {
  id: string;
  name: string;
  icon: string;
  amount: number;
}

export interface OfflineReport {
  seconds: number;
  gains: { id: ResourceId; amount: Decimal }[];
  materialGains: { id: MaterialId; amount: Decimal }[];
  pillGains: OfflineLoot[];
  /** 离线期间带回来的材料种子（游历 / 探索，需求 5） */
  seedGains: OfflineLoot[];
  /** 离线期间寻获的图纸（需求 6） */
  blueprintGains: OfflineLoot[];
  /** 离线期间发生的事件（弟子突破、陨落、探索归来等） */
  journal: JournalEntry[];
}

/**
 * 结算离线收益。
 *
 * 直接复用 applyTick，只是把时间乘以离线效率 ——
 * 这样弟子修炼、秘境推进、增益消耗全都会自动正确处理，
 * 不需要在这里重写一遍逻辑（也就不会出现"线上和离线算得不一样"的 bug）。
 */
export function applyOffline(
  state: GameState,
  now = Date.now(),
  random: RandomSource = gameRandom,
): { state: GameState; report: OfflineReport | null } {
  const elapsed = (now - state.savedAt) / 1000;
  const seconds = Math.min(Math.max(Number.isFinite(elapsed) ? elapsed : 0, 0), MAX_OFFLINE_SECONDS);

  if (seconds < MIN_OFFLINE_SECONDS) {
    return { state: { ...state, savedAt: now }, report: null };
  }

  const before = state;
  const advanced = applyTick(state, seconds * OFFLINE_EFFICIENCY, random);
  const after: GameState = { ...advanced, savedAt: now };

  const gains = RESOURCE_IDS.map((id) => ({ id, amount: after.resources[id].sub(before.resources[id]) })).filter(
    (entry) => entry.amount.gt(0),
  );
  const materialGains = MATERIAL_IDS.map((id) => ({
    id,
    amount: after.materials[id].sub(before.materials[id]),
  })).filter((entry) => entry.amount.gt(0));

  const pillGains: OfflineLoot[] = [];
  for (const [id, count] of Object.entries(after.pills)) {
    const beforeCount = before.pills[id] ?? 0;
    if (count > beforeCount) {
      const def = PILL_MAP[id];
      pillGains.push({
        id,
        name: def?.name ?? id,
        icon: def?.icon ?? '⚗',
        amount: count - beforeCount,
      });
    }
  }

  // 离线期间新增的记事（journal 是最新在前，取多出来的部分）
  const newCount = Math.max(0, after.journal.length - before.journal.length);
  const journal = after.journal.slice(0, newCount);

  const seedGains: OfflineLoot[] = [];
  for (const [id, count] of Object.entries(after.seeds)) {
    const beforeCount = before.seeds[id] ?? 0;
    if (count > beforeCount) {
      const def = SEED_MAP[id];
      seedGains.push({
        id,
        name: def?.name ?? id,
        icon: def?.icon ?? '🌰',
        amount: count - beforeCount,
      });
    }
  }

  const blueprintGains: OfflineLoot[] = Object.keys(after.blueprints)
    .filter((id) => before.blueprints[id] !== true)
    .map((id) => ({
      id,
      name: BLUEPRINT_MAP[id]?.name ?? id,
      icon: BLUEPRINT_MAP[id]?.icon ?? '📜',
      amount: 1,
    }));

  return {
    state: after,
    report: { seconds, gains, materialGains, pillGains, seedGains, blueprintGains, journal },
  };
}

/** 供界面显示用：把 ItemId 转成名字和图标 */
export function describeItem(id: ItemId): { name: string; icon: string } {
  return ITEM_MAP[id] ?? { name: id, icon: '?' };
}
