/**
 * 外交逻辑：赠礼 / 论道 / 结盟 / 宣战 / 宗门大战（设定集第 9 章）
 *
 * 状态里只存"关系 / 赠礼次数 / 是否结盟"三样，其余（档位、能否结盟、
 * 胜率）都是纯函数算出来的 —— 这样界面上显示的和结算时用的必然是同一套判断。
 */
import { D } from './decimal';
import { gameRandom, type RandomSource } from './random';
import {
  ALLIANCE_FAME,
  ALLIANCE_PRODUCTION_BONUS,
  ALLIANCE_RELATION,
  DECLARE_WAR_FAME_COST,
  DECLARE_WAR_RELATION,
  GIFT_COOLDOWN_SECONDS,
  GIFT_FAVORITE_MULTIPLIER,
  GIFT_MAX_PER_SECT,
  GIFT_OPTIONS,
  HOSTILE_RAID_CHANCE_PER_SECOND,
  NPC_SECTS,
  NPC_SECT_MAP,
  PARLEY_COOLDOWN_SECONDS,
  PARLEY_RELATION,
  WAR_BATTLE_INTERVAL,
  WAR_CASUALTY_RATIO,
  WAR_DEFENSE_POWER_PER_DISCIPLE,
  WAR_LOOT,
  WAR_LOSS_RELATION,
  WAR_LOSS_RESOURCE_RATIO,
  WAR_MAX_WIN_CHANCE,
  WAR_MIN_WIN_CHANCE,
  WAR_RESOURCE_COST,
  WAR_WIN_RELATION,
  clampRelation,
  relationTierOf,
  type GiftOption,
  type NpcSectDef,
} from './content';
import { addItem, getAmount, payCost } from './engine';
import { getSectDefense } from './encounter';
import { pushJournal } from './disciples';
import { changeFame, getFame } from './fame';
import type { GameState } from './state';

/** 外交里"每宗各自的冷却"存在播放时长上（一宗一份，够用且不用新开字段） */
function relationOf(state: GameState, sectId: string): number {
  return state.npcSects.find((s) => s.id === sectId)?.relation ?? 0;
}

function patchSect(
  state: GameState,
  sectId: string,
  patch: Partial<{ relation: number; gifts: number; alliance: boolean }>,
): GameState {
  return {
    ...state,
    npcSects: state.npcSects.map((s) => (s.id === sectId ? { ...s, ...patch } : s)),
  };
}

function relationTier(state: GameState, sectId: string) {
  return relationTierOf(relationOf(state, sectId));
}

/* ------------------------------------------------------------------ */
/* 赠礼                                                                */
/* ------------------------------------------------------------------ */

export interface GiftCheck {
  ok: boolean;
  reason: string | null;
  /** 实际关系涨幅（含心头好加成） */
  gain: number;
  /** 实际消耗的数量（若心头好是灵草这类资源，用 amount 计） */
  cost: number;
}

/**
 * 赠礼检查。
 *
 * 「心头好」是这套系统里唯一的策略层：给青云剑宗送玄铁、给百草丹谷送灵草，
 * 同样的东西涨两倍关系 —— 于是"我该留什么给谁"变成一个真的问题。
 */
export function canGift(state: GameState, sectId: string, optionIndex: number): GiftCheck {
  const def = NPC_SECT_MAP[sectId];
  const option: GiftOption | undefined = GIFT_OPTIONS[optionIndex];
  if (!def || !option) return { ok: false, reason: '没有这个选项', gain: 0, cost: 0 };
  const entry = state.npcSects.find((s) => s.id === sectId);
  if (!entry) return { ok: false, reason: '没有这个宗门', gain: 0, cost: 0 };
  if (entry.gifts >= GIFT_MAX_PER_SECT) {
    return { ok: false, reason: `已赠礼 ${GIFT_MAX_PER_SECT} 次，对方不好意思再收了`, gain: 0, cost: option.amount };
  }
  if (getAmount(state, def.favorite).lt(option.amount)) {
    return { ok: false, reason: `${def.favorite === 'herb' ? '灵草' : '心头好'}不足（需 ${option.amount}）`, gain: 0, cost: option.amount };
  }
  const gain = option.relation * GIFT_FAVORITE_MULTIPLIER;
  return { ok: true, reason: null, gain, cost: option.amount };
}

