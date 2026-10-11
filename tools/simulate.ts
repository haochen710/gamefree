/**
 * 数值模拟器
 * ==========
 * 直接调用 src/game 里的真实游戏逻辑（不是另写一套公式），
 * 用一个「理性玩家」策略自动玩一遍，输出两条时间线：
 *
 *   1. 玩家自己的修行曲线（各境界到达时间）
 *   2. 宗门经营曲线（开宗、收徒、秘境、炼丹的解锁节奏）
 *
 * 改完 content/ 里的数值后跑一次 `pnpm simulate` 就能看到节奏变化。
 *
 * 随机数用固定种子，因此每次运行结果完全一致 —— 否则没法比较两次改动。
 */
import { D, fmt, fmtDuration } from '../src/game/decimal';
import {
  ALCHEMY_SLOT_REQUIREMENT,
  BUILDABLE_MAP,
  GENERATORS,
  PILL_MAP,
  REALMS,
  REFINING_SLOT_REQUIREMENT,
  SECT_LEVELS,
  SECRET_REALMS,
  STRUCTURES,
} from '../src/game/content';
import { createInitialState, type GameState } from '../src/game/state';
import * as engine from '../src/game/engine';
import * as disciples from '../src/game/disciples';
import * as expeditions from '../src/game/expeditions';
import * as crafting from '../src/game/crafting';
import { applyTick } from '../src/game/tick';
import type { ItemId } from '../src/game/content';

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

interface SimConfig {
  /** 最长模拟时长（秒） */
  maxSeconds: number;
  /** 没有任何自动产出时，每秒手动打坐次数（受心神限制，实际达不到） */
  clicksPerSecond: number;
  /** 最多模拟几次飞升 */
  maxAscensions: number;
  /** 模拟时间上限（游戏内秒） */
  budget: number;
}

const CONFIG: SimConfig = {
  maxSeconds: 0,
  clicksPerSecond: 4,
  maxAscensions: 0,
  budget: 60 * 60 * 24 * 21, // 21 天
};

/** 固定种子，保证结果可复现 */
function makeRandom(seed = 20240101): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = makeRandom();

/* ------------------------------------------------------------------ */
/* 记录                                                                */
/* ------------------------------------------------------------------ */

interface Milestone {
  seconds: number;
  label: string;
  detail: string;
}

const milestones: Milestone[] = [];

function record(seconds: number, label: string, detail: string): void {
  milestones.push({ seconds, label, detail });
}

/* ------------------------------------------------------------------ */
/* 估值辅助                                                            */
/* ------------------------------------------------------------------ */

/**
 * 资源的影子价格：一单位该资源折算成多少灵气。
 * 用当前产率估算 —— 产 1 单位灵木的时间里本来能产多少灵气。
 */
function shadowPrices(state: GameState): Record<string, number> {
  const production = engine.getProduction(state);
  const qi = production.qi.toNumber();
  const prices: Record<string, number> = { qi: 1, wood: 1, ore: 1, stone: 1, herb: 1 };
  for (const id of ['wood', 'ore', 'stone', 'herb'] as const) {
    const rate = production[id].toNumber();
    prices[id] = rate > 0 && qi > 0 ? qi / rate : 1;
  }
  return prices;
}

