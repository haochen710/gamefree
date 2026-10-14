/**
 * 感悟的逻辑（需求 3）
 *
 * 内容表在 `content/enlightenment.ts`，这里只放判定与结算。
 *
 * 三条线的效果各不相同：
 *   - **五行**：直接乘在对应基础材料的产出上（走 `getEnvironmentMaterialBonus`
 *     之外的另一条乘区，所以能和季节叠乘）；
 *   - **时间**：不直接给产出，而是给"一次结算一大段时间"的能力；
 *   - **空间**：给探索产出加成（弟子、普通探索、掌门亲往都算）。
 */
import { D } from './decimal';
import {
  ENLIGHTEN_PATHS,
  ENLIGHTEN_PATH_MAP,
  ELEMENT_BONUS_PER_LEVEL,
  MAX_ENLIGHTEN_LEVEL,
  MAX_SPACE_RINGS,
  SPACE_BONUS_PER_LEVEL,
  SPACE_RING_BONUS,
  TIME_JUMP_COOLDOWN_YEARS,
  enlightenCost,
  enlightenSeconds,
  spaceRingCost,
  timeJumpYears,
  type EnlightenPathDef,
} from './content/enlightenment';
import { ITEM_MAP, SECONDS_PER_GAME_YEAR, type ItemId, type MaterialId } from './content';
import { addItem, getAmount, payCost, type CostMap } from './engine';
import { pushJournal } from './disciples';
import type { GameState } from './state';

/* ------------------------------------------------------------------ */
/* 读取                                                                */
/* ------------------------------------------------------------------ */

export function getEnlightenLevel(state: GameState, pathId: string): number {
  return Math.max(0, Math.min(MAX_ENLIGHTEN_LEVEL, state.enlightenment[pathId] ?? 0));
}

/** 这个模块开了没有（需求：元婴期后解锁） */
export function isEnlightenmentUnlocked(state: GameState): boolean {
  return state.realmIndex >= 3;
}

/** 某条道解锁了没有 */
export function isPathUnlocked(state: GameState, path: EnlightenPathDef): boolean {
  return state.realmIndex >= path.requiresRealm;
}

/** 某一阶能不能修：门槛 + 是否正在修别的 + 资源够不够 */
export function canEnlighten(
  state: GameState,
  pathId: string,
): { ok: boolean; reason: string | null } {
  const path: EnlightenPathDef | undefined = ENLIGHTEN_PATH_MAP[pathId];
  if (!path) return { ok: false, reason: '没有这条道' };
  if (!isPathUnlocked(state, path)) {
    return { ok: false, reason: `需${path.requiresRealm === 3 ? '元婴期' : '化神期'}` };
  }
  if (state.enlightening) return { ok: false, reason: '正在感悟另一条道' };

  const level = getEnlightenLevel(state, pathId);
  if (level >= MAX_ENLIGHTEN_LEVEL) return { ok: false, reason: '此道已圆满' };
  if (!canAffordEnlighten(state, path, level)) return { ok: false, reason: '资源不足' };
  return { ok: true, reason: null };
}

function enlightenCostMap(path: EnlightenPathDef, level: number): CostMap {
  const c = enlightenCost(path, level);
  const cost: CostMap = {
    qi: D(c.qi),
    herb: D(c.herb),
    ore: D(c.ore),
    stone: D(c.stone),
  };
  if (c.refined > 0) {
    // 进阶资源：五行各自用"自己那一种"更贴题，但为了不让人卡在单一种类上，
    // 统一用阵枢（它是三条合成线里最通用的那条）
    cost.arrayCore = D(c.refined);
  }
  return cost;
}

export function canAffordEnlighten(state: GameState, path: EnlightenPathDef, level: number): boolean {
  for (const [id, need] of Object.entries(enlightenCostMap(path, level)) as [ItemId, ReturnType<typeof D>][]) {
    if (getAmount(state, id).lt(need)) return false;
  }
  return true;
}

