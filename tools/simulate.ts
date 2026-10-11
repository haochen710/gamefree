/**
 * 数值模拟器
 * ==========
 * 直接调用 src/game 里的真实游戏逻辑（不是另写一套公式），
 * 用一个「理性玩家」策略自动玩一遍，输出各境界的到达时间。
 *
 * 这是调平衡的主力工具：改完 content.ts 的数值，跑一次
 *     pnpm simulate
 * 就能看到节奏是变快了还是变慢了。
 *
 * 玩家策略（模拟一个正常玩家的行为）：
 *   1. 能参悟小境界就参悟，能突破就突破；
 *   2. 需要丹药突破时，优先把丹房建起来；
 *   3. 其余时候买「回本时间最短」的设施
 *      （价值用影子价格换算：1 单位灵木值多少灵气 = 灵气产率 / 灵木产率）；
 *   4. 什么都买不起时，如果有产出就等着，没有产出就打坐。
 */
import { D, fmt, fmtDuration } from '../src/game/decimal';
import {
  GENERATORS,
  RESOURCE_IDS,
  type GeneratorDef,
  type ResourceId,
} from '../src/game/content';
import { createAscendedState, createInitialState, type GameState } from '../src/game/state';
import * as engine from '../src/game/engine';

interface SimConfig {
  /** 最长模拟时长（秒） */
  maxSeconds: number;
  /** 没有任何自动产出时，每秒手动打坐次数 */
  clicksPerSecond: number;
  /** 最多模拟几次飞升 */
  maxAscensions: number;
  /** 每次飞升后额外允许的模拟时长（秒） */
  secondsPerAscension: number;
}

const CONFIG: SimConfig = {
  maxSeconds: 60 * 60 * 24 * 30,
  clicksPerSecond: 4,
  maxAscensions: 2,
  secondsPerAscension: 60 * 60 * 24 * 15,
};

interface Milestone {
  ascension: number;
  seconds: number;
  label: string;
  detail: string;
}

/* ------------------------------------------------------------------ */

function snapshotDetail(state: GameState): string {
  const parts = GENERATORS.filter((g) => (state.generators[g.id] ?? 0) > 0).map(
    (g) => `${g.name}×${state.generators[g.id]}`,
  );
  const prod = engine.getProduction(state);
  parts.push(`灵气 ${fmt(prod.qi)}/s`);
  return parts.join('，');
}

/** 资源的影子价格：一单位该资源折算成多少灵气 */
function shadowPrices(state: GameState): Record<ResourceId, number> {
  const prod = engine.getProduction(state);
  const qi = prod.qi.toNumber();
  const prices = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) {
    const rate = prod[id].toNumber();
    prices[id] = rate > 0 && qi > 0 ? qi / rate : 1;
  }
  prices.qi = 1;
  return prices;
}

function costToQi(cost: engine.CostMap, prices: Record<ResourceId, number>): number {
  let total = 0;
  for (const [id, amount] of Object.entries(cost) as [ResourceId, (typeof cost)[ResourceId]][]) {
    if (!amount) continue;
    total += amount.toNumber() * prices[id];
  }
  return total;
}

/** 回本时间（秒）：越小越值得买 */
function paybackSeconds(state: GameState, def: GeneratorDef, prices: Record<ResourceId, number>): number {
  const owned = state.generators[def.id] ?? 0;
  const cost = engine.getCost(def, owned, 1);
  const qiCost = costToQi(cost, prices);
  const deltaOutput = D(def.baseOutput).mul(engine.getGlobalMultiplier(state));
  const value = deltaOutput.toNumber() * prices[def.produces];
  if (value <= 0 || qiCost <= 0) return Infinity;
  return qiCost / value;
}

/** 还需要多久才买得起这份消耗；返回 null 表示靠现有产率永远买不起 */
function secondsUntilAffordable(state: GameState, cost: engine.CostMap): number | null {
  const prod = engine.getProduction(state);
  let longest = 0;

  for (const [id, amount] of Object.entries(cost) as [ResourceId, (typeof cost)[ResourceId]][]) {
    if (!amount) continue;
    const missing = amount.sub(state.resources[id]);
    if (missing.lte(0)) continue;

    const rate = prod[id];
    if (rate.lte(0)) return null;
    longest = Math.max(longest, missing.div(rate).toNumber());
  }
  return longest;
}

function pillNeeded(state: GameState): number {
  const realm = engine.getRealm(state);
  if (state.layer < realm.layerCount) return 0;
  return realm.breakthroughPills;
}

/* ------------------------------------------------------------------ */

