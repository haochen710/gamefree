/**
 * 秘境探索（需求 5）
 *
 * 一次探索的生命周期：
 *   派遣 → 按探索速度累积进度 → 完成时结算产出与伤亡
 *
 * 结算的两个核心量：
 *   战力比 = 队伍战力 / 秘境推荐战力
 *   产出   = 基础 × clamp(战力比, 0.5, 3) × 增益 × 随机浮动
 *   伤亡率 = 基础伤亡率 / 战力比 × (1 - 减免)
 *
 * 战力比同时影响收益和风险，所以"派谁去"是个真实决策：
 * 派太弱的队伍，收益腰斩且死伤惨重；派最强的队伍，又可能耽误别的探索。
 */
import { D } from './decimal';
import {
  ITEM_MAP,
  LOOT_ROLLS,
  MAX_CASUALTY_RATE,
  MAX_YIELD_FACTOR,
  MIN_YIELD_FACTOR,
  PILL_DROP_CHANCE,
  PILL_MAP,
  REALMS,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  YIELD_VARIANCE_MAX,
  YIELD_VARIANCE_MIN,
  expeditionSlots,
  type ItemId,
  type LootEntry,
  type SecretRealmDef,
} from './content';
import { addItem, getArtifactBonuses, isRealmUnlocked } from './engine';
import { getPartyPower, pushJournal, setDiscipleStatus } from './disciples';
import type { Disciple, Expedition, GameState } from './state';

/* ------------------------------------------------------------------ */
/* 解锁与校验                                                          */
/* ------------------------------------------------------------------ */

export function getUnlockedRealms(state: GameState): SecretRealmDef[] {
  return SECRET_REALMS.filter((def) => isRealmUnlocked(def, state));
}

export function getRunningCount(state: GameState): number {
  return state.expeditions.length;
}

export function getMaxExpeditions(state: GameState): number {
  if (!state.sect.founded) return 0;
  return expeditionSlots(state.sect.level);
}

export function getIdleDisciples(state: GameState): Disciple[] {
  return state.sect.disciples.filter((d) => d.status === 'idle');
}

export interface StartCheck {
  ok: boolean;
  reason: string | null;
}

export function canStartExpedition(state: GameState, realmId: string, ids: string[]): StartCheck {
  const def = SECRET_REALM_MAP[realmId];
  if (!def) return { ok: false, reason: '秘境不存在' };
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  if (!isRealmUnlocked(def, state)) return { ok: false, reason: '尚未发现此秘境' };
  if (state.expeditions.length >= getMaxExpeditions(state)) {
    return { ok: false, reason: '探索队伍已满，提升宗门品阶可增加队伍' };
  }
  if (ids.length !== def.partySize) {
    return { ok: false, reason: `需派遣 ${def.partySize} 名弟子` };
  }

  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) return { ok: false, reason: '弟子不存在' };
    if (d.status !== 'idle') return { ok: false, reason: `${d.name} 正在探索中` };
    if (d.realmIndex < def.minRealm) {
      return { ok: false, reason: `需${REALMS[def.minRealm].name}以上弟子` };
    }
  }
  return { ok: true, reason: null };
}

/** 自动挑一队满足条件且战力最高的空闲弟子（界面上「推荐队伍」用） */
export function autoSelectParty(state: GameState, realmId: string): string[] {
  const def = SECRET_REALM_MAP[realmId];
  if (!def) return [];

  const candidates = getIdleDisciples(state)
    .filter((d) => d.realmIndex >= def.minRealm)
    .sort((a, b) => REALMS[b.realmIndex].power - REALMS[a.realmIndex].power);

  return candidates.slice(0, def.partySize).map((d) => d.id);
}

/* ------------------------------------------------------------------ */
/* 开始探索                                                            */
/* ------------------------------------------------------------------ */

