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
  CRAFT_BASE_SUCCESS,
  CRAFT_MASTER_GAP,
  CRAFT_MASTER_GAP_BONUS,
  MAX_CRAFT_TIER,
  MIND_MAX,
  PILLS,
  PILL_MAP,
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
  getPostBonusHere,
  getTraitEffect,
  grantQiSeconds,
  payCost,
  toCostMap,
  type CostMap,
} from './engine';
import { aptitudeRank, pushJournal, relieveDemonAll } from './disciples';
import { furnaceAlchemyBonus, furnaceBatchBonus, furnaceRefiningBonus } from './gear';
import { completeAllExpeditions } from './expeditions';
import type { GameState } from './state';

/* ------------------------------------------------------------------ */
/* 数量工具                                                            */
/* ------------------------------------------------------------------ */

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
export function getCraftSuccessRate(state: GameState, kind: 'alchemy' | 'refining', targetTier: number): number {
  const own = kind === 'alchemy' ? state.alchemyTier : state.refiningTier;
  const gap = own - targetTier;

  // 需求明文：差三个品阶必定成功
  if (gap >= CRAFT_MASTER_GAP) return 1;

  const base = CRAFT_BASE_SUCCESS[Math.max(0, Math.min(MAX_CRAFT_TIER, targetTier))] ?? 1;
  const building =
    kind === 'alchemy'
      ? getStructureBonus(state, 'alchemySuccessBonus')
      : getStructureBonus(state, 'refiningSuccessBonus');
  /*
   * 生产天赋（√人数）与**派遣岗位**（需求 3 / 12）是两条独立加算线：
   *   天赋 = "你招到了什么人"，岗位 = "你把谁安排在了哪儿"。
   * 前者随人数递减，后者受岗位数封顶 —— 各有一道天花板。
   */
  const talent = getFarmTalentBonus(state, kind === 'alchemy' ? 'alchemyRate' : 'refiningRate');
  const post = getPostBonusHere(state, kind);
  // 丹炉九件（设定集第 11 章）：当前那口炉子的成功率加成
  const furnace = kind === 'alchemy' ? furnaceAlchemyBonus(state) : furnaceRefiningBonus(state);
  // 丹鼎天成（先天特质）：炼丹成功率 +12%
  const trait = kind === 'alchemy' ? getTraitEffect(state, 'alchemyBonus', 0) : 0;
  const bonus = gap > 0 ? gap * CRAFT_MASTER_GAP_BONUS : 0;

  // 上限仍是 1（差两品也可能因为炉子好、弟子手巧而摸到满）
  return Math.max(0.05, Math.min(1, base + bonus + building + talent + trait + furnace + post));
}

/** 界面用：说清楚"为什么会失败/为什么会必成" */
export function describeCraftRate(state: GameState, kind: 'alchemy' | 'refining', targetTier: number): string {
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
  const paid = payCost(state, total);

  const rate = getCraftSuccessRate(state, 'alchemy', def.tier);
  let made = 0;
  for (let i = 0; i < attempts; i += 1) if (random() < rate) made += 1;
  const failed = attempts - made;

  /*
   * 丹炉的批量加成（设定集第 11 章）：成功的每一炉都有机会**多出一件**。
   * 这与"成功率"是两个不同的方向 —— 成功率决定成不成，批量决定成了之后多不多，
   * 所以九件炉鼎同时在两边给一点，才像"炉子好坏"而不只是"改了条概率"。
   */
  const batch = furnaceBatchBonus(state);
  // 丹鼎天成（先天特质）：丹药产出翻倍的概率 +10% —— 与丹炉的批量加成同一条线
  const doubleChance = batch + getTraitEffect(state, 'alchemyDoubleChance', 0);
  let bonus = 0;
  if (doubleChance > 0 && made > 0) {
    for (let i = 0; i < made; i += 1) if (random() < doubleChance) bonus += 1;
  }
  const produced = made + bonus;

  let next: GameState = paid;
  if (produced > 0) {
    next = { ...next, pills: { ...next.pills, [pillId]: (next.pills[pillId] ?? 0) + produced } };
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
  const paid = payCost(state, total);

  const rate = getCraftSuccessRate(state, 'refining', def.tier);
  let made = 0;
  for (let i = 0; i < attempts; i += 1) if (random() < rate) made += 1;
  const failed = attempts - made;

  let next: GameState = paid;
  if (made > 0) {
    next = { ...next, artifacts: { ...next.artifacts, [artifactId]: (next.artifacts[artifactId] ?? 0) + made } };
    if (def.carry) {
      // 新炼出来的按满次数记（覆盖旧残件）
      next = { ...next, gearCharges: { ...next.gearCharges, [artifactId]: def.carry.charges } };
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
