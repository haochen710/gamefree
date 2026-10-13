/**
 * 符箓：制作与使用（需求 8）
 *
 * 与炼丹 / 炼器共用**同一条成功率公式**（`crafting.getCraftSuccessRate`），
 * 所以丹炉、符房岗位、制符天赋、藏经阁的器物加成都自动作用在制符上 ——
 * 不需要为符箓再写一套概率规则。
 */
import { gameRandom, type RandomSource } from './random';
import {
  CRAFT_MASTER_GAP,
  TALISMAN_MAP,
  TALISMANS,
  TALISMAN_GRADE_NAMES,
  TALISMAN_SLOT_REQUIREMENT,
  TALISMAN_TIER_COST,
  type TalismanDef,
} from './content';
import { getAmount, payCost, toCostMap } from './engine';
import { pushJournal } from './disciples';
import type { GameState } from './state';

/* ------------------------------------------------------------------ */
/* 品阶                                                                */
/* ------------------------------------------------------------------ */

/** 制符品阶的升品条件（与炼丹 / 炼器同构：符房座数 + 材料 + 技术） */
export interface TalismanUpgradeStatus {
  nextTier: number | null;
  possible: boolean;
  reason: string | null;
  cost: Partial<Record<string, number>>;
  slotsNeeded: number;
  slotsHave: number;
}

export function getTalismanSlots(state: GameState): number {
  return state.buildings.talismanRoom ?? 0;
}

export function getTalismanUpgradeStatus(state: GameState): TalismanUpgradeStatus {
  const tier = state.talismanTier;
  const nextTier = tier >= 9 ? null : tier + 1;
  if (nextTier === null) {
    return { nextTier: null, possible: false, reason: '制符术已至九品', cost: {}, slotsNeeded: 0, slotsHave: getTalismanSlots(state) };
  }
  const cost = TALISMAN_TIER_COST[nextTier] ?? {};
  const slotsNeeded = TALISMAN_SLOT_REQUIREMENT[nextTier] ?? 0;
  const slotsHave = getTalismanSlots(state);
  if (slotsHave < slotsNeeded) {
    return {
      nextTier,
      possible: false,
      reason: `需 ${slotsNeeded} 座符房（现有 ${slotsHave}）`,
      cost,
      slotsNeeded,
      slotsHave,
    };
  }
  /*
   * ⚠️ 一律走 engine.getAmount：它同时认**资源**（灵气、灵草）与**材料**（妖丹、星砂）。
   * 第一版直接读 state.materials，而灵草是资源 —— 于是永远显示"材料不足"。
   */
  for (const [id, amount] of Object.entries(cost) as [string, number][]) {
    if (getAmount(state, id as never).lt(amount)) {
      return { nextTier, possible: false, reason: '材料不足', cost, slotsNeeded, slotsHave };
    }
  }
  return { nextTier, possible: true, reason: null, cost, slotsNeeded, slotsHave };
}