/** 送一份礼：扣心头好、涨关系 */
export function giftSect(state: GameState, sectId: string, optionIndex: number): GameState {
  const check = canGift(state, sectId, optionIndex);
  const def = NPC_SECT_MAP[sectId];
  const option = GIFT_OPTIONS[optionIndex];
  if (!check.ok || !def || !option) return state;

  const entry = state.npcSects.find((s) => s.id === sectId);
  if (!entry) return state;

  const paid = payCost(state, { [def.favorite]: option.amount });
  if (paid === state) return state;

  const relation = clampRelation(entry.relation + check.gain);
  let working = patchSect(paid, sectId, { relation, gifts: entry.gifts + 1 });
  const tier = relationTierOf(relation);
  working = {
    ...working,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'info',
      text: `向${def.name}赠${option.label}，关系 ${Math.round(entry.relation)} → ${Math.round(relation)}（${tier.name}）`,
    }),
  };
  return working;
}

/* ------------------------------------------------------------------ */
/* 论道 / 结盟 / 宣战                                                   */
/* ------------------------------------------------------------------ */

export function canParley(state: GameState, sectId: string): { ok: boolean; reason: string | null } {
  const def = NPC_SECT_MAP[sectId];
  if (!def) return { ok: false, reason: '没有这个宗门' };
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  if (getFame(state) < 500) return { ok: false, reason: '声望太低（需 500），对方懒得见你' };
  const cooldown = state.parleyCooldowns?.[sectId] ?? 0;
  if (cooldown > 0) return { ok: false, reason: `还需 ${Math.ceil(cooldown)} 秒` };
  return { ok: true, reason: null };
}

/** 论道：不花资源，涨一点点关系（主要给早期用） */
export function parleySect(state: GameState, sectId: string): GameState {
  if (!canParley(state, sectId).ok) return state;
  const def = NPC_SECT_MAP[sectId];
  const entry = state.npcSects.find((s) => s.id === sectId);
  if (!def || !entry) return state;
  const relation = clampRelation(entry.relation + PARLEY_RELATION);
  let working = patchSect(state, sectId, { relation });
  working = {
    ...working,
    parleyCooldowns: { ...(working.parleyCooldowns ?? {}), [sectId]: PARLEY_COOLDOWN_SECONDS },
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'info',
      text: `与${def.name}论道一场，关系 ${Math.round(entry.relation)} → ${Math.round(relation)}`,
    }),
  };
  return working;
}

export function canAlly(state: GameState, sectId: string): { ok: boolean; reason: string | null } {
  const def = NPC_SECT_MAP[sectId];
  if (!def) return { ok: false, reason: '没有这个宗门' };
  const entry = state.npcSects.find((s) => s.id === sectId);
  if (!entry) return { ok: false, reason: '没有这个宗门' };
  if (entry.alliance) return { ok: false, reason: '已经结盟' };
  if (entry.relation < ALLIANCE_RELATION) {
    return { ok: false, reason: `关系需达到 ${ALLIANCE_RELATION}（当前 ${Math.round(entry.relation)}）` };
  }
  if (getFame(state) < ALLIANCE_FAME) {
    return { ok: false, reason: `声望需达到 ${ALLIANCE_FAME}（当前 ${Math.round(getFame(state))}）` };
  }
  return { ok: true, reason: null };
}

/**
 * 结盟。
 *
 * 盟友的被动收益是**产出加成**（每盟 +3%），并且是"称霸仙域"结局的硬条件 ——
 * 于是"打"与"谈"这两条路都能通向胜利，而不是只有打仗。
 */
export function allySect(state: GameState, sectId: string): GameState {
  if (!canAlly(state, sectId).ok) return state;
  const def = NPC_SECT_MAP[sectId]!;
  let working = patchSect(state, sectId, { alliance: true });
  working = {
    ...working,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'good',
      text: `${def.name}与我宗缔结盟约（宗门产出 +${Math.round(ALLIANCE_PRODUCTION_BONUS * 100)}%）`,
    }),
  };
  return working;
}

export function canDeclareWar(state: GameState, sectId: string): { ok: boolean; reason: string | null } {
  const def = NPC_SECT_MAP[sectId];
  if (!def) return { ok: false, reason: '没有这个宗门' };
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  const entry = state.npcSects.find((s) => s.id === sectId);
  if (!entry) return { ok: false, reason: '没有这个宗门' };
  if (entry.alliance) return { ok: false, reason: '盟友不可宣战（先撕毁盟约）' };
  if (getFame(state) < DECLARE_WAR_FAME_COST) {
    return { ok: false, reason: `声望不足（宣战需 ${DECLARE_WAR_FAME_COST}）` };
  }
  return { ok: true, reason: null };
}

