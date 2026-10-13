/**
 * 数值模拟器
 * ==========
 * 直接调用 src/game 里的真实游戏逻辑（不是另写一套公式），
 * 用一个「理性玩家」策略自动玩一遍。
 *
 * 会跑多个随机种子的对照：
 *   只跑一个种子分不清「数值问题」和「这一把运气好」，
 *   而且某些死锁只在特定的随机路径上才出现。
 *
 * 输出：
 *   1. 主种子的完整时间线
 *   2. 多种子的境界耗时对照表
 *   3. 死锁检测（灵气顶到上限且什么都买不起 = 永久卡死）
 *
 *     pnpm simulate
 */
import { D, fmt, fmtDuration } from '../src/game/decimal';
import {
  ALCHEMY_TIER_COST,
  BUILDABLE_MAP,
  GENERATORS,
  MATERIAL_IDS,
  MAP_REGIONS,
  QUEUE_UPGRADES,
  REFINE_RECIPES,
  ENLIGHTEN_PATHS,
  FRAGMENTS_PER_MANUAL,
  ARTIFACTS,
  SECRET_REALMS,
  ENDING_MAP,
  FURNACES,
  GEARS,
  TALISMAN_MAP,
  MANUALS,
  NPC_SECT_MAP,
  TRAIT_MAP,
  MANUAL_GRADE_MIN_REALM,
  MANUAL_GRADE_NAMES,
  MANUAL_MAP,
  MATERIAL_MAP,
  SECRET_REALM_MAP,
  PILL_MAP,
  REALMS,
  demonTierOf,
  loyaltyTierOf,
  REFINING_TIER_COST,
  RESOURCE_IDS,
  SECT_LEVELS,
  SERVANT_JOBS,
  STRUCTURES,
  TECHS,
  TECH_MAP,
  TRAVEL_REGION_MAP,
  TRAVEL_REGIONS,
  isResourceId,
} from '../src/game/content';
import type { ItemId, MaterialId } from '../src/game/content';
import { createInitialState, type GameState } from '../src/game/state';
import * as engine from '../src/game/engine';
import * as disciples from '../src/game/disciples';
import * as expeditions from '../src/game/expeditions';
import * as crafting from '../src/game/crafting';
import * as research from '../src/game/research';
import * as planting from '../src/game/planting';
import * as shop from '../src/game/shop';
import * as encounter from '../src/game/encounter';
import * as enlightenment from '../src/game/enlightenment';
import { applyTick as applyTickSim } from '../src/game/tick';
import * as travel from '../src/game/travel';
import * as sectActivity from '../src/game/sectActivity';
import * as manuals from '../src/game/manuals';
import * as fame from '../src/game/fame';
import * as diplomacy from '../src/game/diplomacy';
import * as gear from '../src/game/gear';
import * as posting from '../src/game/posting';
import * as talismans from '../src/game/talismans';
import { applyTick } from '../src/game/tick';

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

interface SimConfig {
  /** 模拟时长上限（秒） */
  budget: number;
  /** 没有自动产出时每秒尝试打坐次数（受心神上限约束，实际达不到） */
  clicksPerSecond: number;
  /** 跑多少个随机种子 */
  seeds: number;
  /**
   * 迭代次数上限（每个"动作"占一次）。
   *
   * 这只是护栏：跑满 30 天在主种子上一百万次上下。撞上它时报告会明确警告
   * 「时间没跑满」—— 免得把"模拟提前结束"读成"AI 卡住不动"。
   */
  maxIterations: number;
}

const CONFIG: SimConfig = {
  /**
   * 模拟时长。
   *
   * 这个窗口必须**覆盖到渡劫期**，否则模拟器就看不到终盘 ——
   * 而终盘恰恰是最容易藏死锁与数值断裂的地方。
   * 本轮把修行节奏压低之后，渡劫期落在 20 天出头，
   * 所以窗口从 21 天放宽到 30 天（多留一点余量看渡劫之后的表现）。
   */
  budget: 60 * 60 * 24 * 30,
  clicksPerSecond: 4,
  seeds: 5,
  maxIterations: 1200000,
};

/**
 * 临时缩短一次运行（排查用）：`SIM_DAYS=3 SIM_SEEDS=1 pnpm simulate`。
 *
 * 加这个开关是因为一次全量运行要十几分钟 —— 而排查"某一处逻辑是不是卡住"
 * 只需要看头三天。默认值不动，所以常规报告仍然是 5 种子 × 30 天。
 *
 * ⚠️ 这里手写 `process` 的声明，而不是直接用 `process.env`：
 * 本项目没有装 `@types/node`（tsconfig 的 types 只有 vite/client），
 * 所以 `process` 在类型上是未知的 —— 而为了一个排查开关引入整个 Node 类型
 * 又不划算。运行期它当然是存在的（脚本就是 node 跑的）。
 */
declare const process: { env: Record<string, string | undefined> } | undefined;
const env = typeof process === 'undefined' ? {} : (process.env ?? {});
const SIM_DAYS = Number(env.SIM_DAYS ?? 0);
const SIM_SEEDS = Number(env.SIM_SEEDS ?? 0);
if (SIM_DAYS > 0) CONFIG.budget = 60 * 60 * 24 * SIM_DAYS;
if (SIM_SEEDS > 0) CONFIG.seeds = SIM_SEEDS;

/** 固定种子线性同余伪随机数，保证结果可复现 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 一次模拟                                                            */
/* ------------------------------------------------------------------ */

interface Milestone {
  seconds: number;
  label: string;
}

interface SimResult {
  seed: number;
  seconds: number;
  iterations: number;
  deadlock: boolean;
  /** 境界名 -> 到达时间（秒） */
  realmTimes: Map<string, number>;
  milestones: Milestone[];
  finalState: GameState;
  /** 路上遇到的随机遭遇次数（需求 2） */
  encountersSeen: number;
  /** 时间加权的平均弟子人数（需求 1 的人口指标） */
  popAverage: number;
  /** 弟子人数峰值 */
  popPeak: number;
  /** 掌门出门采办的趟数 */
  tripsStarted: number;
  /** 每个采办目的地各跑了多少趟（按趟数降序） */
  farmTrips: [string, number][];
  /** 发书的结果计数（诊断库存发不出去） */
  equipOk: number;
  /** 发出去的装备件数（设定集第 8.7 章） */
  gearsHanded: number;
  equipNoTarget: number;
  equipRejected: number;
  /** 是不是撞上了迭代上限（撞上时"30 天"其实没跑满） */
  hitIterationCap: boolean;
}

/**
 * 「下一颗突破丹 / 下一次炼丹升品 / 下一次炼器升品」里，缺的第一味**材料**。
 *
 * 只挑材料：灵气、灵草这些有产率，等着就行；缺的是那种"不出去拿就没有"的东西。
 * AI 用这个来决定掌门该往哪儿走，报告也用它来解释"为什么卡住了"—— 同一份判断，
 * 免得两边各算一次然后读出来的结论不一样。
 */
function nextMissingMaterial(state: GameState): MaterialId | null {
  const costs: Partial<Record<ItemId, number>>[] = [];
  const pillId = engine.getRealm(state).breakthroughPill;
  if (pillId) costs.push(PILL_MAP[pillId]?.cost ?? {});
  const alTier = crafting.getAlchemyUpgradeStatus(state).nextTier;
  if (alTier !== null) costs.push(ALCHEMY_TIER_COST[alTier] ?? {});
  const rfTier = crafting.getRefiningUpgradeStatus(state).nextTier;
  if (rfTier !== null) costs.push(REFINING_TIER_COST[rfTier] ?? {});

  for (const cost of costs) {
    for (const [id, amount] of Object.entries(cost) as [ItemId, number][]) {
      if (isResourceId(id)) continue;
      if (engine.getAmount(state, id).lt(amount)) return id as MaterialId;
    }
  }
  return null;
}

/* -------------------------- 估值辅助 ------------------------------ */

/**
 * 给一本功法找一名能装备它的弟子（模拟器用）。
 *
 * 与 `store.autoEquipManuals` 同一套规则，但不走 store（模拟器只用纯函数）：
 * 境界够、对应槽位空着、境界高的优先。
 */
function findEquipTarget(state: GameState, manualId: string): string | null {
  const def = MANUAL_MAP[manualId];
  if (!def) return null;
  if (manuals.getManualCount(state, manualId) <= 0) return null;
  const slot = def.kind === 'cultivation' ? 'cultivationManual' : 'combatManual';
  const minRealm = MANUAL_GRADE_MIN_REALM[def.grade];

  let best: { id: string; realmIndex: number } | null = null;
  for (const d of state.sect.disciples) {
    if (d[slot] || d.realmIndex < minRealm) continue;
    if (!best || d.realmIndex > best.realmIndex) best = { id: d.id, realmIndex: d.realmIndex };
  }
  return best ? best.id : null;
}

function shadowPrices(state: GameState): Record<string, number> {
  const production = engine.getProduction(state);
  const qi = production.qi.toNumber();
  const prices: Record<string, number> = { qi: 1, wood: 1, ore: 1, stone: 1, herb: 1 };
  for (const id of ['wood', 'ore', 'stone', 'herb'] as const) {
    const rate = production[id].toNumber();
    // 产率为 0 时不能按 1 计价 —— 那等于"白送"，AI 会一直忽视它。
    // 灵石尤其致命：灵石矿单座产出低、容易被别的建筑挤掉，
    // 一旦按 1 计价，AI 就再也不建灵石矿，最后卡在"没灵石招弟子"上。
    prices[id] = rate > 0 && qi > 0 ? qi / rate : 400;
  }
  return prices;
}

function costToQi(cost: engine.CostMap, prices: Record<string, number>): number {
  let total = 0;
  for (const [id, amount] of Object.entries(cost) as [ItemId, ReturnType<typeof D>][]) {
    if (!amount) continue;
    total += amount.toNumber() * (prices[id] ?? 200);
  }
  return total;
}

