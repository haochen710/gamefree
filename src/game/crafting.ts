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
import {
  ALCHEMY_SLOT_REQUIREMENT,
  ALCHEMY_TIER_COST,
  ARTIFACTS,
  ARTIFACT_MAP,
  MAX_CRAFT_TIER,
  MIND_MAX,
  PILLS,
  PILL_MAP,
  REFINING_SLOT_REQUIREMENT,
  REFINING_TIER_COST,
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
  getRefiningSlots,
  grantQiSeconds,
  payCost,
  toCostMap,
  type CostMap,
} from './engine';
import { aptitudeRank, pushJournal } from './disciples';
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

export function craftPill(state: GameState, pillId: string, count = 1): GameState {
  const def = PILL_MAP[pillId];
  if (!def) return state;
  if (state.alchemyTier < def.tier) return state;

  const unit = toCostMap(def.cost);
  const actual = Math.min(count, maxCraftable(state, unit));
  if (actual <= 0) return state;

  const total: CostMap = {};
  for (const [id, amount] of Object.entries(unit) as [ItemId, Decimal][]) {
    total[id] = amount.mul(actual);
  }

  const paid = payCost(state, total);
  return {
    ...paid,
    pills: { ...paid.pills, [pillId]: (paid.pills[pillId] ?? 0) + actual },
  };
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

export function craftArtifact(state: GameState, artifactId: string, count = 1): GameState {
  const def = ARTIFACT_MAP[artifactId];
  if (!def) return state;
  if (state.refiningTier < def.tier) return state;

  const unit = toCostMap(def.cost);
  const actual = Math.min(count, maxCraftable(state, unit));
  if (actual <= 0) return state;

  const total: CostMap = {};
  for (const [id, amount] of Object.entries(unit) as [ItemId, Decimal][]) {
    total[id] = amount.mul(actual);
  }

  const paid = payCost(state, total);
  return {
    ...paid,
    artifacts: { ...paid.artifacts, [artifactId]: (paid.artifacts[artifactId] ?? 0) + actual },
  };
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

export function usePill(state: GameState, pillId: string, random: () => number = Math.random): UsePillResult {
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
