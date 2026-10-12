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
  isAttackEncounter,
  optionRequiredItems,
  playerEncounters,
  sectEncounters,
  type EncounterDef,
  type EncounterOption,
} from './content/encounters';

// 再导出一次：调用方（界面 / 测试）只 import 这一处就够了
export { isAttackEncounter, playerEncounters, sectEncounters };
import { ITEM_MAP, PILL_MAP, isBasicMaterial, type ItemId } from './content';
import { addItem, getStructureBonus, getTraitEffect } from './engine';
import { getSectTalentDefense, pushJournal } from './disciples';
import { changeFame, fameFromKarma } from './fame';
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

/**
 * 每隔多少真实秒判定一次遭遇。
 *
 * ⚠️ 这两个数（间隔 150 秒 / 命中 35%）是**调低过一轮**的：
 * 原来 100 秒 × 45%，平均 3.7 分钟就弹一个。加上"计时器会累积"那个 bug，
 * 玩家点掉一个立刻又弹一个。现在平均约 7 分钟一次 ——
 * 随机事件该是"路上遇到的事"，不是"每隔几分钟必须处理的一条通知"。
 */
export const ENCOUNTER_INTERVAL = 150;
/** 判定时的命中概率 */
export const ENCOUNTER_CHANCE = 0.35;

/**
 * 遭遇在屏幕上停留多久（需求 1：「针对玩家的随机事件持续30秒」）。
 *
 * 到点没做选择：
 *   - 玩家事件与普通宗门事件 → **自动消失、没有影响**；
 *   - 宗门**进攻类**事件 → **照常结算**（需求原文：「正常进行和结算」），
 *     按最坏的情况算，损失由宗门防御减免。
 */
export const ENCOUNTER_SECONDS = 30;

/** 进攻类事件的强度随掌门境界放大的系数 */
export const ATTACK_REALM_SCALE = 0.08;
/** 一次进攻最多打掉多少比例的资源 */
export const ATTACK_MAX_RESOURCE_LOSS = 0.12;
/** 一次进攻最多打伤多少比例的弟子 */
export const ATTACK_MAX_CASUALTY_RATIO = 0.35;

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
 * 现在会不会遇到事（需求 1 改了这条）。
 *
 * 原先只在"未开宗"或"掌门在外"时触发；需求 1 明确要求
 * 「随机事件开宗后也会遇到，只是会增加针对宗门的事件」，
 * 所以现在**任何时候都可能遇到**，只是池子不同：
 *   未开宗 → 只有玩家事件；开宗后 → 玩家事件 + 宗门事件。
 */
export function canRollEncounter(state: GameState): boolean {
  return !state.pendingEncounter;
}

/** 按当前状态决定这次该从哪个池子里抽 */
function encounterPool(state: GameState): EncounterDef[] {
  if (!state.sect.founded) return playerEncounters();
  return ENCOUNTERS;
}