/** 回本时间（秒），越小越值得建 */
function payback(state: GameState, id: string, prices: Record<string, number>): number {
  const def = BUILDABLE_MAP[id];
  if (!def) return Infinity;
  const owned = engine.getBuildingCount(state, id);
  const qiCost = costToQi(engine.getCost(def, owned, 1), prices);
  if (qiCost <= 0) return Infinity;

  const mult = engine.getGlobalMultiplier(state).toNumber();
  if (def.kind === 'generator') {
    const value = def.baseOutput * mult * (prices[def.produces] ?? 1);
    return value > 0 ? qiCost / value : Infinity;
  }

  // 宗门建筑：'是不是前置''有没有功能'比容量更重要，所以排在最前面
  if (def.requiresSect && engine.getBuildingCount(state, def.id) === 0) {
    // 掌门大殿是其余宗门建筑的前提，先建它
    const isPrereq = STRUCTURES.some((s) => s.requiresBuilding === def.id);
    const value = def.arena ? 0.1 : def.sectEvent ? 0.15 : isPrereq ? 0.5 : 0.05;
    return qiCost / (mult * value);
  }
  if (def.discipleCapacity) {
    /*
     * 需求 1 / 2：弟子上限现在卡在**弟子居所床位**上（仆役居所不算数）。
     * 空床位少于 8 就该再盖 —— 这是整条弟子成长线的物理前提，
     * 优先级给得比仆役居所高。
     */
    const need = state.sect.founded && engine.getFreeDiscipleHousing(state) < 8;
    return need ? qiCost / (mult * 0.45) : Infinity;
  }
  if (def.servantCapacity) {
    // 仆役居所只影响产量加成，空床少于 4 才值得扩建
    const need = engine.getFreeServantHousing(state) < 4;
    return need ? qiCost / (mult * 0.5) : Infinity;
  }
  if (def.alchemySlots) {
    /*
     * ⚠️ 这里原来问的是「下一品需要几座丹房」—— 但需求 2 把丹房改成唯一建筑、
     * 升品只看资源之后，`ALCHEMY_SLOT_REQUIREMENT` 整条数组变成全 0，
     * 于是这个判断恒为 false、回本时间恒为 Infinity：**AI 永远不建丹房**。
     * 本轮需求 9 让丹药变成突破的硬门槛，这个洞才暴露出来（模拟直接卡在炼气 9 层）。
     * 现在改成"还没有就建"—— 它本来就是全宗唯一的那一座。
     */
    const need = engine.getBuildingCount(state, def.id) === 0;
    return need ? qiCost / (mult * 0.4) : Infinity;
  }
  if (def.refiningSlots) {
    const need = engine.getBuildingCount(state, def.id) === 0;
    return need ? qiCost / (mult * 0.4) : Infinity;
  }
  if (def.plots) {
    // 手上有种子却没地种，才值得扩建药圃
    const need = planting.getFreePlots(state) === 0 && planting.getOwnedSeeds(state).length > 0;
    return need ? qiCost / (mult * 0.3) : Infinity;
  }
  if (def.shopSlots) {
    // 第一座商行是功能性的；再往后只是为了多两个货位，价值不高
    return engine.getBuildingCount(state, def.id) === 0 ? qiCost / (mult * 0.6) : Infinity;
  }
  if (def.arena) {
    // 比武台是功能性的：十年一次、全宗修行翻倍一年 —— 折算约 +10% 修行速度
    return engine.getBuildingCount(state, def.id) === 0 ? qiCost / (mult * 0.1) : Infinity;
  }
  if (def.sectEvent) {
    // 弟子用建筑：能提供随机事件与心得，价值按效果与稀缺度粗估
    const value = (def.cultivationBonus ?? 0) + (def.disciplePowerBonus ?? 0) + 0.05;
    return qiCost / (mult * value);
  }
  // 纯加成类建筑（讲道堂 / 灵舟坊 / 雷池 / 星坛 / 万兽门 …）：按加成强度折算"回本时间"
  const strength =
    def.productionBonus ??
    def.expeditionYieldBonus ??
    def.cultivationBonus ??
    def.expeditionSpeedBonus ??
    def.insightBonus ??
    def.breakthroughBonus ??
    0;
  if (strength > 0) return qiCost / (mult * strength);
  return Infinity;
}

function chooseBuilding(state: GameState): string | null {
  const prices = shadowPrices(state);
  let best: { id: string; score: number } | null = null;

  for (const def of [...GENERATORS, ...STRUCTURES]) {
    if (engine.getBuildGate(def, state) !== null) continue;
    const owned = engine.getBuildingCount(state, def.id);
    if (owned >= engine.getMaxCount(def)) continue;
    const score = payback(state, def.id, prices);
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score) best = { id: def.id, score };
  }
  return best?.id ?? null;
}

/* -------------------------- 主循环 -------------------------------- */

