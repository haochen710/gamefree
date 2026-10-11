/**
 * 善恶值与随机遭遇（需求 2）
 *
 * 需求原文：
 *   「增加随机事件，开宗前有遇到商队、不同npc等，对不同npc的选择可以获得
 *     不同奖励或者惩罚，人物增加善恶值设定。人物恶行值越高，突破时越容易
 *     遭受天雷之罚，导致突破失败（小境界突破也会），但是恶行值突破一定程度
 *     之后可以抢劫npc，获取大量材料，乃至部分稀有材料，但是几率不大。
 *     善行值越高，普通探索或者秘境探索产出有相应加成。」
 *
 * 拆成四条机制：
 *   1. **一条善恶轴**：`state.karma`，正 = 善、负 = 恶，范围 ±100。
 *      用一条轴而不是两个计数器，是因为"又善又恶"没有意义 ——
 *      而且两条计数器必须时时保证一正一负，反而更容易写错。
 *   2. **恶行 → 天雷之罚**：`getKarmaThunderPenalty()` 会同时作用在
 *      **大境界突破**（getSuccessRate）与**小境界参悟**（advanceLayer）上，
 *      需求里特意点了"小境界突破也会"。
 *   3. **善行 → 探索产出加成**：`getKarmaExploreBonus()`，
 *      作用在普通探索、秘境探索、掌门独自探秘境三处。
 *   4. **恶行解锁抢劫**：遭遇里的抢劫选项要求 `karma <= KARMA_ROB_THRESHOLD`，
 *      而且成功率一律不高（需求："几率不大"），失败还要吃道伤。
 *
 * 遭遇在**开宗前**随机出现（需求原文），另外掌门在外游历 / 独自探秘境时也会遇到 ——
 * 毕竟"在路上才会碰到人"。开宗之后安居山中，就不再有这些事了。
 */
import { D } from './decimal';
import {
  ENCOUNTERS,
  ENCOUNTER_MAP,
  optionRequiredItems,
  type EncounterDef,
  type EncounterOption,
} from './content/encounters';
import { ITEM_MAP, PILL_MAP, isBasicMaterial, type ItemId } from './content';
import { addItem } from './engine';
import { pushJournal } from './disciples';
import { gameRandom, weightedDraw, type RandomSource } from './random';
import type { GameState } from './state';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

export const KARMA_MIN = -100;
export const KARMA_MAX = 100;
/** 恶行值低到这个数以下，遭遇里才会出现"抢劫"选项 */
export const KARMA_ROB_THRESHOLD = -30;
/** 恶行值拉满时，突破成功率最多下降这么多 */
export const KARMA_THUNDER_MAX = 0.35;
/** 善行值拉满时，探索产出最多提高这么多 */
export const KARMA_EXPLORE_BONUS_MAX = 0.3;
/**
 * 突破成功率的下限。
 *
 * 天雷之罚再重也不能把成功率压到 0 —— 那会让"作恶"直接变成死路，
 * 玩家只会读档。留 15% 是让恶行线"难受但走得通"。
 */
export const KARMA_SUCCESS_FLOOR = 0.15;
/** 小境界参悟被天雷打断时的道伤秒数（比大境界失败轻得多） */
export const KARMA_LAYER_FAIL_INJURY = 120;

/** 每隔多少真实秒判定一次遭遇 */
export const ENCOUNTER_INTERVAL = 100;
/** 判定时的命中概率 */
export const ENCOUNTER_CHANCE = 0.45;

/* ------------------------------------------------------------------ */
/* 善恶值                                                              */
/* ------------------------------------------------------------------ */

export interface KarmaLabel {
  name: string;
  icon: string;
  /** 界面配色用的语义 */
  tone: 'good' | 'neutral' | 'evil';
}

/** 当前善恶值（夹在 ±100） */
export function getKarma(state: GameState): number {
  return Math.max(KARMA_MIN, Math.min(KARMA_MAX, state.karma));
}

/** 恶行值（0~100，越大越恶） */
export function getEvil(state: GameState): number {
  return Math.max(0, -getKarma(state));
}

/** 善行值（0~100，越大越善） */
export function getVirtue(state: GameState): number {
  return Math.max(0, getKarma(state));
}

