/**
 * 宗门日常活动（需求 4）
 *
 * 三件事，全部围绕「弟子用建筑」展开：
 *   1. 随机事件 —— 弟子自发去武技阁 / 功法殿 / 通天塔，各得好处；
 *   2. 心得     —— 探索与事件积累，直接加快该弟子的修行；
 *   3. 大比     —— 只有比武台例外：玩家开关，十年一次，
 *                  比完全宗弟子修行加速一年。
 *
 * 依赖关系：本模块依赖 engine（拿建筑加成）与 disciples（推进入口），
 * 不依赖 expeditions —— 秘境结算里的心得是直接写进弟子对象的。
 */
import {
  ARENA_BUFF_GAME_YEARS,
  ARENA_INSIGHT_REWARD,
  ARENA_INTERVAL_GAME_YEARS,
  ARENA_REQUIRED_BUILDING,
  DEMON_RELIEF_ARENA,
  EVENT_CULTIVATE_RATIO,
  EVENT_MARTIAL_INSIGHT,
  EVENT_TOWER_DISCOVERY_PITY,
  EVENT_TOWER_INSIGHT,
  GAME_DAYS_PER_SECOND,
  GAME_DAYS_PER_YEAR,
  REALMS,
  SECT_EVENT_CHANCE,
  SECT_EVENT_INTERVAL,
  STRUCTURES,
  type SectEventKind,
} from './content';
import { getBuildingCount, getInsightMax, getStructureBonus } from './engine';
import { clampDemon, pushJournal } from './disciples';
import { grantArenaManuals } from './manuals';
import { gameRandom, type RandomSource } from './random';
import type { Disciple, GameState } from './state';

/* ------------------------------------------------------------------ */
/* 换算：游戏年 ↔ 真实秒                                                */
/* ------------------------------------------------------------------ */

/** 1 游戏年 = 多少真实秒 */
export const SECONDS_PER_GAME_YEAR = GAME_DAYS_PER_YEAR / GAME_DAYS_PER_SECOND;

/** 大比间隔（秒）：十年一次 */
export const ARENA_INTERVAL_SECONDS = ARENA_INTERVAL_GAME_YEARS * SECONDS_PER_GAME_YEAR;

/** 大比加成持续时间（秒）：一年 */
export const ARENA_BUFF_SECONDS = ARENA_BUFF_GAME_YEARS * SECONDS_PER_GAME_YEAR;

/* ------------------------------------------------------------------ */
/* 比武台（大比）                                                       */
/* ------------------------------------------------------------------ */

/** 玩家是否已建成比武台 */
export function hasArena(state: GameState): boolean {
  return getBuildingCount(state, ARENA_REQUIRED_BUILDING) > 0;
}

/** 大比是否正在生效（弟子修行加速中） */
export function isArenaBuffActive(state: GameState): boolean {
  return state.arenaBuffSeconds > 0;
}


/**
 * 大比是否已开启。
 *
 * 需求明文「比武台由玩家决定是否开启」，所以这里同时要求
 * 玩家点过开关、且比武台确实建成了 —— 拆掉比武台就自动停办。
 */
export function isArenaRunning(state: GameState): boolean {
  return hasArena(state) && state.arenaEnabled;
}

/** 距离下次大比还有多少秒；未开启时返回 null */
export function getArenaCountdown(state: GameState): number | null {
  if (!isArenaRunning(state)) return null;
  return Math.max(0, state.arenaTimer);
}

export interface ArenaResult {
  state: GameState;
  /** 参比弟子数 */
  participants: number;
}

/** 举办一次大比：全宗弟子得心得、心魔稍减，并获得一年的修行加速 */
export function runArena(state: GameState): ArenaResult {
  const disciples = state.sect.disciples;
  if (disciples.length === 0) {
    return { state: { ...state, arenaTimer: ARENA_INTERVAL_SECONDS }, participants: 0 };
  }

  const bonus = 1 + getStructureBonus(state, 'insightBonus');
  const reward = Math.max(1, Math.round(ARENA_INSIGHT_REWARD * bonus));

  /*
   * 论道大比也是功法碎片的一条来源（设定集第 7 章：第一名上品碎片×2、
   * 二三名良品碎片×2、参与奖凡品碎片×1）。这里按名额各抽一本功法发碎片 ——
   * 具体发给谁不影响结果（碎片进的是宗门仓库），所以不必真的排名。
   */
  const manualReward = grantArenaManuals(
    {
      ...state,
      sect: {
        ...state.sect,
        disciples: disciples.map((d) => ({
          ...d,
          insight: Math.min(getInsightMax(state), d.insight + reward),
          demon: clampDemon(d.demon - DEMON_RELIEF_ARENA),
        })),
      },
    },
    gameRandom,
  );

  return {
    state: {
      ...manualReward.state,
      arenaTimer: ARENA_INTERVAL_SECONDS,
      arenaBuffSeconds: ARENA_BUFF_SECONDS,
      journal: pushJournal(state.journal, {
        time: state.playTime,
        kind: 'good',
        text:
          `宗门大比落幕，弟子们各有所得（心得 +${reward}、心魔 −${DEMON_RELIEF_ARENA}` +
          `${manualReward.notes.length > 0 ? `、${manualReward.notes.join('、')}` : ''}），` +
          '全宗修行速度大增，持续一年',
      }),
    },
    participants: disciples.length,
  };
}