/** 界面用：把这一阶的花费列出来 */
export function describeEnlightenCost(path: EnlightenPathDef, level: number): string {
  const c = enlightenCostMap(path, level);
  return Object.entries(c)
    .map(([id, amount]) => `${ITEM_MAP[id as ItemId]?.icon ?? ''}${ITEM_MAP[id as ItemId]?.name ?? id} ${amount.toNumber()}`)
    .join(' · ');
}

/* ------------------------------------------------------------------ */
/* 开始 / 推进                                                          */
/* ------------------------------------------------------------------ */

export function startEnlighten(state: GameState, pathId: string): GameState {
  if (!canEnlighten(state, pathId).ok) return state;
  const path: EnlightenPathDef | undefined = ENLIGHTEN_PATH_MAP[pathId];
  if (!path) return state;
  const level = getEnlightenLevel(state, pathId);
  const cost = enlightenCostMap(path, level);
  if (!canAffordEnlighten(state, path, level)) return state;

  const paid = payCost(state, cost);
  const seconds = enlightenSeconds(level);
  return {
    ...paid,
    enlightening: { pathId, remaining: seconds, total: seconds },
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'info',
      text: `开始感悟${path.name}（第 ${level + 1} 阶，约 ${describeEnlightenTime(seconds)}）`,
    }),
  };
}

export function cancelEnlighten(state: GameState): GameState {
  if (!state.enlightening) return state;
  // 已付的资源不退：感悟被打断本就该有代价
  return {
    ...state,
    enlightening: null,
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'info',
      text: '感悟中断，已投入的资源散于天地。',
    }),
  };
}

export function getEnlightenRemaining(state: GameState): number {
  return state.enlightening?.remaining ?? 0;
}

export function getEnlightenProgress(state: GameState): number {
  const e = state.enlightening;
  if (!e || e.total <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - e.remaining / e.total));
}

/**
 * 感悟耗时的人话（第 24 轮需求 3）。
 *
 * 拉长到"天"的量级之后，"约 950 分钟"就不再是人话了 ——
 * 按量级切成 秒 / 分钟 / 小时 / 天。
 */
function describeEnlightenTime(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} 秒`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / 86400).toFixed(1)} 天`;
}

export function tickEnlighten(state: GameState, dt: number): GameState {  const e = state.enlightening;
  if (!e || dt <= 0) return state;

  const remaining = e.remaining - dt;
  if (remaining > 0) return { ...state, enlightening: { ...e, remaining } };

  const path = ENLIGHTEN_PATH_MAP[e.pathId];
  const level = getEnlightenLevel(state, e.pathId) + 1;
  const enlightenment = { ...state.enlightenment, [e.pathId]: level };
  const { major, minor } = stageOfLocal(level);

  let journal = pushJournal(state.journal, {
    time: state.playTime,
    kind: 'good',
    text: `${path.name} 第 ${major} 大阶段 · 第 ${minor} 小阶段 已成（共 ${level}/${MAX_ENLIGHTEN_LEVEL} 阶）`,
  });
  // 每满一个大阶段单独记一笔：这是玩家真正能感知到的里程碑
  if (minor === 1 && major > 1) {
    journal = pushJournal(journal, {
      time: state.playTime,
      kind: 'good',
      text: `🎉 ${path.name} 突破至第 ${major} 大阶段`,
    });
  }

  return { ...state, enlightenment, enlightening: null, journal };
}

function stageOfLocal(level: number): { major: number; minor: number } {
  if (level <= 0) return { major: 0, minor: 0 };
  return { major: Math.floor((level - 1) / 10) + 1, minor: ((level - 1) % 10) + 1 };
}

/* ------------------------------------------------------------------ */
/* 五行：基础材料产出加成                                                */
/* ------------------------------------------------------------------ */

/**
 * 五行感悟对某种材料的产出加成（乘区）。
 *
 * 注意它和季节/天象是**两个独立乘区**（一个加算进环境倍率、一个单独乘），
 * 所以"冬天灵草 −35% + 木之道 +135%"会得到 +52.75%，而不是简单相加 ——
 * 这样五行修满之后，季节的减益也不会被完全抹平。
 */
