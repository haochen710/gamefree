/**
 * 派遣：把弟子安排进丹房 / 炼器房 / 符房 / 灵田（需求 3 + 12）
 *
 * 与用户确认的口径：
 *   1. **每座设施有岗位数**，逐个指派；
 *   2. **被派遣的弟子不能同时去探索**（`canStartExpedition` 会挡住）；
 *   3. 派遣期间**持续获得心得**（需求 3：遣到建筑也能涨经验）；
 *   4. 派遣期间**积累技艺点**（需求 12），技艺等级越高给这座设施的加成越多。
 *
 * 为什么"不能同时探索"这一条很关键：否则派遣就变成了一份白送的加成，
 * 玩家会把所有人同时塞进设施和队伍里，两头的好处都拿。
 * 有了这条，人手就成了一份**要分配的稀缺资源** —— 这才是养成的取舍。
 */
import {
  POST_BUILDINGS,
  POST_BUILDING_IDS,
  POST_BASE_BONUS,
  POST_COST_CAP,
  POST_EFFECT_PER_LEVEL,
  POST_OUTPUT_CAP,
  CRAFT_FAILURE_BASE_REFUND,
  POST_SALVAGE_CAP,
  POST_TIER_FREE,
  POST_UNLOCK,
  POST_BONUS_CAP,
  POST_INSIGHT_PER_MINUTE,
  SKILL_POINTS_PER_SECOND,
  SKILL_NAMES,
  TALENT_MATCH_MULT,
  TALENT_SKILL_GAIN_MULT,
  emptySkills,
  skillLevelOf,
  type SkillKind,
} from './content';
import { getBuildingCount, getInsightMax } from './engine';
import { FARM_TALENT_MAP } from './content';
import type { Disciple, GameState } from './state';

/* ------------------------------------------------------------------ */
/* 岗位                                                                */
/* ------------------------------------------------------------------ */

/* 岗位表在 content/skills.ts（engine 也要读它，见那里的注释） */

/** 某座设施当前的岗位总数 */
export function getPostCapacity(state: GameState, buildingId: string): number {
  const def = POST_BUILDINGS[buildingId];
  if (!def) return 0;
  return getBuildingCount(state, buildingId) * def.perBuilding;
}

/** 该设施上已有多少人 */
export function getPostCount(state: GameState, buildingId: string): number {
  let n = 0;
  for (const d of state.sect.disciples) {
    if (d.post === buildingId) n += 1;
  }
  return n;
}

export function getPostFree(state: GameState, buildingId: string): number {
  return Math.max(0, getPostCapacity(state, buildingId) - getPostCount(state, buildingId));
}

/** 这名弟子的生产天赋属于哪一类（用于判断"对口"） */
export function talentKindOf(disciple: Disciple): SkillKind | null {
  return FARM_TALENT_MAP[disciple.farmTalent]?.kind ?? null;
}

export function canPost(state: GameState, discipleId: string, buildingId: string): { ok: boolean; reason: string | null } {
  const def = POST_BUILDINGS[buildingId];
  if (!def) return { ok: false, reason: '这里没有可安排的岗位' };
  const disciple = state.sect.disciples.find((d) => d.id === discipleId);
  if (!disciple) return { ok: false, reason: '弟子不存在' };
  if (getPostCapacity(state, buildingId) <= 0) {
    return { ok: false, reason: `还没有${def.name}（先盖一座）` };
  }
  if (disciple.post === buildingId) return { ok: false, reason: '他已经在里面了' };
  if (getPostFree(state, buildingId) <= 0) return { ok: false, reason: `${def.name}的岗位满了` };
  if (disciple.status === 'exploring') return { ok: false, reason: '正在探索，先等他回来' };
  return { ok: true, reason: null };
}

/** 安排一名弟子进设施 */
export function postDisciple(state: GameState, discipleId: string, buildingId: string): GameState {
  if (!canPost(state, discipleId, buildingId).ok) return state;
  return {
    ...state,
    sect: {
      ...state.sect,
      disciples: state.sect.disciples.map((d) =>
        d.id === discipleId ? { ...d, post: buildingId, status: 'posted' as const, expeditionId: undefined } : d,
      ),
    },
  };
}

/** 把一名弟子从设施里撤回来 */
export function unpostDisciple(state: GameState, discipleId: string): GameState {
  const disciple = state.sect.disciples.find((d) => d.id === discipleId);
  if (!disciple || !disciple.post) return state;
  return {
    ...state,
    sect: {
      ...state.sect,
      disciples: state.sect.disciples.map((d) =>
        d.id === discipleId ? { ...d, post: '', status: 'idle' as const } : d,
      ),
    },
  };
}

/** 把某个设施上的人全部撤回 */
export function unpostAll(state: GameState, buildingId: string): { state: GameState; removed: number } {
  let working = state;
  let removed = 0;
  for (const d of state.sect.disciples) {
    if (d.post !== buildingId) continue;
    working = unpostDisciple(working, d.id);
    removed += 1;
  }
  return { state: working, removed };
}