export function upgradeTalisman(state: GameState): GameState {
  const status = getTalismanUpgradeStatus(state);
  if (!status.possible || status.nextTier === null) return state;
  const paid = payCost(state, toCostMap(status.cost as never));
  if (paid === state) return state;
  return {
    ...paid,
    talismanTier: status.nextTier,
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'good',
      text: `制符术精进至 ${status.nextTier} 品`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 制作                                                                */
/* ------------------------------------------------------------------ */

export function canCraftTalisman(state: GameState, id: string): { ok: boolean; reason: string | null } {
  const def = TALISMAN_MAP[id];
  if (!def) return { ok: false, reason: '没有这张符' };
  if (state.talismanTier < def.grade) return { ok: false, reason: `需制符术 ${def.grade} 品` };
  for (const [item, amount] of Object.entries(def.cost) as [string, number][]) {
    if (getAmount(state, item as never).lt(amount)) return { ok: false, reason: '材料不足' };
  }
  return { ok: true, reason: null };
}

export interface CraftTalismanResult {
  state: GameState;
  made: number;
  failed: number;
  rate: number;
}

/**
 * 制符。
 *
 * 与炼丹同一条规则：**失败照样消耗材料**（`crafting` 那边立过的规矩），
 * 成功率由调用方传进来（界面用 `getCraftSuccessRate(state,'talisman',grade)`）。
 */
export function craftTalisman(
  state: GameState,
  id: string,
  count = 1,
  rate: number,
  random: RandomSource = gameRandom,
): CraftTalismanResult {
  const def = TALISMAN_MAP[id];
  if (!def) return { state, made: 0, failed: 0, rate };
  const check = canCraftTalisman(state, id);
  if (!check.ok) return { state, made: 0, failed: 0, rate };

  let working = state;
  let made = 0;
  let failed = 0;
  const times = Math.max(1, Math.floor(count));
  for (let i = 0; i < times; i += 1) {
    if (!canCraftTalisman(working, id).ok) break;
    const paid = payCost(working, toCostMap(def.cost as never));
    if (paid === working) break;
    working = paid;
    if (random() < rate) made += 1;
    else failed += 1;
  }

  if (made > 0) {
    working = { ...working, talismans: { ...working.talismans, [id]: (working.talismans[id] ?? 0) + made } };
  }
  if (made > 0 || failed > 0) {
    working = {
      ...working,
      journal: pushJournal(working.journal, {
        time: working.playTime,
        kind: made > 0 ? 'good' : 'bad',
        text: `绘制${def.name}：成 ${made} 张、废 ${failed} 张（成功率 ${Math.round(rate * 100)}%）`,
      }),
    };
  }
  return { state: working, made, failed, rate };
}

/* ------------------------------------------------------------------ */
/* 使用                                                                */
/* ------------------------------------------------------------------ */

export function getTalismanCount(state: GameState, id: string): number {
  return state.talismans[id] ?? 0;
}

/**
 * 用掉一张符。
 *
 * 三种效果各自挂在一条已有的线上（见 content/talismans.ts 的说明），
 * 这里只负责"扣一张 + 把效果写进 state"。
 */
export function useTalisman(state: GameState, id: string): { state: GameState; ok: boolean; message: string } {
  const def = TALISMAN_MAP[id];
  if (!def) return { state, ok: false, message: '没有这张符' };
  if (getTalismanCount(state, id) <= 0) return { state, ok: false, message: '没有存货' };

  let working: GameState = { ...state, talismans: { ...state.talismans, [id]: getTalismanCount(state, id) - 1 } };
  if ((working.talismans[id] ?? 0) <= 0) {
    const next = { ...working.talismans };
    delete next[id];
    working = { ...working, talismans: next };
  }

  let message = `已用 ${def.name}`;
  if (def.kind === 'spirit' && def.productionMult && def.productionSeconds) {
    // 同类增益取最强的一条（与丹药同一条规则，避免囤符叠加）
    working = {
      ...working,
      buffs: {
        ...working.buffs,
        productionMultiplier: Math.max(working.buffs.productionMultiplier, def.productionMult),
        productionSeconds: Math.max(working.buffs.productionSeconds, def.productionSeconds),
      },
    };
    message = `${def.name}生效：产量 ×${def.productionMult}，持续 ${Math.round(def.productionSeconds / 60)} 分钟`;
  } else if (def.kind === 'break' && def.breakthroughBonus) {
    // 破境符是累积的（与固本丹同一口径），因为它是**一次性消耗品**且有成本
    working = {
      ...working,
      globalBreakthroughBonus: Math.min(0.6, working.globalBreakthroughBonus + def.breakthroughBonus),
    };
    message = `${def.name}已焚：掌门突破成功率 +${Math.round(def.breakthroughBonus * 100)}%`;
  }

  working = {
    ...working,
    journal: pushJournal(working.journal, { time: working.playTime, kind: 'good', text: message }),
  };
  return { state: working, ok: true, message };
}

/** 界面用：库存里有几张符 */
export function getTalismanStock(state: GameState): { def: TalismanDef; count: number }[] {
  return TALISMANS.map((def) => ({ def, count: getTalismanCount(state, def.id) })).filter((e) => e.count > 0);
}

/** 界面用：按品阶分组的符箓配方 */
export function talismansByGrade(): { grade: number; name: string; list: TalismanDef[] }[] {
  return [1, 2, 3].map((grade) => ({
    grade,
    name: TALISMAN_GRADE_NAMES[grade],
    list: TALISMANS.filter((t) => t.grade === grade),
  }));
}

/** 界面上"相差三品必成"这条硬规则的说明（与炼丹炼器同一条） */
export const TALISMAN_MASTER_GAP = CRAFT_MASTER_GAP;