function runSimulation(seed: number): SimResult {
  const random = makeRandom(seed);
  let state = createInitialState(0);
  let seconds = 0;
  let iterations = 0;
  let deadlock = false;
  let seenStorage = false;
  let seenQueue = false;
  let seenSurvey = false;
  let encountersSeen = 0;
  const seenRefine = new Set<string>();
  let seenEnlighten = false;
  let seenTimeJump = false;
  let openedRealms = 0;
  let gearCrafted = 0;
  let seenServant = false;
  /*
   * 弟子人口统计（需求 1：一品约一百人、九品 2048）。
   *
   * 只看"结束时有多少人"会被**快照**骗到：弟子成批阵亡之后、下一轮招收之前
   * 的那一帧可能就是 0 人，于是报告读起来像"人口崩了"。
   * 所以这里按时间加权统计平均与峰值 —— 那才是"这个宗门养着多少人"。
   */
  let popIntegral = 0;
  let popSeconds = 0;
  let popPeak = 0;
  const notePopulation = (s: GameState, dt: number) => {
    const n = s.sect.disciples.length;
    popIntegral += n * dt;
    popSeconds += dt;
    if (n > popPeak) popPeak = n;
  };

  const milestones: Milestone[] = [];
  const realmTimes = new Map<string, number>();
  /** 已经出门采办过的材料（只为里程碑不刷屏） */
  const farmedItems = new Set<string>();
  /** 掌门出门采办的趟数（用来判断"是不是真的在跑"） */
  let tripsStarted = 0;
  /** 每个目的地跑了几趟（诊断"掌门到底在哪儿采办"） */
  const farmTrips = new Map<string, number>();
  const record = (label: string) => milestones.push({ seconds, label });

  const sectFlags = {
    founded: false,
    firstDisciple: false,
    firstExpedition: false,
    firstPill: false,
    firstManual: false,
    firstFurnace: false,
    firstGear: false,
    // 符箓与派遣（需求 3 / 8 / 12）
    firstPost: false,
    firstTalisman: false,
  };
  /** 合成好、等着发给弟子的功法（事件驱动的"发书"队列） */
  const pendingEquip: string[] = [];
  /** 参悟次数上限（防止"灵气一超阈值就参悟"把主循环刷爆） */
  const MAX_CONTEMPLATIONS = 400;
  let contemplations = 0;
  /** 发出去的装备件数（诊断：装备那条线有没有跑起来） */
  let gearsHanded = 0;
  // 符箓与派遣（需求 3 / 8 / 12）：没有 AI 的新系统在实测里等于不存在
  let postedTotal = 0;
  let talismanUsed = 0;
  /** 发书的三种结果（诊断"为什么库存发不出去"） */
  let equipOk = 0;
  let equipNoTarget = 0;
  let equipRejected = 0;
  const seenSectLevel = new Set<number>([1]);
  const seenAlchemy = new Set<number>([1]);
  const seenRefining = new Set<number>([1]);
  const seenHall = new Set<string>();
  const flags = {
    firstTravel: false,
    firstTravelBack: false,
    firstPlant: false,
    firstHarvest: false,
    firstShopBuy: false,
    firstBlueprint: false,
    firstAutoRefine: false,
  };

  record('开局');

  /*
   * 迭代上限。
   *
   * ⚠️ 这个数是**真实的护栏**，不是形式：每个"动作"占一次迭代，而中后期
   * 弟子伤亡率很高（每人平均只活一两小时），AI 会把大量迭代花在"招人补员"上 ——
   * 实测主种子要 100 万次以上才跑得满 30 天。本轮需求 1 把弟子容量从 54 抬到
   * 1408 之后，这个开销按人口线性放大，所以上限也跟着抬。
   * 报告里会印"实际推进了多久 + 用了多少次迭代"，撞上限时还会明确警告 ——
   * 免得读的人把"模拟提前结束"看成"AI 卡住不动"（本轮就误判过一次）。
   */
  while (seconds < CONFIG.budget && iterations < CONFIG.maxIterations) {
    iterations += 1;

    /* ---------------- 0. 自动合成（需求 4；本轮需求 2 扩到全部配方） ----------------
       本轮起自动合成是"按目标存量补齐"，所以 AI 只需要把目标填上：
       灵石（通货）、灵液 / 精金 / 阵枢（炼丹炼器与阵法）。
       ⚠️ 本轮需求 9 之后，这个档位**不能再只看"还在刷小境界"**：
       丹药成了突破的硬门槛，而升炼丹术品阶要吃灵液 ——
       于是"小境界刷满了、卡在等丹药"的那段时间恰恰是**最需要**灵液的时候。
       旧条件（layer < layerCount）会在这一刻把合成线关掉，
       模拟器于是卡在金丹 9 层：缺灵液 → 升不了炼丹 4 品 → 炼不出化婴丹。
       现在只要灵气产量够就开着，这也更接近理性玩家 ——
       灵气是硬通货，但灵液是主线上的一环，不该省。 */
    const stockOf = (id: string) => state.materials[id as keyof typeof state.materials]?.toNumber() ?? 0;
    const wantAuto = engine.getProduction(state).qi.gt(1e5) ? 2 : 0;
    const wantTargets: Record<string, number> = {
      stoneRefine: 4000,
      spiritEssenceRefine: 2000,
      refinedGoldRefine: 1000,
      arrayCoreRefine: 1500,
    };
    if (state.autoRefineLevel !== wantAuto) {
      state = { ...state, autoRefineLevel: wantAuto, autoRefineProgress: wantAuto > 0 ? state.autoRefineProgress : 0 };
      if (wantAuto > 0 && !flags.firstAutoRefine) {
        flags.firstAutoRefine = true;
        record('开启自动合成');
      }
    }
    // 目标只要还没填过就填一次（填过之后玩家/AI 不再动它）
    if (Object.keys(state.autoRefineTargets).length === 0) {
      state = { ...state, autoRefineTargets: wantTargets };
    }

    /* ---------------- 0. 随机遭遇（需求 2） ----------------
       开宗前会遇到商队与各色 NPC，每一个都得做选择。
       这里让**一半种子走行善路线、一半走作恶路线** —— 需求 2 的两条后果
       （善行加探索产出、恶行招天雷）都要被真的跑到，否则模拟器测不到它们。
       作恶路线还能顺带验证"抢劫解锁之后经济会不会失衡"。 */
    if (state.pendingEncounter) {
      const def = encounter.getPendingEncounter(state);
      if (def) {
        const usable = def.options
          .map((o, i) => ({ o, i }))
          .filter(({ o }) => encounter.canChooseOption(state, o).ok);
        const evilRun = seed % 2 === 0;
        const pick =
          usable.find(({ o }) => (evilRun ? o.effect.successChance !== undefined : o.effect.karma > 0)) ??
          usable[0];
        if (pick) {
          const before = state.karma;
          const res = encounter.chooseEncounterOption(state, pick.i, makeRandom(seed + state.playTime));
          if (res.state !== state) {
            state = res.state;
            encountersSeen += 1;
            if (Math.sign(state.karma) !== Math.sign(before) && Math.abs(state.karma) >= 30) {
              record(`善恶值到 ${Math.round(state.karma)}（${encounter.getKarmaLabel(state).name}）`);
            }
            continue;
          }
        }
      }
    }

    /* ---------------- 1. 修行 ----------------
       ⚠️ 这里必须显式传 random。`advanceLayer` 的 random 有默认值 `gameRandom`
       （也就是 Math.random），漏传就会让整份模拟**不可复现** ——
       同一份代码连跑两次，主种子的合体期能从 4天6小时 漂到 6天13小时。
       模拟器的全部意义就是可复现，所以这个参数一个都不能省。 */
    if (engine.canAdvanceLayer(state)) {
      state = engine.advanceLayer(state, random);
      continue;
    }

    const breakthrough = engine.getBreakthroughStatus(state);
    if (breakthrough.possible) {
      const from = engine.getRealm(state).name;
      /*
       * 需求 9：丹药是硬门槛，`possible` 就已经保证了仓库里有丹 ——
       * 原来那句 `usePill = 有丹 && 服丹更划算` 的判断整个失去了意义
       * （没丹时根本走不到这里），参数也从 API 里去掉了。
       */
      const result = engine.breakthrough(state, random);
      if (result) {
        state = result.state;
        if (result.success) {
          const to = engine.getRealm(state).name;
          realmTimes.set(to, seconds);
          record(`${from} → ${to}`);
        } else if (result.injurySeconds > 0) {
          record(`突破失败，道伤 ${fmtDuration(result.injurySeconds)}`);
        }
      }
      continue;
    }

    /* ---------------- 1b. 炼丹（需求 9：丹药是突破的硬门槛） ----------------
       这一段**必须放在"开宗"判断之前**：炼气 → 筑基 的那颗筑基丹是二品丹，
       而要炼二品丹得先把炼丹术升到二品 —— 全是开宗之前的事。
       早先这段写在 `else`（已开宗）分支里，于是模拟器里出现了死锁：
       没丹药 → 突破不了 → 修不到金丹 → 开不了宗 → 永远升不了炼丹术。
       那不是数值问题，是 AI 的行动顺序问题。 */
    {
      const alchemy = crafting.getAlchemyUpgradeStatus(state);
      if (alchemy.possible) {
        const next = crafting.upgradeAlchemy(state);
        if (next !== state) {
          state = next;
          if (!seenAlchemy.has(next.alchemyTier)) {
            seenAlchemy.add(next.alchemyTier);
            record(`炼丹术 ${next.alchemyTier} 品`);
          }
          continue;
        }
      }

      const refining = crafting.getRefiningUpgradeStatus(state);
      if (refining.possible) {
        const next = crafting.upgradeRefining(state);
        if (next !== state) {
          state = next;
          if (!seenRefining.has(next.refiningTier)) {
            seenRefining.add(next.refiningTier);
            record(`炼器术 ${next.refiningTier} 品`);
          }
          continue;
        }
      }

      /*
       * 需求 9 的连带需求：升炼丹 / 炼器品阶从四品起要吃**进阶资源**
       * （灵液 / 精金），而"进阶资源"只能靠合成。于是 AI 必须**按需补料**：
       * 看下一品缺几份，就合几份。
       *
       * 为什么不指望自动合成那套：它设的是长期目标（存 2000 份），
       * 而这里要的是"卡在金丹 9 层、只差 10 份灵液"这种一次性缺口 ——
       * 等自动合成的档位（要灵气产量 > 1e5/秒）跟上，早就卡死了。
       */
      /*
       * ⚠️ 这里必须 **向上取整**：`refine` 是按"整批"合成的（一批一份），
       * 而仓库里的材料可能是**小数** —— 本轮新增的"贪利弟子叛逃带走一部分材料"
       * 就会把 40 变成 39.9。于是 `missing = 0.1`、`refine(state, id, 0.1)`
       * 一批也合不出来，AI 就永远差那 0.1 —— 模拟器为此整整卡了 30 天。
       * 真实玩家遇到这种情况只会点一下"合成"，所以这里也应当补一整批。
       */
      const topUp = (recipeId: string, missing: number) => {
        if (missing <= 0) return false;
        const want = Math.max(1, Math.ceil(missing));
        const affordable = engine.maxRefine(state, recipeId);
        if (affordable <= 0) return false;
        const next = engine.refine(state, recipeId, Math.min(want, affordable));
        if (next === state) return false;
        state = next;
        return true;
      };
      const alchemyNext = crafting.getAlchemyUpgradeStatus(state).nextTier;
      if (alchemyNext !== null) {
        const cost = ALCHEMY_TIER_COST[alchemyNext] ?? {};
        if (topUp('spiritEssenceRefine', (cost.spiritEssence ?? 0) - stockOf('spiritEssence'))) continue;
      }
      const refiningNext = crafting.getRefiningUpgradeStatus(state).nextTier;
      if (refiningNext !== null) {
        const cost = REFINING_TIER_COST[refiningNext] ?? {};
        if (topUp('refinedGoldRefine', (cost.refinedGold ?? 0) - stockOf('refinedGold'))) continue;
      }

      /*
       * 需求 9 之后的又一个连带需求：**炼丹术品阶可能被某一种稀有材料卡住**。
       *
       * 例：化神期要炼「炼虚丹」得先把炼丹术升到 6 品，而 6 品要 120 份月华晶 ——
       * 月华晶只在北境一带出。灵气、灵草堆成山也没用，缺的就是那一味。
       * 这时的正确做法（真人都是这么做的）是**掌门亲自出门去出产它的地方**。
       *
       * 判据合并成一处：看"下一颗丹 + 下一次升品"要什么，缺哪样就去哪样。
       * 只挑**材料**（资源有产率，等着就行）。
       */
      const missingItem = nextMissingMaterial(state);
      if (missingItem && !state.personalTravel) {
        /*
         * ⚠️ 要挑**出产最多**的那个目的地，而不是"第一个产它的"。
         *
         * 仙玉这一味上就吃过亏：`find` 命中的是九幽裂隙（一次 1 份），
         * 而混沌沙海一次给 5 份、极北的某个目的地给 15 份 —— 后者境界要求更高，
         * 但到了合体期明明去得了。结果模拟器跑了 1135 趟采办、仓库里只有 4 份仙玉，
         * 主种子在合体期卡了整整 27 天。
         */
        const scored = travel
          .getAvailableRegions(state)
          .filter((r) => travel.canStartTravel(state, r.id).ok)
          .map((r) => {
            const best = Math.max(
              0,
              ...r.loot.filter((entry) => entry.item === missingItem).map((entry) => entry.amount),
            );
            return { region: r, amount: best };
          })
          .filter((x) => x.amount > 0)
          .sort((a, b) => b.amount - a.amount);
        const target = scored[0]?.region;

        if (target) {
          const next = travel.startTravel(state, target.id);
          if (next !== state) {
            state = next;
            tripsStarted += 1;
            farmTrips.set(target.id, (farmTrips.get(target.id) ?? 0) + 1);
            if (!farmedItems.has(missingItem)) {
              farmedItems.add(missingItem);
              record(
                `掌门出门采办${MATERIAL_MAP[missingItem]?.name ?? missingItem}（${target.name}，一趟约 ${scored[0].amount} 份）`,
              );
            }
            continue;
          }
        }
        /*
         * 找不到出产这种材料的目的地**不算异常**：灵液 / 精金 / 阵枢 / 灵石
         * 都是合成出来的，本来就不在任何采办路线上 —— 它们由上面那两个
         * `topUp` 负责。所以这里**不再记一条 ⚠️ 里程碑**：
         * 上一版把它当成"无处可去"报出来，误导了整整一轮排查
         * （真因是 `topUp` 拿小数去 refine，一批都合不出来）。
         */
      }

      /*
       * 藏经阁（设定集第 7 章）：AI 要会参悟、合成、发书。
       *
       * ⚠️ 这一段的第一版把"发书"写成"每轮都扫一遍全宗弟子找空位"，
       * 结果模拟器直接跑不完：弟子 1408 人 × 库存几百本 × 每轮一次
       * = O(轮数 × 人数 × 库存)，几十万轮下来是天文数字。
       * 现在改成**事件驱动**：合成出一本才把它记进"待发"队列，
       * 每轮最多处理一本 —— 总代价 = 功法总数 × 人数，一笔有限的账。
       */
      if (engine.getBuildingCount(state, 'library') > 0) {
        // 1) 发书：只处理"待发"队列里的那一本
        if (pendingEquip.length > 0) {
          const manualId = pendingEquip[0];
          const target = findEquipTarget(state, manualId);
          if (target) {
            const next = manuals.equipManual(state, target, manualId);
            if (next !== state) {
              state = next;
              pendingEquip.shift();
              equipOk += 1;
              if (!sectFlags.firstManual) {
                sectFlags.firstManual = true;
                record('首次为弟子配备功法');
              }
              continue;
            }
            equipRejected += 1;
          } else {
            equipNoTarget += 1;
          }
          // 没人可发（境界不够，或该槽位都满了）：丢掉这一项，别卡住主循环
          pendingEquip.shift();
        }
        // 1b) 补发：弟子陨落时功法有 60% 会回到仓库，而"谁死了"这件事
        //     不会给待发队列发通知 —— 所以每隔一阵子主动扫一次库存。
        //     每 500 轮一次、每次最多补发一本，把 O(人数) 的扫描摊薄到可忽略。
        if (iterations % 500 === 0) {
          let stock = 0;
          for (const n of Object.values(state.manuals)) stock += n;
          if (stock > 0) {
            // 从**高品阶**往下找（好书先发出去，别拿天纵换凡品）
            const order = [...MANUALS].sort((a, b) => b.grade - a.grade);
            const first = order.find(
              (m) => manuals.getManualCount(state, m.id) > 0 && findEquipTarget(state, m.id) !== null,
            );
            if (first) {
              const target = findEquipTarget(state, first.id);
              if (target) {
                const next = manuals.equipManual(state, target, first.id);
                if (next !== state) {
                  state = next;
                  equipOk += 1;
                  continue;
                }
              }
            }
          }
        }

        // 2) 合成：任何一本凑够 5 份碎片就合（合出来的进待发队列）
        const ready = MANUALS.find((m) => manuals.getFragmentCount(state, m.id) >= FRAGMENTS_PER_MANUAL);
        if (ready) {
          const synth = manuals.synthManual(state, ready.id, random);
          if (synth.ok) pendingEquip.push(ready.id);
          state = synth.state;
          continue;
        }
        // 3) 参悟：灵气富余时换碎片（从高品往下试）。带次数上限，
        //    否则"灵气一超阈值就参悟"会在每个大时间步之后再刷几百次。
        if (contemplations < MAX_CONTEMPLATIONS && state.resources.qi.gt(1e10)) {
          for (const grade of [4, 3, 2, 1] as const) {
            if (!manuals.canContemplate(state, grade).ok) continue;
            const result = manuals.contemplate(state, grade, random);
            if (result.gained) {
              state = result.state;
              contemplations += 1;
              if (!sectFlags.firstManual) {
                sectFlags.firstManual = true;
                record('藏经阁首次参悟，得功法碎片');
              }
              break;
            }
          }
        }
      }

      /*
       * 山门特质（设定集第 1 章）：开局三选一。AI 优先挑"灵气/产出"类的 ——
       * 不选的话，九个特质在实测里完全不可见（文档代理核出来的缺口）。
       */
      if (state.traits.length === 0) {
        /*
         * 候选特质是 **store 在开局时抽的**（`ensureTraitOffer`），而模拟器不走 store ——
         * 所以这里要自己抽一次，否则九个特质在实测里永远是"（未选）"。
         * 这正是文档代理核出来的那个缺口。
         */
        const offer = state.traitOffer.length > 0 ? state.traitOffer : fame.rollTraitOffer(state, random);
        if (offer.length > 0) {
          const preferred = ['spiritVein', 'eternalSpring', 'herbGarden', 'ironArmy', 'scriptureVault', 'starGazing'];
          const pick = preferred.find((id) => offer.includes(id)) ?? offer[0];
          const next = fame.chooseTrait({ ...state, traitOffer: offer }, pick);
          if (next !== state) {
            state = next;
            record('山门气运已定：' + (TRAIT_MAP[pick]?.name ?? pick));
            continue;
          }
        }
      }

      /*
       * 声望商店（设定集第 9 章）：声望攒着不用等于没有这个系统。
       * 策略很省事：买得起就买货架上第一件 —— 目的只是让这条线跑起来。
       */
      /*
       * 声望商店：**必须给结盟留出储备**。
       *
       * 上一版 AI 一有声望就买，结果声望长期趴在几十点 ——
       * 论道要 500、结盟要 3000，外交那条线整条死掉（本轮实测抓出来的）。
       * 这条其实是个真实的取舍：声望同时是"商店货币"和"外交门槛"。
       */
      const fameReserve = 3000;
      if (fame.getFame(state) > fameReserve && state.fameShop.offers.length > 0) {
        const affordable = state.fameShop.offers.find((o) => fame.canBuyFameOffer(state, o.goodId).ok);
        if (affordable) {
          const result = fame.buyFameOffer(state, affordable.goodId, random);
          if (result.state !== state) {
            state = result.state;
            continue;
          }
        }
      }

      /*
       * 炼器与发装备（设定集第 8.7 / 11 章）：
       *   1. 有更好的炉鼎且铸得起，就铸；
       *   2. 仓库里有装备就一键申领。
       * 与功法那一段同样是**事件驱动**的写法（每轮最多做一件），
       * 不然"扫全宗找空位"会把主循环拖垮（上一轮踩过这个坑）。
       */
      {
        /*
         * 炼装备：挑炼得起、品阶最高的那一件（每 300 轮试一次，别把主循环拖垮）。
         * 上一版只炼炉鼎、不炼装备，于是"弟子五装备栏"在实测里是空的。
         */
        if (iterations % 300 === 0) {
          const forgeable = [...GEARS]
            .sort((a, b) => b.grade - a.grade)
            .find((g) => gear.canForgeGear(state, g.id).ok);
          if (forgeable) {
            const rate = crafting.getCraftSuccessRate(state, 'refining', forgeable.grade);
            const result = gear.forgeGear(state, forgeable.id, rate, random);
            if (result.state !== state) {
              state = result.state;
              if (!sectFlags.firstGear && result.ok) {
                sectFlags.firstGear = true;
                record('炼成第一件弟子装备（' + forgeable.name + '）');
              }
              continue;
            }
          }
        }
        const furnaceTarget = FURNACES.find((f) => gear.canForgeFurnace(state, f.id).ok);
        if (furnaceTarget) {
          const next = gear.forgeFurnace(state, furnaceTarget.id);
          if (next !== state) {
            state = next;
            if (!sectFlags.firstFurnace) {
              sectFlags.firstFurnace = true;
              record('铸成 ' + furnaceTarget.name);
            }
            continue;
          }
        }
        if (Object.keys(state.gears).length > 0 && iterations % 200 === 0) {
          const result = gear.autoEquipGears(state);
          if (result.state !== state) {
            state = result.state;
            gearsHanded += result.handed;
            continue;
          }
        }
      }

      /*
       * 派遣与技艺（需求 3 / 12）。
       *
       * 为什么必须补这段 AI：没有 AI 的新系统在实测里等于不存在 ——
       * 上一轮"只炼炉鼎不炼装备"已经栽过一次（坑 94），这一轮的派遣
       * 又是零命中（坑 100）。安排一岗一人就能让丹房 / 炼器房 / 符房 / 灵田
       * 的加成真的生效，也让技艺点真的积累起来。
       */
      if (state.sect.founded && iterations % 500 === 0) {
        const posted = posting.autoPostAll(state);
        if (posted.posted > 0) {
          state = posted.state;
          postedTotal += posted.posted;
          if (!sectFlags.firstPost) {
            sectFlags.firstPost = true;
            record('派出第一批弟子入岗（' + posted.posted + ' 人）');
          }
          continue;
        }
      }

      /*
       * 符箓（需求 8）：画得起就画，优先护身符（探索最需要），
       * 其次破境符（推进境界），最后聚灵符。
       */
      if (state.sect.founded && engine.getBuildingCount(state, 'talismanRoom') > 0 && iterations % 400 === 0) {
        const wantOrder = ['wardGold', 'wardSilver', 'wardBasic', 'breakGold', 'breakSilver', 'breakBasic', 'spiritGold', 'spiritSilver', 'spiritBasic'];
        const target = wantOrder
          .map((id) => TALISMAN_MAP[id])
          .find((def) => def && talismans.canCraftTalisman(state, def.id).ok);
        if (target) {
          const rate = crafting.getCraftSuccessRate(state, 'talisman', target.grade);
          const result = talismans.craftTalisman(state, target.id, 3, rate, random);
          if (result.state !== state) {
            state = result.state;
            if (!sectFlags.firstTalisman && result.made > 0) {
              sectFlags.firstTalisman = true;
              record('画成第一张符（' + target.name + '）');
            }
            continue;
          }
        }
      }

      // 用符（需求 8）：有存货就用 —— 消耗品留着不生利息，护身符优先
      if (state.talismans && Object.keys(state.talismans).length > 0 && iterations % 250 === 0) {
        const useOrder = ['wardGold', 'wardSilver', 'wardBasic', 'breakGold', 'breakSilver', 'breakBasic', 'spiritGold', 'spiritSilver', 'spiritBasic'];
        const usable = useOrder.find((id) => (state.talismans[id] ?? 0) > 0);
        if (usable) {
          const result = talismans.useTalisman(state, usable);
          if (result.ok) {
            state = result.state;
            talismanUsed += 1;
            continue;
          }
        }
      }

      /*
       * 外交（设定集第 9 章）：AI 顺手做两件事 ——
       *   1. 论道冷却好了就论道（不花资源，纯涨关系）；
       *   2. 关系够、声望够就结盟（盟友给全产出加成）。
       * 不主动宣战：战争对 AI 的收益远不如稳扎稳打，而且会让"隐世传承"落空。
       */
      if (state.sect.founded) {
        const ready = state.npcSects.find((s) => diplomacy.canParley(state, s.id).ok);
        if (ready) {
          const next = diplomacy.parleySect(state, ready.id);
          if (next !== state) {
            state = next;
            continue;
          }
        }
        const allyable = state.npcSects.find((s) => diplomacy.canAlly(state, s.id).ok);
        if (allyable) {
          const next = diplomacy.allySect(state, allyable.id);
          if (next !== state) {
            state = next;
            record(`与${NPC_SECT_MAP[allyable.id]?.name ?? allyable.id}缔结盟约`);
            continue;
          }
        }
      }

      // 自己突破要用的那一味丹，备两颗（失败一次还能再来）
      const neededPill = engine.getRealm(state).breakthroughPill;
      if (neededPill) {
        const def = PILL_MAP[neededPill];
        if (
          def &&
          state.alchemyTier >= def.tier &&
          (state.pills[neededPill] ?? 0) < 2 &&
          /*
           * ⚠️ 材料不够时**不能** `continue`：那等于"这一步什么也没发生却重新开始"，
           * 循环会原地空转到 40 万次迭代上限（这一轮就这么卡住了 ——
           * 灵气不足 5000，每次都想炼丹、每次都失败、每次都 continue，
           * 时间一秒都没往前走）。缺材料时必须让它落到"推进到下一件事"那一步去攒灵气。
           */
          crafting.canCraftPill(state, neededPill).ok
        ) {
          const craft = crafting.craftPill(state, neededPill, 1, random);
          // 失败也扣材料，所以无论如何都要接住新状态
          state = craft.state;
          if (craft.made > 0 && !sectFlags.firstPill) {
            sectFlags.firstPill = true;
            record(`首次炼成丹药（${def.name}）`);
          }
          continue;
        }
      }

      /*
       * 需求 9：**弟子**的大境界突破也要吃丹药，所以 AI 必须替弟子备丹 ——
       * 否则弟子的修为会永远卡在瓶颈上（这正是"对丹药需求很强烈"的表现）。
       *
       * 策略：统计各境界"修为已满却卡着"的人数，优先补缺口最大的那一味；
       * 一味只炼一颗（真实的玩家也是这么点的），循环会自然把它补够。
       */
      const stalledByPill = new Map<string, number>();
      for (const d of state.sect.disciples) {
        const def = REALMS[d.realmIndex];
        if (!def || !def.breakthroughPill) continue;
        if (d.realmIndex >= disciples.getDiscipleRealmCap(state, d)) continue;
        if (def.cultivationYears <= 0) continue;
        if (d.progress < def.cultivationYears) continue;
        stalledByPill.set(def.breakthroughPill, (stalledByPill.get(def.breakthroughPill) ?? 0) + 1);
      }
      let worstPill = '';
      let worstNeed = 0;
      for (const [pillId, need] of stalledByPill) {
        const gap = need - (state.pills[pillId] ?? 0);
        if (gap > worstNeed) {
          worstNeed = gap;
          worstPill = pillId;
        }
      }
      if (worstPill) {
        const def = PILL_MAP[worstPill];
        if (def && state.alchemyTier >= def.tier && crafting.canCraftPill(state, worstPill).ok) {
          const craft = crafting.craftPill(state, worstPill, 1, random);
          state = craft.state;
          continue;
        }
      }
    }

    /* ---------------- 2. 宗门 ---------------- */
    if (!state.sect.founded) {
      if (state.realmIndex >= SECT_LEVELS[0].requiresRealm) {
        const next = engine.foundSect(state);
        if (next !== state) {
          state = next;
          sectFlags.founded = true;
          record('开宗立派');
          continue;
        }
      }
    } else {
      const upgrade = engine.getSectUpgradeStatus(state);
      if (upgrade.possible && upgrade.nextLevel !== null) {
        const next = engine.upgradeSect(state);
        if (next !== state) {
          state = next;
          if (!seenSectLevel.has(next.sect.level)) {
            seenSectLevel.add(next.sect.level);
            record(`宗门晋升${SECT_LEVELS[next.sect.level - 1].name}`);
          }
          continue;
        }
      }

      if (disciples.canRecruit(state).ok) {
        const result = disciples.recruitDisciple(state, random);
        if (result.disciple) {
          state = result.state;
          if (!sectFlags.firstDisciple) {
            sectFlags.firstDisciple = true;
            record(`首位弟子入门（${result.disciple.name}）`);
          }
          continue;
        }
      }

      /*
       * 需求 1 的普通探索：还没发现秘境的小区域只能这么做，
       * 而且发现新秘境**只在同一个大区域内生效** ——
       * 所以"先普通探索把一片地方打开"是往前走必经的一步。
       *
       * 但它排在探秘境**后面**，这是刻意的：两者抢的是同一批队伍名额，
       * 而探秘境的收益远高于普通探索。实测把它排在前面，AI 会把队伍
       * 全压在开图上，秘境收益断供 → 弟子变弱 → 寿命变短 → 人口崩掉
       * （30 天结束时弟子 0 人）。所以只在"秘境这边没得打"的空窗期才出门开图。
       */
      if (state.sect.founded && state.expeditions.length < expeditions.getMaxExpeditions(state)) {
        const reachable = MAP_REGIONS.filter(
          (r) => engine.canReachRegion(state, r) && expeditions.canSurveyRegion(state, r.id).ok,
        );
        // 一处秘境都还没发现的小区域：只能靠普通探索打开
        const locked = reachable.find((r) =>
          SECRET_REALMS.filter((x) => x.regionId === r.id).every((x) => state.discoveredRealms[x.id] !== true),
        );
        if (locked) {
          const party = expeditions.autoSelectSurveyParty(state, locked.id, 2);
          if (party.length > 0 && expeditions.canStartSurvey(state, locked.id, party).ok) {
            const next = expeditions.startSurvey(state, locked.id, party, makeRandom(seed + state.expeditions.length + 1));
            if (next !== state) {
              state = next;
              if (!seenSurvey) {
                seenSurvey = true;
                record(`首次普通探索（${locked.name}）`);
              }
              continue;
            }
          }
        }
      }

      if (state.expeditions.length < expeditions.getMaxExpeditions(state)) {
        let started = false;
        /*
         * 从最远的已发现秘境往前找：收益最高的优先。
         * 冷却中或暂时去不了的会被 canStartExpedition 挡掉。
         *
         * ⚠️ 本轮需求 9 之后多了一条排序：**掉缺料的那种秘境优先**。
         * 炼丹术升品和突破丹都要特定材料（例如合体期的大乘丹要 400 份龙血），
         * 而"掌门出门采办"一趟只带回 3~30 份 —— 真正的大头在秘境（8 档一次 130 份）。
         * 不这么排的话，AI 会一直派队伍去打"档次最高但那味不掉"的秘境，
         * 于是手持 2240 趟采办记录、仓库里却只有 27 份龙血。
         * `sort` 是稳定的，所以同一优先级内仍然保持"从高档到低档"。
         */
        const missing = nextMissingMaterial(state);
        const realmOrder = [...SECRET_REALMS].reverse().sort((a, b) => {
          const am = missing && a.loot.some((entry) => entry.item === missing) ? 1 : 0;
          const bm = missing && b.loot.some((entry) => entry.item === missing) ? 1 : 0;
          return bm - am;
        });
        for (const realm of realmOrder) {
          if (!engine.isRealmDiscovered(state, realm)) continue;
          const party = expeditions.autoSelectParty(state, realm.id);
          if (party.length < realm.minParty) continue;
          /*
           * 战力闸。0.9 是"刚好打得动"，但那个比值下的伤亡率接近基础值的 1.1 倍 ——
           * 弟子会被慢慢磨死（实测每名弟子平均只活 1.3 天，心得根本攒不起来）。
           * 提到 1.5 更接近真人：宁可等弟子变强，也不拿命去填。
           * 这属于模拟器自身的修正，不是游戏数值。
           */
          const power = disciples.getPartyPower(state, party);
          if (power < realm.requiredPower * 1.5) continue;
          // 同上：random 必须显式传，否则每次派队伍的 id 都不同、模拟不可复现
          const next = expeditions.startExpedition(state, realm.id, party, random);
          if (next !== state) {
            state = next;
            started = true;
            if (!sectFlags.firstExpedition) {
              sectFlags.firstExpedition = true;
              record(`首次秘境探索（${realm.name}）`);
            }
            break;
          }
        }
        if (started) continue;
      }

      const started = false;
      void started;
    }

    /* ---------------- 2b. 仆役 ----------------
       需求 2 起仆役居所与弟子居所**完全分开**，所以这里不再有"给弟子留几个空位"
       的算计 —— 两边各盖各的房子。AI 的策略简化成一句：
         有仆役空床、灵气够、且仆人数还没到收益递减得离谱的地步，就收。
       弟子床位那边由 payback 里的 discipleCapacity 分支负责扩建。 */
    const freeServantBeds = engine.getFreeServantHousing(state);

    if (freeServantBeds > 0 && engine.canRecruitServant(state).ok) {
      // 派去影子价格最高的资源（也就是最紧缺的那种）
      const prices = shadowPrices(state);
      let best = SERVANT_JOBS[0];
      let bestValue = -1;
      for (const job of SERVANT_JOBS) {
        const value = prices[job.resource] ?? 1;
        if (value > bestValue) {
          bestValue = value;
          best = job;
        }
      }
      const next = engine.recruitServant(state, best.id);
      if (next !== state) {
        state = next;
        if (!seenServant) {
          seenServant = true;
          record(`首位仆役入府（${best.name}）`);
        }
        continue;
      }
    }

    /* ---------------- 2b2. 宗门建筑与大比（需求 4） ----------------
       宗门建筑几乎都靠技术解锁，AI 只要建得起就建；
       比武台一建成立刻开启大比（十年一次的全宗修行翻倍，没有理由不开）。 */
    if (state.sect.founded) {
      const hallCandidates = STRUCTURES.filter(
        (def) => def.group === 'hall' && engine.getBuildGate(def, state) === null,
      ).sort((a, b) => {
        const order = (id: string) => (id === 'masterHall' ? 0 : id === 'arena' ? 1 : 2);
        return order(a.id) - order(b.id);
      });

      let builtHall = false;
      for (const def of hallCandidates) {
        const owned = engine.getBuildingCount(state, def.id);
        if (owned >= engine.getMaxCount(def)) continue;
        if (!engine.canAfford(state, engine.getCost(def, owned, 1))) continue;
        const next = engine.buyBuilding(state, def, 1);
        if (next !== state) {
          state = next;
          builtHall = true;
          if (!seenHall.has(def.id)) {
            seenHall.add(def.id);
            record(`建成${def.name}`);
          }
          break;
        }
      }

      if (!builtHall && sectActivity.hasArena(state) && !state.arenaEnabled) {
        state = { ...state, arenaEnabled: true, arenaTimer: sectActivity.ARENA_INTERVAL_SECONDS };
        record('开启宗门大比');
      }
    }

    /* ---------------- 2c. 钻研（需求 6） ----------------
       建筑几乎都要技术解锁，所以 AI 只要有空就钻研下一门划算的技术。
       选「钻研耗时最短」的那一门：先拿到便宜的早期技术，
       免得开局就把几个小时砸在混元之法上。 */
    if (!state.research) {
      const startable = TECHS.filter((def) => research.canStartResearch(state, def.id).ok).sort(
        (a, b) => a.seconds - b.seconds,
      );
      const pick = startable[0];
      if (pick) {
        const next = research.startResearch(state, pick.id);
        if (next !== state) {
          state = next;
          record(`开始钻研${pick.name}`);
          continue;
        }
      }
    }

    /* ---------------- 2d. 种植（需求 5） ---------------- */
    if (planting.getReadyPlantings(state).length > 0) {
      const result = planting.harvestAll(state);
      if (result.state !== state) {
        state = result.state;
        if (!flags.firstHarvest) {
          flags.firstHarvest = true;
          record(`首次收获灵植（${result.gains.map((g) => g.name).join('、')}）`);
        }
        continue;
      }
    }
    if (planting.getOwnedSeeds(state).length > 0 && planting.getFreePlots(state) > 0) {
      const next = planting.plantAll(state, random);
      if (next !== state) {
        state = next;
        if (!flags.firstPlant) {
          flags.firstPlant = true;
          record('首次种下灵植');
        }
        continue;
      }
    }

    /* ---------------- 2e. 商行（需求 3 / 6） ----------------
       只买「买不到第二次」的东西：图纸与种子。
       资源与材料那一类属于应急，理性玩家不会拿灵石去买。 */
    if (engine.hasShop(state)) {
      const wanted = state.shop.offers.filter((offer) => {
        if (offer.sold) return false;
        if (!engine.canAfford(state, { stone: D(offer.price) })) return false;
        // 留出 20 倍余量，免得把招收弟子的灵石花光
        if (state.resources.stone.lt(offer.price * 20)) return false;
        return offer.kind === 'blueprint' || offer.kind === 'seed';
      });
      const offer = wanted[0];
      if (offer) {
        const result = shop.buyShopOffer(state, offer.id);
        if (result.state !== state) {
          state = result.state;
          if (!flags.firstShopBuy) {
            flags.firstShopBuy = true;
            record(`首次在商行购物（${shop.describeOffer(offer).name}）`);
          }
          if (offer.kind === 'blueprint' && !flags.firstBlueprint) {
            flags.firstBlueprint = true;
            record(`购得图纸（${shop.describeOffer(offer).name}）`);
          }
          continue;
        }
      }
    }

    /* ---------------- 2f. 个人游历（需求 1） ----------------
       开宗之前没有弟子可用，掌门亲自出门是唯一的材料来源；
       但出门要减产 45%，所以只在「手头没灵石且还没有灵石矿」时出门，
       其余情况交给下面的 stall 分支兜底（彻底卡住才出门找材料）。 */
    const stoneIncome = engine.getProduction(state).stone;
    const brokeNoMine = stoneIncome.lte(0) && state.resources.stone.lt(200);
    if (!state.personalTravel && !state.sect.founded && brokeNoMine) {
      const regions = travel.getAvailableRegions(state);
      const best = regions[regions.length - 1];
      if (best) {
        const next = travel.startTravel(state, best.id);
        if (next !== state) {
          state = next;
          if (!flags.firstTravel) {
            flags.firstTravel = true;
            record(`掌门首次出游（${best.name}）`);
          }
          continue;
        }
      }
    }

    /* ---------------- 3a. 仓储告急：先扩建仓库 ---------------- */
    const caps = engine.getStorageCaps(state);
    const tight = RESOURCE_IDS.find((id) => {
      const cap = caps[id];
      return cap.gt(0) && engine.getAmount(state, id).div(cap).gte(0.9);
    });

    if (tight) {
      const storages = STRUCTURES.filter(
        (def) =>
          def.storage &&
          engine.getBuildGate(def, state) === null &&
          engine.getBuildingCount(state, def.id) < engine.getMaxCount(def),
      ).reverse();

      let built = false;
      for (const def of storages) {
        const owned = engine.getBuildingCount(state, def.id);
        if (!engine.canAfford(state, engine.getCost(def, owned, 1))) continue;
        const next = engine.buyBuilding(state, def, 1);
        if (next !== state) {
          state = next;
          built = true;
          if (!seenStorage) {
            seenStorage = true;
            record(`首次扩建仓库（${def.name}）`);
          }
          break;
        }
      }
      if (built) continue;
    }

    /* ---------------- 3b. 常规建造 ---------------- */
    const target = chooseBuilding(state);
    if (target) {
      const def = BUILDABLE_MAP[target];
      const owned = engine.getBuildingCount(state, target);
      if (engine.canAfford(state, engine.getCost(def, owned, 1))) {
        const next = engine.buyBuilding(state, def, 1);
        if (next !== state) {
          state = next;
          continue;
        }
      }
    }

    /* ---------------- 3c. 建造队列与天工院（需求 2） ----------------
       队列的语义是"排好队，资源一到就自动盖"，所以挂机型 AI 正该用它：
       把想盖的下一个目标排进去，让 tick 自己推进。
       这里也顺手把天工院建起来并升满 —— 否则 7 个名额这条线一辈子没人走。 */
    if (state.sect.founded) {
      const hall = BUILDABLE_MAP.tiangongYuan;
      if (
        engine.getBuildingCount(state, 'tiangongYuan') === 0 &&
        engine.getBuildGate(hall, state) === null &&
        engine.canAfford(state, engine.getCost(hall, 0, 1))
      ) {
        const next = engine.buyBuilding(state, hall, 1);
        if (next !== state) {
          state = next;
          if (!seenQueue) {
            seenQueue = true;
            record('建成天工院（建造队列名额 +1）');
          }
          continue;
        }
      }
      if (engine.canUpgradeQueue(state).ok) {
        const before = engine.getQueueSlots(state);
        state = engine.upgradeQueue(state);
        if (engine.getQueueSlots(state) > before) {
          record(`天工院特殊升级：建造名额 ${before} → ${engine.getQueueSlots(state)}`);
          continue;
        }
      }
      /*
       * 队列里**只挂一个**目标，而不是把 7 个名额全填满。
       *
       * 一开始图省事把空位全填上，结果 AI 同时朝 6 个方向花钱，把灵石抽干了 ——
       * `canRecruit` 要灵石，招收一停，弟子就归零。
       * 真人不会这么干：建造队列是"排好一个再排下一个"，
       * 名额多是为了**挂机时能提前排好几步**，不是让人并行撒钱。
       */
      if (state.buildQueue.length === 0) {
        const want = chooseBuilding(state);
        if (want) {
          const queued = engine.enqueueBuild(state, want);
          if (queued !== state) {
            state = queued;
            continue;
          }
        }
      }
    }

    /* ---------------- 3d. 合成进阶资源（需求 4） ----------------
       什么时候该合？AI 的判断很简单：**只要有盈余就一直合**。
       三种进阶资源都是中后期的硬通货（炼丹 / 炼器 / 阵法），
       而它们的原料（灵气、灵草、灵矿、灵木、灵石）在中期本来就会顶到储存上限，
       与其让产量白白溢出，不如换成进阶资源囤着。 */
    /* ---------------- 3d. 进阶资源的里程碑（需求 4） ----------------
       本轮起合成交给"自动合成 + 目标存量"了（见第 0 步设的 autoRefineTargets），
       所以这里只留一件事：**记录每种进阶资源第一次到手的时间**，
       报告里那几行"首次合成灵液 / 精金 / 阵枢"就是从这里来的。 */
    {
      for (const recipe of REFINE_RECIPES) {
        if (recipe.output.item === 'stone') continue;
        if (stockOf(recipe.output.item) <= 0) continue;
        if (seenRefine.has(recipe.id)) continue;
        seenRefine.add(recipe.id);
        const name =
          recipe.output.item === 'spiritEssence'
            ? '灵液'
            : recipe.output.item === 'refinedGold'
              ? '精金'
              : '阵枢';
        record(`首次合成${name}`);
      }
    }


    /* ---------------- 3e. 感悟（需求 3） ----------------
       AI 的策略：
         - 五行优先补"当前最缺的那条"（简单起见按顺序轮转，反正都要修）；
         - 时间大道修到能开就偶尔穿梭一次（它是"结算"，不改变长期收益，
           但能让 AI 更快跑到中后期，正好也验证穿梭不会把弟子全熬死）；
         - 空间大道修满 10 阶就去做戒指。 */
    if (enlightenment.isEnlightenmentUnlocked(state)) {
      // 制作空间戒指
      if (enlightenment.canCraftSpaceRing(state).ok) {
        const next = enlightenment.craftSpaceRing(state);
        if (next !== state) {
          state = next;
          record(`制成第 ${enlightenment.getSpaceRings(state)} 枚空间戒指`);
          continue;
        }
      }
      // 时空穿梭：每 5 游戏年一次，能跳就跳
      if (enlightenment.canTimeJump(state).ok && enlightenment.getEnlightenLevel(state, 'time') > 0) {
        const years = enlightenment.getTimeJumpYears(state);
        /*
         * ⚠️ `random` 必须显式传。
         *
         * `applyTick(state, dt, random = gameRandom)` 的默认值就是 `Math.random`，
         * 漏传这一处会让整份模拟从"首次穿梭"那一刻起被真随机污染 ——
         * 同一份代码连跑两次，合体期能从 1天1小时 漂到 1天14小时。
         * 这个坑这一轮我又踩了一次（上一轮是 advanceLayer / startExpedition）。
         */
        const next = enlightenment.doTimeJump(state, (g, dt) => applyTickSim(g, dt, random));
        if (next !== state) {
          state = next;
          if (!seenTimeJump) {
            seenTimeJump = true;
            record(`首次时空穿梭（${years} 年）`);
          }
          continue;
        }
      }
      // 修感悟：按"阶数最低的那条先修"，保证七条道大致同步推进
      if (!state.enlightening) {
        const candidates = ENLIGHTEN_PATHS.filter((p) => enlightenment.canEnlighten(state, p.id).ok).sort(
          (a, b) => enlightenment.getEnlightenLevel(state, a.id) - enlightenment.getEnlightenLevel(state, b.id),
        );
        const pick = candidates[0];
        if (pick) {
          const next = enlightenment.startEnlighten(state, pick.id);
          if (next !== state) {
            state = next;
            if (!seenEnlighten) {
              seenEnlighten = true;
              record(`首次感悟（${pick.name}）`);
            }
            continue;
          }
        }
      }
    }

    /* ---------------- 3f. 开启富集区秘境（需求 1） ----------------
       资源富集区的秘境要先花一笔资源立阵眼。AI 的策略是"付得起就开"——
       富集区是高档次材料的主要来源，一直不开等于把最肥的地荒着。
       开启花费里有阵枢，所以这一步和上面的合成形成闭环。 */
    {
      const openable = SECRET_REALMS.filter(
        (r) => engine.needsOpening(r) && !engine.isRealmOpened(state, r) && engine.canOpenRealm(state, r).ok,
      );
      if (openable.length > 0) {
        const target = openable[0];
        const next = engine.openRealm(state, target);
        if (next !== state) {
          state = next;
          openedRealms += 1;
          if (openedRealms === 1) record(`首次开启资源富集区秘境（${target.name}）`);
          continue;
        }
      }
    }

    /* ---------------- 3g. 备齐可携带器物（需求 2） ----------------
       可携带器物会随探索磨损，用坏就得重炼。AI 只在"缺货"时补一件，
       而不是能炼就炼 —— 和合成同一条纪律：限额才不会把经济抽干。 */
    if (state.refiningTier >= 2) {
      const missing = ARTIFACTS.filter(
        (a) => a.carry && (state.artifacts[a.id] ?? 0) <= 0 && crafting.canCraftArtifact(state, a.id).ok,
      ).sort((a, b) => a.tier - b.tier);
      const want = missing[0];
      if (want) {
        const craft = crafting.craftArtifact(state, want.id, 1, random);
        // 失败也扣材料，所以无论如何都要接住新状态
        state = craft.state;
        if (craft.made > 0) {
          gearCrafted += 1;
          if (gearCrafted === 1) record(`首次炼成可携带器物（${want.name}）`);
          continue;
        }
      }
    }

    /* ---------------- 死锁检测 ----------------
       真正的死锁只有一个判据：灵气满了，且什么都买不起。
       所有建筑都含灵气造价，灵气一满收入就永远是 0。
       反过来，只要灵气没满就还有希望 —— 别的资源顶上限只是浪费产量。 */
    if (engine.isResourceFull(state, 'qi')) {
      const canAffordAnything = [...GENERATORS, ...STRUCTURES].some((def) => {
        if (engine.getBuildGate(def, state) !== null) return false;
        const owned = engine.getBuildingCount(state, def.id);
        if (owned >= engine.getMaxCount(def)) return false;
        return engine.canAfford(state, engine.getCost(def, owned, 1));
      });
      if (!canAffordAnything) {
        deadlock = true;
        milestones.push({ seconds, label: `⛔ 死锁：灵气顶到上限 ${fmt(engine.getStorageCap(state, 'qi'))}` });
        break;
      }
    }

    /* ---------------- 4. 推进到下一件事 ---------------- */
    const production = engine.getProduction(state);
    let wait = Infinity;

    for (const def of [...GENERATORS, ...STRUCTURES]) {
      if (engine.getBuildGate(def, state) !== null) continue;
      const owned = engine.getBuildingCount(state, def.id);
      if (owned >= engine.getMaxCount(def)) continue;
      const cost = engine.getCost(def, owned, 1);

      let longest = 0;
      let feasible = true;
      for (const [id, amount] of Object.entries(cost) as [ItemId, ReturnType<typeof D>][]) {
        const missing = amount.sub(engine.getAmount(state, id));
        if (missing.lte(0)) continue;
        // 材料没有自动产率（只能靠探索），不能"等出来"
        const rate = (production as Record<string, ReturnType<typeof D>>)[id] ?? D(0);
        // 资源已顶到上限时，等下去也不会变多
        const cap = isResourceId(id) ? caps[id] : undefined;
        if (rate.lte(0) || (cap && engine.getAmount(state, id).gte(cap))) {
          feasible = false;
          break;
        }
        longest = Math.max(longest, missing.div(rate).toNumber());
      }
      if (feasible && longest > 0) wait = Math.min(wait, longest);
    }

    if (!Number.isFinite(wait)) {
      if (production.qi.lte(0)) {
        const dt = 1 / CONFIG.clicksPerSecond;
        seconds += dt;
        state = engine.tickMind(state, dt);
        state = engine.meditate(state);
        state = engine.refreshUnlocks(state);
        continue;
      }
      // 有产出但暂时买不起：多半是缺秘境材料。
      // 开宗之后弟子会去打，所以这里先推进探索；但如果掌门闲着，
      // 就让他亲自出门 —— 游历正是为此准备的兜底手段。
      if (!state.personalTravel) {
        const regions = travel.getAvailableRegions(state);
        const best = regions[regions.length - 1];
        if (best) {
          const next = travel.startTravel(state, best.id);
          if (next !== state) {
            state = next;
            continue;
          }
        }
      }
      const dt = 120;
      seconds += dt;
      // 取样要在推进**之前**：这一段 dt 里宗门养着的是"推进前"那批人，
      // 推进后可能刚好赶上一次大阵亡 —— 那属于下一段，不该算进这一段
      notePopulation(state, dt);
      state = applyTick(state, dt, random);
      continue;
    }

    const dt = Math.max(wait, 0.05);
    seconds += dt;
    const travelingBefore = state.personalTravel;
    notePopulation(state, dt);
    state = applyTick(state, dt, random);
    if (travelingBefore && !state.personalTravel && !flags.firstTravelBack) {
      flags.firstTravelBack = true;
      record(`掌门游历归来（${TRAVEL_REGIONS.find((r) => r.id === travelingBefore.regionId)?.name ?? ''}）`);
    }
  }

  return {
    seed,
    seconds,
    iterations,
    deadlock,
    realmTimes,
    milestones,
    finalState: state,
    encountersSeen,
    popAverage: popSeconds > 0 ? popIntegral / popSeconds : 0,
    popPeak,
    tripsStarted,
    farmTrips: [...farmTrips.entries()].sort((a, b) => b[1] - a[1]),
    equipOk,
    gearsHanded,
    equipNoTarget,
    equipRejected,
    hitIterationCap: iterations >= CONFIG.maxIterations,
  };
}

