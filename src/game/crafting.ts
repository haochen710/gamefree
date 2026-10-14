/**
 * 炼丹 / 炼器 / 服用丹药（需求 2 / 5）
 *
 * 品阶门禁是这套系统的骨架：
 *   炼丹品阶 N  → 需要 N 座丹房   → 需要更多灵气与灵木
 *   炼制 N 品丹 → 需要炼丹品阶 ≥ N → 需要秘境材料
 * 于是"盖丹房 → 提品阶 → 炼高阶丹 → 突破更高境界 → 闯更深秘境"
 * 形成一个自我强化的循环。
 */
import Decimal from './decimal';
import { gameRandom, type RandomSource } from './random';
import {
  ALCHEMY_SLOT_REQUIREMENT,
  ALCHEMY_TIER_COST,
  ALCHEMY_TIER_TECH,
  ARTIFACTS,
  ARTIFACT_MAP,
  // 第 27 轮（需求 3）：自动炼制的节拍与批量
  AUTO_CRAFT_BATCH,
  AUTO_CRAFT_INTERVAL_SECONDS,
  CRAFT_BASE_SUCCESS,
  CRAFT_MASTER_GAP,
  CRAFT_SUCCESS_FLOOR,
  CRAFT_MASTER_GAP_BONUS,
  MAX_CRAFT_TIER,
  MIND_MAX,
  PILLS,
  PILL_MAP,
  // 第 27 轮（需求 3）：自动炼制也要能画符（符箓 id 与丹药/器物同表不同册）
  TALISMAN_MAP,
  REFINING_SLOT_REQUIREMENT,
  REFINING_TIER_COST,
  REFINING_TIER_TECH,
  TECH_MAP,
  REALMS,
  nextAptitude,
  type Effect,
  type ItemId,
  type PillDef,
} from './content';
import {
  canAfford,
  getAlchemySlots,
  getAmount,
  getFarmTalentBonus,
  getRefiningSlots,
  getStructureBonus,
  addItem,
  getTraitEffect,
  grantQiSeconds,
  payCost,
  toCostMap,
  type CostMap,
} from './engine';
import { aptitudeRank, pushJournal, relieveDemonAll } from './disciples';
import { furnaceAlchemyBonus, furnaceBatchBonus, furnaceRefiningBonus } from './gear';
import { completeAllExpeditions } from './expeditions';
// 第 21 轮：派遣的四类加成（成功率 / 省料 / 增产 / 越阶）
import { getPostCostMultiplier, getPostEffect, getPostSalvage } from './posting';
// 第 27 轮（需求 3）：自动炼制里的符箓那一支（符箓的炼制在 talismans.ts）
import { craftTalisman } from './talismans';
import type { GameState } from './state';

/* ------------------------------------------------------------------ */
/* 数量工具                                                            */
/* ------------------------------------------------------------------ */

/**
 * 按倍率打折之后再付钱。两个来源一起作用（第 21 轮）：
 *   1. **在岗弟子的省料**（技艺 3 级起 + 越阶减免，见 posting.getPostCostMultiplier）；
 *   2. **省料类天赋**（惜药如金 / 惜料如命 / 惜墨如金，√人数，上限 −40%）。
 *
 * ⚠️ 只缩不放：最终倍率夹在 0.4~1 之间，永远不会"反向产出资源"。
 */
function scaleCostAsPay(state: GameState, cost: CostMap, multiplier: number): GameState {
  const safe = Math.max(0.4, Math.min(1, multiplier));
  if (safe >= 1) return payCost(state, cost);
  const scaled: CostMap = {};
  for (const [id, amount] of Object.entries(cost) as [ItemId, Decimal][]) {
    scaled[id] = amount.mul(safe);
  }
  return payCost(state, scaled);
}

/** 省料类天赋的总减免（√人数），封顶 −40% */
function talentCostReduction(state: GameState, target: 'alchemyCost' | 'refiningCost' | 'talismanCost'): number {
  return Math.min(0.4, getFarmTalentBonus(state, target));
}

