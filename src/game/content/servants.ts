/**
 * 仆人（杂役）
 *
 * 设计动机：宗门要到化神期才能开，那前期盖的茅屋岂不是白盖了？
 * 仆人从开局就能招收、住在同一批居所里，可以被派去挖矿、采药、伐木等，
 * 给对应资源提供产量加成。
 *
 * 关键的取舍：**仆人和弟子共用居所名额**。
 * 前期名额全给仆人（换产量），开宗之后就得决定要不要腾出房间收弟子
 * （换秘境材料和战力）。这让「居所」在整局游戏里始终是个有意义的决策。
 */
import type { ResourceId } from './resources';

export type ServantJobId = 'chores' | 'wood' | 'ore' | 'herb' | 'stone';

export interface ServantJobDef {
  id: ServantJobId;
  name: string;
  icon: string;
  /** 该工种加成到哪种资源的产量上 */
  resource: ResourceId;
  desc: string;
}

export const SERVANT_JOBS: ServantJobDef[] = [
  {
    id: 'chores',
    name: '洒扫庭院',
    icon: '🧹',
    resource: 'qi',
    desc: '料理洞府杂务、看守阵眼，间接助益灵气汇聚。',
  },
  {
    id: 'wood',
    name: '入山伐木',
    icon: '🪓',
    resource: 'wood',
    desc: '砍伐灵木，运回洞府备用。',
  },
  {
    id: 'ore',
    name: '凿石挖矿',
    icon: '⛏',
    resource: 'ore',
    desc: '深入矿洞采掘灵矿。',
  },
  {
    id: 'herb',
    name: '采集灵草',
    icon: '🌾',
    resource: 'herb',
    desc: '翻山越岭采集灵草，供炼丹之用。',
  },
  {
    id: 'stone',
    name: '淘洗灵石',
    icon: '💠',
    resource: 'stone',
    desc: '在灵砂中淘洗挑拣，攒下零星灵石。',
  },
];

export const SERVANT_JOB_MAP: Record<ServantJobId, ServantJobDef> = SERVANT_JOBS.reduce(
  (acc, job) => {
    acc[job.id] = job;
    return acc;
  },
  {} as Record<ServantJobId, ServantJobDef>,
);

/**
 * 每名仆人给对应资源带来的产量加成（加算）。
 *
 * 定得比较克制：仆人是「凡人帮手」，作用是让前期起步顺一点，
 * 而不是取代设施。真正的产量增长仍然来自聚灵阵和境界倍率。
 * 加成是乘在总产量上的，所以后期仍有一点价值，但不会喧宾夺主。
 */
export const SERVANT_BONUS_PER_HEAD = 0.04;

/**
 * 招收仆人的花费（灵气）。
 *
 * 用灵气而不是灵石 —— 灵石要到灵田之后才拿得到，
 * 而仆人恰恰是给「还没有宗门、还没有灵石矿」的前期准备的。
 * 所以也算是给他们找了个说法：修士用灵气供养凡人仆役。
 *
 * 需求 4：「招收仆人所需的灵气固定为 300」。
 * 原先是 80 × 1.2ⁿ 的等比递增（第 10 个 495 灵气、第 30 个 1.9 万），
 * 于是"招仆人"到中后期变成一件要精算的事 —— 可仆役本来就是替玩家
 * 腾出手来的辅助系统，不该再占一层决策。现在固定 300，
 * 唯一的限制只剩居所容量与上限。
 */
export const SERVANT_COST = 300;

export function servantCost(_currentServants: number): number {
  return SERVANT_COST;
}