export function getElementMaterialBonus(state: GameState, material: MaterialId): number {
  const path = ENLIGHTEN_PATHS.find((p) => p.material === material);
  if (!path) return 0;
  return getEnlightenLevel(state, path.id) * ELEMENT_BONUS_PER_LEVEL;
}

/** 界面用：五条道当前各自加到多少 */
export function getElementSummaries(state: GameState): { path: EnlightenPathDef; level: number; bonus: number }[] {
  return ENLIGHTEN_PATHS.filter((p) => p.material).map((p) => ({
    path: p,
    level: getEnlightenLevel(state, p.id),
    bonus: getEnlightenLevel(state, p.id) * ELEMENT_BONUS_PER_LEVEL,
  }));
}

/* ------------------------------------------------------------------ */
/* 空间：探索产出加成                                                    */
/* ------------------------------------------------------------------ */

export function getSpaceRings(state: GameState): number {
  return Math.max(0, Math.min(MAX_SPACE_RINGS, state.spaceRings));
}

/**
 * 空间大道给探索产出的加成（乘区）。
 *
 * 两部分：**修出来的**（每小阶段 +0.5%）与**做出来的**（每枚戒指 +5%）。
 * 需求原文要的是"效果随感悟等级提升而更明显"，所以两部分都保留 ——
 * 戒指是等级换来的，等级又让戒指更值钱。
 */
export function getSpaceExploreBonus(state: GameState): number {
  return getEnlightenLevel(state, 'space') * SPACE_BONUS_PER_LEVEL + getSpaceRings(state) * SPACE_RING_BONUS;
}

/** 下一枚空间戒指的花费；已满返回 null */
export function getNextSpaceRingCost(state: GameState): CostMap | null {
  const owned = getSpaceRings(state);
  if (owned >= MAX_SPACE_RINGS) return null;
  const c = spaceRingCost(owned);
  return { qi: D(c.qi), stone: D(c.stone), arrayCore: D(c.arrayCore), refinedGold: D(c.refinedGold) };
}

/** 能不做做下一枚：除了材料，还要求空间大道修到对应大阶段 */
export function canCraftSpaceRing(state: GameState): { ok: boolean; reason: string | null } {
  const owned = getSpaceRings(state);
  if (owned >= MAX_SPACE_RINGS) return { ok: false, reason: '已做满' };
  const needLevel = (owned + 1) * 10;
  if (getEnlightenLevel(state, 'space') < needLevel) {
    return { ok: false, reason: `需空间大道 ${needLevel} 阶` };
  }
  const cost = getNextSpaceRingCost(state);
  if (!cost) return { ok: false, reason: '已做满' };
  for (const [id, need] of Object.entries(cost) as [ItemId, ReturnType<typeof D>][]) {
    if (getAmount(state, id).lt(need)) return { ok: false, reason: '材料不足' };
  }
  return { ok: true, reason: null };
}

