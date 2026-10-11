/**
 * 时间推进的组合层。
 *
 * engine / disciples / expeditions 各自只负责一个领域，
 * 这里把它们按正确顺序串起来，并保证彼此不产生循环依赖：
 *
 *   engine.ts      ← 不依赖任何人
 *   disciples.ts   ← 依赖 engine
 *   expeditions.ts ← 依赖 engine、disciples
 *   crafting.ts    ← 依赖 engine、disciples、expeditions
 *   tick.ts        ← 依赖以上全部
 */
import { tickBuffs } from './content';
import { produceResources, tickMind } from './engine';
import { tickDisciples } from './disciples';
import { tickExpeditions } from './expeditions';
import type { GameState } from './state';

/** 单次 tick 最多推进的秒数，防止休眠唤醒后数值跳变 */
export const MAX_TICK_SECONDS = 300;

/**
 * 推进 dt 秒。
 *
 * 顺序有讲究：
 *   1. 先算资源产出（弟子和秘境的结算可能要用到最新资源）
 *   2. 回复心神
 *   3. 弟子修炼与寿元判定（先把寿元耗尽的清掉）
 *   4. 秘境推进与结算
 *   5. 最后扣增益时间，让本 tick 内增益仍然生效
 */
export function applyTick(state: GameState, dt: number, random: () => number = Math.random): GameState {
  if (dt <= 0) return state;

  let next = state;
  next = produceResources(next, dt);
  next = tickMind(next, dt);
  next = tickDisciples(next, dt);
  next = tickExpeditions(next, dt, random);
  next = { ...next, buffs: tickBuffs(next.buffs, dt) };

  return next;
}
