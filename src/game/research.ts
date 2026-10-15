/**
 * 钻研（需求 6）
 *
 * 一次只能钻研一项技术，需要先付材料、再等时间。
 * 钻研期间可以随时改钻研别的技术 —— 但已付的材料不退，
 * 这是刻意的：让"随手改主意"有代价，玩家才会认真规划。
 *
 * 技术是**建筑的前置条件**，所以这个模块只负责"技术有没有被钻研出来"，
 * 至于哪些建筑需要哪些技术，写在 content/buildables.ts 的 requiresTech 上。
 */
import {
  // 第 33 轮需求 5：钻研额外消耗天机点
  FATE_COST_RESEARCH_BASE,
  FATE_COST_RESEARCH_GROWTH,
  REALMS,
  TECH_MAP,
  type TechDef,
} from './content';
import { canAfford, payCost, toCostMap, type CostMap } from './engine';
import { pushJournal } from './disciples';
import type { GameState } from './state';

export interface ResearchCheck {
  ok: boolean;
  reason: string | null;
}

export function isTechResearched(state: GameState, id: string): boolean {
  return state.techs[id] === true;
}


/** 尚未满足的前置技术 */
export function missingPrereqs(state: GameState, def: TechDef): string[] {
  return def.requires.filter((id) => !isTechResearched(state, id)).map((id) => TECH_MAP[id]?.name ?? id);
}

/** 钻研该技术所需的消耗（Decimal 版） */
export function getTechCost(def: TechDef): CostMap {
  return toCostMap(def.cost);
}

/**
 * 界面可见性：境界差两级以上就不显示，避免一上来铺满看不完的科技树。
 * 这和建筑面板的规则一致（提前一级显示，让玩家看到下一个目标）。
 */
export function isTechVisible(state: GameState, def: TechDef): boolean {
  if (isTechResearched(state, def.id)) return true;
  return state.realmIndex + 1 >= def.requiresRealm;
}

export function canStartResearch(state: GameState, id: string): ResearchCheck {
  const def = TECH_MAP[id];
  if (!def) return { ok: false, reason: '无此技术' };
  if (isTechResearched(state, id)) return { ok: false, reason: '已掌握此术' };
  if (state.research?.id === id) return { ok: false, reason: '正在钻研此术' };

  const missing = missingPrereqs(state, def);
  if (missing.length > 0) return { ok: false, reason: `需先钻研「${missing.join('、')}」` };
  if (state.realmIndex < def.requiresRealm) {
    return { ok: false, reason: `需修至${REALMS[def.requiresRealm].name}` };
  }
  if (!canAfford(state, getTechCost(def))) return { ok: false, reason: '资源不足' };
  /*
   * 第 33 轮需求 5：钻研**额外**消耗天机点。
   *
   * 玩家原话：「钻研和领悟功法等增加消耗天机点的需求」。
   * 门槛按它要求的境界递增 —— 越深的技术越"逆天"，要的天机也越多。
   */
  const fate = researchFateCost(def);
  if (state.fatePoints < fate) {
    return { ok: false, reason: `需天机 ${fate} 点（现有 ${Math.floor(state.fatePoints)}）` };
  }
  return { ok: true, reason: null };
}

/** 钻研一项技术要多少天机点（第 33 轮需求 5） */
export function researchFateCost(def: TechDef): number {
  return FATE_COST_RESEARCH_BASE * FATE_COST_RESEARCH_GROWTH ** def.requiresRealm;
}

export function startResearch(state: GameState, id: string): GameState {
  const check = canStartResearch(state, id);
  if (!check.ok) return state;

  const def = TECH_MAP[id];
  const paid = { ...payCost(state, getTechCost(def)), fatePoints: state.fatePoints - researchFateCost(def) };

  return {
    ...paid,
    research: { id, remaining: def.seconds },
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'info',
      text: `开始钻研${def.name}`,
    }),
  };
}

/** 半途而废：已付的材料不退 */
export function cancelResearch(state: GameState): GameState {
  const active = state.research;
  if (!active) return state;

  const name = TECH_MAP[active.id]?.name ?? active.id;
  return {
    ...state,
    research: null,
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'bad',
      text: `${name}钻研中途作罢，所耗材料尽付东流`,
    }),
  };
}

/** 钻研进度 0~1 */
export function getResearchProgress(state: GameState): number {
  const active = state.research;
  if (!active) return 0;
  const total = TECH_MAP[active.id]?.seconds ?? 0;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - active.remaining / total));
}

/** 钻研计时；完成时把技术永久记入 state.techs */
export function tickResearch(state: GameState, dt: number): GameState {
  const active = state.research;
  if (!active || dt <= 0) return state;

  const remaining = active.remaining - dt;
  if (remaining > 0) return { ...state, research: { ...active, remaining } };

  const def = TECH_MAP[active.id];
  if (!def) return { ...state, research: null };

  return {
    ...state,
    research: null,
    techs: { ...state.techs, [def.id]: true },
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'good',
      text: `钻研有成：${def.name}`,
    }),
  };
}
