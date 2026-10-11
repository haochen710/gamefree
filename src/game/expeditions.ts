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
  SURVEY_BASE_KINDS_MAX,
  SURVEY_BASE_KINDS_MIN,
  SURVEY_DURATION_RATIO,
  SURVEY_MAX_PARTY,
  SURVEY_RARE_CHANCE,
  SURVEY_YIELD_MULT,
  YIELD_VARIANCE_MAX,
  YIELD_VARIANCE_MIN,
  MAP_REGION_MAP,
  expeditionSlots,
  getSurveyLoot,
  isBasicMaterial,
  realmCountOfRegion,
  realmsOfRegion,
  regionTier,
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
  isDiscoveryGuaranteed,
  isRealmAvailable,
  isRealmDiscovered,
  recordDiscoveryFailure,
} from './engine';
import { getPartyPower, pushJournal, setDiscipleStatus } from './disciples';
import { getEnvironmentMaterialBonus, getWeatherEffects } from './season';
import { getKarmaExploreBonus } from './encounter';
import { getElementMaterialBonus, getSpaceExploreBonus } from './enlightenment';
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
    kind: 'realm',
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
  const weather = getWeatherEffects(state);
  const yieldMultiplier =
    // 善行值加成（需求 2）：善行越高，探索产出越好
    (1 + getKarmaExploreBonus(state) + getSpaceExploreBonus(state)) *
    state.buffs.yieldMultiplier *
    (1 + artifacts.expeditionYield + getStructureBonus(state, 'expeditionYieldBonus') + (weather.expeditionYield ?? 0));

  /* ---- 1. 计算产出 ---- */
  const pool = def.loot.filter((entry) => !entry.guaranteed);
  const guaranteed = def.loot.filter((entry) => entry.guaranteed);
  const picked: LootEntry[] = [...guaranteed, ...weightedDraw(pool, getLootRolls(def, partySize), random)];

  let working = state;
  const gains: ExpeditionOutcome['gains'] = [];
  const pillGains: ExpeditionOutcome['pills'] = [];

  for (const entry of picked) {
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    /*
     * 季节与天象对**基础材料**的加成在这里生效（需求 1）。
     * 稀有材料不吃这个加成：它们是秘境深处的产物，不该被地表气候左右 ——
     * 否则一年里总有一段时间刷不到星辰砂，节奏会变得莫名其妙。
     */
    // 季节/天象（需求 1）与五行感悟（需求 3）是两个独立乘区
    const seasonal = isBasicMaterial(entry.item)
      ? (1 + getEnvironmentMaterialBonus(state, entry.item)) * (1 + getElementMaterialBonus(state, entry.item))
      : 1;
    const amount = Math.max(
      1,
      Math.floor(entry.amount * yieldFactor * sizeFactor * yieldMultiplier * variance * Math.max(0, seasonal)),
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
  // 只在附近发现（需求 1）：探秘境同样倾向于发现同一片地方的新秘境
  const candidates = getUndiscoveredCandidates(working, def.regionId);
  if (candidates.length > 0) {
    // 硬保底：连续失败够多次就必然发现一次（它不在概率公式里，见 engine）
    if (isDiscoveryGuaranteed(working) || random() < getDiscoveryChance(working)) {
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
      // 没发现就累积失败次数，避免运气差的玩家永远停在第一处秘境
      working = recordDiscoveryFailure(working);
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
  /*
   * 注意：天象**不影响**伤亡率。
   * 试过让血月 / 罡风临时抬高伤亡，结果是把伤亡的正反馈推过临界点 ——
   * 多死几个 → 队伍凑不满 → 战力比下降 → 伤亡更高 → 弟子全灭。
   * 随机天象不该有能力掀翻宗门，所以那两条天象改用别的方式做代价。
   */
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
/* 普通探索（需求 1：小区域还没发现秘境时唯一能做的事）                  */
/* ------------------------------------------------------------------ */

/**
 * 一个小区域现在能不能做普通探索。
 *
 * 规则来自需求原文：「每个小区域在未发现秘境时只能普通探索」。
 * 所以条件是 **该小区域还有没被发现的秘境** —— 全都发现之后就只剩探秘境了。
 */
export function canSurveyRegion(state: GameState, regionId: string): StartCheck {
  const region = MAP_REGION_MAP[regionId];
  if (!region) return { ok: false, reason: '此处不存在' };
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  if (state.realmIndex < region.requiresRealm) return { ok: false, reason: '境界不足，走不到那里' };
  const total = realmCountOfRegion(regionId);
  const found = realmsOfRegion(regionId).filter((r) => isRealmDiscovered(state, r)).length;
  if (total > 0 && found >= total) {
    return { ok: false, reason: '此地秘境已全部寻得，直接探秘境即可' };
  }
  if (state.expeditions.length >= getMaxExpeditions(state)) {
    return { ok: false, reason: '探索队伍已满，提升宗门品阶可增加队伍' };
  }
  return { ok: true, reason: null };
}

/** 普通探索的时长（比正经探秘境快一些，因为它就在近处转） */
export function getSurveyDuration(_state: GameState, regionId: string): number {
  const region = MAP_REGION_MAP[regionId];
  if (!region) return 0;
  const tier = regionTier(regionId);
  const base = 120 * 1.6 ** (tier - 1);
  return Math.round(base * SURVEY_DURATION_RATIO);
}

/** 普通探索能派几个人：比探秘境宽松（就是去附近看看，不用整队） */
export function getSurveyPartyRange(): { min: number; max: number } {
  return { min: 1, max: SURVEY_MAX_PARTY };
}

export function canStartSurvey(state: GameState, regionId: string, ids: string[]): StartCheck {
  const region = canSurveyRegion(state, regionId);
  if (!region.ok) return region;

  const { min, max } = getSurveyPartyRange();
  if (ids.length < min) return { ok: false, reason: `至少需派遣 ${min} 名弟子` };
  if (ids.length > max) return { ok: false, reason: `普通探索最多派 ${max} 名弟子` };
  if (new Set(ids).size !== ids.length) return { ok: false, reason: '同一名弟子不能重复派遣' };

  const def = MAP_REGION_MAP[regionId];
  const minRealm = Math.max(0, (def?.requiresRealm ?? 0) - 1);
  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) return { ok: false, reason: '弟子不存在' };
    if (d.status !== 'idle') return { ok: false, reason: `${d.name} 正在探索中` };
    if (d.realmIndex < minRealm) return { ok: false, reason: `需${REALMS[minRealm].name}以上弟子` };
  }
  return { ok: true, reason: null };
}

/** 自动挑一队空闲弟子去做普通探索 */
export function autoSelectSurveyParty(state: GameState, _regionId: string, size = 2): string[] {
  return getIdleDisciples(state)
    .sort((a, b) => REALMS[b.realmIndex].power - REALMS[a.realmIndex].power)
    .slice(0, Math.max(1, Math.min(size, SURVEY_MAX_PARTY)))
    .map((d) => d.id);
}

export function startSurvey(
  state: GameState,
  regionId: string,
  ids: string[],
  random: RandomSource = gameRandom,
): GameState {
  const check = canStartSurvey(state, regionId, ids);
  if (!check.ok) return state;
  const region = MAP_REGION_MAP[regionId];
  if (!region) return state;

  const expedition: Expedition = {
    id: randomId('s', random),
    realmId: regionId,
    discipleIds: [...ids],
    progress: 0,
    duration: getSurveyDuration(state, regionId),
    kind: 'survey',
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
      text: `${names} 在${region.name}一带普通探索（${ids.length} 人）`,
    }),
  };
}

