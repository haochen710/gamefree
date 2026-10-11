/**
 * 个人游历（需求 1 / 5）
 *
 * 掌门亲自出门，按境界开放区域，带回资源、材料与种子。
 *
 * 与弟子秘境的关键区别：
 *   - 不占弟子、不会死人（掌门自己远比同境界弟子强）
 *   - 但**出门期间全局产量下降**（engine.getTravelMultiplier）
 *   - 没有宗门也能进行 —— 这正是需求 1 想解决的"开宗之前没事干"
 *
 * 需求 5 之后，能去哪儿由**地图区域**决定（见 map.ts）：
 * 境界越高飞得越远，区域门槛就是「探索距离」的体现。
 * 掌门出门同样可能**发现新秘境**（需求 1：「弟子或者玩家探索发现」）。
 */
import { D } from './decimal';
import {
  EXPLORATION_SEEDS,
  INSIGHT_PER_TRAVEL,
  ITEM_MAP,
  MAP_REGIONS,
  MAP_REGION_MAP,
  MATERIAL_MAP,
  REALMS,
  SEED_MAP,
  TRAVEL_LOOT_ROLLS,
  TRAVEL_MIN_STONE,
  TRAVEL_REGION_MAP,
  TRAVEL_REGIONS,
  YIELD_VARIANCE_MAX,
  YIELD_VARIANCE_MIN,
  LOOT_ROLLS,
  SECRET_REALM_MAP,
  isBasicMaterial,
  isRareMaterial,
  type ItemId,
  type MaterialId,
  type TravelRegionDef,
} from './content';
import {
  addItem,
  canReachRegion,
  discoverRealm,
  getDiscoveryChance,
  getRealmCooldown,
  getStructureBonus,
  getUndiscoveredCandidates,
  isDiscoveryGuaranteed,
  isRealmAvailable,
  isRealmOpened,
  isRealmDiscovered,
  isRegionVisible,
  recordDiscoveryFailure,
} from './engine';
import { addInsight, pushJournal } from './disciples';
import { getEnvironmentMaterialBonus } from './season';
import { getKarmaExploreBonus } from './encounter';
import { getElementMaterialBonus, getSpaceExploreBonus } from './enlightenment';
import { addSeeds } from './planting';
import { gameRandom, weightedDraw, type RandomSource } from './random';
import type { GameState, PersonalTravel } from './state';

/* ------------------------------------------------------------------ */
/* 区域可见性与校验                                                     */
/* ------------------------------------------------------------------ */

/** 该游历目的地所在的地图区域 */
export function travelRegionOf(def: TravelRegionDef) {
  return MAP_REGION_MAP[def.regionId] ?? MAP_REGIONS[0];
}

/** 已经能去的游历目的地（地图区域 + 自身境界双重门槛） */
export function getAvailableRegions(state: GameState): TravelRegionDef[] {
  return TRAVEL_REGIONS.filter((def) => canReachRegion(state, travelRegionOf(def)));
}

/** 可见但还去不了的（提前一档显示，标注所需境界） */
export function getLockedRegions(state: GameState): TravelRegionDef[] {
  return TRAVEL_REGIONS.filter((def) => {
    const region = travelRegionOf(def);
    return !canReachRegion(state, region) && isRegionVisible(state, region);
  });
}

export function getTravelProgress(travel: PersonalTravel): number {
  if (travel.duration <= 0) return 1;
  return Math.min(1, Math.max(0, travel.progress / travel.duration));
}

export interface TravelCheck {
  ok: boolean;
  reason: string | null;
}

export function canStartTravel(state: GameState, regionId: string): TravelCheck {
  const def = TRAVEL_REGION_MAP[regionId];
  if (!def) return { ok: false, reason: '此地不存在' };
  if (state.personalTravel) return { ok: false, reason: '掌门已经在外游历' };

  const region = travelRegionOf(def);
  if (!canReachRegion(state, region)) {
    return { ok: false, reason: `探索距离不足，需先能抵达${region.name}（${REALMS[region.requiresRealm].name}）` };
  }
  if (state.realmIndex < def.minRealm) {
    return { ok: false, reason: `需修至${REALMS[def.minRealm].name}` };
  }
  return { ok: true, reason: null };
}

