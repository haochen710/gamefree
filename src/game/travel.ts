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
  type ItemId,
  type MaterialId,
  type TravelRegionDef,
} from './content';
import {
  addItem,
  canReachRegion,
  discoverRealm,
  getDiscoveryChance,
  getStructureBonus,
  getUndiscoveredCandidates,
  growDiscoveryPity,
  isRegionVisible,
} from './engine';
import { pushJournal } from './disciples';
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
    personalTravel: { regionId, progress: 0, duration: def.duration },
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'info',
      text: `掌门启程前往${def.name}游历，洞府无人监管，产量下降`,
    }),
  };
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
    let amount = Math.max(1, Math.floor(entry.amount * variance));
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
  const candidates = getUndiscoveredCandidates(working);
  if (candidates.length > 0) {
    if (random() < getDiscoveryChance(working, 0)) {
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
      working = growDiscoveryPity(working);
    }
  }

  /* ---- 掌门见闻讲与弟子（需求 4 的心得） ---- */
  const insightGain = Math.max(0, Math.round(INSIGHT_PER_TRAVEL * (1 + getStructureBonus(working, 'insightBonus'))));
  if (insightGain > 0 && working.sect.disciples.length > 0) {
    working = {
      ...working,
      sect: {
        ...working.sect,
        disciples: working.sect.disciples.map((d) => ({ ...d, insight: d.insight + insightGain })),
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
  if (progress < travel.duration) {
    return { ...state, personalTravel: { ...travel, progress } };
  }
  return resolveTravel({ ...state, personalTravel: { ...travel, progress } }, random).state;
}

/** 界面上显示「还有多久回来」 */
export function getTravelRemaining(travel: PersonalTravel): number {
  return Math.max(0, travel.duration - travel.progress);
}
