/**
 * 宗门大阵（需求 9）
 *
 * 需求原文：「符箓还可以增加设定，宗门大阵需要消耗符箓等等」。
 *
 * 为什么把"减伤"从护身符搬到这里：
 *   一张符换一趟免伤，是一次性、零维护的收益 —— 这正是需求 9 说的
 *   「符箓对秘境减伤的增益太大了」。改成大阵之后，同样的强度需要
 *   **长期烧符供养**：你烧得起，宗门就稳；烧不起，大阵自己就灭了。
 *
 * ⚠️ 大阵的消耗按**真实秒**算。`applyOffline` 会一次喂进几小时的 dt，
 * 所以这里必须先按 dt 把燃料算够、算不够就熄火 —— 不能让离线回来时
 * 大阵"欠"了一屁股符。
 */
import {
  SECT_ARRAY_BUILDING_ID,
  SECT_ARRAY_CULTIVATION,
  SECT_ARRAY_DEFENSE,
  SECT_ARRAY_DRAIN_PER_SECOND,
  SECT_ARRAY_HAPPINESS,
  TALISMANS,
  TALISMAN_FUEL_VALUE,
} from './content';
import { getBuildingCount } from './engine';
import { pushJournal } from './disciples';
import type { GameState } from './state';

/** 宗门里有没有大阵 */
export function hasSectArray(state: GameState): boolean {
  return getBuildingCount(state, SECT_ARRAY_BUILDING_ID) > 0;
}

/** 库存符箓能烧出多少"阵法燃料" */
export function getArrayFuel(state: GameState): number {
  let fuel = 0;
  for (const def of TALISMANS) {
    const count = state.talismans[def.id] ?? 0;
    fuel += count * (TALISMAN_FUEL_VALUE[def.grade] ?? 1);
  }
  return fuel;
}

/** 这些燃料还能烧多久（秒） */
export function getArraySecondsLeft(state: GameState): number {
  if (!state.sectArrayOn) return 0;
  return SECT_ARRAY_DRAIN_PER_SECOND > 0 ? Math.floor(getArrayFuel(state) / SECT_ARRAY_DRAIN_PER_SECOND) : 0;
}

export function canActivateArray(state: GameState): { ok: boolean; reason: string | null } {
  if (!hasSectArray(state)) return { ok: false, reason: '还没有宗门大阵（先去「建筑」页建一座）' };
  if (state.sectArrayOn) return { ok: false, reason: '大阵已经在运转' };
  if (getArrayFuel(state) <= 0) return { ok: false, reason: '符箓不够 —— 大阵要烧符才能起' };
  return { ok: true, reason: null };
}

export function activateArray(state: GameState): GameState {
  const check = canActivateArray(state);
  if (!check.ok) return state;
  return {
    ...state,
    sectArrayOn: true,
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'good',
      text: `宗门大阵启动：以符箓为薪，可维持约 ${Math.floor(getArrayFuel(state) / SECT_ARRAY_DRAIN_PER_SECOND / 60)} 分钟`,
    }),
  };
}

export function deactivateArray(state: GameState): GameState {
  if (!state.sectArrayOn) return state;
  return {
    ...state,
    sectArrayOn: false,
    journal: pushJournal(state.journal, { time: state.playTime, kind: 'info', text: '宗门大阵已停' }),
  };
}

/**
 * 烧符（需求 9）。
 *
 * 从**最低品阶**的符开始烧：好符（破境符之类）玩家另有大用，
 * 大阵先吃边角料 —— 这条规则让"我要不要留几张"这个问题有答案。
 */
export function burnFuel(state: GameState, fuelNeeded: number): { state: GameState; burned: number; out: boolean } {
  let remaining = fuelNeeded;
  const talismans = { ...state.talismans };
  let burned = 0;

  const order = [...TALISMANS].sort((a, b) => a.grade - b.grade);
  for (const def of order) {
    if (remaining <= 0) break;
    const value = TALISMAN_FUEL_VALUE[def.grade] ?? 1;
    let count = talismans[def.id] ?? 0;
    while (count > 0 && remaining > 0) {
      count -= 1;
      remaining -= value;
      burned += 1;
    }
    if (count > 0) talismans[def.id] = count;
    else delete talismans[def.id];
  }

  const out = remaining > 0;
  let next: GameState = { ...state, talismans };
  if (out) {
    next = {
      ...next,
      sectArrayOn: false,
      journal: pushJournal(next.journal, {
        time: next.playTime,
        kind: 'bad',
        text: '宗门大阵符尽而灭 —— 补几张符可以重新启动',
      }),
    };
  }
  return { state: next, burned, out };
}

/** 每帧推进：开着就烧符 */
export function tickSectArray(state: GameState, dt: number): GameState {
  if (!state.sectArrayOn || dt <= 0) return state;
  const needed = SECT_ARRAY_DRAIN_PER_SECOND * dt;
  return burnFuel(state, needed).state;
}

/* ------------------------------------------------------------------ */
/* 大阵给的三样东西                                                    */
/* ------------------------------------------------------------------ */

/** 宗门防御加成（大阵开着才算） */
export function getSectArrayDefense(state: GameState): number {
  return state.sectArrayOn ? SECT_ARRAY_DEFENSE : 0;
}

/** 全宗弟子修炼加成 */
export function getSectArrayCultivationBonus(state: GameState): number {
  return state.sectArrayOn ? SECT_ARRAY_CULTIVATION : 0;
}

/** 幸福度加成 */
export function getSectArrayHappiness(state: GameState): number {
  return state.sectArrayOn ? SECT_ARRAY_HAPPINESS : 0;
}