function costToQi(cost: engine.CostMap, prices: Record<string, number>): number {
  let total = 0;
  for (const [id, amount] of Object.entries(cost) as [ItemId, ReturnType<typeof D>][]) {
    if (!amount) continue;
    // 材料（秘境产物）用灵石近似估值，避免被当成免费
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

  // 建筑没有直接产出：给一个基于"当前是否急需"的等效价值
  if (def.capacity) {
    const need = state.sect.disciples.length >= engine.getHousingCapacity(state);
    return need ? qiCost / (mult * 0.5) : Infinity;
  }
  if (def.alchemySlots) {
    const nextTier = state.alchemyTier + 1;
    const need = (ALCHEMY_SLOT_REQUIREMENT[nextTier] ?? 0) > engine.getAlchemySlots(state);
    return need ? qiCost / (mult * 0.4) : Infinity;
  }
  if (def.refiningSlots) {
    const nextTier = state.refiningTier + 1;
    const need = (REFINING_SLOT_REQUIREMENT[nextTier] ?? 0) > engine.getRefiningSlots(state);
    return need ? qiCost / (mult * 0.4) : Infinity;
  }
  return Infinity;
}

function chooseBuilding(state: GameState): string | null {
  const prices = shadowPrices(state);
  let best: { id: string; score: number } | null = null;

  for (const def of [...GENERATORS, ...STRUCTURES]) {
    if (!engine.isUnlocked(def, state)) continue;
    const score = payback(state, def.id, prices);
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score) best = { id: def.id, score };
  }
  return best?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

function simulate(): void {
  let state = createInitialState(0);
  let seconds = 0;
  let iterations = 0;

  const sectFlags = { founded: false, firstDisciple: false, firstExpedition: false, firstPill: false };
  const seenSectLevel = new Set<number>([1]);
  const seenAlchemy = new Set<number>([1]);
  const seenRefining = new Set<number>([1]);

  record(0, '开局', '打坐引气入体');

  const detail = (): string => {
    const production = engine.getProduction(state);
    const parts = [...GENERATORS, ...STRUCTURES]
      .filter((def) => engine.getBuildingCount(state, def.id) > 0)
      .map((def) => `${def.name}×${engine.getBuildingCount(state, def.id)}`);
    parts.push(`灵气 ${fmt(production.qi)}/s`);
    if (state.sect.founded) parts.push(`弟子 ${state.sect.disciples.length}`);
    return parts.join('，');
  };

  while (seconds < CONFIG.budget && iterations < 300000) {
    iterations += 1;

    /* ---------------- 1. 修行 ---------------- */
    if (engine.canAdvanceLayer(state)) {
      state = engine.advanceLayer(state);
      continue;
    }

    const breakthrough = engine.getBreakthroughStatus(state);
    if (breakthrough.possible) {
      const from = engine.getRealm(state).name;
      const pillId = breakthrough.pillId;
      const usePill = Boolean(pillId) && (state.pills[pillId] ?? 0) > 0 && engine.getSuccessRate(state, true) > engine.getSuccessRate(state, false);
      const result = engine.breakthrough(state, usePill, random);
      if (result) {
        state = result.state;
        record(
          seconds,
          result.success ? `${from} → ${engine.getRealm(state).name}` : `${from} 突破失败（保底 +5%）`,
          detail(),
        );
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
          record(seconds, '开宗立派', detail());
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
            record(seconds, `宗门晋升${SECT_LEVELS[next.sect.level - 1].name}`, detail());
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
            record(seconds, `首位弟子入门（${result.disciple.name}）`, detail());
          }
          continue;
        }
      }

      // 派探索：把空闲弟子尽量排满所有队伍
      if (state.expeditions.length < expeditions.getMaxExpeditions(state)) {
        let started = false;
        for (const realm of [...SECRET_REALMS].reverse()) {
          if (!expeditions.isRealmUnlocked(realm, state)) continue;
          const party = expeditions.autoSelectParty(state, realm.id);
          if (party.length < realm.partySize) continue;
          const next = expeditions.startExpedition(state, realm.id, party);
          if (next !== state) {
            state = next;
            started = true;
            if (!sectFlags.firstExpedition) {
              sectFlags.firstExpedition = true;
              record(seconds, `首次秘境探索（${realm.name}）`, detail());
            }
            break;
          }
        }
        if (started) continue;
      }

      // 炼丹品阶
      const alchemy = crafting.getAlchemyUpgradeStatus(state);
      if (alchemy.possible) {
        const next = crafting.upgradeAlchemy(state);
        if (next !== state) {
          state = next;
          if (!seenAlchemy.has(next.alchemyTier)) {
            seenAlchemy.add(next.alchemyTier);
            record(seconds, `炼丹术 ${next.alchemyTier} 品`, detail());
          }
          continue;
        }
      }

      // 炼器品阶
      const refining = crafting.getRefiningUpgradeStatus(state);
      if (refining.possible) {
        const next = crafting.upgradeRefining(state);
        if (next !== state) {
          state = next;
          if (!seenRefining.has(next.refiningTier)) {
            seenRefining.add(next.refiningTier);
            record(seconds, `炼器术 ${next.refiningTier} 品`, detail());
          }
          continue;
        }
      }

      // 炼当前的境界丹
      const neededPill = engine.getRealm(state).breakthroughPill;
      if (neededPill) {
        const def = PILL_MAP[neededPill];
        if (def && state.alchemyTier >= def.tier && (state.pills[neededPill] ?? 0) < 2) {
          const next = crafting.craftPill(state, neededPill, 1);
          if (next !== state) {
            state = next;
            if (!sectFlags.firstPill) {
              sectFlags.firstPill = true;
              record(seconds, `首次炼成丹药（${def.name}）`, detail());
            }
            continue;
          }
        }
      }
    }

    /* ---------------- 3. 建造 ---------------- */
    const target = chooseBuilding(state);
    if (target) {
      const def = BUILDABLE_MAP[target];
      const owned = engine.getBuildingCount(state, target);
      const cost = engine.getCost(def, owned, 1);
      if (engine.canAfford(state, cost)) {
        const next = engine.buyBuilding(state, def, 1);
        if (next !== state) {
          state = next;
          continue;
        }
      }
    }

    /* ---------------- 4. 推进到下一件事 ---------------- */
    const production = engine.getProduction(state);
    let wait = Infinity;

    for (const def of [...GENERATORS, ...STRUCTURES]) {
      if (!engine.isUnlocked(def, state)) continue;
      const owned = engine.getBuildingCount(state, def.id);
      const cost = engine.getCost(def, owned, 1);

      let longest = 0;
      let feasible = true;
      for (const [id, amount] of Object.entries(cost) as [ItemId, ReturnType<typeof D>][]) {
        const missing = amount.sub(engine.getAmount(state, id));
        if (missing.lte(0)) continue;
        // 材料（秘境产物）没有自动产率，只能靠探索，不能"等出来"
        const rate = (production as Record<string, ReturnType<typeof D>>)[id] ?? D(0);
        if (rate.lte(0)) {
          feasible = false;
          break;
        }
        longest = Math.max(longest, missing.div(rate).toNumber());
      }
      if (feasible && longest > 0) wait = Math.min(wait, longest);
    }

    if (!Number.isFinite(wait)) {
      if (production.qi.lte(0)) {
        // 完全没有自动产出：只能打坐（受心神上限约束）
        const dt = 1 / CONFIG.clicksPerSecond;
        seconds += dt;
        state = engine.tickMind(state, dt);
        state = engine.meditate(state);
        continue;
      }
      // 有自动产出但暂时买不起任何东西（往往是缺秘境材料）：
      // 跳过一段时间，让弟子修炼和探索继续推进，而不是直接结束模拟
      const dt = 120;
      seconds += dt;
      state = applyTick(state, dt, random);
      continue;
    }

    const dt = Math.max(wait, 0.05);
    seconds += dt;
    state = applyTick(state, dt, random);
  }

  report(state, seconds, iterations);
}

