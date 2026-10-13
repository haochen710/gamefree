/**
 * 空间禁制（需求 6）
 *
 * 需求原文：「玩家感悟**空间大道**后，可以对库房类建筑施加增益」。
 *
 * 口径（与用户确认）：**主动施加、可叠加、逐次变贵**。
 *   - 门槛：空间大道感悟等级 ≥ 1（`state.daoLevels.spatial`）；
 *   - 花灵气 + 灵矿 + 星砂，给**某一座库房**永久 +25% 容量；
 *   - 同一座可以反复施加，第 n 次的花费按 2.1^n 递增。
 *
 * 为什么不做成"被动全局加成"：
 *   需求说的是"对库房类建筑**施加**增益"—— 施加是一个动作。
 *   而且逐座施加才有取舍：你是把禁制堆在灵气库上（灵气是主瓶颈），
 *   还是摊开到五种专库上？（需求 10 拆库之后，这个取舍会更明显。）
 */
import {
  SPATIAL_WARD_BASE_COST,
  SPATIAL_WARD_CAPACITY_BONUS,
  SPATIAL_WARD_COST_GROWTH,
  SPATIAL_WARD_MAX_STACKS,
  STORAGE_BUILDINGS,
} from './content';
import { getAmount, getSpatialWardBonus, payCost, toCostMap } from './engine';
import { pushJournal } from './disciples';
import { getEnlightenLevel } from './enlightenment';
import type { GameState } from './state';

/** 库房类建筑的 id 清单（需求 10 拆库之后仍然是这些） */
export const STORAGE_BUILDING_IDS: string[] = STORAGE_BUILDINGS.map((b) => b.id);

/** 这一座是不是库房 */
export function isStorageBuilding(buildingId: string): boolean {
  return STORAGE_BUILDING_IDS.includes(buildingId);
}

/** 空间禁制至少需要几级空间大道 */
export const SPATIAL_WARD_REQUIRED_DAO_LEVEL = 1;

/** 第 n 次施加（n 从 0 开始）的花费 */
export function getWardCost(state: GameState, buildingId: string): Record<string, number> {
  const stacks = state.spatialWards[buildingId] ?? 0;
  const mult = Math.pow(SPATIAL_WARD_COST_GROWTH, stacks);
  const out: Record<string, number> = {};
  for (const [id, amount] of Object.entries(SPATIAL_WARD_BASE_COST)) {
    out[id] = amount * mult;
  }
  return out;
}

export interface WardCheck {
  ok: boolean;
  reason: string | null;
  stacks: number;
  cost: Record<string, number>;
}

export function canApplyWard(state: GameState, buildingId: string): WardCheck {
  const stacks = state.spatialWards[buildingId] ?? 0;
  const cost = getWardCost(state, buildingId);

  if (!isStorageBuilding(buildingId)) {
    return { ok: false, reason: '只能对库房类建筑施加', stacks, cost };
  }
  if ((state.buildings[buildingId] ?? 0) <= 0) {
    return { ok: false, reason: '还没有这座库房', stacks, cost };
  }
  const daoLevel = getEnlightenLevel(state, 'spatial');
  if (daoLevel < SPATIAL_WARD_REQUIRED_DAO_LEVEL) {
    return {
      ok: false,
      reason: `需先感悟空间大道（当前 ${daoLevel} 级）`,
      stacks,
      cost,
    };
  }
  if (stacks >= SPATIAL_WARD_MAX_STACKS) {
    return { ok: false, reason: `此库房的禁制已至 ${SPATIAL_WARD_MAX_STACKS} 层（上限）`, stacks, cost };
  }
  for (const [item, amount] of Object.entries(cost)) {
    if (getAmount(state, item as never).lt(amount)) {
      return { ok: false, reason: '材料不足', stacks, cost };
    }
  }
  return { ok: true, reason: null, stacks, cost };
}

/** 施加一层空间禁制 */
export function applyWard(state: GameState, buildingId: string): GameState {
  const check = canApplyWard(state, buildingId);
  if (!check.ok) return state;
  const paid = payCost(state, toCostMap(check.cost as never));
  if (paid === state) return state;
  const stacks = (paid.spatialWards[buildingId] ?? 0) + 1;
  const buildingName = STORAGE_BUILDINGS.find((b) => b.id === buildingId)?.name ?? buildingId;
  return {
    ...paid,
    spatialWards: { ...paid.spatialWards, [buildingId]: stacks },
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'good',
      text: `以空间禁制扩充${buildingName}（第 ${stacks} 层，容量 +${Math.round(stacks * SPATIAL_WARD_CAPACITY_BONUS * 100)}%）`,
    }),
  };
}

/** 界面用：所有已建库房的禁制状态 */
export function getWardOverview(state: GameState): {
  id: string;
  name: string;
  icon: string;
  count: number;
  stacks: number;
  bonus: number;
  cost: Record<string, number>;
  ok: boolean;
  reason: string | null;
}[] {
  return STORAGE_BUILDINGS.filter((b) => (state.buildings[b.id] ?? 0) > 0).map((b) => {
    const check = canApplyWard(state, b.id);
    return {
      id: b.id,
      name: b.name,
      icon: b.icon,
      count: state.buildings[b.id] ?? 0,
      stacks: check.stacks,
      bonus: getSpatialWardBonus(state, b.id),
      cost: check.cost,
      ok: check.ok,
      reason: check.reason,
    };
  });
}
