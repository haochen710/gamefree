/**
 * 种植（需求 5）
 *
 * 一块地种一颗种子，长够时间就成熟，玩家手动收获。
 *
 * 为什么是**手动**收获而不是自动：
 *   挂机 8 小时后自动收获会把几十块地的产出一次性塞进材料栏，
 *   玩家完全看不到发生了什么；而且会绕过"记得回来收"这个放置游戏的基本节奏。
 *   手动收获配合「一键收获」按钮，既不烦人，也让每次回来都有事可做。
 *
 * 催熟（需求 5 明文）：花灵气或灵石立刻推进一段生长进度。
 * 两种货币的性价比刻意不同，见 content/planting.ts。
 */
import { D } from './decimal';
import {
  HASTEN_QI_SECONDS,
  HASTEN_STONE_SECONDS,
  MATERIAL_MAP,
  SEED_MAP,
  hastenQiCost,
  hastenStoneCost,
  isBasicMaterial,
  type MaterialId,
  type SeedDef,
} from './content';
import { addItem, getPlotCapacity } from './engine';
import { getEnvironmentMaterialBonus } from './season';
import { getElementMaterialBonus } from './enlightenment';
import { pushJournal } from './disciples';
import { gameRandom, randomId, type RandomSource } from './random';
import type { GameState, Planting } from './state';


export type HastenCurrency = 'qi' | 'stone';

/* ------------------------------------------------------------------ */
/* 种子                                                                */
/* ------------------------------------------------------------------ */

export function getSeedCount(state: GameState, material: MaterialId): number {
  return state.seeds[material] ?? 0;
}

export function addSeeds(state: GameState, material: MaterialId, amount: number): GameState {
  const add = Math.floor(amount);
  if (add <= 0) return state;
  return { ...state, seeds: { ...state.seeds, [material]: (state.seeds[material] ?? 0) + add } };
}

