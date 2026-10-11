/**
 * 秘境探索（需求 1 / 5）
 *
 * 一次探索的生命周期：
 *   发现 ──► 派遣（minParty~maxParty）──► 按探索速度累积进度
 *        ──► 结算产出 / 伤亡 / 心得 / 发现新秘境 ──► 该秘境进入冷却
 *
 * 需求 1 的三条硬性要求在这里落实：
 *   「弟子或者玩家探索发现」   → discovery 判定（个人游历里也有一份）
 *   「发现后固定在秘境栏」     → state.discoveredRealms 只增不减
 *   「每次探索后需要隔一段时间」→ 结算时写入 realmCooldowns
 *   「人越多最终获取的资源越多」→ 数量系数 + 掉落条目数都随人数增长
 *
 * 结算的核心量：
 *   战力比 = 队伍战力 / 秘境推荐战力
 *   人数系数 = 1 + (人数 - minParty) × PARTY_YIELD_PER_EXTRA
 *   产出   = 基础 × clamp(战力比, 0.5, 3) × 人数系数 × 增益 × 随机浮动
 *   伤亡率 = 基础伤亡率 / 战力比 × (1 - 减免)
 */
import { D } from './decimal';
import { gameRandom, randomId, weightedDraw, type RandomSource } from './random';
import {
  BLUEPRINTS,
  EXPLORATION_SEEDS,
  INSIGHT_PER_EXPEDITION,
  INSIGHT_PER_REALM_LEVEL,
  ITEM_MAP,
  LOOT_ROLLS,
  LOOT_ROLLS_MAX,
  LOOT_ROLLS_PER_EXTRA,
  MAX_CASUALTY_RATE,
  MAX_YIELD_FACTOR,
  MIN_YIELD_FACTOR,
  PARTY_YIELD_PER_EXTRA,
  PILL_DROP_CHANCE,
  PILL_MAP,
  REALMS,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  SEED_MAP,
  SEED_ROLLS,
  YIELD_VARIANCE_MAX,
  YIELD_VARIANCE_MIN,
  expeditionSlots,
  type ItemId,
  type LootEntry,
  type MaterialId,
  type SecretRealmDef,
} from './content';
import {
  addItem,
  discoverRealm,
  getArtifactBonuses,
  getDiscoveryChance,
  getRealmCooldown,
  getStructureBonus,
  getUndiscoveredCandidates,
  growDiscoveryPity,
  isRealmAvailable,
  isRealmDiscovered,
} from './engine';
import { getPartyPower, pushJournal, setDiscipleStatus } from './disciples';
import { addSeeds } from './planting';
import type { Disciple, Expedition, GameState } from './state';

/* ------------------------------------------------------------------ */
/* 校验与选人                                                          */
/* ------------------------------------------------------------------ */

