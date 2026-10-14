/**
 * 时间推进的组合层。
 *
 * 各模块只管一个领域，这里把它们按正确顺序串起来，
 * 并保证彼此不产生循环依赖：
 *
 *   engine.ts       ← 不依赖任何人
 *   disciples.ts    ← 依赖 engine
 *   planting.ts     ← 依赖 engine、disciples
 *   research.ts     ← 依赖 engine、disciples
 *   sectActivity.ts ← 依赖 engine、disciples
 *   expeditions.ts  ← 依赖 engine、disciples、planting
 *   shop.ts         ← 依赖 engine、disciples、planting
 *   travel.ts       ← 依赖 engine、disciples、planting
 *   crafting.ts     ← 依赖 engine、disciples、expeditions
 *   tick.ts         ← 依赖以上全部
 */
import { tickBuffs } from './content';
// 第 27 轮（需求 3）：自动炼制住在 crafting.ts（engine ← crafting 不能反向依赖）
import { autoCraft } from './crafting';
import {
  autoRefine,
  clampResources,
  produceResources,
  refreshUnlocks,
  tickBuildQueue,
  tickInjury,
  tickMind,
  tickRealmCooldowns,
} from './engine';
import { tickEncounters } from './encounter';
import { tickEnlighten } from './enlightenment';
import { tickDisciples } from './disciples';
import { tickExpeditions } from './expeditions';
import { tickPlantings } from './planting';
import { tickResearch } from './research';
import { tickSeason } from './season';
import { tickArena, tickSectEvents } from './sectActivity';
import { tickShop } from './shop';
import { tickCaravan } from './caravan';
import { tickSectArray } from './sectArray';
import { tickPosts } from './posting';
import { tickHappiness } from './happiness';
import { tickFameShop } from './fame';
import { tickParleyCooldowns, tickWar } from './diplomacy';
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
 *   8. 掌门游历（需求 1）—— 完成时结算材料，也可能发现新秘境
 *   9. 秘境推进与结算（需求 1：结算后写入冷却、发放心得、判定发现）
 *  10. 秘境冷却倒计时（需求 1：隔一段时间才能再探）
 *  11. 宗门活动（需求 4：大比计时 + 弟子自发使用宗门建筑）
 *  12. 扣增益时间，让本 tick 内增益仍然生效
 *  13. 商行刷新（需求 3）
 *  14. 刷新建筑解锁（资源涨够了就永久解锁）
 *  15. 最后统一把资源砍回储存上限（秘境掉落、商行购买都可能顶破上限）
 */
export function applyTick(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (dt <= 0) return state;

  let next = state;
  // 季节与天象排在最前面：它决定这一 tick 的产出该按哪个季节算（需求 1）
  next = tickSeason(next, dt, random);
  next = produceResources(next, dt);
  next = autoRefine(next, dt);
  // 第 27 轮（需求 3）：自动炼制（与自动合成挨着，两套机制并排读）
  next = autoCraft(next, dt, random);
  next = tickMind(next, dt);
  next = tickInjury(next, dt);
  next = tickResearch(next, dt);
  next = tickDisciples(next, dt);
  // 派遣（需求 3 / 12）：在岗弟子持续长心得、积累技艺点
  next = tickPosts(next, dt);
  // 幸福度（需求 4）：朝目标值平滑靠拢
  next = tickHappiness(next, dt);
  next = tickPlantings(next, dt);
  next = tickTravel(next, dt, random);
  next = tickExpeditions(next, dt, random);
  next = tickRealmCooldowns(next, dt);
  // 必须把 random 传进去：大比要发功法碎片，那是一次掷骰。
  // 漏传会退回全局随机源，pnpm simulate 就不再可复现（坑 89）。
  next = tickArena(next, dt, random);
  next = tickSectEvents(next, dt, random);
  next = { ...next, buffs: tickBuffs(next.buffs, dt) };
  next = tickShop(next, dt, random);
  // 商队（需求 7）：来了一支就等在门口；同时需求 8 要求刷新率很低
  next = tickCaravan(next, dt, random);
  // 宗门大阵（需求 9）：开着就烧符，烧完自己灭
  next = tickSectArray(next, dt);
  // 声望商店（设定集第 9 章）：与灵石商行同一套刷新节奏
  next = tickFameShop(next, dt, random);
  // 外交：论道冷却与宗门大战（处于战争状态时按周期开打，敌对宗门也可能主动来犯）
  next = tickParleyCooldowns(next, dt);
  next = tickWar(next, dt, random);
  next = refreshUnlocks(next);
  // 建造队列（需求 2）：解锁刷新之后再推进，刚解锁的建筑当帧就能排上
  next = tickBuildQueue(next);
  // 随机遭遇（需求 2）：开宗前与掌门在外时会遇到人
  next = tickEncounters(next, dt, random);
  // 感悟（需求 3）：一阶一阶地推，和钻研同一类
  next = tickEnlighten(next, dt);
  next = clampResources(next);

  return next;
}