/**
 * 自动填岗（一键安排）。
 *
 * 按"对口优先、技艺高的优先"排序后往里塞 —— 玩家在千人宗门里
 * 不可能手动挑，但这件事**该由玩家决定要不要做**，所以做成一个按钮
 * 而不是自动执行。
 */
export function autoPostAll(state: GameState): { state: GameState; posted: number } {
  let working = state;
  let posted = 0;
  for (const buildingId of POST_BUILDING_IDS) {
    const def = POST_BUILDINGS[buildingId];
    let free = getPostFree(working, buildingId);
    if (free <= 0) continue;
    const candidates = working.sect.disciples
      .filter((d) => d.post === '' && d.status === 'idle')
      .map((d) => ({
        d,
        // 对口 +100 分，技艺点每点折算成很小的一点，境界高的略优先
        score:
          (talentKindOf(d) === def.kind ? 100 : 0) +
          Math.min(50, (d.skills[def.kind] ?? 0) / 100) +
          d.realmIndex * 2,
      }))
      .sort((a, b) => b.score - a.score);
    for (const entry of candidates) {
      if (free <= 0) break;
      const next = postDisciple(working, entry.d.id, buildingId);
      if (next === working) continue;
      working = next;
      posted += 1;
      free -= 1;
    }
  }
  return { state: working, posted };
}

/* ------------------------------------------------------------------ */
/* 派遣带来的加成                                                       */
/* ------------------------------------------------------------------ */

/**
 * 派遣带来的**四类**加成（第 21 轮重做）。
 *
 * 玩家原话：
 *   「弟子针对建筑的加成不能只是成功率上，炼丹可以减少资源消耗、增加产出等，
 *     所以天赋可以更加多元化……但是加成的初始值一定要低，现在一个弟子的初始
 *     加成都直接百分之 9 了，过于高了，加成应当是在技艺的提升过程中逐步解锁。
 *     并且不同等级的技艺，对不同品级的丹药和器物的加成也是不一样的。」
 *
 * 所以这个模型有三条规则：
 *   1. **起点极低**：技艺 0 级、天赋不对口的弟子贡献 **0**（连成功率都不给）；
 *   2. **分阶解锁**：1 级起给成功率、3 级起省料、5 级起增产、7 级起越阶；
 *   3. **按品阶打折**：`有效等级 = max(0, 等级 − max(0, 目标品阶 − 1))` ——
 *      3 级炼丹弟子炼一品丹是满额，炼五品丹则是零贡献。
 */
export interface PostEffect {
  /** 成功率加成（加算，0.05 = +5 个百分点） */
  success: number;
  /** 省料比例（0.1 = 少花 10% 材料） */
  cost: number;
  /** 失败回收（0.1 = 把 10% 材料捞回来） */
  salvage: number;
  /** 增产比例（0.1 = 出双份的概率 +10%） */
  output: number;
  /** 越阶减免：目标品阶高于自身时抵掉的那部分惩罚 */
  quality: number;
  /** 有几个在岗弟子在真正出力（有效等级 > 0） */
  contributors: number;
  /** 在岗总人数（含还没练出技艺的） */
  posted: number;
}

/** 有效等级：目标品阶越高，越吃"技艺不够"的折扣 */
export function effectiveSkillLevel(level: number, targetTier: number): number {
  const penalty = Math.max(0, targetTier - POST_TIER_FREE);
  return Math.max(0, level - penalty);
}

/**
 * 某个技艺面在**炼制品阶 targetTier** 时的四类加成。
 *
 * 注意 `targetTier` 是"要炼的东西的品阶"（丹药品阶 / 器物品阶 / 符箓品阶），
 * 采集类（灵田）没有品阶，传 1 即可。
 */
export function getPostEffect(state: GameState, kind: SkillKind, targetTier = 1): PostEffect {
  const out: PostEffect = { success: 0, salvage: 0, cost: 0, output: 0, quality: 0, contributors: 0, posted: 0 };

  for (const d of state.sect.disciples) {
    if (!d.post) continue;
    const def = POST_BUILDINGS[d.post];
    if (!def || def.kind !== kind) continue;
    out.posted += 1;

    const level = skillLevelOf(d.skills[kind] ?? 0);
    const eff = effectiveSkillLevel(level, targetTier);
    if (eff <= 0) continue;
    out.contributors += 1;

    const match = talentKindOf(d) === kind ? TALENT_MATCH_MULT : 1;
    if (level >= POST_UNLOCK.success) {
      out.success += (POST_BASE_BONUS + eff * POST_EFFECT_PER_LEVEL.success) * match;
    }
    if (level >= POST_UNLOCK.salvage) {
      out.salvage += eff * POST_EFFECT_PER_LEVEL.salvage * match;
    }
    if (level >= POST_UNLOCK.cost) {
      out.cost += eff * POST_EFFECT_PER_LEVEL.cost * match;
    }
    if (level >= POST_UNLOCK.output) {
      out.output += eff * POST_EFFECT_PER_LEVEL.output * match;
    }
    if (level >= POST_UNLOCK.quality) {
      out.quality += eff * POST_EFFECT_PER_LEVEL.quality * match;
    }
  }

  out.success = Math.min(POST_BONUS_CAP, out.success);
  out.salvage = Math.min(POST_SALVAGE_CAP, out.salvage);
  out.cost = Math.min(POST_COST_CAP, out.cost);
  out.output = Math.min(POST_OUTPUT_CAP, out.output);
  out.quality = Math.min(POST_BONUS_CAP, out.quality);
  return out;
}