export function startTravel(state: GameState, regionId: string): GameState {
  if (!canStartTravel(state, regionId).ok) return state;

  const def = TRAVEL_REGION_MAP[regionId];
  return {
    ...state,
    personalTravel: { kind: 'travel', regionId, progress: 0, duration: def.duration },
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'info',
      text: `掌门启程前往${def.name}游历，洞府无人监管，产量下降`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 掌门独自探秘境（需求 5）                                             */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：「秘境可由玩家独自前往，玩家独自前往更容易获取稀有材料」。
 *
 * 和派弟子的区别有两点，都是刻意做的：
 *   1. **慢**：一个人要自己开路、自己护法，时长是派队伍的 1.4 倍；
 *   2. **专挑稀有的**：总产量只有队伍的 45%（一个人背不动），
 *      但稀有材料的权重 ×4 —— 想要星辰砂、太阴玄晶这类东西，
 *      亲自跑一趟比派弟子划算。
 *
 * 掌门亲自出门同样会**让洞府产量下降**（和游历共用同一套惩罚），
 * 所以这不是"免费的第二支队伍"，而是拿家中产量换稀有材料。
 */
export const SOLO_REALM_DURATION_MULT = 1.4;
export const SOLO_REALM_YIELD_MULT = 0.45;
export const SOLO_REALM_RARE_WEIGHT_MULT = 4;

export function getSoloRealmDuration(_state: GameState, realmId: string): number {
  const def = SECRET_REALM_MAP[realmId];
  if (!def) return 0;
  return Math.round(def.duration * SOLO_REALM_DURATION_MULT);
}

export function canStartSoloRealm(state: GameState, realmId: string): TravelCheck {
  const def = SECRET_REALM_MAP[realmId];
  if (!def) return { ok: false, reason: '秘境不存在' };
  if (state.personalTravel) return { ok: false, reason: '掌门正在外' };
  if (!isRealmDiscovered(state, def)) return { ok: false, reason: '尚未发现此秘境' };
  if (!isRealmOpened(state, def)) return { ok: false, reason: '尚未开启，需先立阵眼' };
  if (!isRealmAvailable(state, def)) {
    const cooldown = getRealmCooldown(state, def.id);
    if (cooldown > 0) return { ok: false, reason: `冷却中，还需 ${Math.ceil(cooldown)} 秒` };
    return { ok: false, reason: '此地暂时去不了' };
  }
  return { ok: true, reason: null };
}

export function startSoloRealm(state: GameState, realmId: string): GameState {
  if (!canStartSoloRealm(state, realmId).ok) return state;
  const def = SECRET_REALM_MAP[realmId];
  return {
    ...state,
    personalTravel: {
      kind: 'realm',
      regionId: realmId,
      progress: 0,
      duration: getSoloRealmDuration(state, realmId),
    },
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'info',
      text: `掌门独自前往${def.name}，洞府无人监管，产量下降`,
    }),
  };
}

/**
 * 掌门独自探秘境的结算。
 *
 * 掉落规则和派弟子**共用同一张表**（`def.loot`），只做两件事：
 *   - 稀有材料的权重 ×4（"更容易获取稀有材料"）；
 *   - 总产量 ×0.45（一个人带不了多少东西）。
 */