/* ------------------------------------------------------------------ */
/* 报告                                                                */
/* ------------------------------------------------------------------ */

function report(state: GameState, seconds: number, iterations: number): void {
  console.log('仙途 · 数值模拟报告');
  console.log('='.repeat(78));
  console.log('策略：回本最快优先建造，缺丹药时优先炼丹，宗门可升就升，探索队伍尽量排满');
  console.log(
    `随机种子固定，结果可复现 · 模拟上限 ${fmtDuration(CONFIG.budget)} · 实际模拟 ${fmtDuration(
      seconds,
    )} · 迭代 ${iterations} 次`,
  );
  console.log('');

  console.log('【修行与宗门时间线】');
  for (const m of milestones) {
    console.log(`  ${fmtDuration(m.seconds).padStart(12)}  ${m.label}`);
  }

  /* ---- 境界耗时 ---- */
  const realmSteps = milestones.filter((m) => m.label.includes('→'));
  if (realmSteps.length > 0) {
    console.log('\n【各境界耗时】');
    let previous = 0;
    for (const m of realmSteps) {
      console.log(
        `  ${m.label.padEnd(18)} 用时 ${fmtDuration(m.seconds - previous)}（累计 ${fmtDuration(m.seconds)}）`,
      );
      previous = m.seconds;
    }
  }

  /* ---- 最终状态 ---- */
  console.log('\n【模拟结束时的状态】');
  const production = engine.getProduction(state);
  console.log(`  境界：${engine.getRealm(state).name} ${state.layer} 层`);
  console.log(`  灵气产量：${fmt(production.qi)}/秒`);
  console.log(`  全局倍率：×${fmt(engine.getGlobalMultiplier(state))}`);
  console.log(`  宗门：${state.sect.founded ? SECT_LEVELS[state.sect.level - 1].name : '未开宗'}`);
  console.log(`  弟子：${state.sect.disciples.length} 人，累计招收 ${state.sect.totalRecruited} 人`);
  console.log(`  炼丹术 ${state.alchemyTier} 品 · 炼器术 ${state.refiningTier} 品`);

  const held = Object.entries(state.pills).filter(([, n]) => n > 0);
  console.log(`  存丹：${held.length === 0 ? '无' : held.map(([id, n]) => `${PILL_MAP[id]?.name ?? id}×${n}`).join('，')}`);

  const materials = Object.entries(state.materials)
    .filter(([, amount]) => amount.gt(0))
    .map(([id, amount]) => `${id} ${fmt(amount)}`);
  console.log(`  秘境材料：${materials.length === 0 ? '无' : materials.join('，')}`);

  /* ---- 弟子分布 ---- */
  if (state.sect.disciples.length > 0) {
    const byRealm = new Map<number, number>();
    const byAptitude = new Map<string, number>();
    for (const d of state.sect.disciples) {
      byRealm.set(d.realmIndex, (byRealm.get(d.realmIndex) ?? 0) + 1);
      byAptitude.set(d.aptitude, (byAptitude.get(d.aptitude) ?? 0) + 1);
    }
    console.log('\n【弟子境界分布】');
    for (const [realm, count] of [...byRealm.entries()].sort((a, b) => b[0] - a[0])) {
      console.log(`  ${REALMS[realm].name.padEnd(8)} ${count} 人`);
    }
    console.log('\n【弟子资质分布】');
    for (const [aptitude, count] of [...byAptitude.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${aptitude.padEnd(12)} ${count} 人`);
    }
  }

  /* ---- 最近的记事 ---- */
  if (state.journal.length > 0) {
    console.log('\n【最近记事】');
    for (const entry of state.journal.slice(0, 8)) {
      console.log(`  ${fmtDuration(entry.time).padStart(12)}  ${entry.text}`);
    }
  }

  console.log('');
  console.log('='.repeat(78));
}

simulate();