/**
 * 兼容旧调用点：成功率那一项（界面上的"+X%"也用它）。
 *
 * ⚠️ 传 targetTier 才能反映"按品阶打折"；不传就按一品算。
 */
export function getPostBonus(state: GameState, kind: SkillKind, targetTier = 1): number {
  return getPostEffect(state, kind, targetTier).success;
}

/**
 * 炼制消耗的倍率（省料）：`1 − 派遣省料 − 越阶减免`，有下限。
 *
 * 越阶减免放在这里而不是成功率上，是因为"手艺好的人来炼你的丹，
 * 最直接的体现就是少浪费材料"。
 */
/**
 * 失败时能捞回多少材料（第 22 轮）：
 * `基础回收 CRAFT_FAILURE_BASE_REFUND + 在岗弟子的技艺回收`，封顶 0.75。
 *
 * 玩家原话：「后期才能更加依靠弟子**减少失败损耗**」——
 * 这条就是那个"损耗"的出口。
 */
export function getPostSalvage(state: GameState, kind: SkillKind, targetTier = 1): number {
  return Math.min(0.75, CRAFT_FAILURE_BASE_REFUND + getPostEffect(state, kind, targetTier).salvage);
}

export function getPostCostMultiplier(state: GameState, kind: SkillKind, targetTier = 1): number {
  const effect = getPostEffect(state, kind, targetTier);
  return Math.max(0.4, 1 - effect.cost - effect.quality * 0.5);
}

/** 在岗人数（按技艺面） */
export function getPostCountOfKind(state: GameState, kind: SkillKind): number {
  let n = 0;
  for (const d of state.sect.disciples) {
    if (!d.post) continue;
    if (POST_BUILDINGS[d.post]?.kind === kind) n += 1;
  }
  return n;
}

/** 界面用：四个技艺面的总览 */
export function getPostOverview(state: GameState): {
  kind: SkillKind;
  name: string;
  posted: number;
  capacity: number;
  bonus: number;
  buildings: { id: string; name: string; icon: string; posted: number; capacity: number }[];
}[] {
  return (Object.keys(SKILL_NAMES) as SkillKind[]).map((kind) => {
    const buildings = POST_BUILDING_IDS.filter((id) => POST_BUILDINGS[id].kind === kind).map((id) => ({
      id,
      name: POST_BUILDINGS[id].name,
      icon: POST_BUILDINGS[id].icon,
      posted: getPostCount(state, id),
      capacity: getPostCapacity(state, id),
    }));
    return {
      kind,
      name: SKILL_NAMES[kind],
      posted: getPostCountOfKind(state, kind),
      capacity: buildings.reduce((sum, b) => sum + b.capacity, 0),
      bonus: getPostBonus(state, kind),
      buildings,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 时间推进：心得 + 技艺点                                              */
/* ------------------------------------------------------------------ */

/**
 * 在岗弟子的收益（需求 3 的"经验值" + 需求 12 的"技艺点"）。
 *
 * ⚠️ 两者都按**真实秒**结算，与探索的"心得按次给"不同 ——
 * 派遣是持续的，按次给说不通（难道要他每分钟回来一趟？）。
 */
export function tickPosts(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  let any = false;
  for (const d of state.sect.disciples) {
    if (d.post) {
      any = true;
      break;
    }
  }
  if (!any) return state;

  const insightMax = getInsightMax(state);
  const disciples = state.sect.disciples.map((d) => {
    if (!d.post) return d;
    const def = POST_BUILDINGS[d.post];
    if (!def) return d;
    const kind = def.kind;
    const match = talentKindOf(d) === kind;
    // 技艺点：基础速率 × 对口倍率（需求 12：有对应天赋时获取更多）
    const gain = SKILL_POINTS_PER_SECOND * dt * (match ? TALENT_SKILL_GAIN_MULT : 1);
    const points = Math.max(0, (d.skills[kind] ?? 0) + gain);
    // 心得：在设施里干活同样长见识（需求 3）
    const insight = Math.min(insightMax, d.insight + (POST_INSIGHT_PER_MINUTE * dt) / 60);
    return { ...d, skills: { ...d.skills, [kind]: points }, insight };
  });
  return { ...state, sect: { ...state.sect, disciples } };
}

/** 界面用：某名弟子的派遣状态描述 */
export function describePost(disciple: Disciple): string {
  if (!disciple.post) return '未派遣';
  const def = POST_BUILDINGS[disciple.post];
  if (!def) return '未派遣';
  const lv = skillLevelOf(disciple.skills[def.kind] ?? 0);
  return `${def.icon}${def.name}（${SKILL_NAMES[def.kind]} ${lv} 级）`;
}

/** 新弟子的空技艺表（转发一下，省得各处 import 两个模块） */
export { emptySkills };