/**
 * 普通探索的结算。
 *
 * 需求原文：「普通探索有概率发现秘境和稀有材料，必定产出基础材料，但是数量随机。」
 * 所以三件事：
 *   1. **必定**给基础材料（1~2 种，数量随机）；
 *   2. 有概率给稀有材料；
 *   3. 有概率发现新秘境（用和探秘境同一套发现概率与硬保底）。
 *
 * ⚠️ 刻意**没有伤亡**：普通探索就是"在附近转转"，
 * 不该成为弟子的绞肉机。秘境那边的伤亡已经足够制造紧张感了，
 * 而且我这一轮已经亲眼见过两次"伤亡正反馈把宗门清空"，不想再加第三个来源。
 */
export function resolveSurvey(
  state: GameState,
  expedition: Expedition,
  random: RandomSource = gameRandom,
): { state: GameState; outcome: ExpeditionOutcome | null } {
  const region = MAP_REGION_MAP[expedition.realmId];
  const drop = () => state.expeditions.filter((e) => e.id !== expedition.id);
  if (!region) return { state: { ...state, expeditions: drop() }, outcome: null };

  const alive = expedition.discipleIds.filter((id) => state.sect.disciples.some((d) => d.id === id));
  const partySize = Math.max(1, alive.length);
  const tier = regionTier(region.id);

  const weather = getWeatherEffects(state);
  const yieldMultiplier =
    // 善行值加成（需求 2）：普通探索同样吃善行加成
    (1 + getKarmaExploreBonus(state) + getSpaceExploreBonus(state)) *
    state.buffs.yieldMultiplier *
    (1 + getStructureBonus(state, 'expeditionYieldBonus') + (weather.expeditionYield ?? 0)) *
    SURVEY_YIELD_MULT;
  // 人越多带回来的越多：普通探索也一样
  const sizeFactor = 1 + (partySize - 1) * PARTY_YIELD_PER_EXTRA;

  const { base, rare } = getSurveyLoot(tier);
  let working = state;
  const gains: ExpeditionOutcome['gains'] = [];

  const push = (item: ItemId, rawAmount: number): void => {
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    const seasonal = isBasicMaterial(item)
      ? (1 + getEnvironmentMaterialBonus(working, item)) * (1 + getElementMaterialBonus(working, item))
      : 1;
    const amount = Math.max(
      1,
      Math.floor(rawAmount * yieldMultiplier * sizeFactor * variance * Math.max(0, seasonal)),
    );
    working = addItem(working, item, D(amount));
    const existing = gains.find((g) => g.id === item);
    if (existing) existing.amount += amount;
    else {
      gains.push({
        id: item,
        amount,
        name: ITEM_MAP[item].name,
        icon: ITEM_MAP[item].icon,
      });
    }
  };

  // 1. 必定产出的基础材料（1~2 种，数量随机）
  const kinds =
    SURVEY_BASE_KINDS_MIN +
    (SURVEY_BASE_KINDS_MAX > SURVEY_BASE_KINDS_MIN && random() < 0.5 ? 1 : 0);
  for (const entry of weightedDraw(base, Math.min(kinds, base.length), random)) {
    push(entry.item, entry.amount);
  }

  // 2. 有概率带回稀有材料
  if (rare.length > 0 && random() < SURVEY_RARE_CHANCE) {
    const [picked] = weightedDraw(rare, 1, random);
    if (picked) push(picked.item, picked.amount);
  }

  /* 3. 有概率发现新秘境（与探秘境共用同一套概率与硬保底） */
  let discovered: ExpeditionOutcome['discovered'] = null;
  // 普通探索只会在**这一带**找到秘境（需求 1：这是打开新区域的唯一入口）
  const candidates = getUndiscoveredCandidates(working, region.id);
  if (candidates.length > 0) {
    if (isDiscoveryGuaranteed(working) || random() < getDiscoveryChance(working)) {
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
      working = recordDiscoveryFailure(working);
    }
  }

  /* 4. 心得：普通探索也给，但只有秘境的一半 —— 见闻不如亲历 */
  const minRealm = Math.max(0, region.requiresRealm - 1);
  const insightGain = Math.max(
    1,
    Math.round(
      ((INSIGHT_PER_EXPEDITION + minRealm * INSIGHT_PER_REALM_LEVEL) * 0.5) *
        (1 + getStructureBonus(working, 'insightBonus')),
    ),
  );
  const disciples = working.sect.disciples.map((d) =>
    alive.includes(d.id) ? { ...d, status: 'idle' as const, expeditionId: undefined, insight: d.insight + insightGain } : d,
  );
  working = { ...working, sect: { ...working.sect, disciples } };

  let journal = working.journal;
  const summary = gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ');
  journal = pushJournal(journal, {
    time: working.playTime,
    kind: 'good',
    text: `${region.name}普通探索归来（${partySize} 人）：${summary || '一无所获'}`,
  });
  if (discovered) {
    journal = pushJournal(journal, {
      time: working.playTime,
      kind: 'good',
      text: `在${region.name}发现了新的秘境：${discovered.icon}${discovered.name}`,
    });
  }

  const next: GameState = {
    ...working,
    expeditions: working.expeditions.filter((e) => e.id !== expedition.id),
    journal,
  };

  return {
    state: next,
    outcome: {
      realmName: `${region.name}（普通探索）`,
      gains,
      pills: [],
      seeds: [],
      blueprints: [],
      discovered,
      insight: insightGain,
      casualties: [],
      powerRatio: 1,
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
  const weather = getWeatherEffects(state).expeditionSpeed ?? 0;
  return Math.max(0.1, state.buffs.speedMultiplier * (1 + artifacts.expeditionSpeed + buildings + weather));
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
    working =
      expedition.kind === 'survey'
        ? resolveSurvey(working, expedition, random).state
        : resolveExpedition(working, expedition, random).state;
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