export function getKarmaLabel(state: GameState): KarmaLabel {
  const k = getKarma(state);
  if (k >= 60) return { name: '大善', icon: '😇', tone: 'good' };
  if (k >= 20) return { name: '行善', icon: '🙂', tone: 'good' };
  if (k > -20) return { name: '中立', icon: '😐', tone: 'neutral' };
  if (k > -60) return { name: '作恶', icon: '😠', tone: 'evil' };
  return { name: '大恶', icon: '😈', tone: 'evil' };
}

/** 恶行值带来的突破失败加成（0 ~ KARMA_THUNDER_MAX），越大越容易挨天雷 */
export function getKarmaThunderPenalty(state: GameState): number {
  return (getEvil(state) / 100) * KARMA_THUNDER_MAX;
}

/** 善行值带来的探索产出加成（0 ~ KARMA_EXPLORE_BONUS_MAX） */
export function getKarmaExploreBonus(state: GameState): number {
  return (getVirtue(state) / 100) * KARMA_EXPLORE_BONUS_MAX;
}

/** 能不能抢劫（恶行值到位） */
export function canRob(state: GameState): boolean {
  return getKarma(state) <= KARMA_ROB_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/* 遭遇的触发                                                          */
/* ------------------------------------------------------------------ */

/**
 * 现在会不会遇到人。
 *
 * 需求写的是"开宗前"，所以开宗之后就不再随机遭遇了；
 * 但掌门**在外**（游历 / 独自探秘境）时例外 —— 人在路上，遇到商队与 NPC 很自然。
 */
export function canRollEncounter(state: GameState): boolean {
  if (state.pendingEncounter) return false;
  return !state.sect.founded || state.personalTravel !== null;
}

export function tickEncounters(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (dt <= 0) return state;
  if (!canRollEncounter(state)) return state;

  const timer = state.encounterTimer + dt;
  if (timer < ENCOUNTER_INTERVAL) return { ...state, encounterTimer: timer };

  // 到点了：掷一次，不管中不中，计时都归零
  const rest = timer - ENCOUNTER_INTERVAL;
  if (random() >= ENCOUNTER_CHANCE) return { ...state, encounterTimer: rest };

  const [picked] = weightedDraw(
    ENCOUNTERS.map((e) => ({ id: e.id, weight: e.weight })),
    1,
    random,
  );
  if (!picked) return { ...state, encounterTimer: rest };

  const def = ENCOUNTER_MAP[picked.id];
  return {
    ...state,
    encounterTimer: rest,
    pendingEncounter: picked.id,
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'info',
      text: `路上遇到了${def.icon}${def.name}`,
    }),
  };
}

/** 手动触发一次遭遇（模拟器与测试用，省得等计时器） */
export function rollEncounterNow(state: GameState, random: RandomSource = gameRandom): GameState {
  if (state.pendingEncounter) return state;
  const [picked] = weightedDraw(
    ENCOUNTERS.map((e) => ({ id: e.id, weight: e.weight })),
    1,
    random,
  );
  if (!picked) return state;
  return { ...state, pendingEncounter: picked.id };
}

/* ------------------------------------------------------------------ */
/* 选项                                                                */
/* ------------------------------------------------------------------ */

/** 当前待选遭遇的定义（没有则 null） */
export function getPendingEncounter(state: GameState): EncounterDef | null {
  return state.pendingEncounter ? (ENCOUNTER_MAP[state.pendingEncounter] ?? null) : null;
}

/** 某个选项现在可不可选 */
export function canChooseOption(
  state: GameState,
  option: EncounterOption,
): { ok: boolean; reason: string | null } {
  if (option.requiresKarmaAtMost !== undefined && getKarma(state) > option.requiresKarmaAtMost) {
    return { ok: false, reason: `恶行值需低于 ${option.requiresKarmaAtMost}` };
  }
  if (option.requiresKarmaAtLeast !== undefined && getKarma(state) < option.requiresKarmaAtLeast) {
    return { ok: false, reason: `善行值需高于 ${option.requiresKarmaAtLeast}` };
  }
  const need = optionRequiredItems(option);
  for (const [item, amount] of Object.entries(need)) {
    const have = itemHave(state, item as ItemId);
    if (have < (amount as number)) {
      return { ok: false, reason: `${ITEM_MAP[item as ItemId]?.name ?? item}不足` };
    }
  }
  return { ok: true, reason: null };
}

