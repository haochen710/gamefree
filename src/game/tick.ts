/**
 * 时间推进的组合层。
 *
 * engine / disciples / expeditions 等模块各自只负责一个领域，
 * 这里把它们按正确顺序串起来，并保证彼此不产生循环依赖：
 *
 *   engine.ts      ← 不依赖任何人
 *   disciples.ts   ← 依赖 engine
 *   planting.ts    ← 依赖 engine、disciples
 *   research.ts    ← 依赖 engine、disciples
 *   expeditions.ts ← 依赖 engine、disciples、planting
 *   shop.ts        ← 依赖 engine、disciples、planting
 *   travel.ts      ← 依赖 engine、disciples、planting
 *   crafting.ts    ← 依赖 engine、disciples、expeditions
 *   tick.ts        ← 依赖以上全部
 */
import { tickBuffs } from './content';
import {
  autoRefine,
  clampResources,
  produceResources,
  refreshUnlocks,
  tickInjury,
  tickMind,
} from './engine';
import { tickDisciples } from './disciples';
import { tickExpeditions } from './expeditions';
import { tickPlantings } from './planting';
import { tickResearch } from './research';
import { tickShop } from './shop';
import { tickTravel } from './travel';
import { gameRandom, type RandomSource } from './random';
import type { GameState } from './state';

/** 单次 tick 最多推进的秒数，防止休眠唤醒后数值跳变 */
export const MAX_TICK_SECONDS = 300;

/**
 * 推进 dt 秒。
 *
 * 顺序有讲究：
 *   1. 先算资源产出
 *   2. 自动合成灵石（需求 4）—— 刚产出的灵气立刻能换成灵石
 *   3. 回复心神
 *   4. 道伤计时
 *   5. 钻研计时（需求 6）—— 钻研完成立刻解锁建筑，玩家下一步就能看到
 *   6. 弟子修炼与寿元判定（先把寿元耗尽的清掉）
 *   7. 种植生长（需求 5）
 *   8. 掌门游历（需求 1）—— 完成时结算材料
 *   9. 秘境推进与结算
 *  10. 扣增益时间，让本 tick 内增益仍然生效
 *  11. 商行刷新（需求 3）
 *  12. 刷新建筑解锁（资源涨够了就永久解锁）
 *  13. 最后统一把资源砍回储存上限（秘境掉落、商行购买都可能顶破上限）
 */
export function applyTick(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (dt <= 0) return state;

  let next = state;
  next = produceResources(next, dt);
  next = autoRefine(next, dt);
  next = tickMind(next, dt);
  next = tickInjury(next, dt);
  next = tickResearch(next, dt);
  next = tickDisciples(next, dt);
  next = tickPlantings(next, dt);
  next = tickTravel(next, dt, random);
  next = tickExpeditions(next, dt, random);
  next = { ...next, buffs: tickBuffs(next.buffs, dt) };
  next = tickShop(next, dt, random);
  next = refreshUnlocks(next);
  next = clampResources(next);

  return next;
}
