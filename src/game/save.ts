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
  ARTIFACT_MAP,
  REFINE_RECIPE_MAP,
  BLUEPRINT_MAP,
  BUILDABLES,
  BUILDABLE_MAP,
  BUILD_QUEUE_MAX_SLOTS,
  QUEUE_UPGRADES,
  ENCOUNTER_MAP,
  ENLIGHTEN_PATH_IDS,
  ENLIGHTEN_PATH_MAP,
  MAX_ENLIGHTEN_LEVEL,
  MAX_SPACE_RINGS,
  DISCOVERY_PITY_FAILURES,
  DISCIPLE_CAP_BY_SECT_LEVEL,
  MAP_REGION_MAP,
  FINAL_REALM_INDEX,
  INSIGHT_MAX_ABSOLUTE,
  ITEM_MAP,
  MATERIAL_IDS,
  DEFAULT_FURNACE_ID,
  FURNACE_MAP,
  GEAR_MAP,
  GEAR_SLOTS,
  HAPPINESS_MAX,
  HAPPINESS_MIN,
  HAPPINESS_NEUTRAL,
  CARAVAN_INTERVAL_SECONDS,
  TALISMAN_MAP,
  MANUAL_MAP,
  manualIdOfFragment,
  slotAccepts,
  MATERIAL_MAP,
  FAME_MAX,
  FAME_GOOD_MAP,
  FAME_SHOP_REFRESH_SECONDS,
  NPC_SECTS,
  NPC_SECT_MAP,
  GIFT_MAX_PER_SECT,
  RELATION_MIN,
  RELATION_MAX,
  TRAIT_MAP,
  ENDING_MAP,
  WAR_BATTLE_INTERVAL,
  clampRelation,
  type EndingId,
  PILL_MAP,
  REALMS,
  RESOURCE_IDS,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  SEASON_SECONDS,
  SEASONS,
  SEED_MAP,
  SERVANT_JOB_MAP,
  SHOP_GOOD_MAP,
  TECHS,
  TECH_MAP,
  TRAVEL_REGION_MAP,
  WEATHER_MAP,
  WEATHER_ROLL_INTERVAL,
  createEmptyBuffs,
  COMBAT_TALENT_IDS,
  DEMON_MAX,
  DEMON_MIN,
  FARM_TALENT_IDS,
  LOYALTY_INITIAL,
  LOYALTY_MAX,
  LOYALTY_MIN,
  PERSONALITY_IDS,
  type ActiveBuffs,
  type AptitudeId,
  type CombatTalentId,
  type FarmTalentId,
  type ItemId,
  type MaterialId,
  type PersonalityId,
  type ResourceId,
  type ShopOffer,
} from './content';
import { ARENA_INTERVAL_SECONDS } from './sectActivity';
import { getSurveyDuration } from './expeditions';
import { SOLO_SURVEY_DURATION_MULT } from './travel';
import { SOLO_REALM_DURATION_MULT } from './travel';
import { ENCOUNTER_INTERVAL, ENCOUNTER_SECONDS, KARMA_MAX, KARMA_MIN } from './encounter';
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
  /**
   * `bp`（每个境界累积的突破保底加成）**已废弃**（需求 9 删除保底机制）。
   * 字段声明保留成可选，只为让旧存档能原样读进来而不报错；不再序列化。
   */
  bp?: number[];
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
  /** discoveryFailures：连续没发现新秘境的次数，用于硬保底（需求 1） */
  df?: number;
  /** 建造队列（需求 2） */
  bq?: unknown;
  /** 已开启的秘境（需求 1） */
  or?: Record<string, boolean>;
  /** 可携带器物的剩余次数（需求 2） */
  gc?: Record<string, number>;
  /** 功法：完整功法 `mn`、碎片 `mf`（设定集第 7 章） */
  mn?: Record<string, number>;
  mf?: Record<string, number>;
  /** 装备库存（设定集第 8.7 章） */
  gr?: Record<string, number>;
  /** 符箓库存（需求 8，键名 tmf 避开已被占用的 tl / tm） */
  tmf?: Record<string, number>;
  /** 制符品阶（键名 ttier 避开已被占用的 tt / tq） */
  ttier?: unknown;
  /** 已铸成的丹炉（设定集第 11 章） */
  fn?: unknown;
  /** 当前在用的炉鼎 */
  fd?: unknown;
  /* ---- 声望 / 特质 / 外交 / 结局（设定集第 1 / 9 / 10 章） ---- */
  /** 声望 */
  fm?: unknown;
  /** 声望商店货架 */
  fs?: unknown;
  /** 声望商店倒计时 */
  fst?: unknown;
  /** 已选特质 */
  /** 已选特质（键名取 tf：避免与 sec.tr 混淆） */
  tf?: unknown;
  /** @deprecated 旧键名，读档时兼容 */
  tr?: unknown;
  /** 候选特质 */
  to?: unknown;
  /** 已完成结局（跨周目） */
  le?: unknown;
  /** NPC 宗门关系 */
  ns?: { id?: string; relation?: unknown; gifts?: unknown; alliance?: unknown }[];
  /** 是否主动宣战过 */
  ew?: unknown;
  /** 第 24 轮（需求 2）：是否停过战（键名取 mpc：mp 已被 mindProgress 占、pc 已被 parleyCooldowns 占） */
  mpc?: unknown;
  /** 正在交战的宗门 */
  aw?: unknown;
  /** 大战计时（键名取 wm：wt 已经被天象 id 占了） */
  wm?: unknown;
  /** 论道冷却 */
  pc?: unknown;
  /** 宗门幸福度（需求 4） */
  hp?: unknown;
  /** 空间禁制层数（需求 6） */
  sw?: unknown;
  /** 到访中的商队（需求 7） */
  cv?: unknown;
  /** 下一支商队的倒计时（需求 7） */
  cvt?: unknown;
  /** 宗门大阵是否在运转（需求 9） */
  sa?: unknown;
  /** 秘境探索次数（需求 9 的危险度进度） */
  rr?: unknown;
  /** 各条配方的自动合成目标存量（本轮需求 2） */
  art?: Record<string, number>;
  /**
   * 第 27 轮（需求 3）：自动炼制的目标存量。
   *
   * ⚠️ 键名与 `art`（自动合成）只差一个字母，所以这里把语义写死在注释里：
   * **art = autoRefineTargets（合成）· act = autoCraftTargets（炼制）**。
   */
  act?: Record<string, number>;
  /** 自动炼制的节拍（秒） */
  actm?: number;
  /** 天工院特殊升级等级（需求 2） */
  tl?: number;
  /** 善恶值 / 待选遭遇 id / 遭遇判定计时（需求 2） */
  ka?: number;
  pe?: string | null;
  et?: number;
  /** 当前遭遇的剩余秒数（需求 1） */
  ed?: number;
  /** 感悟阶数 / 正在感悟的那一阶 / 空间戒指数 / 上次穿梭时间（需求 3） */
  en?: Record<string, number>;
  eg?: { pathId: string; remaining: number; total: number } | null;
  sr?: number;
  lj?: number;
  /** arenaEnabled / arenaTimer / arenaBuffSeconds：宗门大比（需求 4） */
  ae?: boolean;
  arn?: number;
  arb?: number;
  /** sectEventTimer：距离下次宗门随机事件的秒数（需求 4） */
  se?: number;
  /** 季节与天象（需求 1）：sn 季节下标 / ss 本季已过秒数 */
  sn?: number;
  ss?: number;
  /** wt 天象 id / ws 剩余秒数 / wr 距下次判定秒数 */
  wt?: string | null;
  ws?: number;
  wr?: number;
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
    /** 功法（设定集第 7 章）：完整功法 `mn`、碎片 `mf` */
    mn: { ...state.manuals },
    mf: { ...state.manualFragments },
    /* 装备库存 gr / 丹炉 fn + fd（设定集第 8.7 / 11 章） */
    gr: { ...state.gears },
    /* 符箓库存 tmf 与制符品阶 ttier（需求 8：这两个键名都是先查过整份表才定的） */
    tmf: { ...state.talismans },
    ttier: state.talismanTier,
    fn: [...state.furnaces],
    fd: state.furnaceId,
    /* ---- 声望 / 特质 / 外交 / 结局（设定集第 1 / 9 / 10 章） ---- */
    fm: state.fame,
    fs: state.fameShop.offers.map((o) => ({ g: o.goodId, p: o.price })),
    fst: state.fameShop.secondsLeft,
    /* 特质 tf（不是 tr —— tr 已经被 sec.totalRecruited 用了，同名极易看错） */
    tf: [...state.traits],
    to: [...state.traitOffer],
    le: [...state.legacyEndings],
    ns: state.npcSects.map((s) => ({
      id: s.id,
      relation: s.relation,
      gifts: s.gifts,
      alliance: s.alliance,
    })),
    ew: state.everDeclaredWar,
    mpc: state.everMadePeace,
    aw: [...state.atWarWith],
    wm: state.warTimer,
    pc: { ...state.parleyCooldowns },
    rr: { ...state.realmRuns },
    hp: state.happiness,
    sw: { ...state.spatialWards },
    cv: state.caravan ?? undefined,
    cvt: state.caravanTimer,
    sa: state.sectArrayOn,
    gc: { ...state.gearCharges },
    ri: state.realmIndex,
    li: state.layer,
    gb: state.globalBreakthroughBonus,
    mi: state.mind,
    mp: state.mindProgress,
    sv: { ...state.servants },
    inj: state.injurySeconds,
    pv: state.personalTravel,
    au: state.autoRefineLevel,
    ap: state.autoRefineProgress,
    art: { ...state.autoRefineTargets },
    /* 第 27 轮（需求 3）：自动炼制 —— 键名取 act / actm（art 已被自动合成的目标占用） */
    act: { ...state.autoCraftTargets },
    actm: state.autoCraftTimer,
    sd: { ...state.seeds },
    pg: state.plantings,
    npi: state.nextPlantingId,
    tc: { ...state.techs },
    rs: state.research,
    bpr: { ...state.blueprints },
    sh: state.shop,
    rc: { ...state.realmCooldowns },
    or: { ...state.openedRealms },
    df: state.discoveryFailures,
    bq: [...state.buildQueue],
    tl: state.tiangongLevel,
    // 善恶值与随机遭遇（需求 2）：ka 善恶值 / pe 待选遭遇 / et 遭遇判定计时
    ka: state.karma,
    pe: state.pendingEncounter,
    et: state.encounterTimer,
    ed: state.encounterDeadline,
    en: { ...state.enlightenment },
    eg: state.enlightening,
    sr: state.spaceRings,
    lj: state.lastTimeJump,
    ae: state.arenaEnabled,
    arn: state.arenaTimer,
    arb: state.arenaBuffSeconds,
    se: state.sectEventTimer,
    // 季节与天象（需求 1）：`sn` 季节下标 / `ss` 本季已过秒数
    // `wt` 天象 id / `ws` 天象剩余秒数 / `wr` 距下次天象判定秒数
    sn: state.season,
    ss: state.seasonSeconds,
    wt: state.weatherId,
    ws: state.weatherSeconds,
    wr: state.weatherTimer,
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