export function tickEncounters(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (dt <= 0) return state;

  /*
   * 先处理"已经在屏幕上的那个"。
   *
   * 需求 1 把两种事件的到期行为分开了：
   *   - 进攻类：**照常结算**（不选就是最坏结果）；
   *   - 其余：消失，什么都不发生。
   * 注意倒计时用的是**真实秒**，与日历无关 —— 30 秒是给坐在屏幕前的人看的。
   *
   * ⚠️ 这里有一个"离线把遭遇冲掉"的坑（本轮修的）：
   * 离线结算（`applyOffline`）会把几小时的 dt 一次喂进来，于是
   * `deadline = 30 - 10800 < 0` —— 玩家一打开游戏，屏幕上那个遭遇
   * **还没来得及看就已经"照常结算"了**（进攻类还会顺手扣资源、给道伤）。
   * 现在：dt 一旦超过倒计时本身，就当作"这个遭遇刚刚出现"，
   * 把倒计时重置回满，让玩家自己决定。倒计时只属于"人在屏幕前"的时间。
   */
  if (state.pendingEncounter) {
    if (dt >= ENCOUNTER_SECONDS) return { ...state, encounterDeadline: ENCOUNTER_SECONDS };
    const deadline = state.encounterDeadline - dt;
    if (deadline > 0) return { ...state, encounterDeadline: deadline };

    const def = ENCOUNTER_MAP[state.pendingEncounter];
    const cleared: GameState = { ...state, pendingEncounter: null, encounterDeadline: 0 };
    if (!def) return cleared;
    if (isAttackEncounter(def)) return resolveAttack(cleared, def);
    return {
      ...cleared,
      journal: pushJournal(cleared.journal, {
        time: cleared.playTime,
        kind: 'info',
        text: `${def.icon}${def.name}：你没有理会，事情就这么过去了。`,
      }),
    };
  }

  /*
   * ⚠️ 计时器**不能累积**（本轮修的第二个坑）。
   *
   * 原来写的是 `timer = state.encounterTimer + dt`，而离线一小时之后
   * dt = 3600 → timer = 3600，掷一次、把剩下的 3499 秒留着当计时器；
   * 玩家点掉这个遭遇，下一帧 timer 又 ≥ 间隔，立刻再弹一个 ——
   * 于是"点了一个马上又来下一个"，连着弹十几次才把攒下的时间用完。
   *
   * 现在封顶在 ENCOUNTER_INTERVAL，而且每次掷完都归零：
   * **一次离线最多补一次判定**，随机事件的时间线不会被压缩。
   */
  const timer = Math.min(state.encounterTimer + dt, ENCOUNTER_INTERVAL);
  if (timer < ENCOUNTER_INTERVAL) return { ...state, encounterTimer: timer };

  // 到点了：掷一次，不管中不中，计时都归零
  if (random() >= ENCOUNTER_CHANCE) return { ...state, encounterTimer: 0 };

  const pool = encounterPool(state);
  if (pool.length === 0) return { ...state, encounterTimer: 0 };

  const [picked] = weightedDraw(
    pool.map((e) => ({ id: e.id, weight: e.weight })),
    1,
    random,
  );
  if (!picked) return { ...state, encounterTimer: 0 };

  return openEncounter({ ...state, encounterTimer: 0 }, picked.id);
}

/** 把一条遭遇挂到屏幕上，并开始 30 秒倒计时 */
export function openEncounter(state: GameState, id: string): GameState {
  const def = ENCOUNTER_MAP[id];
  if (!def) return state;
  return {
    ...state,
    pendingEncounter: id,
    encounterDeadline: ENCOUNTER_SECONDS,
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: isAttackEncounter(def) ? 'bad' : 'info',
      text: `${def.icon}${def.name}${isAttackEncounter(def) ? '（进攻宗门！不处理就会照常结算）' : ''}`,
    }),
  };
}

/** 手动触发一次遭遇（模拟器与测试用，省得等计时器） */
export function rollEncounterNow(state: GameState, random: RandomSource = gameRandom): GameState {
  if (state.pendingEncounter) return state;
  const pool = encounterPool(state);
  const [picked] = weightedDraw(
    pool.map((e) => ({ id: e.id, weight: e.weight })),
    1,
    random,
  );
  return picked ? openEncounter(state, picked.id) : state;
}

/* ------------------------------------------------------------------ */
/* 宗门防御与进攻结算（需求 1）                                          */
/* ------------------------------------------------------------------ */

/**
 * 宗门防御总强度（0 起步，可以超过 1 —— 超过 1 就是"完全挡下"）。
 *
 * 两条来源：
 *   1. **建筑**（护山大阵 / 周天星斗大阵 / 混元无极阵，`sectDefense`）；
 *   2. **弟子的战斗天赋与性格**（设定集第 8.3 / 8.5 章：铁甲体魄"妖兽袭宗防御判定 +12"、
 *      好战"妖兽袭宗防御判定 +8"）。
 *
 * ⚠️ 第 2 条本轮差点变成一句空话：`disciples.getSectTalentDefense` 当时写好了
 * 却**一个调用点都没有** —— 天赋描述里写着"+5 宗门防御"、实现里永远不生效，
 * 界面还理直气壮地把它显示出来。现在它在这里被真正读到了。
 * 口径是"取全宗最高一项"，不是按人头叠加（否则一千个铁甲体魄就是无敌）。
 */