function itemHave(state: GameState, item: ItemId): number {
  if (item in state.resources) {
    return (state.resources as Record<string, { toNumber: () => number }>)[item].toNumber();
  }
  if (item in state.materials) {
    return (state.materials as Record<string, { toNumber: () => number }>)[item].toNumber();
  }
  return state.pills[item] ?? 0;
}

export interface EncounterOutcome {
  text: string;
  /** 实际拿到（正）或失去（负）的东西，界面用来做小结 */
  gains: { id: ItemId; name: string; icon: string; amount: number }[];
  karmaDelta: number;
  success: boolean;
}

/**
 * 选择某个选项并结算。
 *
 * 结算顺序：先判成败（抢劫类才有），再算收获，最后扣善恶值。
 * 注意**善恶值一定是按选项写的值加**，哪怕抢劫失败 ——
 * "动了手"这件事本身就已经是恶行了。
 */
export function chooseEncounterOption(
  state: GameState,
  index: number,
  random: RandomSource = gameRandom,
): { state: GameState; outcome: EncounterOutcome | null } {
  const def = getPendingEncounter(state);
  if (!def) return { state, outcome: null };
  const option = def.options[index];
  if (!option) return { state, outcome: null };
  if (!canChooseOption(state, option).ok) return { state, outcome: null };

  const effect = option.effect;
  const rolls = effect.successChance !== undefined ? random() < effect.successChance : true;
  const items = rolls ? { ...(effect.items ?? {}), ...(effect.successItems ?? {}) } : { ...(effect.items ?? {}) };

  let working = state;
  const gains: EncounterOutcome['gains'] = [];
  for (const [item, raw] of Object.entries(items)) {
    const amount = raw as number;
    if (amount === 0) continue;
    working = addItem(working, item as ItemId, D(amount));
    gains.push({
      id: item as ItemId,
      name: (ITEM_MAP[item as ItemId] ?? PILL_MAP?.[item])?.name ?? item,
      icon: (ITEM_MAP[item as ItemId] ?? PILL_MAP?.[item])?.icon ?? '❓',
      amount,
    });
  }

  const karma = Math.max(KARMA_MIN, Math.min(KARMA_MAX, working.karma + effect.karma));
  const injury = (rolls ? 0 : (effect.failInjury ?? 0)) + (rolls ? (effect.injury ?? 0) : 0);

  let journal = working.journal;
  journal = pushJournal(journal, {
    time: working.playTime,
    kind: rolls && effect.karma >= 0 ? 'good' : effect.karma < 0 ? 'bad' : 'info',
    text: `${def.name}：${rolls ? option.result : (option.failResult ?? option.result)}`,
  });

  const next: GameState = {
    ...working,
    karma,
    injurySeconds: Math.max(working.injurySeconds, injury),
    pendingEncounter: null,
    journal,
  };

  return {
    state: next,
    outcome: {
      text: rolls ? option.result : (option.failResult ?? option.result),
      gains,
      karmaDelta: effect.karma,
      success: rolls,
    },
  };
}

/** 界面用的掉落预览文案 */
export function describeOption(option: EncounterOption): string {
  const parts: string[] = [];
  const k = option.effect.karma;
  if (k !== 0) parts.push(`善恶 ${k > 0 ? '+' : ''}${k}`);
  for (const [item, amount] of Object.entries(option.effect.items ?? {})) {
    const n = amount as number;
    if (n === 0) continue;
    parts.push(`${ITEM_MAP[item as ItemId]?.icon ?? ''}${ITEM_MAP[item as ItemId]?.name ?? item}${n > 0 ? '+' : ''}${n}`);
  }
  if (option.effect.successChance !== undefined) {
    parts.push(`成功率 ${Math.round(option.effect.successChance * 100)}%`);
  }
  if (option.effect.failInjury) parts.push(`失败道伤 ${option.effect.failInjury} 秒`);
  return parts.join(' · ');
}

/** 善行值与基础材料的加成不叠加（季节管那件事），这里只用于文案提醒 */
export function isKarmaRelevantItem(item: ItemId): boolean {
  return isBasicMaterial(item);
}