/** 读一个夹在区间里的**浮点**数（幸福度用；toInt 会截断小数） */
/**
 * 读回商队（需求 7）。
 *
 * ⚠️ 这一块是**唯一**需要"读档时清洗嵌套结构"的地方：wants / offers
 * 都是数组，旧存档或手改存档里可能是任意东西。宁可把整支商队丢掉
 * （玩家只是少了一次交易），也不能让一个坏对象把界面炸掉。
 */
function sanitizeCaravan(raw: unknown): GameState['caravan'] {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const cleanList = (list: unknown): { id: string; name: string; icon: string; amount: number; value: number }[] => {
    if (!Array.isArray(list)) return [];
    return list
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
      .map((x) => ({
        id: String(x.id ?? ''),
        name: String(x.name ?? ''),
        icon: String(x.icon ?? '📦'),
        amount: Math.max(1, Math.floor(Number(x.amount ?? 1)) || 1),
        value: Math.max(0, Number(x.value ?? 0) || 0),
      }))
      .filter((x) => x.id !== '')
      .slice(0, 8);
  };
  const wants = cleanList(source.wants);
  const offers = cleanList(source.offers);
  if (wants.length === 0 && offers.length === 0) return null;
  return {
    id: String(source.id ?? 'c0'),
    wants,
    offers,
    secondsLeft: Math.max(0, Number(source.secondsLeft ?? 0) || 0),
  };
}