/* ------------------------------------------------------------------ */
/* 报告                                                                */
/* ------------------------------------------------------------------ */

/** 主种子的详细报告 */
function printDetail(result: SimResult): void {
  console.log('【主种子时间线】');
  for (const m of result.milestones) {
    console.log(`  ${fmtDuration(m.seconds).padStart(12)}  ${m.label}`);
  }

  const steps = result.milestones.filter((m) => m.label.includes('→'));
  if (steps.length > 0) {
    console.log('\n【各境界耗时】');
    let previous = 0;
    for (const m of steps) {
      console.log(
        `  ${m.label.padEnd(18)} 用时 ${fmtDuration(m.seconds - previous)}（累计 ${fmtDuration(m.seconds)}）`,
      );
      previous = m.seconds;
    }
  }

  console.log('\n【模拟结束时的状态】');
  const state = result.finalState;
  const encountersSeen = result.encountersSeen;
  const production = engine.getProduction(state);
  const caps = engine.getStorageCaps(state);

  console.log(`  境界：${engine.getRealm(state).name} ${state.layer} 层`);
  /*
   * 突破门槛的诊断（需求 9）：丹药变成硬门槛之后，"为什么卡在这里"
   * 最常见的答案就是"缺某一味丹"。这一行让报告自己说出来。
   */
  {
    const bt = engine.getBreakthroughStatus(state);
    const pillId = bt.pillId;
    const owned = pillId ? (state.pills[pillId] ?? 0) : 0;
    console.log(
      `  突破：${bt.possible ? '可以尝试' : (bt.reason ?? '未知')}` +
        (pillId ? ` · ${PILL_MAP[pillId]?.name ?? pillId} ×${owned}` : ''),
    );
  }
  console.log(`  灵气产量：${fmt(production.qi)}/秒 · 全局倍率 ×${fmt(engine.getGlobalMultiplier(state))}`);
  console.log(`  宗门：${state.sect.founded ? SECT_LEVELS[state.sect.level - 1].name : '未开宗'}`);
  console.log(`  弟子：${state.sect.disciples.length} 人，累计招收 ${state.sect.totalRecruited} 人`);
  if (state.sect.founded) {
    // 招不了人的时候，"为什么招不了"必须能从报告里读出来
    const can = disciples.canRecruit(state);
    console.log(
      `  招收：${can.ok ? '可以招' : (can.reason ?? '未知')}` +
        ` · 弟子床位 ${engine.getDiscipleHousing(state)}（上限 ${engine.getDiscipleCapacity(state)}）`,
    );
  }
  /*
   * ⚠️ 实际推进了多久 + 用了多少次迭代。
   *
   * 循环的退出条件是「时间到 30 天」**或**「迭代到 40 万次」，而报告原来只写
   * "模拟时长上限 30天" —— 于是"其实只跑了 8 天就撞上迭代上限"这种情况
   * 完全看不出来（这一轮就被它误导过一次：以为 AI 卡了 22 天没动，
   * 实际是模拟早就结束了）。两个数都打出来，这种误读就不会再发生。
   */
  console.log(
    `  实际推进：${fmtDuration(result.seconds)}（上限 ${fmtDuration(CONFIG.budget)}）` +
      ` · 迭代 ${result.iterations} 次${result.hitIterationCap ? '（⚠️ 撞上迭代上限，时间没跑满）' : ''}`,
  );
  /*
   * 人口指标（需求 1）。"结束时 0 人"经常只是**快照**（成批阵亡之后、
   * 下一轮招收之前），所以真正该看的是时间加权的平均与峰值。
   */
  console.log(
    `  人口：平均 ${result.popAverage.toFixed(1)} 人 · 峰值 ${result.popPeak} 人` +
      ` · 宗门上限 ${engine.getDiscipleCapacity(state)}`,
  );

  const servantTotal = engine.getServantCount(state);
  const servantDetail = SERVANT_JOBS.filter((job) => (state.servants[job.id] ?? 0) > 0)
    .map((job) => `${job.name} ${state.servants[job.id]}`)
    .join('，');
  console.log(
    `  仆役：${servantTotal} 人 / 上限 ${engine.getServantCapacity(state)}${servantTotal > 0 ? `（${servantDetail}）` : ''}`,
  );
  if (state.injurySeconds > 0) {
    console.log(`  道伤：剩余 ${fmtDuration(state.injurySeconds)}`);
  }

  console.log(`  炼丹术 ${state.alchemyTier} 品 · 炼器术 ${state.refiningTier} 品`);
  /*
   * 升品的卡点（需求 9 的连带影响）：炼丹术现在在主线上了，
   * "为什么升不上去"必须能从报告里直接读出来，否则每次都要回去翻代码。
   */
  {
    const al = crafting.getAlchemyUpgradeStatus(state);
    const rf = crafting.getRefiningUpgradeStatus(state);
    console.log(
      `  升品卡点：炼丹 ${al.nextTier ?? '—'} 品 ${al.possible ? '可升' : (al.reason ?? '')}` +
        ` · 炼器 ${rf.nextTier ?? '—'} 品 ${rf.possible ? '可升' : (rf.reason ?? '')}`,
    );
    const missing = nextMissingMaterial(state);
    console.log(
      `  卡点材料：${missing ? `${MATERIAL_MAP[missing]?.name ?? missing}（存量 ${fmt(engine.getAmount(state, missing))}）` : '无（要么不缺、要么卡在资源上）'}`,
    );
  }

  /* ---- 需求 6：钻研与图纸 ---- */
  const learned = TECHS.filter((t) => state.techs[t.id] === true);
  console.log(
    `  钻研：${learned.length}/${TECHS.length} 门${learned.length > 0 ? `（${learned.map((t) => t.name).join('、')}）` : ''}`,
  );
  if (state.research) {
    console.log(`  正在钻研：${TECH_MAP[state.research.id]?.name ?? state.research.id}（还需 ${fmtDuration(state.research.remaining)}）`);
  }
  const blueprints = Object.keys(state.blueprints);
  console.log(`  图纸：${blueprints.length} 张${blueprints.length > 0 ? `（${blueprints.join('、')}）` : ''}`);

  /* ---- 需求 5：地图与探索距离 ---- */
  const range = engine.getExplorationRange(state);
  const discovered = engine.getDiscoveredRealms(state);
  console.log(
    `  探索：距离 ${range.distance} 里 · 可达 ${range.reachable.length}/${MAP_REGIONS.length} 区（${range.reachable
      .map((r) => r.name)
      .join('、')}）`,
  );
  // 44 处秘境的名字全列出来会把报告刷屏，所以只报数量 + 前几处
  const sample = discovered.slice(0, 6).map((r) => r.name).join('、');
  console.log(
    `  已发现秘境：${discovered.length}/${SECRET_REALMS.length}` +
      (discovered.length > 0 ? `（${sample}${discovered.length > 6 ? ' …' : ''}）` : ''),
  );
  console.log(
    `  秘境档次分布：${[1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((tier) => `${tier}档 ${SECRET_REALMS.filter((r) => r.tier === tier).length} 处`)
      .join(' · ')}`,
  );
  const cooling = Object.entries(state.realmCooldowns);
  console.log(
    `  冷却中的秘境：${
      cooling.length === 0
        ? '无'
        : cooling.map(([id, s]) => `${SECRET_REALM_MAP[id]?.name ?? id} ${fmtDuration(s)}`).join('，')
    }`,
  );

  /* ---- 需求 4：宗门建筑、大比、心得 ---- */
  const hallBuilt = STRUCTURES.filter(
    (def) => def.group === 'hall' && engine.getBuildingCount(state, def.id) > 0,
  ).map((def) => `${def.name}×${engine.getBuildingCount(state, def.id)}`);
  console.log(`  宗门建筑：${hallBuilt.length === 0 ? '无' : hallBuilt.join('，')}`);
  {
    const levels = ENLIGHTEN_PATHS.map(
      (p) => `${p.name} ${enlightenment.getEnlightenLevel(state, p.id)}`,
    ).join(' · ');
    console.log(`  感悟（需求 3）：${levels}`);
    console.log(
      `  进阶资源（需求 4）：灵液 ${Math.round(state.materials.spiritEssence?.toNumber() ?? 0)}` +
        ` · 精金 ${Math.round(state.materials.refinedGold?.toNumber() ?? 0)}` +
        ` · 阵枢 ${Math.round(state.materials.arrayCore?.toNumber() ?? 0)}` +
        ` · 空间戒指 ${enlightenment.getSpaceRings(state)} 枚`,
    );
  }
  {
    const karmaLabel = encounter.getKarmaLabel(state);
    console.log(
      `  善恶值（需求 2）：${Math.round(state.karma)}（${karmaLabel.icon}${karmaLabel.name}）` +
        ` · 路上遭遇 ${encountersSeen} 次` +
        ` · 天雷之罚 −${(encounter.getKarmaThunderPenalty(state) * 100).toFixed(0)}%` +
        ` · 善行加成 +${(encounter.getKarmaExploreBonus(state) * 100).toFixed(0)}%`,
    );
  }
  {
    const queueNames = state.buildQueue.map((id) => BUILDABLE_MAP[id]?.name ?? id);
    console.log(
      `  建造队列（需求 2）：${state.buildQueue.length}/${engine.getQueueSlots(state)} 名额` +
        ` · 天工院${engine.getBuildingCount(state, 'tiangongYuan') > 0 ? '已建' : '未建'}` +
        ` · 特殊升级 ${state.tiangongLevel}/${QUEUE_UPGRADES.length}` +
        ` · 队列 ${queueNames.length === 0 ? '空' : queueNames.join('、')}`,
    );
  }
  if (sectActivity.hasArena(state)) {
    const countdown = sectActivity.getArenaCountdown(state);
    console.log(
      `  大比：${sectActivity.isArenaRunning(state) ? '已开启' : '已停办'}${
        countdown !== null ? `，距下次 ${fmtDuration(countdown)}` : ''
      }${sectActivity.isArenaBuffActive(state) ? `，加速中（剩 ${fmtDuration(state.arenaBuffSeconds)}）` : ''}`,
    );
  } else {
    console.log('  大比：未建比武台');
  }
  const insights = state.sect.disciples.map((d) => d.insight).sort((a, b) => b - a);
  const medianInsight = insights[Math.floor(insights.length / 2)] ?? 0;
  console.log(
    `  弟子心得：最高 ${Math.round(insights[0] ?? 0)} · 中位 ${Math.round(medianInsight)} · 修行倍率 ×${engine
      .getCultivationSpeedMultiplier(state)
      .toFixed(2)}`,
  );

  /*
   * 弟子养成（设定集第 8 / 14 章）：忠诚与心魔的分布。
   *
   * 只报"平均 61"是看不出问题的 —— 真要看的是**有没有人已经掉到叛逃区、
   * 有没有人已经高到拒绝出征**。所以按档位报人数。
   */
  {
    const loyaltyTiers = new Map<string, number>();
    const demonTiers = new Map<string, number>();
    let refusing = 0;
    for (const d of state.sect.disciples) {
      const lt = loyaltyTierOf(d.loyalty).name;
      loyaltyTiers.set(lt, (loyaltyTiers.get(lt) ?? 0) + 1);
      const dt = demonTierOf(d.demon).name;
      demonTiers.set(dt, (demonTiers.get(dt) ?? 0) + 1);
      if (d.demon >= 61) refusing += 1;
    }
    console.log(
      `  弟子忠诚：${[...loyaltyTiers.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') || '（无弟子）'}`,
    );
    console.log(
      `  弟子心魔：${[...demonTiers.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') || '（无弟子）'}${
        refusing > 0 ? ` · ⚠️ 已有 ${refusing} 人拒绝出征` : ''
      }`,
    );
  }

  /* ---- 丹炉与装备（设定集第 8.7 / 11 章） ---- */
  {
    const furnace = gear.getFurnace(state);
    const ownedGears = gear.getOwnedGears(state);
    const stock = ownedGears.reduce((sum, entry) => sum + entry.count, 0);
    let worn = 0;
    for (const d of state.sect.disciples) worn += gear.countDiscipleGear(d);
    console.log(
      '  炉鼎：' +
        furnace.icon +
        furnace.name +
        '（' +
        furnace.grade +
        ' 品，炼丹 +' +
        Math.round(furnace.alchemyBonus * 100) +
        '% · 炼器 +' +
        Math.round(furnace.refiningBonus * 100) +
        '% · 出丹双份 +' +
        Math.round(furnace.batchBonus * 100) +
        '%）· 已铸 ' +
        gear.getOwnedFurnaces(state).length +
        '/9',
    );
    console.log('  弟子装备：本局累计发出 ' + result.gearsHanded + ' 件 · 当前在装 ' + worn + ' 件 · 库存 ' + stock + ' 件');
  }

  /* ---- 声望与外交（设定集第 9 章） ---- */
  {
    console.log(
      '  山门特质：' +
        (state.traits.length > 0 ? state.traits.map((id) => TRAIT_MAP[id]?.name ?? id).join('、') : '（未选）'),
    );
    const tier = fame.getFameTier(state);
    const allied = state.npcSects.filter((s) => s.alliance).length;
    const relations = state.npcSects
      .map((s) => `${NPC_SECT_MAP[s.id]?.name ?? s.id} ${Math.round(s.relation)}`)
      .join(' · ');
    console.log(`  声望：${Math.round(fame.getFame(state))}（${tier.icon}${tier.name}）· 盟友 ${allied}/6`);
    console.log(`  外交关系：${relations}`);
    console.log(
      `  结局进度：${fame
        .checkEndings(state)
        .map((e) => `${ENDING_MAP[e.id].name}${e.reached ? '✓' : '✗'}`)
        .join(' · ')}`,
    );
  }

  /* ---- 功法（设定集第 7 章） ---- */
  {
    const owned = manuals.getOwnedManuals(state);
    const fragments = manuals.getOwnedFragments(state);
    const inStock = owned.reduce((sum, entry) => sum + entry.count, 0);
    const fragmentsTotal = fragments.reduce((sum, entry) => sum + entry.count, 0);
    let equipped = 0;
    for (const d of state.sect.disciples) {
      if (d.cultivationManual) equipped += 1;
      if (d.combatManual) equipped += 1;
    }
    console.log(
      `  功法（藏经阁 ${engine.getBuildingCount(state, 'library')} 座 · 合成率 ${Math.round(
        manuals.getSynthRate(state) * 100,
      )}%）：本局累计发书 ${result.equipOk} 本 · 当前在装 ${equipped} 本 · 库存 ${inStock} 本 · 碎片 ${fragmentsTotal} 份`,
    );
    /*
     * ⚠️ 「本局累计发书」与「当前在装」必须**一起**报。
     *
     * 只报"当前在装 37 本"会让人以为发书逻辑坏了 —— 事实上这一局发出去过
     * 六千多本，只是这个存档的门派弟子更替极快（30 天招收 48 万人），
     * 弟子坐化时功法 60% 回仓库、40% 损毁，于是快照上的在装数永远很小。
     * 两个数放在一起，读者才能分清"系统没跑"和"跑了很多但人换了"。
     */
    const byGrade = new Map<number, number>();
    for (const d of state.sect.disciples) {
      for (const id of [d.cultivationManual, d.combatManual]) {
        const def = MANUAL_MAP[id];
        if (def) byGrade.set(def.grade, (byGrade.get(def.grade) ?? 0) + 1);
      }
    }
    if (byGrade.size > 0) {
      console.log(
        `  已装配品阶：${[...byGrade.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([g, n]) => `${MANUAL_GRADE_NAMES[g as 1 | 2 | 3 | 4 | 5]} ${n}`)
          .join(' · ')}`,
      );
    }
    /*
     * 「库存两千多本却只装出去几十本」这种账必须能一眼看懂，所以把
     * **库存品阶**与**每种品阶还剩多少空位**（够境界且槽位空着的人数）一起印出来。
     * 只印总数的话，读者分不清是"没人够境界"还是"发书逻辑根本没跑"。
     */
    if (inStock > 0) {
      const stockByGrade = new Map<number, number>();
      for (const entry of owned) {
        stockByGrade.set(entry.def.grade, (stockByGrade.get(entry.def.grade) ?? 0) + entry.count);
      }
      console.log(
        `  库存品阶：${[...stockByGrade.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([g, n]) => `${MANUAL_GRADE_NAMES[g as 1 | 2 | 3 | 4 | 5]} ${n}`)
          .join(' · ')}`,
      );
      const slots: string[] = [];
      for (const grade of [5, 4, 3, 2, 1] as const) {
        const minRealm = MANUAL_GRADE_MIN_REALM[grade];
        let free = 0;
        for (const d of state.sect.disciples) {
          if (d.realmIndex < minRealm) continue;
          if (!d.cultivationManual) free += 1;
          if (!d.combatManual) free += 1;
        }
        slots.push(`${MANUAL_GRADE_NAMES[grade]} ${free}`);
      }
      console.log(`  可装空位（按该品阶的境界门槛算）：${slots.join(' · ')}`);
      console.log(
        `  发书诊断：成功 ${result.equipOk} · 找不到合适弟子 ${result.equipNoTarget} · 装备被拒 ${result.equipRejected}`,
      );
    }
  }

  /* ---- 需求 4：自动合成 ---- */
  console.log(
    `  自动合成：${state.autoRefineLevel === 0 ? '关闭' : `${state.autoRefineLevel} 档（${engine.getAutoRefineRate(state)} 批/秒）`}`,
  );

  /* ---- 需求 5：种植 ---- */
  const seedTotal = Object.values(state.seeds).reduce((sum, n) => sum + n, 0);
  console.log(
    `  灵植：地块 ${planting.getUsedPlots(state)}/${engine.getPlotCapacity(state)} · 余种 ${seedTotal} 颗 · 已成熟 ${planting.getReadyPlantings(state).length}`,
  );

  /* ---- 需求 3：商行 ---- */
  if (engine.hasShop(state)) {
    const goods = state.shop.offers
      .map((o) => `${shop.describeOffer(o).name}×${o.amount}${o.sold ? '(已售)' : ''}`)
      .join('，');
    console.log(`  商行货架（${fmtDuration(state.shop.secondsLeft)}后刷新）：${goods || '空'}`);
  } else {
    console.log('  商行：未开设');
  }

  /* ---- 需求 1：游历 ---- */
  if (state.personalTravel) {
    const region = TRAVEL_REGIONS.find((r) => r.id === state.personalTravel?.regionId);
    console.log(`  掌门在外：${region?.name ?? ''}（还剩 ${fmtDuration(travel.getTravelRemaining(state.personalTravel))}）`);
  } else {
    console.log('  掌门：在洞府中');
  }
  console.log(
    `  采办出行：${result.tripsStarted} 趟${nextMissingMaterial(state) ? ` · 仍缺 ${MATERIAL_MAP[nextMissingMaterial(state)!]?.name ?? ''}` : ''}`,
  );
  if (result.farmTrips.length > 0) {
    console.log(
      `  采办去向：${result.farmTrips
        .map(([id, n]) => `${TRAVEL_REGION_MAP[id]?.name ?? id} ${n} 趟`)
        .join(' · ')}`,
    );
  }

  console.log(
    `  储存占用：${RESOURCE_IDS.map((id) => `${id} ${fmt(state.resources[id])}/${fmt(caps[id])}`).join('，')}`,
  );
  const storeBuildings = STRUCTURES.filter(
    (def) => def.storage && engine.getBuildingCount(state, def.id) > 0,
  ).map((def) => `${def.name}×${engine.getBuildingCount(state, def.id)}`);
  console.log(`  储物建筑：${storeBuildings.length === 0 ? '无' : storeBuildings.join('，')}`);

  const materials = Object.entries(state.materials)
    .filter(([, amount]) => amount.gt(0))
    .map(([id, amount]) => `${MATERIAL_MAP[id as keyof typeof MATERIAL_MAP]?.name ?? id} ${fmt(amount)}`);
  console.log(`  材料：${materials.length === 0 ? '无' : materials.join('，')}`);
  // ⚠️ 这里看的是**终盘还剩多少**，不是"有没有拿到过"。
  // 需求 4 的进阶资源会被持续消耗（炼丹 / 炼器 / 阵法 / 空间戒指），
  // 终盘为 0 只说明"用光了"，不代表没拿到 —— 拿到过的证据在里程碑里
  // （"首次合成阵枢"那一类）。文案写清楚，免得被读成回归。
  const missing = MATERIAL_IDS.filter((id) => state.materials[id].lte(0));
  console.log(
    `  终盘已用尽的材料：${missing.length === 0 ? '无' : missing.map((id) => MATERIAL_MAP[id].name).join('、')}`,
  );
  console.log('    （AI 只在"卡住"时才出门游历，所以高境界材料未必会被取到；来源见冒烟测试）');

  if (state.sect.disciples.length > 0) {
    const byRealm = new Map<number, number>();
    for (const d of state.sect.disciples) {
      byRealm.set(d.realmIndex, (byRealm.get(d.realmIndex) ?? 0) + 1);
    }
    console.log(
      `  弟子分布：${[...byRealm.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([realm, count]) => `${REALMS[realm].name} ${count}`)
        .join('，')}`,
    );
  }
}