export function getPillCount(state: GameState, id: string): number {
  return state.pills[id] ?? 0;
}

export function getArtifactCount(state: GameState, id: string): number {
  return state.artifacts[id] ?? 0;
}

/** 一份消耗最多能满足几次 */
export function maxCraftable(state: GameState, cost: CostMap): number {
  let max = Infinity;
  for (const [id, amount] of Object.entries(cost) as [ItemId, Decimal][]) {
    if (amount.lte(0)) continue;
    max = Math.min(max, getAmount(state, id).div(amount).floor().toNumber());
  }
  return Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
}

/* ------------------------------------------------------------------ */
/* 炼丹 / 炼器品阶                                                      */
/* ------------------------------------------------------------------ */

export interface TierUpgradeStatus {
  possible: boolean;
  reason: string | null;
  nextTier: number | null;
  cost: CostMap;
  slotsNeeded: number;
  slotsHave: number;
}

function tierUpgradeStatus(
  currentTier: number,
  slotRequirement: number[],
  tierCost: Record<number, Partial<Record<ItemId, number>>>,
  tierTech: Record<number, string>,
  slotsHave: number,
  state: GameState,
  label: string,
): TierUpgradeStatus {
  if (currentTier >= MAX_CRAFT_TIER) {
    return { possible: false, reason: `${label}已至九品`, nextTier: null, cost: {}, slotsNeeded: 0, slotsHave };
  }

  const nextTier = currentTier + 1;
  const slotsNeeded = slotRequirement[nextTier] ?? 0;
  const cost = toCostMap(tierCost[nextTier] ?? {});

  /*
   * 需求 6：升品要先钻研**对应等级的技术**。
   * 这一条排在最前面 —— 玩家最该先看到的阻碍是"道术没读到"，而不是"材料不够"，
   * 因为前者才是他要去做的下一件事。
   */
  const needTech = tierTech[nextTier];
  if (needTech && state.techs[needTech] !== true) {
    return {
      possible: false,
      reason: `需先钻研「${TECH_MAP[needTech]?.name ?? needTech}」`,
      nextTier,
      cost,
      slotsNeeded,
      slotsHave,
    };
  }

  if (slotsHave < slotsNeeded) {
    return {
      possible: false,
      reason: `需 ${slotsNeeded} 座${label === '炼丹术' ? '丹房' : '炼器房'}（现有 ${slotsHave}）`,
      nextTier,
      cost,
      slotsNeeded,
      slotsHave,
    };
  }
  if (!canAfford(state, cost)) {
    return { possible: false, reason: '材料不足', nextTier, cost, slotsNeeded, slotsHave };
  }
  return { possible: true, reason: null, nextTier, cost, slotsNeeded, slotsHave };
}

export function getAlchemyUpgradeStatus(state: GameState): TierUpgradeStatus {
  return tierUpgradeStatus(
    state.alchemyTier,
    ALCHEMY_SLOT_REQUIREMENT,
    ALCHEMY_TIER_COST,
    ALCHEMY_TIER_TECH,
    getAlchemySlots(state),
    state,
    '炼丹术',
  );
}

export function getRefiningUpgradeStatus(state: GameState): TierUpgradeStatus {
  return tierUpgradeStatus(
    state.refiningTier,
    REFINING_SLOT_REQUIREMENT,
    REFINING_TIER_COST,
    REFINING_TIER_TECH,
    getRefiningSlots(state),
    state,
    '炼器术',
  );
}

export function upgradeAlchemy(state: GameState): GameState {
  const status = getAlchemyUpgradeStatus(state);
  if (!status.possible || status.nextTier === null) return state;
  const paid = payCost(state, status.cost);
  return {
    ...paid,
    alchemyTier: status.nextTier,
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'good',
      text: `炼丹术精进至${status.nextTier}品`,
    }),
  };
}