function toClamped(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function toFloat(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/**
 * 把任意输入读成"字符串 id 数组"，并用 `accept` 过滤掉已经删掉的内容。
 *
 * 声望 / 特质 / 结局 / 交战对象四处都是这个形状 —— 它们都必须"只认还在定义里的 id"，
 * 否则一个被删掉的功法或宗门会永远留在存档里（既读不出名字，又占着位置）。
 */
/**
 * 读取弟子的五个装备栏。
 *
 * 校验两件事：id 还在定义里、且**大类与栏位匹配**（剑不能放进丹药栏）。
 * 旧存档没有这个字段时返回五个空栏 —— 与"新弟子一律空手"口径一致。
 */
/** 读取四项技艺点（缺字段 → 全 0；非数字 / 负数一律归零） */
function sanitizeSkills(raw: unknown): { alchemy: number; refining: number; talisman: number; farm: number } {
  const out = { alchemy: 0, refining: 0, talisman: 0, farm: 0 };
  if (raw === null || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  for (const kind of ['alchemy', 'refining', 'talisman', 'farm'] as const) {
    const value = source[kind];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[kind] = Math.min(value, 1e9);
    }
  }
  return out;
}

function sanitizeGearSlots(raw: unknown): { gain: string; attack: string; defense: string; pill1: string; pill2: string } {
  const out = { gain: '', attack: '', defense: '', pill1: '', pill2: '' };
  if (raw === null || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  for (const slot of GEAR_SLOTS) {
    const id = source[slot];
    if (typeof id !== 'string') continue;
    const def = GEAR_MAP[id];
    if (!def) continue;
    if (!slotAccepts(slot, def.kind)) continue;
    out[slot] = id;
  }
  return out;
}

function sanitizeIds(raw: unknown, accept?: (id: string) => boolean): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (accept && !accept(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** 把任意输入读成"字符串 → 非负有限数"的表（冷却时间之类） */
/** 把任意输入读成"字符串 → 非负整数"的表（秘境探索次数这类计数用它） */
function toIntMap(raw: unknown, max = 1e6): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[key] = Math.min(Math.floor(value), max);
    }
  }
  return out;
}

function sanitizeNumberMap(raw: unknown, max = 1e9): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[key] = Math.min(value, max);
    }
  }
  return out;
}