export function startExpedition(state: GameState, realmId: string, ids: string[]): GameState {
  const check = canStartExpedition(state, realmId, ids);
  if (!check.ok) return state;

  const def = SECRET_REALM_MAP[realmId];
  const expedition: Expedition = {
    id: `e${state.playTime.toFixed(2)}_${realmId}`,
    realmId,
    discipleIds: [...ids],
    progress: 0,
    duration: def.duration,
  };

  const withStatus = setDiscipleStatus(state, ids, 'exploring', expedition.id);
  const names = ids
    .map((id) => state.sect.disciples.find((d) => d.id === id)?.name ?? '?')
    .join('、');

  return {
    ...withStatus,
    expeditions: [...withStatus.expeditions, expedition],
    journal: pushJournal(withStatus.journal, {
      time: withStatus.playTime,
      kind: 'info',
      text: `${names} 启程探索${def.name}`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

/** 按权重不放回地抽 count 项 */
function weightedDraw<T extends { weight: number }>(pool: T[], count: number, random: () => number): T[] {
  const available = [...pool];
  const picked: T[] = [];
  while (picked.length < count && available.length > 0) {
    const total = available.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) break;
    let roll = random() * total;
    let index = available.length - 1;
    for (let i = 0; i < available.length; i += 1) {
      roll -= available[i].weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(available[index]);
    available.splice(index, 1);
  }
  return picked;
}

export interface ExpeditionOutcome {
  realmName: string;
  gains: { id: ItemId; amount: number; name: string; icon: string }[];
  pills: { id: string; amount: number; name: string; icon: string }[];
  casualties: string[];
  powerRatio: number;
}

/**
 * 结算一次探索。
 * 先发奖励再判定伤亡 —— 弟子用命换来的东西不会因为死亡而丢失。
 */
export function resolveExpedition(
  state: GameState,
  expedition: Expedition,
  random: () => number = Math.random,
): { state: GameState; outcome: ExpeditionOutcome | null } {
  const def = SECRET_REALM_MAP[expedition.realmId];
  if (!def) {
    return { state: { ...state, expeditions: state.expeditions.filter((e) => e.id !== expedition.id) }, outcome: null };
  }

  // 队伍里可能已经有人寿元耗尽
  const alive = expedition.discipleIds.filter((id) => state.sect.disciples.some((d) => d.id === id));
  const partyPower = getPartyPower(state, alive);
  const powerRatio = def.requiredPower > 0 ? partyPower / def.requiredPower : MAX_YIELD_FACTOR;

  const yieldFactor = Math.min(Math.max(powerRatio, MIN_YIELD_FACTOR), MAX_YIELD_FACTOR);
  const artifacts = getArtifactBonuses(state);
  const yieldMultiplier = state.buffs.yieldMultiplier * (1 + artifacts.expeditionYield);

  /* ---- 1. 计算产出 ---- */
  const pool = def.loot.filter((entry) => !entry.guaranteed);
  const guaranteed = def.loot.filter((entry) => entry.guaranteed);
  const picked: LootEntry[] = [...guaranteed, ...weightedDraw(pool, LOOT_ROLLS, random)];

  let working = state;
  const gains: ExpeditionOutcome['gains'] = [];
  const pillGains: ExpeditionOutcome['pills'] = [];

  for (const entry of picked) {
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    const amount = Math.max(1, Math.floor(entry.amount * yieldFactor * yieldMultiplier * variance));
    working = addItem(working, entry.item, D(amount));
    gains.push({
      id: entry.item,
      amount,
      name: ITEM_MAP[entry.item].name,
      icon: ITEM_MAP[entry.item].icon,
    });
  }

  if (def.pillLoot && def.pillLoot.length > 0 && random() < PILL_DROP_CHANCE) {
    const pillsPicked = weightedDraw(def.pillLoot, 1, random);
    for (const entry of pillsPicked) {
      const pills = { ...working.pills, [entry.pill]: (working.pills[entry.pill] ?? 0) + entry.amount };
      working = { ...working, pills };
      pillGains.push({
        id: entry.pill,
        amount: entry.amount,
        name: PILL_MAP[entry.pill]?.name ?? entry.pill,
        icon: PILL_MAP[entry.pill]?.icon ?? '⚗',
      });
    }
  }

  /* ---- 2. 判定伤亡 ---- */
  const safety = Math.min(1, Math.max(0, state.buffs.safetyReduction + artifacts.expeditionSafety));
  const baseRate = powerRatio > 0 ? def.baseCasualty / powerRatio : MAX_CASUALTY_RATE;
  const casualtyRate = Math.min(Math.max(baseRate, 0), MAX_CASUALTY_RATE) * (1 - safety);

  const casualties: { id: string; name: string }[] = [];
  const survivors: string[] = [];
  for (const id of alive) {
    if (random() < casualtyRate) {
      const d = working.sect.disciples.find((x) => x.id === id);
      if (d) casualties.push({ id, name: d.name });
    } else {
      survivors.push(id);
    }
  }

  /* ---- 3. 写回状态 ---- */
  // 注意：这里必须用 id 而不是名字来剔除陨落弟子 —— 道号是随机生成的，完全可能重复
  const deadIds = new Set(casualties.map((c) => c.id));
  const survivorSet = new Set(survivors);

  const disciples = working.sect.disciples
    .filter((d) => !deadIds.has(d.id))
    .map((d) => (survivorSet.has(d.id) ? { ...d, status: 'idle' as const, expeditionId: undefined } : d));

  let journal = working.journal;
  const summary = gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ');
  journal = pushJournal(journal, {
    time: working.playTime,
    kind: 'good',
    text: `${def.name}探索归来：${summary || '一无所获'}`,
  });
  if (casualties.length > 0) {
    journal = pushJournal(journal, {
      time: working.playTime,
      kind: 'bad',
      text: `${def.name}一行折损：${casualties.map((c) => c.name).join('、')} 陨落`,
    });
  }

  const next: GameState = {
    ...working,
    sect: { ...working.sect, disciples },
    expeditions: working.expeditions.filter((e) => e.id !== expedition.id),
    journal,
  };

  return {
    state: next,
    outcome: {
      realmName: def.name,
      gains,
      pills: pillGains,
      casualties: casualties.map((c) => c.name),
      powerRatio,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 时间推进                                                            */
/* ------------------------------------------------------------------ */

export function getExpeditionSpeed(state: GameState): number {
  const artifacts = getArtifactBonuses(state);
  return state.buffs.speedMultiplier * (1 + artifacts.expeditionSpeed);
}

export function tickExpeditions(state: GameState, dt: number, random: () => number = Math.random): GameState {
  if (state.expeditions.length === 0 || dt <= 0) return state;

  const gained = dt * getExpeditionSpeed(state);
  const remaining: Expedition[] = [];
  const finished: Expedition[] = [];

  for (const expedition of state.expeditions) {
    const progress = expedition.progress + gained;
    if (progress >= expedition.duration) finished.push({ ...expedition, progress });
    else remaining.push({ ...expedition, progress });
  }

  let working: GameState = { ...state, expeditions: remaining };
  for (const expedition of finished) {
    working = resolveExpedition(working, expedition, random).state;
  }
  return working;
}

/** 立即完成所有探索（灭魔丹） */
export function completeAllExpeditions(state: GameState, random: () => number = Math.random): GameState {
  let working = state;
  for (const expedition of [...state.expeditions]) {
    working = resolveExpedition(working, { ...expedition, progress: expedition.duration }, random).state;
  }
  return working;
}

export function getExpeditionProgress(expedition: Expedition): number {
  if (expedition.duration <= 0) return 1;
  return Math.min(1, expedition.progress / expedition.duration);
}
