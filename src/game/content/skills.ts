/**
 * 技艺（需求 12）
 *
 * 弟子在**炼丹 / 炼器 / 制符 / 种田**四件事上各自积累技艺点，
 * 点数够了就升一级；等级越高，被派遣到对应设施时给它的加成越多。
 *
 * 三条设计口径（与用户确认过的）：
 *   1. **技艺记在弟子身上**，不是宗门共享 —— 所以"培养一个炼丹大师"
 *      是一件有长期回报的事；
 *   2. 技艺点只在**派遣**到对应设施时积累（见 `game/posting.ts`）；
 *   3. **有对应天赋的人积累更快**（`TALENT_SKILL_GAIN_MULT`），
 *      这让"天赋"与"培养"两件事叠在一起，而不是二选一。
 */
import type { TalentKind } from './talents';

/** 四项技艺的口径与天赋的四种归属完全一致 */
export type SkillKind = TalentKind;

export const SKILL_KINDS: SkillKind[] = ['alchemy', 'refining', 'talisman', 'farm'];

export const SKILL_NAMES: Record<SkillKind, string> = {
  alchemy: '炼丹',
  refining: '炼器',
  talisman: '制符',
  farm: '种田',
};

/**
 * 每一级所需的**累计**技艺点。
 *
 * 曲线取"越往后越陡"（每级需求约 ×2.2）：前几级几天就能看到，
 * 后几级要挂上很久 —— 这与需求 16「越到后面越慢」是同一条原则。
 */
export const SKILL_LEVEL_POINTS: number[] = [
  0, // 0 级：入门
  100, // 1
  260, // 2
  620, // 3
  1400, // 4
  3100, // 5
  6800, // 6
  15000, // 7
  33000, // 8
  72000, // 9
];

export const SKILL_MAX_LEVEL = SKILL_LEVEL_POINTS.length - 1;

/** 每一级给派遣设施的基础加成（数值很小：加成靠下面的"分阶解锁"长出来） */
export const SKILL_BONUS_PER_LEVEL = 0.006;

/**
 * 派遣时的基础加成（与技艺无关的那一份）。
 *
 * ⚠️ 第 21 轮大幅调低：玩家反馈「现在一个弟子的初始加成都直接百分之 9 了，
 * 过于高了，加成应当是在技艺的提升过程中逐步解锁」。
 * 原来是 0.03 × 对口 2.5 = **7.5%**，再加技艺与特长就到 9% 以上。
 * 现在降到 0.004（0.4%），对口倍率也从 2.5 降到 1.5 ——
 * **一开始几乎是白搭，价值全在技艺等级上**。
 */
export const POST_BASE_BONUS = 0.004;

/** 天赋对口时的技艺点获取倍率（需求 12：有对应天赋时，技艺点获取得更多） */
export const TALENT_SKILL_GAIN_MULT = 1.6;

/**
 * 天赋**对口**时，这名弟子给设施的加成倍率。
 *
 * 从 2.5 降到 1.5：对口仍然明显更值（+50%），但不再"一个人顶三个"。
 */
export const TALENT_MATCH_MULT = 1.5;

/** 派遣时每秒积累的技艺点（基础值，还会乘上面那个天赋倍率） */
export const SKILL_POINTS_PER_SECOND = 0.02;

/** 派遣弟子每分钟获得的心得（需求 3：遣到建筑也能涨经验） */
export const POST_INSIGHT_PER_MINUTE = 0.6;

/** 成功率加成的上限（避免几十个人堆出一个天文数字） */
export const POST_BONUS_CAP = 1.2;
/** 省料加成的上限（最多省一半材料） */
export const POST_COST_CAP = 0.5;
/** 增产加成的上限 */
export const POST_OUTPUT_CAP = 0.5;
/** 失败回收的上限（最多把六成材料捞回来） */
export const POST_SALVAGE_CAP = 0.6;

/**
 * 技艺等级**分阶解锁**的加成类型（第 21 轮的核心改动）。
 *
 * 玩家原话：「弟子针对建筑的加成不能只是成功率上，炼丹可以减少资源消耗、
 * 增加产出等……加成应当是在技艺的提升过程中逐步解锁」。
 *
 * 所以一个在岗弟子给的不是"一个百分比"，而是**四项能力按等级逐步长出来**：
 *   1 级起 → 成功率
 *   3 级起 → **省料**（减少炼制消耗）
 *   5 级起 → **增产**（出双份 / 产量）
 *   7 级起 → **越阶**：减免"炼制高于自身品阶的东西"的惩罚
 */
