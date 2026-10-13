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
  POST_BONUS_CAP,
  POST_INSIGHT_PER_MINUTE,
  SKILL_POINTS_PER_SECOND,
  SKILL_NAMES,
  TALENT_MATCH_MULT,
  TALENT_SKILL_GAIN_MULT,
  emptySkills,
  skillBonus,
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
 * 某个技艺面得到的**设施加成**（0.03 = +3%）。
 *
 * 每名在岗弟子贡献 `(基础 3% + 技艺等级 ×2%) × 对口倍率`，全部相加后封顶。
 * 之所以让"对口"给一个很大的倍率（而不是加法），是为了让"把炼丹天赋的人
 * 放进丹房"成为唯一正确的事 —— 否则随手塞人也能拿到大部分收益。
 */
export function getPostBonus(state: GameState, kind: SkillKind): number {
  let total = 0;
  for (const d of state.sect.disciples) {
    if (!d.post) continue;
    const def = POST_BUILDINGS[d.post];
    if (!def || def.kind !== kind) continue;
    const base = POST_BASE_BONUS + skillBonus(d.skills[kind] ?? 0);
    const match = talentKindOf(d) === kind ? TALENT_MATCH_MULT : 1;
    total += base * match;
  }
  return Math.min(POST_BONUS_CAP, total);
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