export function resolveSoloRealm(
  state: GameState,
  travel: PersonalTravel,
  random: RandomSource = gameRandom,
): { state: GameState; outcome: SoloRealmOutcome | null } {
  const def = SECRET_REALM_MAP[travel.regionId];
  if (!def) return { state: { ...state, personalTravel: null }, outcome: null };

  const entries = def.loot.map((entry) => ({
    ...entry,
    weight:
      entry.weight *
      (isRareMaterial(entry.item) ? SOLO_REALM_RARE_WEIGHT_MULT : 1),
    amount: Math.max(1, Math.round(entry.amount * SOLO_REALM_YIELD_MULT)),
  }));

  /*
   * "必掉"的条目对掌门也必掉。
   *
   * 一开始这里把整张表一起丢进加权抽，`guaranteed` 就被无声地忽略了 ——
   * 于是同一处秘境，派弟子去一定有那份招牌产出，掌门亲自去反而可能空手，
   * 而界面上写的是"产出倾向：…"，玩家只会觉得是 bug。抽签只该决定**额外**的东西。
   */
  const guaranteed = entries.filter((entry) => entry.guaranteed);
  const optional = entries.filter((entry) => !entry.guaranteed);
  const rolls = Math.max(2, Math.round(LOOT_ROLLS * 0.7));
  const picked = [...guaranteed, ...weightedDraw(optional, rolls, random)];

  let working = state;
  const gains: TravelGain[] = [];
  for (const entry of picked) {
    // 季节对基础材料仍然生效
    const seasonal = isBasicMaterial(entry.item)
      ? (1 + getEnvironmentMaterialBonus(working, entry.item)) * (1 + getElementMaterialBonus(working, entry.item))
      : 1;
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    const amount = Math.max(1, Math.floor(entry.amount * Math.max(0, seasonal) * variance * (1 + getKarmaExploreBonus(working) + getSpaceExploreBonus(working))));
    working = addItem(working, entry.item, D(amount));
    const existing = gains.find((g) => g.id === entry.item);
    if (existing) existing.amount += amount;
    else {
      gains.push({
        id: entry.item,
        amount,
        name: ITEM_MAP[entry.item as ItemId]?.name ?? entry.item,
        icon: ITEM_MAP[entry.item as ItemId]?.icon ?? '❓',
      });
    }
  }

  let journal = working.journal;
  journal = pushJournal(journal, {
    time: working.playTime,
    kind: 'good',
    text: `掌门自${def.name}归来：${gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ') || '一无所获'}`,
  });

  // 亲自去过就算探过：同样进冷却
  const next: GameState = {
    ...working,
    personalTravel: null,
    realmCooldowns: { ...working.realmCooldowns, [def.id]: def.cooldown },
    journal,
  };

  return { state: next, outcome: { realmName: def.name, gains } };
}

export interface SoloRealmOutcome {
  realmName: string;
  gains: TravelGain[];
}