/** 大比计时（含加成倒计时） */
export function tickArena(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  let next = state;
  let changed = false;

  // 加速倒计时独立于是否开启大比 —— 关掉比武台不该取消已经拿到的奖励
  if (next.arenaBuffSeconds > 0) {
    next = { ...next, arenaBuffSeconds: Math.max(0, next.arenaBuffSeconds - dt) };
    changed = true;
  }

  if (!isArenaRunning(next)) return changed ? next : state;

  const timer = next.arenaTimer - dt;
  if (timer > 0) return { ...next, arenaTimer: timer };

  return runArena({ ...next, arenaTimer: 0 }).state;
}

/* ------------------------------------------------------------------ */
/* 随机事件（弟子自发使用宗门建筑）                                      */
/* ------------------------------------------------------------------ */

/** 已建成、且支持随机事件的宗门建筑 */
export function getEventBuildings(state: GameState): { id: string; name: string; icon: string; kind: SectEventKind }[] {
  return STRUCTURES.filter(
    (def) => def.sectEvent && getBuildingCount(state, def.id) > 0,
  ).map((def) => ({
    id: def.id,
    name: def.name,
    icon: def.icon,
    kind: def.sectEvent as SectEventKind,
  }));
}

export interface SectEventResult {
  state: GameState;
  text: string | null;
}

/**
 * 一名弟子用一次宗门建筑。
 *
 * 效果按建筑类型分三种，都写进宗门记事 —— 需求要的是
 * "弟子使用这些建筑为随机事件"，那就得让玩家看得见它发生了。
 */
function applyEvent(
  state: GameState,
  disciple: Disciple,
  building: { name: string; icon: string; kind: SectEventKind },
  random: RandomSource,
): SectEventResult {
  const bonus = 1 + getStructureBonus(state, 'insightBonus');

  switch (building.kind) {
    case 'cultivate': {
      // 功法殿：直接推进一截修为（按本境界总年数的比例）
      const realm = REALMS[Math.min(disciple.realmIndex, REALMS.length - 1)];
      const gain = Math.max(0.5, realm.cultivationYears * EVENT_CULTIVATE_RATIO);
      return {
        state: {
          ...state,
          sect: {
            ...state.sect,
            disciples: state.sect.disciples.map((d) =>
              d.id === disciple.id ? { ...d, progress: d.progress + gain } : d,
            ),
          },
        },
        text: `${disciple.name} 于${building.name}参悟${Math.round(gain)}年，修为大进`,
      };
    }

    case 'insight': {
      const gain = Math.max(1, Math.round(EVENT_MARTIAL_INSIGHT * bonus));
      return {
        state: {
          ...state,
          sect: {
            ...state.sect,
            disciples: state.sect.disciples.map((d) =>
              d.id === disciple.id ? { ...d, insight: Math.min(getInsightMax(state), d.insight + gain) } : d,
            ),
          },
        },
        text: `${disciple.name} 入${building.name}研习，心得 +${gain}`,
      };
    }

    case 'discover': {
      // 通天塔：心得 + 一份发现保底（相当于一次没探到秘境的探索）
      const gain = Math.max(1, Math.round(EVENT_TOWER_INSIGHT * bonus));
      const found = random() < 0.5;
      return {
        state: {
          ...state,
          discoveryFailures: Math.max(0, state.discoveryFailures - EVENT_TOWER_DISCOVERY_PITY),
          sect: {
            ...state.sect,
            disciples: state.sect.disciples.map((d) =>
              d.id === disciple.id ? { ...d, insight: Math.min(getInsightMax(state), d.insight + gain) } : d,
            ),
          },
        },
        text: found
          ? `${disciple.name} 登${building.name}远眺，隐约望见远处有异象（心得 +${gain}）`
          : `${disciple.name} 登${building.name}远眺，心得 +${gain}`,
      };
    }

    default:
      return { state, text: null };
  }
}

/** 判定一次随机事件；未触发时返回原状态 */
export function rollSectEvent(state: GameState, random: RandomSource = gameRandom): SectEventResult {
  if (!state.sect.founded) return { state, text: null };

  const idle = state.sect.disciples.filter((d) => d.status === 'idle');
  const buildings = getEventBuildings(state);
  if (idle.length === 0 || buildings.length === 0) return { state, text: null };
  if (random() >= SECT_EVENT_CHANCE) return { state, text: null };

  const disciple = idle[Math.min(idle.length - 1, Math.floor(random() * idle.length))];
  const building = buildings[Math.min(buildings.length - 1, Math.floor(random() * buildings.length))];

  const result = applyEvent(state, disciple, building, random);
  if (!result.text) return { state, text: null };

  return {
    state: {
      ...result.state,
      journal: pushJournal(result.state.journal, {
        time: result.state.playTime,
        kind: 'good',
        text: result.text,
      }),
    },
    text: result.text,
  };
}

/**
 * 随机事件计时。
 *
 * 用"固定间隔 + 概率"而不是每帧掷骰：后者在 30fps 下会把概率放大 30 倍，
 * 而且离线结算时行为完全不同。
 */
export function tickSectEvents(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (dt <= 0 || !state.sect.founded) return state;

  const timer = state.sectEventTimer + dt;
  const rolls = Math.floor(timer / SECT_EVENT_INTERVAL);
  if (rolls <= 0) return { ...state, sectEventTimer: timer };

  let working: GameState = { ...state, sectEventTimer: timer - rolls * SECT_EVENT_INTERVAL };
  // 离线很久时不要真跑几百次判定，最多补 8 次
  const capped = Math.min(rolls, 8);
  for (let i = 0; i < capped; i += 1) {
    working = rollSectEvent(working, random).state;
  }
  return working;
}