export function getSectDefense(state: GameState): number {
  // 三条来源：建筑 + 弟子的战斗天赋/性格 + 先天特质「铁血军魂」
  return (
    getStructureBonus(state, 'sectDefense') +
    getSectTalentDefense(state) +
    getTraitEffect(state, 'sectDefense', 0)
  );
}

export interface AttackOutcome {
  /** 实际烈度 0~1 */
  severity: number;
  /** 被防御削掉的比例 0~1 */
  blocked: number;
  /** 受伤（道伤）的弟子名 */
  casualties: string[];
  /** 损失的资源 */
  lost: { id: ItemId; name: string; icon: string; amount: number }[];
  text: string;
}

/**
 * 结算一次进攻（需求 1）。
 *
 * 烈度 = 强度 × 境界系数 × (1 − 防御)，再夹到上限。
 * 防御来自「宗门大阵」这类建筑的 `sectDefense`，可以累加到 1 以上 ——
 * 那时烈度为 0，也就是需求说的「减少**乃至避免**弟子伤亡」。
 */
export function resolveAttack(
  state: GameState,
  def: EncounterDef,
): GameState {
  const attack = def.attack;
  if (!attack) return state;

  const raw = attack.power * (1 + state.realmIndex * ATTACK_REALM_SCALE);
  const defense = getSectDefense(state);
  const severity = Math.max(0, Math.min(0.8, raw * Math.max(0, 1 - defense)));
  const blocked = defense >= 1 ? 1 : Math.min(1, defense);

  const text = attack.desc;

  // 挡得干干净净：只留一笔记事，不掉人也不掉东西
  if (severity <= 0) {
    return {
      ...state,
      journal: pushJournal(state.journal, {
        time: state.playTime,
        kind: 'good',
        text: `${def.name}：大阵光华流转，来犯者连山门都没能靠近。`,
      }),
    };
  }

  /* ---- 1. 弟子受伤（按比例，至少一个） ---- */
  const disciples = state.sect.disciples;
  const hurtCount = Math.min(
    disciples.length,
    Math.max(
      severity > 0 && disciples.length > 0 ? 1 : 0,
      Math.round(disciples.length * severity * ATTACK_MAX_CASUALTY_RATIO),
    ),
  );
  const casualties: string[] = [];
  if (hurtCount > 0) {
    // 从后往前挑：战力最低的弟子最先受伤（强者顶在前面）
    const ordered = [...disciples].sort((a, b) => a.realmIndex - b.realmIndex);
    for (const d of ordered.slice(0, hurtCount)) casualties.push(d.name);
  }

  /* ---- 2. 资源损失 ---- */
  const lost: AttackOutcome['lost'] = [];
  let working = state;
  const resources: Record<string, typeof state.resources.qi> = { ...state.resources };
  for (const [id, have] of Object.entries(resources)) {
    const amount = have.mul(severity * ATTACK_MAX_RESOURCE_LOSS);
    if (amount.lte(0)) continue;
    resources[id] = have.sub(amount);
    lost.push({
      id: id as ItemId,
      name: ITEM_MAP[id as ItemId]?.name ?? id,
      icon: ITEM_MAP[id as ItemId]?.icon ?? '❓',
      amount: amount.toNumber(),
    });
  }
  working = { ...working, resources: resources as typeof state.resources };

  /*
   * ---- 3. 受伤的弟子 ----
   *
   * ⚠️ 这里**不再给掌门道伤**（本轮修的第三个坑，也是玩家报的那个 bug）。
   *
   * 原来的实现是 `injurySeconds: max(..., 60 + severity*600)` ——
   * 宗门被袭、掌门没出手，掌门却照样"道伤缠身"。而界面上「道伤」这块
   * 写的是"**突破失败**将道伤缠身 / 还需 X 才能再次突破"，
   * 于是玩家看到的是"我什么都没点，怎么就不能突破了"。
   *
   * 道伤现在的来源收紧成**只有玩家自己的修行动作**：
   *   1. 大境界突破失败（engine.breakthrough）；
   *   2. 恶行值下参悟小境界被天雷打断（engine.advanceLayer）。
   * 至于"掌门亲自迎敌"那种**玩家主动选的**选项，它自己的 `effect.injury`
   * 仍然照旧生效 —— 那是玩家自己选的伤，与这条无关。
   *
   * 被袭击的代价落在**资源**上（上面那一段），这与"不处理就是最坏结果"
   * 的设计一致：不理会进攻 = 库房被搬走一批，而不是掌门莫名其妙受内伤。
   */
  const hurtSet = new Set(casualties.map((n) => n));
  const updated = working.sect.disciples.map((d) =>
    hurtSet.has(d.name) ? { ...d, status: 'idle' as const, expeditionId: undefined } : d,
  );

  const summary = lost
    .filter((l) => l.amount >= 1)
    .slice(0, 4)
    .map((l) => `${l.icon}${l.name}−${Math.round(l.amount)}`)
    .join(' ');

  return {
    ...working,
    sect: { ...working.sect, disciples: updated },
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'bad',
      text:
        `${def.name}：${text}` +
        `${casualties.length > 0 ? ` 弟子受伤 ${casualties.length} 人（${casualties.slice(0, 3).join('、')}${casualties.length > 3 ? '…' : ''}）` : ' 弟子无恙'}` +
        `${blocked > 0 ? `，大阵挡下 ${Math.round(blocked * 100)}%` : ''}` +
        `${summary ? `，损失 ${summary}` : ''}`,
    }),
  };
}