export const POST_UNLOCK = {
  success: 1,
  /** 2 级起：**失败回收**（玩家说的"减少失败损耗"） */
  salvage: 2,
  cost: 3,
  output: 5,
  quality: 7,
} as const;

/** 上面各项各自的"每有效等级"系数 */
export const POST_EFFECT_PER_LEVEL = {
  success: 0.012,
  salvage: 0.03,
  cost: 0.01,
  output: 0.008,
  quality: 0.02,
} as const;

/**
 * 品阶适配的**免费档位**：目标品阶不超过这个数时不吃惩罚。
 *
 * 玩家原话：「不同等级的技艺，对不同品级的丹药和器物的加成也是不一样的」。
 * 做法：`有效等级 = max(0, 技艺等级 − max(0, 目标品阶 − POST_TIER_FREE))`。
 * 于是一个 3 级炼丹弟子炼一品丹是满额、炼五品丹等于零贡献 ——
 * 「拿低级弟子去堆高级丹」再也堆不动了。
 */
export const POST_TIER_FREE = 1;

/** 技艺点 → 等级 */
export function skillLevelOf(points: number): number {
  let level = 0;
  for (let i = 0; i < SKILL_LEVEL_POINTS.length; i += 1) {
    if (points >= SKILL_LEVEL_POINTS[i]) level = i;
  }
  return Math.min(level, SKILL_MAX_LEVEL);
}

/** 距离下一级还差多少点（满级返回 null） */
export function skillPointsToNext(points: number): number | null {
  const level = skillLevelOf(points);
  if (level >= SKILL_MAX_LEVEL) return null;
  return Math.max(0, SKILL_LEVEL_POINTS[level + 1] - points);
}

/** 某一项技艺给设施的加成（只看等级，不看天赋 —— 天赋管的是"积累速度"） */
export function skillBonus(points: number): number {
  return skillLevelOf(points) * SKILL_BONUS_PER_LEVEL;
}

/** 界面用：一项技艺的完整状态 */
export interface SkillView {
  kind: SkillKind;
  name: string;
  points: number;
  level: number;
  toNext: number | null;
  bonus: number;
}

export function skillView(kind: SkillKind, points: number): SkillView {
  return {
    kind,
    name: SKILL_NAMES[kind],
    points,
    level: skillLevelOf(points),
    toNext: skillPointsToNext(points),
    bonus: skillBonus(points),
  };
}


/**
 * 哪些建筑有岗位、各是什么技艺、每座几个。
 *
 * ⚠️ 这张表放在 **content** 而不是 game/posting.ts：
 * engine 算「灵田岗位加成」时也要读它，而 engine 不能 import posting
 * （posting 依赖 engine 的 getBuildingCount，反向引用成环）。
 * 数据放 content、逻辑放 posting，这条线就干净了。
 */
/**
 * 第 20 轮调整（玩家原话：「丹房等建筑可派遣的弟子数量要增加，
 * 不然那么多弟子往哪放」）。
 *
 * ⚠️ 当时的真问题不只是"每座几个人"，而是**丹房与炼器房的 `max` 居然是 1** ——
 * 全宗门最多 2 个炼丹岗位、2 个炼器岗位，1024 个弟子根本无处可去。
 * 所以这一轮两件事一起做：
 *   1. 丹房 / 炼器房的 max 从 1 放开到 12（符房 8 → 12）；
 *   2. 每座岗位数大幅提高：丹房 / 炼器房 / 符房 2 → **10**，灵田 3 → **15**。
 */
export const POST_BUILDINGS: Record<string, { kind: SkillKind; perBuilding: number; name: string; icon: string }> = {
  // 第 29 轮：丹房恢复唯一（max 1），所以岗位数抬到 40 —— "唯一"与"容得下"两件事都要成立
  alchemyRoom: { kind: 'alchemy', perBuilding: 40, name: '丹房', icon: '⚗' },
  refinery: { kind: 'refining', perBuilding: 40, name: '炼器房', icon: '🔨' },
  talismanRoom: { kind: 'talisman', perBuilding: 10, name: '符房', icon: '📜' },
  herbField: { kind: 'farm', perBuilding: 15, name: '灵田', icon: '🌱' },
};

export const POST_BUILDING_IDS = Object.keys(POST_BUILDINGS);

/** 空的技艺表（新弟子的起点） */
export function emptySkills(): Record<SkillKind, number> {
  return { alchemy: 0, refining: 0, talisman: 0, farm: 0 };
}