/** 声望商店的货架：只留认得出的商品，价格按当前定义表重算（防止旧存档定死一个过期价） */
function sanitizeFameOffers(raw: unknown): { goodId: string; price: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { goodId: string; price: number }[] = [];
  for (const entry of raw) {
    const goodId = typeof (entry as { g?: unknown })?.g === 'string' ? ((entry as { g: string }).g) : '';
    const def = FAME_GOOD_MAP[goodId];
    if (!def) continue;
    if (!out.some((o) => o.goodId === goodId)) out.push({ goodId, price: def.price });
  }
  return out;
}

/**
 * 把任意输入安全读成「id → 正整数」的表（丹药 / 器物 / 功法库存都是这个形状）。
 *
 * `accept` 用于过滤掉已经删掉的内容：旧存档里可能存着一个后来被移除的
 * 丹药 / 功法 id，不过滤的话它会一直躺在库存里（界面读不出名字、还占存档体积）。
 */
function toCountMap(
  raw: unknown,
  min = 0,
  max = 1e12,
  accept?: (key: string) => boolean,
): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (accept && !accept(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > min) {
      out[key] = Math.min(Math.floor(value), max);
    }
  }
  return out;
}

/**
 * 由字符串稳定地推出一个小整数（FNV-1a）。
 *
 * 本轮新增了"战斗天赋 / 种田天赋 / 性格"三个随机维度，而旧存档里没有它们。
 * 补的时候**必须用这种确定性派生**，不能用 `random()`：
 * 否则每次刷新页面都会给同一名弟子换一套性格与天赋 —— 那等于内置了读档作弊，
 * 而且玩家会以为界面在乱跳。
 */
function stableIndex(text: string, mod: number): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % mod;
}

