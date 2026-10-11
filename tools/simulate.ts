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
  ALCHEMY_SLOT_REQUIREMENT,
  BUILDABLE_MAP,
  GENERATORS,
  MATERIAL_IDS,
  MAP_REGIONS,
  QUEUE_UPGRADES,
  REFINE_RECIPES,
  ENLIGHTEN_PATHS,
  MATERIAL_MAP,
  PILL_MAP,
  REALMS,
  REFINING_SLOT_REQUIREMENT,
  RESOURCE_IDS,
  SECT_LEVELS,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  SERVANT_JOBS,
  STRUCTURES,
  TECHS,
  TECH_MAP,
  TRAVEL_REGIONS,
  isResourceId,
} from '../src/game/content';
import type { ItemId } from '../src/game/content';
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
};

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
}

/* -------------------------- 估值辅助 ------------------------------ */

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
  if (def.capacity) {
    // 空房间少于 4 间就该扩建了（弟子和仆人都要住）
    const need = engine.getFreeHousing(state) < 4;
    return need ? qiCost / (mult * 0.5) : Infinity;
  }
  if (def.alchemySlots) {
    const need = (ALCHEMY_SLOT_REQUIREMENT[state.alchemyTier + 1] ?? 0) > engine.getAlchemySlots(state);
    return need ? qiCost / (mult * 0.4) : Infinity;
  }
  if (def.refiningSlots) {
    const need = (REFINING_SLOT_REQUIREMENT[state.refiningTier + 1] ?? 0) > engine.getRefiningSlots(state);
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
  let seenServant = false;

  const milestones: Milestone[] = [];
  const realmTimes = new Map<string, number>();
  const record = (label: string) => milestones.push({ seconds, label });

  const sectFlags = { founded: false, firstDisciple: false, firstExpedition: false, firstPill: false };
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

  while (seconds < CONFIG.budget && iterations < 400000) {
    iterations += 1;

    /* ---------------- 0. 自动合成档位（需求 4） ----------------
       理性玩家不会一直开着：灵气是突破的硬通货，
       所以只在「还在刷小境界层数」且灵气产量足够大时才开。 */
    const realmNow = engine.getRealm(state);
    const wantAuto =
      state.layer < realmNow.layerCount && engine.getProduction(state).qi.gt(1e5)
        ? 2
        : 0;
    if (state.autoRefineLevel !== wantAuto) {
      state = { ...state, autoRefineLevel: wantAuto, autoRefineProgress: wantAuto > 0 ? state.autoRefineProgress : 0 };
      if (wantAuto > 0 && !flags.firstAutoRefine) {
        flags.firstAutoRefine = true;
        record('开启灵石自动合成');
      }
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
      const pillId = breakthrough.pillId;
      const usePill =
        Boolean(pillId) &&
        (state.pills[pillId] ?? 0) > 0 &&
        engine.getSuccessRate(state, true) > engine.getSuccessRate(state, false);
      const result = engine.breakthrough(state, usePill, random);
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
        // 从最远的已发现秘境往前找：收益最高的优先。
        // 冷却中或暂时去不了的会被 canStartExpedition 挡掉。
        for (const realm of [...SECRET_REALMS].reverse()) {
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

      const neededPill = engine.getRealm(state).breakthroughPill;
      if (neededPill) {
        const def = PILL_MAP[neededPill];
        if (def && state.alchemyTier >= def.tier && (state.pills[neededPill] ?? 0) < 2) {
          const next = crafting.craftPill(state, neededPill, 1);
          if (next !== state) {
            state = next;
            if (!sectFlags.firstPill) {
              sectFlags.firstPill = true;
              record(`首次炼成丹药（${def.name}）`);
            }
            continue;
          }
        }
      }
    }

    /* ---------------- 2b. 仆役 ----------------
       仆人和弟子共用居所名额，AI 的策略是：
         - 开宗前：有多少空房就收多少仆人换产量
         - 开宗后：始终给弟子留 8 个空位，其余照收；
                   真的一个空位都没有时才腾退仆人 */
    const freeHousing = engine.getFreeHousing(state);
    // 开宗之后要给弟子留够位置：留 10 间，够招满一品宗门的 6 名弟子
    const servantReserve = state.sect.founded ? 10 : 0;

    if (freeHousing <= 0 && state.sect.founded && engine.getServantCount(state) > 0) {
      // 从人数最多的工种里遣散一个，给弟子腾位置
      const busiest = SERVANT_JOBS.map((job) => ({ job, count: state.servants[job.id] ?? 0 }))
        .sort((a, b) => b.count - a.count)[0];
      if (busiest.count > 0) {
        const next = engine.dismissServant(state, busiest.job.id);
        if (next !== state) {
          state = next;
          continue;
        }
      }
    } else if (freeHousing > servantReserve && engine.canRecruitServant(state).ok) {
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
    {
      for (const recipe of REFINE_RECIPES) {
        if (recipe.output.item === 'stone') {
          // 灵石合成走原来的自动合成档位，这里不重复点
          continue;
        }
        if (engine.maxRefine(state, recipe.id) <= 0) continue;
        const next = engine.refine(state, recipe.id, 1);
        if (next !== state) {
          state = next;
          if (!seenRefine.has(recipe.id)) {
            seenRefine.add(recipe.id);
            record(`首次合成${recipe.output.item === 'spiritEssence' ? '灵液' : recipe.output.item === 'refinedGold' ? '精金' : '阵枢'}`);
          }
          break;
        }
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
        const next = enlightenment.doTimeJump(state, (g, dt) => applyTickSim(g, dt));
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
      state = applyTick(state, dt, random);
      continue;
    }

    const dt = Math.max(wait, 0.05);
    seconds += dt;
    const travelingBefore = state.personalTravel;
    state = applyTick(state, dt, random);
    if (travelingBefore && !state.personalTravel && !flags.firstTravelBack) {
      flags.firstTravelBack = true;
      record(`掌门游历归来（${TRAVEL_REGIONS.find((r) => r.id === travelingBefore.regionId)?.name ?? ''}）`);
    }
  }

  return { seed, seconds, iterations, deadlock, realmTimes, milestones, finalState: state, encountersSeen };
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
  console.log(`  灵气产量：${fmt(production.qi)}/秒 · 全局倍率 ×${fmt(engine.getGlobalMultiplier(state))}`);
  console.log(`  宗门：${state.sect.founded ? SECT_LEVELS[state.sect.level - 1].name : '未开宗'}`);
  console.log(`  弟子：${state.sect.disciples.length} 人，累计招收 ${state.sect.totalRecruited} 人`);

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

  console.log('\n【多种子对照】到达各境界所需时间');
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

  // 各阶段耗时的波动范围，用来判断曲线是数值问题还是运气问题
  console.log('\n【各阶段耗时波动】');
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