function simulate(config: SimConfig): Milestone[] {
  let state = createInitialState(0);
  let seconds = 0;
  let ascension = 0;
  const milestones: Milestone[] = [];

  const record = (label: string) => {
    milestones.push({ ascension, seconds, label, detail: snapshotDetail(state) });
  };

  record('开局');

  let budgetEnd = config.maxSeconds;
  let iterations = 0;

  while (seconds < budgetEnd && iterations++ < 400_000) {
    /* 1. 能参悟就参悟 */
    if (engine.canAdvanceLayer(state)) {
      state = engine.advanceLayer(state);
      continue;
    }

    /* 2. 能突破就突破 */
    if (engine.getBreakthroughStatus(state).possible) {
      const from = engine.getRealm(state).name;
      state = engine.breakthrough(state);
      const to = engine.getRealm(state).name;
      record(`${from} → ${to}`);

      if (engine.canAscend(state) && ascension < config.maxAscensions) {
        const gain = engine.getDaoYunGain(state);
        state = createAscendedState(state, gain, 0);
        ascension += 1;
        budgetEnd += config.secondsPerAscension;
        record(`飞升（+${fmt(gain)} 道韵）`);
      }
      continue;
    }

    /* 3. 挑购买目标 */
    const prices = shadowPrices(state);
    const needed = pillNeeded(state);
    const pillShort = needed > 0 && state.resources.pill.lt(needed);

    const unlocked = GENERATORS.filter((def) => engine.isUnlocked(def, state));

    // 丹药缺口优先
    if (pillShort) {
      const alchemy = unlocked.find((def) => def.produces === 'pill');
      if (alchemy) {
        const owned = state.generators[alchemy.id] ?? 0;
        const cost = engine.getCost(alchemy, owned, 1);
        if (engine.canAfford(cost, state.resources)) {
          state = engine.buyGenerator(state, alchemy, 1);
          continue;
        }
      }
    }

    // 买得起的里面挑回本最快的
    let best: { def: GeneratorDef; payback: number } | null = null;
    for (const def of unlocked) {
      if (def.produces === 'pill' && !pillShort) continue;
      const owned = state.generators[def.id] ?? 0;
      if (!engine.canAfford(engine.getCost(def, owned, 1), state.resources)) continue;
      const payback = paybackSeconds(state, def, prices);
      if (payback === Infinity) continue;
      if (!best || payback < best.payback) best = { def, payback };
    }

    if (best) {
      state = engine.buyGenerator(state, best.def, 1);
      continue;
    }

    /* 4. 都买不起：算下一件事什么时候能发生 */
    let waitSeconds = Infinity;
    for (const def of unlocked) {
      if (def.produces === 'pill' && !pillShort) continue;
      const owned = state.generators[def.id] ?? 0;
      const wait = secondsUntilAffordable(state, engine.getCost(def, owned, 1));
      if (wait !== null) waitSeconds = Math.min(waitSeconds, wait);
    }

    if (!Number.isFinite(waitSeconds)) {
      // 完全没有自动产出，只能手动打坐
      if (engine.getProduction(state).qi.gt(0)) break;
      const dt = 1 / config.clicksPerSecond;
      seconds += dt;
      state = engine.applyTick(state, dt);
      state = engine.meditate(state);
      continue;
    }

    const dt = Math.max(waitSeconds, 0.01);
    seconds += dt;
    state = engine.applyTick(state, dt);
  }

  return milestones;
}

/* ------------------------------------------------------------------ */

function main(): void {
  const started = Date.now();
  const milestones = simulate(CONFIG);
  const elapsed = Date.now() - started;

  console.log('仙途 · 数值模拟报告');
  console.log('='.repeat(76));
  console.log(
    `策略：回本最快优先，需要丹药时优先建丹房，无产出时每秒打坐 ${CONFIG.clicksPerSecond} 次`,
  );
  console.log(`模拟上限：${fmtDuration(CONFIG.maxSeconds)}`);
  console.log('');

  let lastKey = '';
  for (const m of milestones) {
    const key = `${m.ascension}`;
    if (key !== lastKey) {
      const title = m.ascension === 0 ? '第一世' : `第 ${m.ascension + 1} 世（已飞升 ${m.ascension} 次）`;
      console.log(`\n【${title}】`);
      lastKey = key;
    }
    console.log(`  ${fmtDuration(m.seconds).padStart(12)}  ${m.label}`);
    console.log(`  ${' '.repeat(12)}  ${m.detail}`);
  }

  console.log('');
  console.log('='.repeat(76));
  console.log(`模拟耗时 ${elapsed}ms`);

  const realmGaps = milestones.filter((m) => m.label.includes('→'));
  if (realmGaps.length > 0) {
    console.log('\n各境界耗时：');
    let previous = 0;
    for (const m of realmGaps) {
      const active = m.seconds - previous;
      console.log(`  ${m.label.padEnd(16)} 用时 ${fmtDuration(active)}（累计 ${fmtDuration(m.seconds)}）`);
      previous = m.seconds;
    }
  }
}

main();