function sanitizeDisciple(raw: unknown, index: number): Disciple | null {
  if (raw === null || typeof raw !== 'object') return null;
  const d = raw as Partial<Disciple>;
  if (typeof d.id !== 'string' || typeof d.name !== 'string') return null;

  const aptitude: AptitudeId = APTITUDE_ORDER.includes(d.aptitude as AptitudeId)
    ? (d.aptitude as AptitudeId)
    : 'mortal';

  const id = d.id;
  const combatTalent = COMBAT_TALENT_IDS.includes(d.combatTalent as CombatTalentId)
    ? (d.combatTalent as CombatTalentId)
    : COMBAT_TALENT_IDS[stableIndex(`${id}:c`, COMBAT_TALENT_IDS.length)];
  const farmTalent = FARM_TALENT_IDS.includes(d.farmTalent as FarmTalentId)
    ? (d.farmTalent as FarmTalentId)
    : FARM_TALENT_IDS[stableIndex(`${id}:f`, FARM_TALENT_IDS.length)];
  const personality = PERSONALITY_IDS.includes(d.personality as PersonalityId)
    ? (d.personality as PersonalityId)
    : PERSONALITY_IDS[stableIndex(`${id}:p`, PERSONALITY_IDS.length)];

  // 旧存档没有忠诚度：按资质区间的中点补一个（新存档是区间里随机取）
  const [loyaltyMin, loyaltyMax] = LOYALTY_INITIAL[aptitude];
  const loyaltyFallback = (loyaltyMin + loyaltyMax) / 2;

  return {
    id,
    name: d.name.slice(0, 24) || `弟子${index + 1}`,
    aptitude,
    combatTalent,
    farmTalent,
    personality,
    loyalty: toFloat(d.loyalty, loyaltyFallback, LOYALTY_MIN, LOYALTY_MAX),
    // 心魔是"练出来的"：旧存档里的弟子一律从 0 起，不凭空给他们塞心病
    demon: toFloat(d.demon, 0, DEMON_MIN, DEMON_MAX),
    idleSeconds: toFloat(d.idleSeconds, 0, 0, 1e9),
    realmIndex: toInt(d.realmIndex, 0, 0, FINAL_REALM_INDEX),
    progress: toFloat(d.progress, 0, 0, 1e9),
    age: toFloat(d.age, 16, 0, 1e9),
    insight: toFloat(d.insight, 0, 0, INSIGHT_MAX_ABSOLUTE),
    // 功法：只认还存在的 id（一本被删掉的功法不该让读档报错）
    cultivationManual: MANUAL_MAP[String(d.cultivationManual)] ? String(d.cultivationManual) : '',
    combatManual: MANUAL_MAP[String(d.combatManual)] ? String(d.combatManual) : '',
    // 弟子五装备栏（设定集第 8.7 章）：只认还在定义里、且大类与栏位匹配的 id
    gear: sanitizeGearSlots(d.gear),
    // 派遣与技艺（需求 3 / 12）
    post: typeof d.post === 'string' && d.post ? String(d.post) : '',
    skills: sanitizeSkills(d.skills),
    // status 交给 repairState 依据探索列表重新推导，这里先一律置空闲
    status: 'idle',
  };
}

/** 建造队列：只留下还认得出来的 id，并且不超过当前名额 */
function sanitizeBuildQueue(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === 'string' && BUILDABLE_MAP[id] !== undefined)
    .slice(0, BUILD_QUEUE_MAX_SLOTS);
}

function sanitizeExpedition(raw: unknown): Expedition | null {
  if (raw === null || typeof raw !== 'object') return null;
  const e = raw as Partial<Expedition>;
  if (typeof e.realmId !== 'string') return null;
  if (!Array.isArray(e.discipleIds)) return null;

  /*
   * 现在有两种探索（需求 1）：
   *   realm  —— realmId 是秘境 id
   *   survey —— realmId 是小区域 id
   * 所以目标是否存在要分别校验，默认时长也要分别取。
   */
  const kind: Expedition['kind'] = e.kind === 'survey' ? 'survey' : 'realm';
  const def = SECRET_REALM_MAP[e.realmId];
  const region = MAP_REGION_MAP[e.realmId];
  if (kind === 'realm' && !def) return null;
  if (kind === 'survey' && !region) return null;

  const ids = e.discipleIds.filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return null;

  const fallbackDuration = kind === 'survey' ? getSurveyDuration({} as GameState, e.realmId) : (def?.duration ?? 60);
  return {
    id: typeof e.id === 'string' ? e.id : `e_${e.realmId}_${ids[0]}`,
    realmId: e.realmId,
    discipleIds: ids,
    progress: toFloat(e.progress, 0, 0, 1e9),
    duration: toFloat(e.duration, fallbackDuration, 1, 1e9),
    kind,
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
    safetyOnce: b.safetyOnce === true,
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

/** 感悟阶数：只认还存在的道，并夹到 0~90 */
/** 已开启的秘境：只认还存在的秘境 id */
/** 可携带器物的剩余次数：只认还在库存里、而且确实可携带的器物 */
/** 自动合成目标：只认还存在的配方 id，值夹到 0~1e9 */
/**
 * 自动炼制的目标存量（第 27 轮）。
 *
 * 与自动合成那张表要**分开校验**：丹药 / 器物 / 符箓的 id 不在
 * REFINE_RECIPE_MAP 里，照搬 sanitizeAutoRefineTargets 会把它们全滤掉。
 */
function sanitizeAutoCraftTargets(raw: unknown): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PILL_MAP[id] && !ARTIFACT_MAP[id] && !TALISMAN_MAP[id]) continue;
    const n = toInt(value, 0, 0, 1e9);
    if (n > 0) out[id] = n;
  }
  return out;
}