export function upgradeRefining(state: GameState): GameState {
  const status = getRefiningUpgradeStatus(state);
  if (!status.possible || status.nextTier === null) return state;
  const paid = payCost(state, status.cost);
  return {
    ...paid,
    refiningTier: status.nextTier,
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'good',
      text: `炼器术精进至${status.nextTier}品`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 炼制                                                                */
/* ------------------------------------------------------------------ */

export interface CraftCheck {
  ok: boolean;
  reason: string | null;
}

export function canCraftPill(state: GameState, pillId: string): CraftCheck {
  const def = PILL_MAP[pillId];
  if (!def) return { ok: false, reason: '丹方不存在' };
  if (state.alchemyTier < def.tier) {
    return { ok: false, reason: `需炼丹术 ${def.tier} 品（现有 ${state.alchemyTier} 品）` };
  }
  if (!canAfford(state, toCostMap(def.cost))) return { ok: false, reason: '材料不足' };
  return { ok: true, reason: null };
}

/* ------------------------------------------------------------------ */
/* 炼制成功率（需求 2）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 炼制某个品阶的东西，这一次的成功率（0~1）。
 *
 * 规则完全按需求原文来：
 *   1. 「丹药和器物的等级越高，基础成功率越低」→ `CRAFT_BASE_SUCCESS[tier]`；
 *   2. 「炼制更低品阶的则有加成」→ 每低一品 +12%；
 *   3. 「**相差三个品阶的时候成功率达到百分百**」→ 差 ≥ 3 时**硬返回 1**，
 *      不是"算出来刚好接近 1"。这一点很重要：如果写成加法，
 *      以后一改基础成功率，那句"百分之百"就悄悄失效了。
 *   4. 丹炉阵 / 地火熔炉额外加成（`alchemySuccessBonus` / `refiningSuccessBonus`）；
 *   5. 弟子的**种田天赋**（炉火通灵 / 锻器巧手，设定集第 8.4 章）——
 *      按 √人数 给全宗加成，所以不会因为"招了一千个弟子"把成功率顶穿。
 */
export function getCraftSuccessRate(
  state: GameState,
  kind: 'alchemy' | 'refining' | 'talisman',
  targetTier: number,
): number {
  const own = kind === 'alchemy' ? state.alchemyTier : kind === 'refining' ? state.refiningTier : state.talismanTier;
  const gap = own - targetTier;

  // 需求明文：差三个品阶必定成功
  if (gap >= CRAFT_MASTER_GAP) return 1;

  const base = CRAFT_BASE_SUCCESS[Math.max(0, Math.min(MAX_CRAFT_TIER, targetTier))] ?? 1;
  const building =
    kind === 'alchemy'
      ? getStructureBonus(state, 'alchemySuccessBonus')
      : kind === 'refining'
        ? getStructureBonus(state, 'refiningSuccessBonus')
        : 0;
  /*
   * 生产天赋（√人数）与**派遣岗位**（需求 3 / 12）是两条独立加算线：
   *   天赋 = "你招到了什么人"，岗位 = "你把谁安排在了哪儿"。
   * 前者随人数递减，后者受岗位数封顶 —— 各有一道天花板。
   */
  const talentTarget = kind === 'alchemy' ? 'alchemyRate' : kind === 'refining' ? 'refiningRate' : 'talismanRate';
  const talent = getFarmTalentBonus(state, talentTarget);
  // 第 21 轮：派遣的成功率加成按**目标品阶**打折（低级弟子堆不动高级丹）
  const post = getPostEffect(state, kind, targetTier).success;
  // 丹炉九件（设定集第 11 章）：当前那口炉子的成功率加成（符箓不吃炉子）
  const furnace = kind === 'alchemy' ? furnaceAlchemyBonus(state) : kind === 'refining' ? furnaceRefiningBonus(state) : 0;
  // 丹鼎天成（先天特质）：炼丹成功率 +12%
  const trait = kind === 'alchemy' ? getTraitEffect(state, 'alchemyBonus', 0) : 0;
  const bonus = gap > 0 ? gap * CRAFT_MASTER_GAP_BONUS : 0;

  // 上限仍是 1（差两品也可能因为炉子好、弟子手巧而摸到满）
  // 第 22 轮：下限从 5% 降到 2%（否则九品 3% 的基础成功率会被夹住）
  return Math.max(CRAFT_SUCCESS_FLOOR, Math.min(1, base + bonus + building + talent + trait + furnace + post));
}

/** 界面用：说清楚"为什么会失败/为什么会必成" */
export function describeCraftRate(
  state: GameState,
  kind: 'alchemy' | 'refining' | 'talisman',
  targetTier: number,
): string {
  const own = kind === 'alchemy' ? state.alchemyTier : state.refiningTier;
  const rate = getCraftSuccessRate(state, kind, targetTier);
  if (own - targetTier >= CRAFT_MASTER_GAP) {
    return `成功率 100%（高出 ${own - targetTier} 品，已至必成）`;
  }
  return `成功率 ${Math.round(rate * 100)}%`;
}

export interface CraftResult {
  state: GameState;
  /** 实际炼成了几件 */
  made: number;
  /** 炸炉几次 */
  failed: number;
  /** 本次判定的成功率 */
  rate: number;
}

/**
 * 炼制丹药（需求 2：有概率失败）。
 *
 * 失败**照样消耗材料** —— 那是失败的代价，也是"成功率"这件事的意义所在。
 * 丹药本身没有使用次数，所以失败只影响这一次的产出。
 */
export function craftPill(
  state: GameState,
  pillId: string,
  count = 1,
  random: RandomSource = gameRandom,
): CraftResult {
  const def = PILL_MAP[pillId];
  if (!def) return { state, made: 0, failed: 0, rate: 0 };
  if (state.alchemyTier < def.tier) return { state, made: 0, failed: 0, rate: 0 };

  const unit = toCostMap(def.cost);
  const attempts = Math.min(count, maxCraftable(state, unit));
  if (attempts <= 0) return { state, made: 0, failed: 0, rate: 0 };

  const total: CostMap = {};
  for (const [id, amount] of Object.entries(unit) as [ItemId, Decimal][]) {
    total[id] = amount.mul(attempts);
  }
  /*
   * 第 21 轮：在岗弟子的**省料**与**越阶减免**直接作用在总消耗上 ——
   * 这是玩家点名要的第二类加成（"炼丹可以减少资源消耗"）。
   */
  const paid = scaleCostAsPay(
    state,
    total,
    getPostCostMultiplier(state, 'alchemy', def.tier) * (1 - talentCostReduction(state, 'alchemyCost')),
  );

  const rate = getCraftSuccessRate(state, 'alchemy', def.tier);
  let made = 0;
  for (let i = 0; i < attempts; i += 1) if (random() < rate) made += 1;
  const failed = attempts - made;
  /*
   * 第 22 轮：失败不是把材料全烧掉 —— 按"基础回收 + 弟子技艺回收"退回一部分。
   * 这是玩家说的"减少失败损耗"，也是后期低成功率下玩家真正的靠山。
   * ⚠️ 回收按**实付口径**算（乘上省料倍率），否则会"失败反而赚材料"。
   */
  const salvageRate = failed > 0 ? getPostSalvage(state, 'alchemy', def.tier) : 0;
  const salvage: CostMap = {};
  if (salvageRate > 0) {
    const paidMult = getPostCostMultiplier(state, 'alchemy', def.tier) * (1 - talentCostReduction(state, 'alchemyCost'));
    for (const [id, amount] of Object.entries(unit) as [ItemId, Decimal][]) {
      salvage[id] = amount.mul(failed).mul(paidMult).mul(salvageRate);
    }
  }

  /*
   * 丹炉的批量加成（设定集第 11 章）：成功的每一炉都有机会**多出一件**。
   * 这与"成功率"是两个不同的方向 —— 成功率决定成不成，批量决定成了之后多不多，
   * 所以九件炉鼎同时在两边给一点，才像"炉子好坏"而不只是"改了条概率"。
   */
  const batch = furnaceBatchBonus(state);
  // 丹鼎天成（先天特质）：丹药产出翻倍的概率 +10% —— 与丹炉的批量加成同一条线
  // 第 21 轮：在岗弟子的**增产**进双份概率（技艺 5 级起才解锁）
  // ⚠️ 同时接上「丹心妙手」这类批量天赋 —— 它原来是**死配置**（0 处读取）
  const doubleChance =
    batch +
    getTraitEffect(state, 'alchemyDoubleChance', 0) +
    getFarmTalentBonus(state, 'alchemyBatch') +
    getPostEffect(state, 'alchemy', def.tier).output;
  let bonus = 0;
  if (doubleChance > 0 && made > 0) {
    for (let i = 0; i < made; i += 1) if (random() < doubleChance) bonus += 1;
  }
  const produced = made + bonus;

  let next: GameState = paid;
  if (produced > 0) {
    next = { ...next, pills: { ...next.pills, [pillId]: (next.pills[pillId] ?? 0) + produced } };
  }
  // 第 22 轮：把失败那几炉回收的材料退回去
  if (salvageRate > 0 && failed > 0) {
    for (const [id, amount] of Object.entries(salvage) as [ItemId, Decimal][]) {
      next = addItem(next, id, amount);
    }
  }
  if (failed > 0) {
    next = {
      ...next,
      journal: pushJournal(next.journal, {
        time: next.playTime,
        kind: 'bad',
        text: `炼制${def.name}失败 ${failed} 次（成功率 ${Math.round(rate * 100)}%），回收了 ${Math.round(salvageRate * 100)}% 材料`,
      }),
    };
  }
  return { state: next, made, failed, rate };
}

/**
 * 自动炼制（第 27 轮需求 3）。
 *
 * 玩家原话：「炼丹和炼器、制符等也变成"炼制""自动炼制"」。
 *
 * ⚠️ 查证过：合成有 autoRefineTargets + engine.autoRefine 这一套，
 * 但三种炼制**原本没有任何自动机制** —— 所以不能只把按钮改名成"自动炼制"，
 * 那会做出一个点下去什么也不会发生的按钮。这里照着 autoRefine 的形状补一套：
 *
 *   - 目标存在 autoCraftTargets（键 = 丹药 / 器物 / 符箓 id），> 0 即开着；
 *   - 每 AUTO_CRAFT_INTERVAL_SECONDS 秒炼**一批**（autoCraftTimer 计时）；
 *   - 每批挑"**缺口最大、而且炼得动**"的那一条，补到目标就停手；
 *   - 与合成一样**不保留欠账**，否则资源一变多就会爆发式狂炼。
 *
 * ⚠️ 放在 crafting.ts 而不是 engine.ts：engine ← crafting 的依赖方向不能反
 * （engine 里拿不到这些炼制函数，反过来会成环）。
 */
export function autoCraft(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (dt <= 0) return state;
  const entries = Object.entries(state.autoCraftTargets).filter(([, target]) => target > 0);
  if (entries.length === 0) return state;

  const timer = state.autoCraftTimer + dt;
  if (timer < AUTO_CRAFT_INTERVAL_SECONDS) return { ...state, autoCraftTimer: timer };
  const next: GameState = { ...state, autoCraftTimer: 0 };

  const candidates = entries
    .map(([id, target]) => ({ id, short: target - craftStockOf(next, id) }))
    .filter((c) => c.short > 0)
    .filter((c) => maxCraftableOf(next, c.id) > 0)
    .sort((a, b) => b.short - a.short);

  const pick = candidates[0];
  if (!pick) return next;

  const batch = Math.max(1, Math.min(pick.short, maxCraftableOf(next, pick.id), AUTO_CRAFT_BATCH));
  if (PILL_MAP[pick.id]) return craftPill(next, pick.id, batch, random).state;
  if (ARTIFACT_MAP[pick.id]) return craftArtifact(next, pick.id, batch, random).state;
  if (TALISMAN_MAP[pick.id]) {
    // 符箓只有 1~3 品（字段叫 grade，不是 tier）
    const rate = getCraftSuccessRate(next, 'talisman', TALISMAN_MAP[pick.id].grade);
    return craftTalisman(next, pick.id, batch, rate, random).state;
  }
  return next;
}

/** 某个炼制品的现有库存（丹药 / 器物 / 符箓三表里查） */
export function craftStockOf(state: GameState, id: string): number {
  if (PILL_MAP[id]) return state.pills[id] ?? 0;
  if (ARTIFACT_MAP[id]) return state.artifacts[id] ?? 0;
  if (TALISMAN_MAP[id]) return state.talismans[id] ?? 0;
  return 0;
}

/** 某条炼制线现在最多能炼几个（取决于材料与品阶门槛） */
export function maxCraftableOf(state: GameState, id: string): number {
  if (PILL_MAP[id]) return maxCraftable(state, toCostMap(PILL_MAP[id].cost));
  if (ARTIFACT_MAP[id]) return maxCraftable(state, toCostMap(ARTIFACT_MAP[id].cost));
  if (TALISMAN_MAP[id]) return maxCraftable(state, toCostMap(TALISMAN_MAP[id].cost));
  return 0;
}

export function canCraftArtifact(state: GameState, artifactId: string): CraftCheck {
  const def = ARTIFACT_MAP[artifactId];
  if (!def) return { ok: false, reason: '器方不存在' };
  if (state.refiningTier < def.tier) {
    return { ok: false, reason: `需炼器术 ${def.tier} 品（现有 ${state.refiningTier} 品）` };
  }
  if (!canAfford(state, toCostMap(def.cost))) return { ok: false, reason: '材料不足' };
  return { ok: true, reason: null };
}

/**
 * 炼制器物（需求 2：有概率失败；可携带的器物带使用次数）。
 *
 * 成功时会把 `gearCharges` 设成它的满次数 —— 也就是"新炼出来的是满耐久"。
 * 旧的（用残了的）会被直接覆盖：同一件器物不堆叠耐久，简单且不会出现
 * "一堆 3/10 次的残件"那种账。
 */
export function craftArtifact(
  state: GameState,
  artifactId: string,
  count = 1,
  random: RandomSource = gameRandom,
): CraftResult {
  const def = ARTIFACT_MAP[artifactId];
  if (!def) return { state, made: 0, failed: 0, rate: 0 };
  if (state.refiningTier < def.tier) return { state, made: 0, failed: 0, rate: 0 };

  const unit = toCostMap(def.cost);
  const attempts = Math.min(count, maxCraftable(state, unit));
  if (attempts <= 0) return { state, made: 0, failed: 0, rate: 0 };

  const total: CostMap = {};
  for (const [id, amount] of Object.entries(unit) as [ItemId, Decimal][]) {
    total[id] = amount.mul(attempts);
  }
  const paid = scaleCostAsPay(
    state,
    total,
    getPostCostMultiplier(state, 'refining', def.tier) * (1 - talentCostReduction(state, 'refiningCost')),
  );

  const rate = getCraftSuccessRate(state, 'refining', def.tier);
  let made = 0;
  for (let i = 0; i < attempts; i += 1) if (random() < rate) made += 1;
  const failed = attempts - made;
  // 第 22 轮：失败回收（与炼丹同一口径 —— 按实付算，避免"失败反而赚"）
  const salvageRate = failed > 0 ? getPostSalvage(state, 'refining', def.tier) : 0;
  const salvage: CostMap = {};
  if (salvageRate > 0) {
    const paidMult = getPostCostMultiplier(state, 'refining', def.tier) * (1 - talentCostReduction(state, 'refiningCost'));
    for (const [id, amount] of Object.entries(unit) as [ItemId, Decimal][]) {
      salvage[id] = amount.mul(failed).mul(paidMult).mul(salvageRate);
    }
  }

  let next: GameState = paid;
  if (made > 0) {
    /*
     * 第 21/22 轮收尾：接上「火候精准」这类**批量**天赋（`refiningBatch`）。
     * ⚠️ 它以前是**死配置** —— 类型里声明了、描述也写了，但全仓库 0 处读取，
     * 也就是说那项天赋实际什么也没干。这里让它做"每一炉都有机会多出一件"。
     */
    const batchChance = Math.min(0.6, getFarmTalentBonus(state, 'refiningBatch'));
    let extra = 0;
    if (batchChance > 0) {
      for (let i = 0; i < made; i += 1) if (random() < batchChance) extra += 1;
    }
    next = { ...next, artifacts: { ...next.artifacts, [artifactId]: (next.artifacts[artifactId] ?? 0) + made + extra } };
    if (def.carry) {
      // 新炼出来的按满次数记（覆盖旧残件）
      next = { ...next, gearCharges: { ...next.gearCharges, [artifactId]: def.carry.charges } };
    }
  }
  if (salvageRate > 0) {
    for (const [id, amount] of Object.entries(salvage) as [ItemId, Decimal][]) {
      next = addItem(next, id, amount);
    }
  }
  if (failed > 0) {
    next = {
      ...next,
      journal: pushJournal(next.journal, {
        time: next.playTime,
        kind: 'bad',
        text: `炼制${def.name}失败 ${failed} 次（成功率 ${Math.round(rate * 100)}%），材料已耗`,
      }),
    };
  }
  return { state: next, made, failed, rate };
}

/** 某品阶下已解锁的丹方 / 器方（品阶从低到高，界面上按品阶分组用） */
export function getAvailablePills(state: GameState): PillDef[] {
  return PILLS.filter((p) => p.tier <= state.alchemyTier);
}

export function getAvailableArtifacts(state: GameState) {
  return ARTIFACTS.filter((a) => a.tier <= state.refiningTier);
}

/* ------------------------------------------------------------------ */
/* 服用丹药                                                            */
/* ------------------------------------------------------------------ */

/** 境界丹只能在突破时消耗，不能直接吃 */
export function isUsablePill(def: PillDef): boolean {
  return def.category !== 'breakthrough';
}

export interface UsePillResult {
  state: GameState;
  message: string;
}

export function canUsePill(state: GameState, pillId: string): CraftCheck {
  const def = PILL_MAP[pillId];
  if (!def) return { ok: false, reason: '丹药不存在' };
  if (!isUsablePill(def)) return { ok: false, reason: '该丹药只能在突破时服用' };
  if (getPillCount(state, pillId) <= 0) return { ok: false, reason: '没有此丹药' };

  if (def.effect.kind === 'aptitudeUp') {
    const upgradable = state.sect.disciples.some((d) => d.aptitude !== 'heaven');
    if (!upgradable) return { ok: false, reason: '已无弟子可提升资质' };
  }
  return { ok: true, reason: null };
}

function applyEffect(state: GameState, effect: Effect, random: () => number): UsePillResult {
  const buffs = { ...state.buffs };

  switch (effect.kind) {
    case 'productionBuff': {
      buffs.productionMultiplier = Math.max(buffs.productionMultiplier, effect.multiplier);
      buffs.productionSeconds = Math.max(buffs.productionSeconds, effect.duration);
      return { state: { ...state, buffs }, message: `产量提升至 ${effect.multiplier} 倍` };
    }

    case 'restoreMind':
      return { state: { ...state, mind: MIND_MAX, mindProgress: 0 }, message: '心神已满' };

    case 'grantQiSeconds': {
      const before = state.resources.qi;
      const next = grantQiSeconds(state, effect.seconds);
      const gained = next.resources.qi.sub(before);
      return { state: next, message: `顿悟，获得 ${gained.toString()} 灵气` };
    }

    case 'aptitudeUp': {
      // 挑资质最低的那名弟子提升一档
      const candidates = state.sect.disciples.filter((d) => d.aptitude !== 'heaven');
      if (candidates.length === 0) return { state, message: '已无弟子可提升资质' };
      candidates.sort((a, b) => aptitudeRank(a.aptitude) - aptitudeRank(b.aptitude));
      const target = candidates[0];
      const upgraded = nextAptitude(target.aptitude);

      return {
        state: {
          ...state,
          sect: {
            ...state.sect,
            disciples: state.sect.disciples.map((d) =>
              d.id === target.id ? { ...d, aptitude: upgraded } : d,
            ),
          },
        },
        message: `${target.name} 洗髓成功，资质大进`,
      };
    }

    case 'relieveDemon': {
      const next = relieveDemonAll(state, effect.amount);
      if (next === state) return { state, message: '尚无弟子，无人需要静心' };
      return { state: next, message: `全宗弟子心魔 −${effect.amount}` };
    }

    case 'lifespanBonus':
      return {
        state: { ...state, sect: { ...state.sect, lifespanBonus: state.sect.lifespanBonus + effect.amount } },
        message: `全体弟子寿元提升 ${Math.round(effect.amount * 100)}%`,
      };

    case 'breakthroughBonus':
      return {
        state: { ...state, globalBreakthroughBonus: state.globalBreakthroughBonus + effect.amount },
        message: `突破成功率永久 +${Math.round(effect.amount * 100)}%`,
      };

    case 'completeLayers': {
      const realm = REALMS[state.realmIndex];
      if (state.layer >= realm.layerCount) return { state, message: '当前境界已圆满' };
      return {
        state: { ...state, layer: realm.layerCount },
        message: `${realm.name}圆满`,
      };
    }

    case 'expeditionPower': {
      buffs.powerMultiplier = Math.max(buffs.powerMultiplier, effect.multiplier);
      buffs.powerSeconds = Math.max(buffs.powerSeconds, effect.duration);
      return { state: { ...state, buffs }, message: `弟子战力提升至 ${effect.multiplier} 倍` };
    }

    case 'expeditionSafety': {
      buffs.safetyReduction = Math.max(buffs.safetyReduction, effect.reduction);
      // 需求 2 的保命丹是"按次"的：不设时限，等下一次探索把它用掉
      if ('once' in effect) {
        buffs.safetyOnce = true;
        return {
          state: { ...state, buffs },
          message: `下一次探索伤亡率降低 ${Math.round(effect.reduction * 100)}%`,
        };
      }
      buffs.safetySeconds = Math.max(buffs.safetySeconds, effect.duration);
      return { state: { ...state, buffs }, message: `探索伤亡率降低 ${Math.round(effect.reduction * 100)}%` };
    }

    case 'expeditionSpeed': {
      buffs.speedMultiplier = Math.max(buffs.speedMultiplier, effect.multiplier);
      buffs.speedSeconds = Math.max(buffs.speedSeconds, effect.duration);
      return { state: { ...state, buffs }, message: `探索速度提升至 ${effect.multiplier} 倍` };
    }

    case 'expeditionYield': {
      buffs.yieldMultiplier = Math.max(buffs.yieldMultiplier, effect.multiplier);
      buffs.yieldSeconds = Math.max(buffs.yieldSeconds, effect.duration);
      return { state: { ...state, buffs }, message: `秘境产出提升至 ${effect.multiplier} 倍` };
    }

    case 'completeExpeditions': {
      if (state.expeditions.length === 0) return { state, message: '当前没有进行中的探索' };
      const next = completeAllExpeditions(state, random);
      return { state: next, message: '诸方探索即刻功成' };
    }

    default:
      return { state, message: '' };
  }
}

export function usePill(state: GameState, pillId: string, random: RandomSource = gameRandom): UsePillResult {
  const check = canUsePill(state, pillId);
  if (!check.ok) return { state, message: check.reason ?? '无法服用' };

  const def = PILL_MAP[pillId];
  const count = getPillCount(state, pillId);
  const pills = { ...state.pills };
  if (count > 1) pills[pillId] = count - 1;
  else delete pills[pillId];

  const consumed: GameState = { ...state, pills };
  const result = applyEffect(consumed, def.effect, random);

  return {
    state: {
      ...result.state,
      journal: pushJournal(result.state.journal, {
        time: result.state.playTime,
        kind: 'info',
        text: `服用${def.name}：${result.message}`,
      }),
    },
    message: result.message,
  };
}