export function craftSpaceRing(state: GameState): GameState {
  if (!canCraftSpaceRing(state).ok) return state;
  const cost = getNextSpaceRingCost(state);
  if (!cost) return state;
  const paid = payCost(state, cost);
  const rings = getSpaceRings(paid) + 1;
  return {
    ...paid,
    spaceRings: rings,
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'good',
      text: `制成第 ${rings} 枚空间戒指（探索产出 +${Math.round(rings * SPACE_RING_BONUS * 100)}%）`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 时间：时空穿梭                                                        */
/* ------------------------------------------------------------------ */

/** 一次穿梭要消耗多少真实秒（= 年数 × 一游戏年的真实秒数） */
export function timeJumpSeconds(years: number): number {
  return years * SECONDS_PER_GAME_YEAR;
}

/** 距离上次穿梭过了多少个游戏年（用 playTime 换算） */
export function yearsSinceLastJump(state: GameState): number {
  return (state.playTime - state.lastTimeJump) / SECONDS_PER_GAME_YEAR;
}

export function canTimeJump(state: GameState): { ok: boolean; reason: string | null } {
  if (getEnlightenLevel(state, 'time') <= 0) return { ok: false, reason: '需先感悟时间大道' };
  /*
   * `lastTimeJump <= 0` = 从来没穿梭过（初始值就是 0）。
   * 这一条是必要的：否则刚解锁的玩家会被"距上次穿梭还差 5 游戏年"挡在门外
   * —— 一次都没穿过，哪来的"上次"。
   */
  if (state.lastTimeJump <= 0) return { ok: true, reason: null };
  const since = yearsSinceLastJump(state);
  if (since < TIME_JUMP_COOLDOWN_YEARS) {
    const left = TIME_JUMP_COOLDOWN_YEARS - since;
    return { ok: false, reason: `还需 ${left.toFixed(1)} 游戏年` };
  }
  return { ok: true, reason: null };
}

/** 这次穿梭能跳多少年 */
export function getTimeJumpYears(state: GameState): number {
  return timeJumpYears(getEnlightenLevel(state, 'time'));
}

/**
 * 发动时空穿梭。
 *
 * 实现上就是**一次性推进一大段时间**（交给 `applyTick`），
 * 所以它天然会结算：产出（受储存上限约束）、钻研、灵植、
 * 弟子的修炼与寿元、秘境冷却、商行刷新 —— 也就是需求说的
 * 「一次性结算基础产出收益和其它需要时间的任务（在对应时间内能完成的）」。
 *
 * ⚠️ 代价是**真的会老**：弟子会按穿梭的年数长岁数，寿元不够的会坐化。
 * 这不是 bug，而是这条道最核心的取舍 —— 想跳时间，就得先确保门里养得起。
 */
export function doTimeJump(state: GameState, applyTickFn: (s: GameState, dt: number) => GameState): GameState {
  if (!canTimeJump(state).ok) return state;
  const years = getTimeJumpYears(state);
  const seconds = timeJumpSeconds(years);

  const before = {
    qi: state.resources.qi.toNumber(),
    disciples: state.sect.disciples.length,
  };

  const jumped = applyTickFn(state, seconds);
  const after = {
    qi: jumped.resources.qi.toNumber(),
    disciples: jumped.sect.disciples.length,
  };

  return {
    ...jumped,
    // 记的是**跳跃之后**的时间点：穿梭发生在"到达的那一刻"，
    // 所以从那一刻起重新计算 5 年冷却（用跳跃前的时间会让冷启动时失效）
    lastTimeJump: jumped.playTime,
    journal: pushJournal(jumped.journal, {
      time: jumped.playTime,
      kind: 'good',
      text:
        `⏳ 时空穿梭 ${years} 年：灵气 ${Math.round(before.qi)} → ${Math.round(after.qi)}` +
        `，弟子 ${before.disciples} → ${after.disciples} 人` +
        `${after.disciples < before.disciples ? '（寿元不足者已坐化）' : ''}`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 杂项                                                                */
/* ------------------------------------------------------------------ */

/** 供界面显示：五行的材料名（拿 id 换名字，避免在组件里再抄一遍表） */
export function pathMaterialName(path: EnlightenPathDef): string {
  return path.material ? (ITEM_MAP[path.material]?.name ?? path.material) : '';
}

/** 全部道当前的阶数（存档清洗与界面都用） */
export function emptyEnlightenment(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of ENLIGHTEN_PATHS) out[p.id] = 0;
  return out;
}

/** 给"其它模块"用的统一入口：某个材料最终吃到的感悟加成 */
export function enlightenmentMaterialMultiplier(state: GameState, material: MaterialId): number {
  return 1 + getElementMaterialBonus(state, material);
}

/** 合成资源（供模拟器判断"该不该合"） */
export function addRefined(state: GameState, item: ItemId, amount: number): GameState {
  return addItem(state, item, D(amount));
}