/** 玩家手里所有种子（用于界面列表，按稀有度排序） */
export function getOwnedSeeds(state: GameState): { seed: SeedDef; count: number }[] {
  return (Object.keys(SEED_MAP) as MaterialId[])
    .map((material) => ({ seed: SEED_MAP[material], count: getSeedCount(state, material) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => a.seed.rarity - b.seed.rarity);
}

/* ------------------------------------------------------------------ */
/* 地块                                                                */
/* ------------------------------------------------------------------ */

export function getUsedPlots(state: GameState): number {
  return state.plantings.length;
}

export function getFreePlots(state: GameState): number {
  return Math.max(0, getPlotCapacity(state) - getUsedPlots(state));
}

export function getPlantingProgress(planting: Planting): number {
  if (planting.duration <= 0) return 1;
  return Math.min(1, Math.max(0, planting.progress / planting.duration));
}

export function isPlantingReady(planting: Planting): boolean {
  return planting.progress >= planting.duration;
}

export function getReadyPlantings(state: GameState): Planting[] {
  return state.plantings.filter(isPlantingReady);
}

export interface PlantCheck {
  ok: boolean;
  reason: string | null;
}

export function canPlant(state: GameState, material: MaterialId): PlantCheck {
  const seed = SEED_MAP[material];
  if (!seed) return { ok: false, reason: '没有这种种子' };
  if (getSeedCount(state, material) <= 0) return { ok: false, reason: `没有${seed.name}` };
  if (getPlotCapacity(state) <= 0) return { ok: false, reason: '尚无地块，需先建灵植园' };
  if (getFreePlots(state) <= 0) return { ok: false, reason: '地块已满，先收获或扩建' };
  return { ok: true, reason: null };
}

export function plantSeed(
  state: GameState,
  material: MaterialId,
  random: RandomSource = gameRandom,
): GameState {
  if (!canPlant(state, material).ok) return state;

  const seed = SEED_MAP[material];
  const count = getSeedCount(state, material);
  const seeds = { ...state.seeds };
  if (count > 1) seeds[material] = count - 1;
  else delete seeds[material];

  const planting: Planting = {
    id: randomId('p', random),
    material,
    progress: 0,
    duration: seed.growSeconds,
  };

  return {
    ...state,
    seeds,
    plantings: [...state.plantings, planting],
    nextPlantingId: state.nextPlantingId + 1,
  };
}

/** 一次性把手上所有种子种下（种到地满为止） */
export function plantAll(state: GameState, random: RandomSource = gameRandom): GameState {
  let working = state;
  const materials = getOwnedSeeds(state).map((entry) => entry.seed.material);

  for (const material of materials) {
    while (canPlant(working, material).ok && getSeedCount(working, material) > 0) {
      const next = plantSeed(working, material, random);
      if (next === working) break;
      working = next;
    }
  }
  return working;
}

/* ------------------------------------------------------------------ */
/* 生长与收获                                                          */
/* ------------------------------------------------------------------ */

export function tickPlantings(state: GameState, dt: number): GameState {
  if (state.plantings.length === 0 || dt <= 0) return state;

  let changed = false;
  const plantings = state.plantings.map((planting) => {
    if (planting.progress >= planting.duration) return planting;
    changed = true;
    return { ...planting, progress: Math.min(planting.duration, planting.progress + dt) };
  });

  return changed ? { ...state, plantings } : state;
}

export interface HarvestGain {
  material: MaterialId;
  name: string;
  icon: string;
  amount: number;
}

export interface HarvestResult {
  state: GameState;
  gains: HarvestGain[];
}

/** 收获一块地 */
export function harvestPlanting(state: GameState, id: string): HarvestResult {
  const planting = state.plantings.find((p) => p.id === id);
  if (!planting || !isPlantingReady(planting)) return { state, gains: [] };

  const seed = SEED_MAP[planting.material];
  // 季节与天象会改变基础材料的收成（需求 1）：春天种灵草比冬天多收四成多。
  // 需求 3 的五行感悟是另一个独立乘区 —— 修了木之道，灵草收成再上一截。
  const seasonal = isBasicMaterial(planting.material)
    ? Math.max(0, 1 + getEnvironmentMaterialBonus(state, planting.material)) *
      (1 + getElementMaterialBonus(state, planting.material))
    : 1;
  const amount = Math.max(1, Math.floor((seed?.yield ?? 1) * seasonal));
  const def = MATERIAL_MAP[planting.material];

  let next = addItem(state, planting.material, D(amount));
  next = { ...next, plantings: next.plantings.filter((p) => p.id !== id) };

  return {
    state: next,
    gains: [{ material: planting.material, name: def?.name ?? planting.material, icon: def?.icon ?? '?', amount }],
  };
}

/** 一键收获所有成熟的地块，并把同类产物合并 */
export function harvestAll(state: GameState): HarvestResult {
  const ready = getReadyPlantings(state);
  if (ready.length === 0) return { state, gains: [] };

  let working = state;
  const merged = new Map<MaterialId, HarvestGain>();

  for (const planting of ready) {
    const result = harvestPlanting(working, planting.id);
    working = result.state;
    for (const gain of result.gains) {
      const existing = merged.get(gain.material);
      if (existing) existing.amount += gain.amount;
      else merged.set(gain.material, { ...gain });
    }
  }

  const gains = [...merged.values()];
  const summary = gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ');

  return {
    state: {
      ...working,
      journal: pushJournal(working.journal, {
        time: working.playTime,
        kind: 'good',
        text: `灵植成熟：${summary}`,
      }),
    },
    gains,
  };
}

/* ------------------------------------------------------------------ */
/* 催熟                                                                */
/* ------------------------------------------------------------------ */

export interface HastenCheck {
  ok: boolean;
  reason: string | null;
  cost: number;
  seconds: number;
}

export function canHasten(
  state: GameState,
  id: string,
  currency: HastenCurrency,
): HastenCheck {
  const planting = state.plantings.find((p) => p.id === id);
  if (!planting) return { ok: false, reason: '地块不存在', cost: 0, seconds: 0 };
  if (isPlantingReady(planting)) return { ok: false, reason: '已经成熟了', cost: 0, seconds: 0 };

  const rarity = SEED_MAP[planting.material]?.rarity ?? 1;
  const cost = currency === 'qi' ? hastenQiCost(rarity) : hastenStoneCost(rarity);
  const seconds = currency === 'qi' ? HASTEN_QI_SECONDS : HASTEN_STONE_SECONDS;

  const have = currency === 'qi' ? state.resources.qi : state.resources.stone;
  if (have.lt(cost)) {
    return { ok: false, reason: currency === 'qi' ? '灵气不足' : '灵石不足', cost, seconds };
  }
  return { ok: true, reason: null, cost, seconds };
}

export interface HastenResult {
  state: GameState;
  message: string;
}

/** 催熟一块地：按当前稀有度扣钱，立刻推进一段生长进度 */
export function hastenPlanting(
  state: GameState,
  id: string,
  currency: HastenCurrency,
): HastenResult {
  const check = canHasten(state, id, currency);
  if (!check.ok) return { state, message: check.reason ?? '无法催熟' };

  const planting = state.plantings.find((p) => p.id === id);
  if (!planting) return { state, message: '地块不存在' };

  const resources = { ...state.resources };
  if (currency === 'qi') resources.qi = resources.qi.sub(check.cost);
  else resources.stone = resources.stone.sub(check.cost);

  const progress = Math.min(planting.duration, planting.progress + check.seconds);
  const plantings = state.plantings.map((p) => (p.id === id ? { ...p, progress } : p));
  const def = MATERIAL_MAP[planting.material];

  return {
    state: { ...state, resources, plantings },
    message: `以${currency === 'qi' ? '灵气' : '灵石'}催熟${def?.name ?? ''}，长了 ${check.seconds} 秒`,
  };
}

/** 界面上显示「还差多久成熟」 */
export function getPlantingRemaining(planting: Planting): number {
  return Math.max(0, planting.duration - planting.progress);
}


