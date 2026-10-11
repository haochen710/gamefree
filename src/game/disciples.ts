/**
 * 弟子系统（需求 4 / 7）
 *
 * 一名弟子的一生由三件事驱动：
 *   资质  → 决定修炼速度和能修到的最高境界
 *   时间  → 每真实秒推进 30 游戏天，按速度累积修为
 *   寿元  → 到境界对应的寿元上限还没突破，就寿元耗尽而亡
 *
 * 这三条合起来，让"招收 → 培养 → 逐出低资质、补入高资质"成为长期决策：
 * 凡品灵根弟子也会慢慢变强，但永远追不上天灵根，而且会先老死。
 */
import Decimal, { D } from './decimal';
import { gameRandom, type RandomSource } from './random';
import {
  APTITUDE_MAP,
  APTITUDE_ORDER,
  GAME_DAYS_PER_SECOND,
  GAME_DAYS_PER_YEAR,
  INSIGHT_SPEED_PER_POINT,
  REALMS,
  randomDiscipleName,
  recruitCost,
  rollAptitude,
} from './content';
import {
  getArtifactBonuses,
  getCultivationSpeedMultiplier,
  getInsightMax,
  getDiscipleCapacity,
  getStructureBonus,
} from './engine';
import { JOURNAL_LIMIT, type Disciple, type GameState, type JournalEntry } from './state';

/** 弟子一生最多一次跨多少个境界（防止极端离线时间把循环跑爆） */
const MAX_REALM_JUMPS = 32;

/**
 * 弟子的境界上限 = min(自身资质上限, 掌门当前境界)。
 *
 * 「弟子不得超越掌门」是修仙小说的通行设定，同时也解决了一个真实的平衡问题：
 * 没有这条限制，天灵根弟子会在两三天内修到仙人，把玩家自己的修行
 * 和整个宗门养成线彻底架空。加上之后，弟子的成长就跟着主线走。
 */
export function getDiscipleRealmCap(state: GameState, disciple: Disciple): number {
  return Math.min(APTITUDE_MAP[disciple.aptitude].capRealm, state.realmIndex);
}

/** 弟子停止成长的原因，用于界面提示 */
export function getDiscipleCapReason(
  state: GameState,
  disciple: Disciple,
): 'aptitude' | 'master' | null {
  if (disciple.realmIndex < getDiscipleRealmCap(state, disciple)) return null;
  return APTITUDE_MAP[disciple.aptitude].capRealm <= state.realmIndex ? 'aptitude' : 'master';
}

/* ------------------------------------------------------------------ */
/* 生成与招收                                                          */
/* ------------------------------------------------------------------ */

export function rollDisciple(sectLevel: number, id: number, random: RandomSource = gameRandom): Disciple {
  return {
    id: `d${id}`,
    name: randomDiscipleName(random),
    aptitude: rollAptitude(sectLevel, random),
    realmIndex: 0,
    // 给一点随机初始进度，免得同一批弟子永远整齐划一地一起突破
    progress: random() * 5,
    age: 16 + Math.floor(random() * 14),
    status: 'idle',
    insight: 0,
  };
}

/**
 * 心得带来的修行速度加成（需求 4：弟子探索后增加心得，加快进境）。
 *
 * 每点心得 +0.5%，上限随掌门境界增长（见 engine.getInsightMax）：
 * 炼气期 30 点（+15%）→ 渡劫期 270 点（+135%）。
 * （300 是「仙人」那一档，也就是 INSIGHT_MAX_ABSOLUTE，只用于存档清洗。）
 *
 * 早先上限写死 100 点（+100%），既是个墙（探索到顶之后心得就不涨了），
 * 又因为秘境从 8 处扩到 44 处而被摊薄到摸不着（实测最高 52）。
 * 现在上限跟着境界走，单点收益从 +1% 降到 +0.5% ——
 * 上限放开的同时不能让修行倍率随境界一起失控。
 */
export function getInsightSpeedBonus(state: GameState, disciple: Disciple): number {
  const capped = Math.min(disciple.insight, getInsightMax(state));
  return capped * INSIGHT_SPEED_PER_POINT;
}