/**
 * 主动宣战。
 *
 * 代价是声望（名声变差）与关系直接掉到底；收益是"打赢了能拿对方的资源"。
 * `everDeclaredWar` 会被记下来 —— 隐世传承结局要求"从未主动宣战"，
 * 所以这一下点下去是有后果的，而不是随手点点。
 */
export function declareWar(state: GameState, sectId: string): GameState {
  if (!canDeclareWar(state, sectId).ok) return state;
  const def = NPC_SECT_MAP[sectId]!;
  let working = patchSect(state, sectId, { relation: DECLARE_WAR_RELATION, alliance: false });
  working = { ...working, everDeclaredWar: true, atWarWith: [...new Set([...working.atWarWith, sectId])] };
  const fame = changeFame(working, -DECLARE_WAR_FAME_COST, '宣战损耗名望');
  working = fame.state;
  working = {
    ...working,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'bad',
      text: `我宗向${def.name}宣战！战鼓一响，再无回头路`,
    }),
  };
  return working;
}

/** 撕毁盟约（结盟与宣战互斥，所以要先撕） */
export function breakAlliance(state: GameState, sectId: string): GameState {
  const entry = state.npcSects.find((s) => s.id === sectId);
  if (!entry?.alliance) return state;
  const def = NPC_SECT_MAP[sectId]!;
  let working = patchSect(state, sectId, { alliance: false, relation: clampRelation(entry.relation - 40) });
  working = {
    ...working,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'bad',
      text: `撕毁与${def.name}的盟约，对方记下了这笔账`,
    }),
  };
  return working;
}

/* ------------------------------------------------------------------ */
/* 宗门大战                                                            */
/* ------------------------------------------------------------------ */

/** 我方战力（防御 + 弟子规模），只在计算胜率时用 */
export function getWarStrength(state: GameState): number {
  const disciples = state.sect.disciples.length;
  return getSectDefense(state) + disciples * WAR_DEFENSE_POWER_PER_DISCIPLE;
}

/** 某宗的大战胜率 */
export function getWinChance(state: GameState, sectId: string): number {
  const def = NPC_SECT_MAP[sectId];
  if (!def) return 0;
  const strength = getWarStrength(state);
  // 对面强度随实力提升；我方"越强越难再进一步"（避免碾压式胜利）
  const ratio = strength / (def.power * (1 + Math.sqrt(strength)));
  return Math.max(WAR_MIN_WIN_CHANCE, Math.min(WAR_MAX_WIN_CHANCE, 0.35 + ratio * 0.5));
}

export interface BattleOutcome {
  state: GameState;
  won: boolean;
  /** 我方折损的弟子名 */
  casualties: string[];
  /** 战利品 */
  loot: { id: string; amount: number; name: string }[];
  text: string;
}

/**
 * 打一场宗门大战。
 *
 * 胜：声望大涨 + 战利品 + 关系回暖（打赢了对方反而客气）
 * 负：声望下跌 + 弟子折损 + 资源被掠
 *
 * 伤亡按**比例**（6%）而不是按固定人数：一千人的宗门与十人的宗门
 * 打同一场仗，损失的量级本来就该不同。
 */
export function resolveBattle(
  state: GameState,
  sectId: string,
  random: RandomSource = gameRandom,
): BattleOutcome | null {
  const def = NPC_SECT_MAP[sectId];
  if (!def) return null;
  const entry = state.npcSects.find((s) => s.id === sectId);
  if (!entry) return null;

  const chance = getWinChance(state, sectId);
  const won = random() < chance;

  const casualties: string[] = [];
  let working = state;

  if (won) {
    const scale = def.power;
    const loot: BattleOutcome['loot'] = [];
    for (const item of WAR_LOOT) {
      const amount = Math.max(1, Math.round(item.amount * scale));
      working = addItem(working, item.id, D(amount));
      loot.push({ id: item.id, amount, name: item.id });
    }
    // 战胜也要付出资源代价（打仗烧钱）
    const resources = { ...working.resources };
    for (const key of Object.keys(resources) as (keyof typeof resources)[]) {
      resources[key] = resources[key].mul(D(1 - WAR_RESOURCE_COST));
    }
    working = { ...working, resources };
    const fame = changeFame(working, 120 * scale, `大胜${def.name}`);
    working = fame.state;
    working = patchSect(working, sectId, { relation: clampRelation(entry.relation + WAR_WIN_RELATION) });
    working = {
      ...working,
      journal: pushJournal(working.journal, {
        time: working.playTime,
        kind: 'good',
        text: `宗门大战：大破${def.name}！（胜率 ${Math.round(chance * 100)}%）`,
      }),
    };
    return { state: working, won: true, casualties, loot, text: `大破${def.name}` };
  }

  // 战败：按比例折损弟子
  const count = Math.min(working.sect.disciples.length, Math.max(1, Math.floor(working.sect.disciples.length * WAR_CASUALTY_RATIO)));
  const shuffled = [...working.sect.disciples];
  // 用同一个 random 做一次 Fisher-Yates（放在这里而不是工具函数里：只有这一处需要）
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const fallen = new Set(shuffled.slice(0, count).map((d) => d.id));
  for (const d of shuffled.slice(0, count)) casualties.push(d.name);
  working = {
    ...working,
    sect: { ...working.sect, disciples: working.sect.disciples.filter((d) => !fallen.has(d.id)) },
  };
  // 战败被掠：资源按比例扣掉（与战胜时的"烧钱"对称，但更重）
  const raided = { ...working.resources };
  for (const key of Object.keys(raided) as (keyof typeof raided)[]) {
    raided[key] = raided[key].mul(D(1 - WAR_LOSS_RESOURCE_RATIO));
  }
  working = { ...working, resources: raided };
  const fame = changeFame(working, -60 * def.power, `败于${def.name}`);
  working = fame.state;
  working = patchSect(working, sectId, { relation: clampRelation(entry.relation + WAR_LOSS_RELATION) });
  working = {
    ...working,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'bad',
      text: `宗门大战：败于${def.name}，折损 ${count} 名弟子`,
    }),
  };
  return { state: working, won: false, casualties, loot: [], text: `败于${def.name}` };
}