function sanitizeAutoRefineTargets(raw: unknown): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!REFINE_RECIPE_MAP[id]) continue;
    const n = toInt(value, 0, 0, 1e9);
    if (n > 0) out[id] = n;
  }
  return out;
}

function sanitizeGearCharges(raw: unknown, ownedRaw: unknown): Record<string, number> {
  const owned = (ownedRaw ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const def = ARTIFACT_MAP[id];
    if (!def?.carry) continue;
    if (typeof owned[id] !== 'number' || (owned[id] as number) <= 0) continue;
    out[id] = toInt(value, def.carry.charges, 0, def.carry.charges);
  }
  return out;
}

function sanitizeOpened(raw: unknown): Record<string, boolean> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true && SECRET_REALM_MAP[id]) out[id] = true;
  }
  return out;
}

function sanitizeEnlightenment(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ENLIGHTEN_PATH_IDS) out[id] = 0;
  if (raw === null || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(id in out)) continue;
    out[id] = toInt(value, 0, 0, MAX_ENLIGHTEN_LEVEL);
  }
  return out;
}

/** 正在感悟的那一阶：道要存在、剩余时间要有效 */
function sanitizeEnlightening(raw: unknown): GameState['enlightening'] {
  if (raw === null || typeof raw !== 'object') return null;
  const e = raw as { pathId?: unknown; remaining?: unknown; total?: unknown };
  if (typeof e.pathId !== 'string' || !ENLIGHTEN_PATH_MAP[e.pathId]) return null;
  const total = toFloat(e.total, 0, 0, 1e9);
  if (total <= 0) return null;
  return { pathId: e.pathId, remaining: toFloat(e.remaining, 0, 0, total), total };
}