/**
 * 弟子的综合修行速度倍率。
 *
 * = 资质 × (1 + 建筑 + 大比 + 心得)
 *
 * ⚠️ 这里原来是 `资质 × (1 + 心得) × 建筑大比` —— 心得和建筑是**两个乘区**，
 * 而且大比在建筑那一项里又是乘算 ×2，三者互相放大：
 * 满配时 (1 + 心得) × (1 + 建筑) × 2 能到 ×9 以上（更早一版的实测是 ×7.4）。
 * 现在三者全部并进同一个加算池：
 *   1 + 功法殿 80% + 讲道堂 50% + 大比 50% + 心得 135% = ×4.15
 * 好处不只是"数字变小"：加算池不会随着以后再加内容而互相放大。
 */
export function getDiscipleSpeed(state: GameState, disciple: Disciple): number {
  const aptitude = APTITUDE_MAP[disciple.aptitude].speed;
  return aptitude * (getCultivationSpeedMultiplier(state) + getInsightSpeedBonus(state, disciple));
}

export interface RecruitResult {
  state: GameState;
  disciple: Disciple | null;
  reason: string | null;
}

export function getRecruitCost(state: GameState): Decimal {
  return D(recruitCost(state.sect.level, state.sect.disciples.length));
}

export function canRecruit(state: GameState): { ok: boolean; reason: string | null } {
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  if (state.sect.disciples.length >= getDiscipleCapacity(state)) {
    return { ok: false, reason: '居所已满，需扩建或提升宗门品阶' };
  }
  if (state.resources.stone.lt(getRecruitCost(state))) {
    return { ok: false, reason: '灵石不足' };
  }
  return { ok: true, reason: null };
}

export function recruitDisciple(state: GameState, random: RandomSource = gameRandom): RecruitResult {
  const check = canRecruit(state);
  if (!check.ok) return { state, disciple: null, reason: check.reason };

  const cost = getRecruitCost(state);
  const disciple = rollDisciple(state.sect.level, state.nextDiscipleId, random);

  const next: GameState = {
    ...state,
    resources: { ...state.resources, stone: state.resources.stone.sub(cost) },
    sect: {
      ...state.sect,
      disciples: [...state.sect.disciples, disciple],
      totalRecruited: state.sect.totalRecruited + 1,
    },
    nextDiscipleId: state.nextDiscipleId + 1,
  };

  return { state: next, disciple, reason: null };
}

/** 逐出弟子（需求 7：后期清理低资质弟子） */
export function dismissDisciple(state: GameState, id: string): GameState {
  const disciple = state.sect.disciples.find((d) => d.id === id);
  if (!disciple || disciple.status === 'exploring') return state;

  return {
    ...state,
    sect: { ...state.sect, disciples: state.sect.disciples.filter((d) => d.id !== id) },
  };
}

/** 一次性逐出所有低于指定资质的空闲弟子 */
export function dismissBelowAptitude(state: GameState, keepFrom: number): { state: GameState; count: number } {
  const kept: Disciple[] = [];
  let removed = 0;
  for (const d of state.sect.disciples) {
    const rank = aptitudeRank(d.aptitude);
    if (d.status === 'idle' && rank < keepFrom) {
      removed += 1;
    } else {
      kept.push(d);
    }
  }
  if (removed === 0) return { state, count: 0 };
  return { state: { ...state, sect: { ...state.sect, disciples: kept } }, count: removed };
}

/* ------------------------------------------------------------------ */
/* 资质与战力                                                          */
/* ------------------------------------------------------------------ */

export function aptitudeRank(id: string): number {
  const index = APTITUDE_ORDER.indexOf(id as never);
  return index < 0 ? 0 : index;
}

/**
 * 弟子的战力（受境界、丹药增益、器物与宗门建筑加成影响）。
 *
 * 宗门建筑这一项是需求 4 的「武技阁」：声明了 `disciplePowerBonus: 0.08`
 * 却一度没接线 —— 界面上写着 +8%/座、模拟器也按它有值来估值，
 * 但实际战力算不出来。这是文档核对时被翻出来的。
 */
export function getDisciplePower(state: GameState, disciple: Disciple): number {
  const base = REALMS[Math.min(disciple.realmIndex, REALMS.length - 1)].power;
  const multiplier =
    state.buffs.powerMultiplier *
    (1 + getArtifactBonuses(state).combat + getStructureBonus(state, 'disciplePowerBonus'));
  return base * multiplier;
}

/** 探索队伍的总战力 */
export function getPartyPower(state: GameState, ids: string[]): number {
  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  return ids.reduce((sum, id) => {
    const d = byId.get(id);
    return d ? sum + getDisciplePower(state, d) : sum;
  }, 0);
}