/** 大战计时：处于战争状态时按周期开打；敌对宗门也可能主动来犯 */
export function tickWar(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (dt <= 0 || !state.sect.founded) return state;
  let working = state;
  let timer = working.warTimer - dt;
  if (timer <= 0) {
    const target = working.atWarWith[0];
    if (target && NPC_SECT_MAP[target]) {
      const outcome = resolveBattle(working, target, random);
      if (outcome) working = outcome.state;
    } else {
      // 没有宣战对象：敌方主动来犯的概率判定（按时间折算，避免每帧都掷骰）
      const chance = HOSTILE_RAID_CHANCE_PER_SECOND * dt;
      if (random() < chance) {
        const hostiles = working.npcSects.filter((s) => relationTierOf(s.relation).hostile);
        if (hostiles.length > 0) {
          const pick = hostiles[Math.floor(random() * hostiles.length)];
          const raid = resolveBattle(working, pick.id, random);
          if (raid) working = raid.state;
        }
      }
      timer = WAR_BATTLE_INTERVAL;
    }
    working = { ...working, warTimer: WAR_BATTLE_INTERVAL };
    return working;
  }
  return { ...working, warTimer: timer };
}

/* ------------------------------------------------------------------ */
/* 论道冷却                                                            */
/* ------------------------------------------------------------------ */

export function tickParleyCooldowns(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  const cooldowns = state.parleyCooldowns ?? {};
  const keys = Object.keys(cooldowns);
  if (keys.length === 0) return state;
  const next: Record<string, number> = {};
  let changed = false;
  for (const key of keys) {
    const left = cooldowns[key] - dt;
    if (left > 0) {
      next[key] = left;
    } else {
      changed = true;
    }
  }
  if (!changed && Object.keys(next).length === keys.length) {
    // 全部还在冷却：仍要更新剩余时间
    return { ...state, parleyCooldowns: next };
  }
  return { ...state, parleyCooldowns: next };
}

/* ------------------------------------------------------------------ */
/* 结盟的被动收益                                                       */
/* ------------------------------------------------------------------ */

/** 盟友数量 */
export function getAlliedCount(state: GameState): number {
  return state.npcSects.filter((s) => s.alliance).length;
}

/** 结盟带来的产出加成 —— 读取点：`engine.getGlobalMultiplier` */
export function allianceProductionBonus(state: GameState): number {
  return getAlliedCount(state) * ALLIANCE_PRODUCTION_BONUS;
}

/** 界面用：某宗的完整展示信息 */
export function sectView(state: GameState, def: NpcSectDef) {
  const entry = state.npcSects.find((s) => s.id === def.id);
  const relation = entry?.relation ?? def.initialRelation;
  return {
    def,
    relation,
    tier: relationTierOf(relation),
    alliance: entry?.alliance ?? false,
    gifts: entry?.gifts ?? 0,
    winChance: getWinChance(state, def.id),
    atWar: state.atWarWith.includes(def.id),
  };
}

export { relationOf, relationTier, NPC_SECTS, GIFT_OPTIONS, GIFT_COOLDOWN_SECONDS };
