/**
 * 个人游历（需求 1）
 *
 * 掌门亲自出门，按境界开放区域，带回资源、材料与种子。
 *
 * 与弟子秘境的关键区别：
 *   - 不占弟子、不会死人（掌门自己远比同境界弟子强）
 *   - 但**出门期间全局产量下降**（engine.getTravelMultiplier）
 *   - 没有宗门也能进行 —— 这正是需求 1 想解决的"开宗之前没事干"
 *
 * 材料门槛完全由区域的 minRealm 决定，这就是「材料的获取跟着玩家的等级走」。
 */
import { D } from './decimal';
import {
  EXPLORATION_SEEDS,
  ITEM_MAP,
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
import { addItem } from './engine';
import { pushJournal } from './disciples';
import { addSeeds } from './planting';
import { gameRandom, weightedDraw, type RandomSource } from './random';
import type { GameState, PersonalTravel } from './state';

/* ------------------------------------------------------------------ */
/* 区域可见性与校验                                                     */
/* ------------------------------------------------------------------ */


/** 已经能去的区域 */
export function getAvailableRegions(state: GameState): TravelRegionDef[] {
  return TRAVEL_REGIONS.filter((def) => state.realmIndex >= def.minRealm);
}

/** 可见但还去不了的区域（界面上灰掉，标注所需境界） */
export function getLockedRegions(state: GameState): TravelRegionDef[] {
  return TRAVEL_REGIONS.filter(
    (def) => state.realmIndex < def.minRealm && state.realmIndex + 1 >= def.minRealm,
  );
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
}

/**
 * 结算一次游历。
 *
 * 掉落规则与秘境一致（必掉项 + 按权重不放回抽若干项 + 数量浮动），
 * 差别只在于：不会有伤亡、额外可能带回种子。
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
    // 保证第一次出门就一定凑得起第一门技术（炼丹入门 100 灵石）
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

  return { state: working, outcome: { regionName: def.name, gains, seeds: seedGains } };
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