/* ------------------------------------------------------------------ */
/* 时间推进                                                            */
/* ------------------------------------------------------------------ */

function pushJournal(journal: JournalEntry[], entry: JournalEntry): JournalEntry[] {
  const next = [entry, ...journal];
  return next.length > JOURNAL_LIMIT ? next.slice(0, JOURNAL_LIMIT) : next;
}

/**
 * 推进所有弟子的修炼与年龄。
 *
 * 返回新 state，同时把寿元耗尽 / 突破境界写进宗门记事。
 * 死去的弟子会从进行中的探索队伍里一并移除。
 */
export function tickDisciples(state: GameState, dt: number): GameState {
  if (state.sect.disciples.length === 0 || dt <= 0) return state;

  const years = (dt * GAME_DAYS_PER_SECOND) / GAME_DAYS_PER_YEAR;
  if (years <= 0) return state;

  const lifespanBonus = 1 + state.sect.lifespanBonus;
  const survivors: Disciple[] = [];
  const deadIds = new Set<string>();
  let journal = state.journal;
  let changed = false;

  for (const disciple of state.sect.disciples) {
    const age = disciple.age + years;
    /*
     * ⚠️ 年龄一变，这次推进就必然产生了新状态。
     *
     * 这一行是补上来的 bug 修复：`changed` 原先只在"突破 / 修为有变 / 死亡"时置位，
     * 于是**修为没有变化的弟子根本不会变老** —— 卡在境界上限、或者进度刚好
     * 四舍五入到同一个值的弟子，年龄会永远停在那里。
     * 加了纪年（需求 1）之后这个洞更明显：时间在走，人却不老。
     */
    changed = true;

    /* --- 修为推进：可能一次跨越多个境界（离线很久时） --- */
    const realmCap = getDiscipleRealmCap(state, disciple);
    let realmIndex = disciple.realmIndex;
    let progress = disciple.progress;
    // 心得与宗门建筑/大比都在这里一起生效（需求 4）
    let remaining = years * getDiscipleSpeed(state, disciple);
    let jumps = 0;

    while (remaining > 0 && realmIndex < realmCap && jumps < MAX_REALM_JUMPS) {
      const need = REALMS[realmIndex].cultivationYears;
      if (need <= 0) break;

      const toNext = need - progress;
      if (remaining >= toNext) {
        remaining -= toNext;
        realmIndex += 1;
        progress = 0;
        jumps += 1;
      } else {
        progress += remaining;
        remaining = 0;
      }
    }

    if (realmIndex !== disciple.realmIndex) {
      changed = true;
      journal = pushJournal(journal, {
        time: state.playTime,
        kind: 'good',
        text: `${disciple.name} 突破至${REALMS[realmIndex].name}`,
      });
    } else if (progress !== disciple.progress) {
      changed = true;
    }

    /* --- 寿元判定 --- */
    const lifespan = REALMS[realmIndex].lifespan * lifespanBonus;
    if (age > lifespan) {
      changed = true;
      deadIds.add(disciple.id);
      journal = pushJournal(journal, {
        time: state.playTime,
        kind: 'bad',
        text: `${disciple.name} 寿元耗尽，于${REALMS[realmIndex].name}坐化`,
      });
      continue;
    }

    survivors.push({ ...disciple, age, realmIndex, progress });
  }

  if (!changed) return state;

  /* --- 清理阵亡弟子所属的探索队伍 --- */
  let expeditions = state.expeditions;
  if (deadIds.size > 0) {
    expeditions = state.expeditions
      .map((e) => ({ ...e, discipleIds: e.discipleIds.filter((id) => !deadIds.has(id)) }))
      .filter((e) => e.discipleIds.length > 0);
  }

  return {
    ...state,
    sect: { ...state.sect, disciples: survivors },
    expeditions,
    journal,
  };
}

/** 把弟子标记为探索中 / 空闲 */
export function setDiscipleStatus(
  state: GameState,
  ids: string[],
  status: Disciple['status'],
  expeditionId?: string,
): GameState {
  const set = new Set(ids);
  return {
    ...state,
    sect: {
      ...state.sect,
      disciples: state.sect.disciples.map((d) =>
        set.has(d.id) ? { ...d, status, expeditionId: status === 'exploring' ? expeditionId : undefined } : d,
      ),
    },
  };
}

export { pushJournal };