function sanitizeTravel(raw: unknown): PersonalTravel | null {
  if (raw === null || typeof raw !== 'object') return null;
  const t = raw as Partial<PersonalTravel>;
  if (typeof t.regionId !== 'string') return null;

  /*
   * 需求 5 之后掌门出门有**三种**：游历目的地（travel）、独自探秘境（realm）、
   * 亲自普通探索（survey）。旧存档没有 kind 字段，一律当作游历；
   * 三种都要校验目标还在不在。
   */
  const kind: PersonalTravel['kind'] =
    t.kind === 'realm' ? 'realm' : t.kind === 'survey' ? 'survey' : 'travel';
  const def =
    kind === 'realm'
      ? SECRET_REALM_MAP[t.regionId]
      : kind === 'survey'
        ? MAP_REGION_MAP[t.regionId]
        : TRAVEL_REGION_MAP[t.regionId];
  if (!def) return null;

  const fallback =
    kind === 'realm'
      ? Math.round((SECRET_REALM_MAP[t.regionId]?.duration ?? 60) * SOLO_REALM_DURATION_MULT)
      : kind === 'survey'
        ? Math.round(getSurveyDuration({} as GameState, t.regionId) * SOLO_SURVEY_DURATION_MULT)
        : (TRAVEL_REGION_MAP[t.regionId]?.duration ?? 60);
  return {
    kind,
    regionId: t.regionId,
    progress: toFloat(t.progress, 0, 0, 1e9),
    duration: toFloat(t.duration, fallback, 1, 1e9),
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
  // 需求 2：可携带器物的剩余次数（只认还在库存里、且确实可携带的那些）
  const gearCharges = sanitizeGearCharges(data.gc, artifacts);

  /* ---- 境界 ---- */
  const realmIndex = toInt(data.ri, 0, 0, FINAL_REALM_INDEX);
  const layer = toInt(data.li, 0, 0, REALMS[realmIndex].layerCount);

  /*
   * 需求 9 删掉了突破保底：旧存档里的 `bp`（失败累积成功率）直接忽略，
   * 不迁移 —— 保底本来就是「失败攒出来的」，把它折成别的数只会凭空送进度。
   */

  /* ---- 宗门 ---- */
  const rawSect = (data.sec ?? {}) as Record<string, unknown>;
  const disciplesRaw = Array.isArray(rawSect.d) ? rawSect.d : [];
  const disciples: Disciple[] = [];
  /*
   * ⚠️ 这里原来夹的是 `i < 500`。需求 1 把弟子总数上限抬到 2048，
   * 于是这个"防作弊上限"变成了**真实的数据丢失**：读档时第 501 名以后的弟子
   * 会被静默丢掉 —— 每次刷新页面掉一批人，而且看不出来是谁。
   * 现在按 `DISCIPLE_CAP_BY_SECT_LEVEL` 的最大值夹，与游戏内上限同源。
   */
  const discipleHardMax = Math.max(...DISCIPLE_CAP_BY_SECT_LEVEL);
  for (let i = 0; i < disciplesRaw.length && i < discipleHardMax; i += 1) {
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
    gearCharges,
    // 功法只保留认得出 id 的那些（删过的功法不该把存档带崩）
    manuals: toCountMap(data.mn, 0, 1e12, (id) => MANUAL_MAP[id] !== undefined),
    manualFragments: toCountMap(data.mf, 0, 1e12, (key) => manualIdOfFragment(key) !== null),
    // 装备库存与丹炉（设定集第 8.7 / 11 章）：同样只认还存在的 id
    gears: toCountMap(data.gr, 0, 1e12, (id) => GEAR_MAP[id] !== undefined),
    // 符箓（需求 8）：只认还存在的符
    talismans: toCountMap(data.tmf, 0, 1e12, (id) => TALISMAN_MAP[id] !== undefined),
    talismanTier: toInt(data.ttier, 1, 1, 9),
    furnaces: sanitizeIds(data.fn, (id) => FURNACE_MAP[id] !== undefined),
    furnaceId: FURNACE_MAP[String(data.fd)] ? String(data.fd) : DEFAULT_FURNACE_ID,
    /*
     * 声望 / 特质 / 外交 / 结局（设定集第 1 / 9 / 10 章）。
     *
     * ⚠️ `npcSects` 一律**按定义表重建**，只把存档里的 relation/gifts/alliance 抄回来：
     * 这样以后改动六大宗门的名单（加一家、改名）时，旧存档不会留下一个
     * 已经不存在的宗门占着一格关系条。
     * `traits` 同理：只认还在定义里的 id。
     */
    fame: toFloat(data.fm, 0, 0, FAME_MAX),
    fameShop: {
      offers: sanitizeFameOffers(data.fs),
      secondsLeft: toFloat(data.fst, FAME_SHOP_REFRESH_SECONDS, 0, 1e9),
    },
    traits: sanitizeIds(data.tf ?? data.tr, (id) => TRAIT_MAP[id] !== undefined),
    traitOffer: sanitizeIds(data.to, (id) => TRAIT_MAP[id] !== undefined),
    legacyEndings: sanitizeIds(data.le, (id) => ENDING_MAP[id as EndingId] !== undefined),
    npcSects: NPC_SECTS.map((def) => {
      const saved = (Array.isArray(data.ns) ? data.ns : []).find((entry) => entry?.id === def.id);
      return {
        id: def.id,
        relation: clampRelation(toFloat(saved?.relation, def.initialRelation, RELATION_MIN, RELATION_MAX)),
        gifts: toInt(saved?.gifts, 0, 0, GIFT_MAX_PER_SECT),
        alliance: saved?.alliance === true,
      };
    }),
    everDeclaredWar: data.ew === true,
    // 第 24 轮（需求 2）：停战 —— 旧存档没有这个字段，默认 false
    everMadePeace: data.mpc === true,
    atWarWith: sanitizeIds(data.aw, (id) => NPC_SECT_MAP[id] !== undefined),
    warTimer: toFloat(data.wm, WAR_BATTLE_INTERVAL, 0, 1e9),
    parleyCooldowns: sanitizeNumberMap(data.pc),
    // 秘境探索次数（需求 9）：整数，上限给得很宽（危险度早就归零了）
    realmRuns: toIntMap(data.rr),
    happiness: toClamped(data.hp, HAPPINESS_NEUTRAL, HAPPINESS_MIN, HAPPINESS_MAX),
    spatialWards: toIntMap(data.sw, 64),
    // 商队（需求 7）：到访中的那一支要连清单一起恢复
    caravan: sanitizeCaravan(data.cv),
    caravanTimer: toInt(data.cvt, 0, 0, CARAVAN_INTERVAL_SECONDS),
    sectArrayOn: data.sa === true,
    realmIndex,
    layer,
    globalBreakthroughBonus: toFloat(data.gb, 0, 0, 10),
    mind: toFloat(data.mi, fresh.mind, 0, 1e6),
    mindProgress: toFloat(data.mp, 0, 0, 1e6),
    servants,
    injurySeconds: toFloat(data.inj, 0, 0, 1e9),
    personalTravel: sanitizeTravel(data.pv),
    autoRefineLevel: toInt(data.au, 0, 0, AUTO_REFINE_LEVEL_MAX),
    autoRefineTargets: sanitizeAutoRefineTargets(data.art),
    autoCraftTargets: sanitizeAutoCraftTargets(data.act),
    autoCraftTimer: toFloat(data.actm, 0, 0, 1e9),
    autoRefineProgress: toFloat(data.ap, 0, 0, 1e6),
    seeds: toSeedMap(data.sd),
    plantings,
    nextPlantingId,
    techs: toBoolMap(data.tc, TECHS.map((t) => t.id)),
    research: sanitizeResearch(data.rs),
    blueprints: toBoolMap(data.bpr, Object.keys(BLUEPRINT_MAP)),
    shop: sanitizeShop(data.sh),
    realmCooldowns: sanitizeCooldowns(data.rc),
    openedRealms: sanitizeOpened(data.or),
    buildQueue: sanitizeBuildQueue(data.bq),
    tiangongLevel: toInt(data.tl, 0, 0, QUEUE_UPGRADES.length),
    karma: toInt(data.ka, 0, KARMA_MIN, KARMA_MAX),
    // 只认还存在的遭遇 id：旧存档若挂着一个已经删掉的遭遇，就会永远点不掉
    pendingEncounter: typeof data.pe === 'string' && ENCOUNTER_MAP[data.pe] ? data.pe : null,
    encounterTimer: toFloat(data.et, 0, 0, ENCOUNTER_INTERVAL),
    encounterDeadline: toFloat(data.ed, 0, 0, ENCOUNTER_SECONDS),
    enlightenment: sanitizeEnlightenment(data.en),
    enlightening: sanitizeEnlightening(data.eg),
    spaceRings: toInt(data.sr, 0, 0, MAX_SPACE_RINGS),
    lastTimeJump: toFloat(data.lj, 0, 0, 1e12),
    // 旧存档的 `dp` 是"累积保底概率"（0~0.5 的小数），与现在的"连续失败次数"
    // 语义不同，所以直接丢弃不用。丢掉最多只是少一点保底进度，不会损坏存档。
    discoveryFailures: toFloat(data.df, 0, 0, DISCOVERY_PITY_FAILURES),
    arenaEnabled: data.ae === true,
    arenaTimer: toFloat(data.arn, ARENA_INTERVAL_SECONDS, 0, 1e9),
    arenaBuffSeconds: toFloat(data.arb, 0, 0, 1e9),
    sectEventTimer: toFloat(data.se, 0, 0, 1e9),
    // 季节与天象（需求 1）。旧存档没有这几个字段时回到"春天、无天象"。
    season: toInt(data.sn, 0, 0, SEASONS.length - 1),
    seasonSeconds: toFloat(data.ss, 0, 0, SEASON_SECONDS),
    // 天象 id 必须是表里有的，否则当作没有天象（同时把计时归零，免得挂着一个空 id）
    weatherId: typeof data.wt === 'string' && WEATHER_MAP[data.wt] ? data.wt : null,
    weatherSeconds:
      typeof data.wt === 'string' && WEATHER_MAP[data.wt]
        ? toFloat(data.ws, 0, 0, WEATHER_MAP[data.wt].duration)
        : 0,
    weatherTimer: toFloat(data.wr, WEATHER_ROLL_INTERVAL, 0, WEATHER_ROLL_INTERVAL),
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