/** 尚未发现的秘境数量（界面上给个「还有几处没找到」的目标感） */
export function getUndiscoveredCount(state: GameState): number {
  return SECRET_REALMS.filter((def) => !isRealmDiscovered(state, def)).length;
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
  if (!isRealmDiscovered(state, def)) return { ok: false, reason: '尚未发现此秘境' };
  if (!isRealmAvailable(state, def)) {
    const cooldown = getRealmCooldown(state, def.id);
    if (cooldown > 0) return { ok: false, reason: `冷却中，还需 ${Math.ceil(cooldown)} 秒` };
    return { ok: false, reason: '此地暂时去不了' };
  }
  if (state.expeditions.length >= getMaxExpeditions(state)) {
    return { ok: false, reason: '探索队伍已满，提升宗门品阶可增加队伍' };
  }
  if (ids.length < def.minParty) {
    return { ok: false, reason: `至少需派遣 ${def.minParty} 名弟子` };
  }
  if (ids.length > def.maxParty) {
    return { ok: false, reason: `最多可派遣 ${def.maxParty} 名弟子` };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: '同一名弟子不能重复派遣' };
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

/**
 * 自动挑一队满足条件且战力最高的空闲弟子（界面上「推荐队伍」用）。
 *
 * 默认按 maxParty 满编 —— 「人越多最终获取的资源越多」，
 * 空闲弟子闲着也是闲着。
 */
export function autoSelectParty(state: GameState, realmId: string, size?: number): string[] {
  const def = SECRET_REALM_MAP[realmId];
  if (!def) return [];

  const candidates = getIdleDisciples(state)
    .filter((d) => d.realmIndex >= def.minRealm)
    .sort((a, b) => REALMS[b.realmIndex].power - REALMS[a.realmIndex].power);

  const want = Math.max(def.minParty, Math.min(size ?? def.maxParty, def.maxParty));
  return candidates.slice(0, want).map((d) => d.id);
}

/* ------------------------------------------------------------------ */
/* 开始探索                                                            */
/* ------------------------------------------------------------------ */

export function startExpedition(
  state: GameState,
  realmId: string,
  ids: string[],
  random: RandomSource = gameRandom,
): GameState {
  const check = canStartExpedition(state, realmId, ids);
  if (!check.ok) return state;

  const def = SECRET_REALM_MAP[realmId];
  if (!def) return state;

  const expedition: Expedition = {
    // 用随机 id 而不是 playTime：同一时刻派出两支队伍时，
    // 基于时间的 id 会撞车，结算时就会误删另一支队伍
    id: randomId('e', random),
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
      text: `${names} 启程探索${def.name}（${ids.length} 人）`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

export interface ExpeditionOutcome {
  realmName: string;
  gains: { id: ItemId; amount: number; name: string; icon: string }[];
  pills: { id: string; amount: number; name: string; icon: string }[];
  /** 带回的材料种子（需求 5） */
  seeds: { material: MaterialId; amount: number; name: string; icon: string }[];
  /** 寻获的图纸（需求 6） */
  blueprints: { id: string; name: string; icon: string }[];
  /** 本次新发现的秘境（需求 1） */
  discovered: { id: string; name: string; icon: string } | null;
  /** 队员们获得的心得（需求 4） */
  insight: number;
  casualties: string[];
  powerRatio: number;
  partySize: number;
}

/** 人数系数：超出最少人数的部分每人 +40% */
export function getPartySizeFactor(def: SecretRealmDef, partySize: number): number {
  const extra = Math.max(0, partySize - def.minParty);
  return 1 + extra * PARTY_YIELD_PER_EXTRA;
}

/** 掉落条目数：人数越多抽得越多 */
export function getLootRolls(def: SecretRealmDef, partySize: number): number {
  const extra = Math.max(0, partySize - def.minParty);
  return Math.min(LOOT_ROLLS + extra * LOOT_ROLLS_PER_EXTRA, LOOT_ROLLS_MAX);
}

/** 一次探索给每名参与者多少心得 */
export function getExpeditionInsight(state: GameState, def: SecretRealmDef): number {
  const base = INSIGHT_PER_EXPEDITION + def.minRealm * INSIGHT_PER_REALM_LEVEL;
  return Math.max(1, Math.round(base * (1 + getStructureBonus(state, 'insightBonus'))));
}

/**
 * 结算一次探索。
 * 先发奖励再判定伤亡 —— 弟子用命换来的东西不会因为死亡而丢失。
 */
export function resolveExpedition(
  state: GameState,
  expedition: Expedition,
  random: RandomSource = gameRandom,
): { state: GameState; outcome: ExpeditionOutcome | null } {
  const def = SECRET_REALM_MAP[expedition.realmId];
  if (!def) {
    return { state: { ...state, expeditions: state.expeditions.filter((e) => e.id !== expedition.id) }, outcome: null };
  }

  // 队伍里可能已经有人寿元耗尽
  const alive = expedition.discipleIds.filter((id) => state.sect.disciples.some((d) => d.id === id));
  const partyPower = getPartyPower(state, alive);
  const powerRatio = def.requiredPower > 0 ? partyPower / def.requiredPower : MAX_YIELD_FACTOR;
  const partySize = alive.length;

  const yieldFactor = Math.min(Math.max(powerRatio, MIN_YIELD_FACTOR), MAX_YIELD_FACTOR);
  const sizeFactor = getPartySizeFactor(def, partySize);
  const artifacts = getArtifactBonuses(state);
  const yieldMultiplier =
    state.buffs.yieldMultiplier *
    (1 + artifacts.expeditionYield + getStructureBonus(state, 'expeditionYieldBonus'));

  /* ---- 1. 计算产出 ---- */
  const pool = def.loot.filter((entry) => !entry.guaranteed);
  const guaranteed = def.loot.filter((entry) => entry.guaranteed);
  const picked: LootEntry[] = [...guaranteed, ...weightedDraw(pool, getLootRolls(def, partySize), random)];

  let working = state;
  const gains: ExpeditionOutcome['gains'] = [];
  const pillGains: ExpeditionOutcome['pills'] = [];

  for (const entry of picked) {
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    const amount = Math.max(
      1,
      Math.floor(entry.amount * yieldFactor * sizeFactor * yieldMultiplier * variance),
    );
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

  /* ---- 1b. 种子（需求 5：稀有材料的种子只能靠探索） ---- */
  const seedGains: ExpeditionOutcome['seeds'] = [];
  if (random() < def.seedChance) {
    const seedPool = EXPLORATION_SEEDS.filter(
      (seed) => seed.rarity >= (def.seedMinRarity ?? 1) && seed.rarity <= def.seedMaxRarity,
    ).map((seed) => ({
      ...seed,
      weight: seed.dropWeight,
    }));
    for (const pickedSeed of weightedDraw(seedPool, SEED_ROLLS, random)) {
      working = addSeeds(working, pickedSeed.material, 1);
      seedGains.push({
        material: pickedSeed.material,
        amount: 1,
        name: SEED_MAP[pickedSeed.material]?.name ?? pickedSeed.name,
        icon: pickedSeed.icon,
      });
    }
  }

  /* ---- 1c. 图纸（需求 6：稀有建筑只能靠探索或商行） ---- */
  const blueprintGains: ExpeditionOutcome['blueprints'] = [];
  if (def.blueprintChance > 0 && random() < def.blueprintChance) {
    // 只掉境界够得着的图纸（需求 6：图纸要跟玩家等级挂钩）
    const missing = BLUEPRINTS.filter(
      (bp) => working.blueprints[bp.id] !== true && working.realmIndex >= bp.requiresRealm,
    );
    if (missing.length > 0) {
      const found = missing[Math.min(missing.length - 1, Math.floor(random() * missing.length))];
      working = { ...working, blueprints: { ...working.blueprints, [found.id]: true } };
      blueprintGains.push({ id: found.id, name: found.name, icon: found.icon });
    }
  }

  /* ---- 1d. 发现新秘境（需求 1） ---- */
  let discovered: ExpeditionOutcome['discovered'] = null;
  const candidates = getUndiscoveredCandidates(working);
  if (candidates.length > 0) {
    const extra = Math.max(0, partySize - def.minParty);
    if (random() < getDiscoveryChance(working, extra)) {
      const [found] = weightedDraw(
        candidates.map((c) => ({ ...c, weight: c.discoveryWeight })),
        1,
        random,
      );
      if (found) {
        working = discoverRealm(working, found.id);
        discovered = { id: found.id, name: found.name, icon: found.icon };
      }
    } else {
      // 没发现也长保底，避免运气差的玩家永远停在第一处秘境
      working = growDiscoveryPity(working);
    }
  }

  /* ---- 1e. 心得（需求 4：弟子探索后增加心得，加快进境） ---- */
  const insightGain = getExpeditionInsight(working, def);

  /* ---- 2. 判定伤亡 ---- */
  const safety = Math.min(
    1,
    Math.max(
      0,
      state.buffs.safetyReduction +
        artifacts.expeditionSafety +
        getStructureBonus(state, 'casualtyReduction'),
    ),
  );
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
    .map((d) => {
      const survived = survivorSet.has(d.id);
      // 生还者：回空闲 + 涨心得；其他人（未参与本次）原样保留
      return survived
        ? { ...d, status: 'idle' as const, expeditionId: undefined, insight: d.insight + insightGain }
        : d;
    });

  let journal = working.journal;
  const summary = gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ');
  const extra = [
    seedGains.map((s) => `${s.icon}${s.name}`).join(' '),
    blueprintGains.map((b) => `${b.icon}${b.name}`).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
  journal = pushJournal(journal, {
    time: working.playTime,
    kind: 'good',
    text: `${def.name}探索归来（${partySize} 人）：${summary || '一无所获'}${
      extra ? `，另得 ${extra}` : ''
    }`,
  });
  if (discovered) {
    journal = pushJournal(journal, {
      time: working.playTime,
      kind: 'good',
      text: `弟子在${def.name}深处发现了新的秘境：${discovered.icon}${discovered.name}`,
    });
  }
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
    // 需求 1：每次探索后要隔一段时间才能再探
    realmCooldowns: { ...working.realmCooldowns, [def.id]: def.cooldown },
    journal,
  };

  return {
    state: next,
    outcome: {
      realmName: def.name,
      gains,
      pills: pillGains,
      seeds: seedGains,
      blueprints: blueprintGains,
      discovered,
      insight: insightGain,
      casualties: casualties.map((c) => c.name),
      powerRatio,
      partySize,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 时间推进                                                            */
/* ------------------------------------------------------------------ */

/** 探索速度倍率：丹药增益 × 器物 × 建筑（灵舟坊） */
export function getExpeditionSpeed(state: GameState): number {
  const artifacts = getArtifactBonuses(state);
  const buildings = getStructureBonus(state, 'expeditionSpeedBonus');
  return state.buffs.speedMultiplier * (1 + artifacts.expeditionSpeed + buildings);
}

export function tickExpeditions(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
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
export function completeAllExpeditions(state: GameState, random: RandomSource = gameRandom): GameState {
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