/** 界面用：把一次进攻的预期后果算出来（不真的结算） */
export function previewAttack(state: GameState, def: EncounterDef): AttackOutcome | null {
  const attack = def.attack;
  if (!attack) return null;
  const raw = attack.power * (1 + state.realmIndex * ATTACK_REALM_SCALE);
  const defense = getSectDefense(state);
  const severity = Math.max(0, Math.min(0.8, raw * Math.max(0, 1 - defense)));
  const count = Math.min(
    state.sect.disciples.length,
    Math.max(
      severity > 0 && state.sect.disciples.length > 0 ? 1 : 0,
      Math.round(state.sect.disciples.length * severity * ATTACK_MAX_CASUALTY_RATIO),
    ),
  );
  return {
    severity,
    blocked: defense >= 1 ? 1 : Math.min(1, defense),
    casualties: state.sect.disciples.slice(0, count).map((d) => d.name),
    lost: [],
    text: attack.desc,
  };
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

  /*
   * 善行 → 声望（设定集第 9 章：善行也能挣名声）。
   *
   * 这一条原本只有 fameFromKarma 这个函数、没有任何调用点 —— 又一个"写了没人读"。
   * 接在这里是因为**这里是全局唯一改 karma 的地方**，接在这里就不会漏掉任何一条善行。
   * 只加不减：作恶掉声望由战斗与事件各自扣，不在这条线上重复惩罚。
   */
  const karmaGain = Math.max(0, karma - working.karma);
  const fameGain = karmaGain > 0 ? fameFromKarma(karmaGain) : 0;
  const afterFame = fameGain > 0 ? changeFame(working, fameGain, '行善积名').state : working;

  const next: GameState = {
    ...afterFame,
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
  /*
   * ⚠️ 两条道伤提示缺一不可。
   *
   * `failInjury`（赌输了的代价）原本就有，而 `injury`（**成功也要付的代价**）
   * 一直没显示 —— 于是"掌门亲自迎敌"这种选项在界面上看着只是"善恶 +4"，
   * 点下去却平白多了 90 秒道伤。玩家会以为道伤是凭空冒出来的
   * （这正是本轮玩家报的第二个 bug 的一半来源）。
   */
  if (option.effect.injury) parts.push(`道伤 ${option.effect.injury} 秒`);
  if (option.effect.failInjury) parts.push(`失败道伤 ${option.effect.failInjury} 秒`);
  return parts.join(' · ');
}
/** 善行值与基础材料的加成不叠加（季节管那件事），这里只用于文案提醒 */
export function isKarmaRelevantItem(item: ItemId): boolean {
  return isBasicMaterial(item);
}