export function cancelTravel(state: GameState): GameState {
  const travel = state.personalTravel;
  if (!travel) return state;
  const def = TRAVEL_REGION_MAP[travel.regionId];

  return {
    ...state,
    personalTravel: null,
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'info',
      text: `掌门自${def?.name ?? '外'}折返，此行无功而返`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

export interface TravelGain {
  id: ItemId;
  name: string;
  icon: string;
  amount: number;
}

export interface TravelSeedGain {
  material: MaterialId;
  name: string;
  amount: number;
}

export interface TravelOutcome {
  regionName: string;
  gains: TravelGain[];
  seeds: TravelSeedGain[];
  /** 掌门本次发现的新秘境（需求 1） */
  discovered: { id: string; name: string; icon: string } | null;
}

/**
 * 结算一次游历。
 *
 * 掉落规则与秘境一致（必掉项 + 按权重不放回抽若干项 + 数量浮动），
 * 差别只在于：不会有伤亡、且掌门见闻会讲给弟子听（全宗 +1 心得）。
 */
export function resolveTravel(
  state: GameState,
  random: RandomSource = gameRandom,
): { state: GameState; outcome: TravelOutcome | null } {
  const travel = state.personalTravel;
  if (!travel) return { state, outcome: null };

  const def = TRAVEL_REGION_MAP[travel.regionId];
  if (!def) return { state: { ...state, personalTravel: null }, outcome: null };

  const guaranteed = def.loot.filter((entry) => entry.guaranteed);
  const pool = def.loot.filter((entry) => !entry.guaranteed);
  const picked = [...guaranteed, ...weightedDraw(pool, TRAVEL_LOOT_ROLLS, random)];

  let working: GameState = { ...state, personalTravel: null };
  const gains: TravelGain[] = [];
  let stoneGained = 0;

  for (const entry of picked) {
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    // 季节与天象对基础材料的加成（需求 1）在游历里同样生效
    const seasonal = isBasicMaterial(entry.item)
      ? Math.max(0, 1 + getEnvironmentMaterialBonus(state, entry.item)) * (1 + getElementMaterialBonus(state, entry.item))
      : 1;
    let amount = Math.max(1, Math.floor(entry.amount * variance * seasonal));
    // 出门一趟至少带回 TRAVEL_MIN_STONE 灵石，
    // 保证"第一次出门一定有实在收益"
    if (entry.item === 'stone') {
      amount = Math.max(amount, TRAVEL_MIN_STONE - stoneGained);
      stoneGained += amount;
    }

    working = addItem(working, entry.item, D(amount));
    gains.push({
      id: entry.item,
      amount,
      name: ITEM_MAP[entry.item].name,
      icon: ITEM_MAP[entry.item].icon,
    });
  }

  /* ---- 种子（需求 5：稀有材料种子只能靠探索，越高级概率越小） ---- */
  const seedGains: TravelSeedGain[] = [];
  if (random() < def.seedChance) {
    const seedPool = EXPLORATION_SEEDS.filter(
      (seed) => seed.rarity >= (def.seedMinRarity ?? 1) && seed.rarity <= def.seedMaxRarity,
    );
    const [pickedSeed] = weightedDraw(
      seedPool.map((seed) => ({ ...seed, weight: seed.dropWeight })),
      1,
      random,
    );
    if (pickedSeed) {
      working = addSeeds(working, pickedSeed.material, 1);
      seedGains.push({
        material: pickedSeed.material,
        name: SEED_MAP[pickedSeed.material]?.name ?? pickedSeed.name,
        amount: 1,
      });
    }
  }

  /* ---- 发现新秘境（需求 1：玩家探索也能发现） ---- */
  let discovered: TravelOutcome['discovered'] = null;
  // 掌门亲自游历：只在目的地所在的那一片找新秘境（需求 1）
  const candidates = getUndiscoveredCandidates(working, def.regionId);
  if (candidates.length > 0) {
    // 硬保底与探索共用同一个失败计数（发现概率只有寻宝宝盘能提升）
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

  /* ---- 掌门见闻讲与弟子（需求 4 的心得） ---- */
  const insightGain = Math.max(0, Math.round(INSIGHT_PER_TRAVEL * (1 + getStructureBonus(working, 'insightBonus'))));
  if (insightGain > 0 && working.sect.disciples.length > 0) {
    working = {
      ...working,
      sect: {
        ...working.sect,
    disciples: working.sect.disciples.map((d) => ({ ...d, insight: addInsight(working, d, insightGain).insight })),
      },
    };
  }

  const summary = gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ');
  const seedText = seedGains.map((s) => `${MATERIAL_MAP[s.material]?.icon ?? '🌰'}${s.name}`).join(' ');

  working = {
    ...working,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'good',
      text: `自${def.name}游历归来：${summary || '一无所获'}${seedText ? `，另得${seedText}` : ''}`,
    }),
  };

  if (discovered) {
    working = {
      ...working,
      journal: pushJournal(working.journal, {
        time: working.playTime,
        kind: 'good',
        text: `掌门在${def.name}外发现了新的秘境：${discovered.icon}${discovered.name}`,
      }),
    };
  }

  return { state: working, outcome: { regionName: def.name, gains, seeds: seedGains, discovered } };
}

/* ------------------------------------------------------------------ */
/* 时间推进                                                            */
/* ------------------------------------------------------------------ */

export function tickTravel(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  const travel = state.personalTravel;
  if (!travel || dt <= 0) return state;

  const progress = travel.progress + dt;
  const running = { ...state, personalTravel: { ...travel, progress } };
  if (progress < travel.duration) return running;

  // 需求 5：掌门独自探秘境走同一条时间线，只是结算不同
  return travel.kind === 'realm'
    ? resolveSoloRealm(running, running.personalTravel as PersonalTravel, random).state
    : resolveTravel(running, random).state;
}

/** 界面上显示「还有多久回来」 */
export function getTravelRemaining(travel: PersonalTravel): number {
  return Math.max(0, travel.duration - travel.progress);
}