/** 多种子对照表 */
function printSweep(results: SimResult[]): void {
  const stageNames = REALMS.map((r) => r.name);

  /*
   * ⚠️ 标题里的口径要写准：`realmTimes` 存的是**进入该境界那一刻的总秒数**
   * （见 runSeed 里的 `realmTimes.set(to, seconds)`），所以这张表印的是**累计**用时。
   * 而下面【各阶段耗时波动】用的是同一批值 —— 那也就同样是累计值，
   * 不是"这一段花了多久"。两处口径必须一致，否则读的人会把
   * "筑基 29 分 / 金丹 2 小时24分"读成"金丹这一跳花了 2 小时24分"。
   */
  console.log('\n【多种子对照】到达各境界的**累计**用时（从开局算起）');
  console.log(`  ${'种子'.padEnd(8)}${stageNames.slice(1, 7).map((n) => n.padStart(12)).join('')}   死锁`);

  for (const result of results) {
    const cells = stageNames.slice(1, 7).map((name) => {
      const t = result.realmTimes.get(name);
      return (t === undefined ? '—' : fmtDuration(t)).padStart(12);
    });
    console.log(
      `  ${String(result.seed).padEnd(8)}${cells.join('')}   ${result.deadlock ? '⛔ 是' : '✅ 否'}`,
    );
  }

  const deadlocks = results.filter((r) => r.deadlock);
  if (deadlocks.length > 0) {
    console.log(`\n⛔ ${deadlocks.length}/${results.length} 个种子发生死锁，储物建筑的容量/价格曲线需要调整。`);
  } else {
    console.log(`\n✅ ${results.length} 个种子全程均未死锁。`);
  }

  // 各阶段耗时的波动范围，用来判断曲线是数值问题还是运气问题。
  // ⚠️ 与上表同源：这里也是**累计**用时（见 printSweep 开头的说明）
  console.log('\n【各阶段累计耗时波动】');
  for (let i = 1; i < 7 && i < stageNames.length; i += 1) {
    const name = stageNames[i];
    const times: number[] = [];
    for (const result of results) {
      const t = result.realmTimes.get(name);
      if (t !== undefined) times.push(t);
    }
    if (times.length === 0) continue;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
    const spread = median > 0 ? Math.round(((max - min) / median) * 100) : 0;
    console.log(
      `  ${name.padEnd(8)} 中位 ${fmtDuration(median).padStart(10)} · 最快 ${fmtDuration(min)} · 最慢 ${fmtDuration(max)} · 波动 ±${spread}%`,
    );
  }
}

/* ------------------------------------------------------------------ */

function main(): void {
  const started = Date.now();
  const results: SimResult[] = [];
  for (let i = 0; i < CONFIG.seeds; i += 1) {
    results.push(runSimulation(20240101 + i * 7919));
  }

  console.log('仙途 · 数值模拟报告');
  console.log('='.repeat(78));
  console.log('策略：回本最快优先建造，仓储告急先扩建仓库，宗门可升就升，探索队伍尽量排满');
  console.log(
    `模拟时长上限 ${fmtDuration(CONFIG.budget)} · ${CONFIG.seeds} 个随机种子 · 总耗时 ${Date.now() - started}ms`,
  );
  console.log('');

  printDetail(results[0]);
  printSweep(results);

  console.log('');
  console.log('='.repeat(78));
}

main();
