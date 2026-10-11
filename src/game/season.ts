/**
 * 季节与天象的推进与查询（需求 1）
 *
 * 这个模块刻意**不依赖 engine** —— 它只读写 GameState 与 content 表，
 * 所以 tick.ts / engine.ts / expeditions.ts 都可以引用它而不会形成循环。
 */
import {
  SEASONS,
  SEASON_MAP,
  SEASON_SECONDS,
  WEATHERS,
  WEATHER_CHANCE,
  WEATHER_MAP,
  WEATHER_ROLL_INTERVAL,
  type SeasonDef,
  type WeatherDef,
  type WeatherEffects,
} from './content';
import { MATERIAL_MAP, RESOURCE_MAP, type MaterialId, type ResourceId } from './content';
import { weightedDraw, type RandomSource } from './random';
import type { GameState } from './state';

/** 没有任何加成时的空效果 */
const NO_EFFECTS: WeatherEffects = {};

/* ------------------------------------------------------------------ */
/* 季节                                                                */
/* ------------------------------------------------------------------ */

export function getSeason(state: GameState): SeasonDef {
  return SEASONS[((state.season % SEASONS.length) + SEASONS.length) % SEASONS.length];
}

/** 本季还剩多少秒 */
export function getSeasonRemaining(state: GameState): number {
  return Math.max(0, SEASON_SECONDS - state.seasonSeconds);
}

/** 本季已过去的比例（0~1），界面画进度用 */
export function getSeasonProgress(state: GameState): number {
  return Math.min(1, Math.max(0, state.seasonSeconds / SEASON_SECONDS));
}

/**
 * 季节对某种**基础资源**的产出加成（加算）。
 *
 * 这是季节系统的核心：同一个设施在春天与冬天的产出可以差三成。
 */
export function getSeasonResourceBonus(state: GameState, resource: ResourceId): number {
  return getSeason(state).resources[resource] ?? 0;
}

/**
 * 季节对某种**基础材料**的产出加成（加算）。
 *
 * 作用于灵植收获、秘境产出与游历收获 —— 这三处是基础材料的主要来源。
 * 稀有材料不吃季节加成：它们是秘境深处的产物，不该被地表的气候左右。
 */
export function getSeasonMaterialBonus(state: GameState, material: MaterialId): number {
  return getSeason(state).materials[material] ?? 0;
}

/** 当前季节带来的全部加成，拼成一句给界面看的说明 */
export function describeSeason(state: GameState): string[] {
  const season = getSeason(state);
  const parts: string[] = [];
  for (const [id, value] of Object.entries(season.resources)) {
    parts.push(`${resourceLabel(id as ResourceId)} ${signed(value as number)}`);
  }
  for (const [id, value] of Object.entries(season.materials)) {
    parts.push(`${materialLabel(id as MaterialId)} ${signed(value as number)}`);
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/* 天象                                                                */
/* ------------------------------------------------------------------ */

export function getWeather(state: GameState): WeatherDef | null {
  return state.weatherId ? WEATHER_MAP[state.weatherId] ?? null : null;
}

export function getWeatherEffects(state: GameState): WeatherEffects {
  return getWeather(state)?.effects ?? NO_EFFECTS;
}

/** 天象还剩多少秒 */
export function getWeatherRemaining(state: GameState): number {
  return getWeather(state) ? Math.max(0, state.weatherSeconds) : 0;
}

/** 天象提供的全局产量加成 */
export function getWeatherProductionBonus(state: GameState): number {
  return getWeatherEffects(state).production ?? 0;
}

/** 天象提供的弟子修行速度加成 */
export function getWeatherCultivationBonus(state: GameState): number {
  return getWeatherEffects(state).cultivation ?? 0;
}

export function getWeatherResourceBonus(state: GameState, resource: ResourceId): number {
  return getWeatherEffects(state).resources?.[resource] ?? 0;
}

export function getWeatherMaterialBonus(state: GameState, material: MaterialId): number {
  return getWeatherEffects(state).materials?.[material] ?? 0;
}

/**
 * 季节 + 天象对某种资源的**总**加成。
 *
 * 两者都是加算，所以不会出现"冬天叠上极寒之潮直接归零或翻几倍"的极端情况。
 */
export function getEnvironmentResourceBonus(state: GameState, resource: ResourceId): number {
  return getSeasonResourceBonus(state, resource) + getWeatherResourceBonus(state, resource);
}

/** 季节 + 天象对某种基础材料的总加成 */
export function getEnvironmentMaterialBonus(state: GameState, material: MaterialId): number {
  return getSeasonMaterialBonus(state, material) + getWeatherMaterialBonus(state, material);
}

/** 天象效果的说明列表 */
export function describeWeather(state: GameState): string[] {
  const weather = getWeather(state);
  if (!weather) return [];
  const e = weather.effects;
  const parts: string[] = [];
  if (e.production) parts.push(`全局产量 ${signed(e.production)}`);
  if (e.cultivation) parts.push(`弟子修行 ${signed(e.cultivation)}`);
  if (e.expeditionYield) parts.push(`秘境产出 ${signed(e.expeditionYield)}`);
  if (e.expeditionSpeed) parts.push(`探索速度 ${signed(e.expeditionSpeed)}`);
  if (e.breakthrough) parts.push(`突破成功率 ${signed(e.breakthrough)}`);
  for (const [id, value] of Object.entries(e.resources ?? {})) {
    parts.push(`${resourceLabel(id as ResourceId)} ${signed(value as number)}`);
  }
  for (const [id, value] of Object.entries(e.materials ?? {})) {
    parts.push(`${materialLabel(id as MaterialId)} ${signed(value as number)}`);
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/* 推进                                                                */
/* ------------------------------------------------------------------ */

/**
 * 推进季节与天象。
 *
 * 两条路径，因为调用方的 dt 尺度差得很远：
 *
 * **细粒度（dt ≤ 一季）** —— 活跃游戏的每帧、离线几分钟，都走这条。
 * 一季 90 秒，天象每 40 秒判定一次（40% 概率出现），持续 45~60 秒，
 * 所以大部分时间有天象挂着，但没有哪一条会一直在。
 *
 * **粗粒度（dt > 一季）** —— 离线八小时、模拟器一次跳几天，都走这条。
 * 这时逐拍模拟既没必要也会把主线程拖垮（八小时 = 720 拍以上），
 * 所以直接把季节推到位，天象只做"是否已过期 + 掷一次新的"。
 *
 * ⚠️ 粗粒度下有个已知近似：**产出用的是落地时的那一季**，
 * 而不是把离线区间按四季积分。离线收益本来就是 50% 的粗略结算，
 * 为了季节把它做成积分不划算 —— 但这条要写清楚，免得以后有人当真。
 */
export function tickSeason(state: GameState, dt: number, random: RandomSource): GameState {
  if (dt <= 0) return state;

  if (dt > SEASON_SECONDS) return tickSeasonCoarse(state, dt, random);

  let next = state;
  let remaining = dt;
  let guard = 0;

  while (remaining > 0 && guard < 400) {
    guard += 1;

    // 距离下一个"事件点"还有多久：季节结束或天象结束或天象判定
    const toSeasonEnd = SEASON_SECONDS - next.seasonSeconds;
    const weather = getWeather(next);
    const toWeatherEnd = weather ? next.weatherSeconds : Infinity;
    const toWeatherRoll = next.weatherTimer;
    const step = Math.max(0, Math.min(remaining, toSeasonEnd, toWeatherEnd, toWeatherRoll));

    next = {
      ...next,
      seasonSeconds: next.seasonSeconds + step,
      weatherSeconds: weather ? Math.max(0, next.weatherSeconds - step) : next.weatherSeconds,
      weatherTimer: Math.max(0, next.weatherTimer - step),
    };
    remaining -= step;

    // 天象到期
    if (next.weatherId && next.weatherSeconds <= 0) {
      next = { ...next, weatherId: null, weatherSeconds: 0 };
    }

    // 季节轮转
    if (next.seasonSeconds >= SEASON_SECONDS) {
      next = {
        ...next,
        season: (next.season + 1) % SEASONS.length,
        seasonSeconds: next.seasonSeconds - SEASON_SECONDS,
      };
    }

    // 天象判定
    if (next.weatherTimer <= 0) {
      next = { ...next, weatherTimer: WEATHER_ROLL_INTERVAL };
      if (!next.weatherId && random() < WEATHER_CHANCE) {
        next = summonWeather(next, random);
      }
    }
  }

  return next;
}

/** 粗粒度推进：直接把季节推到位，天象只做一次判定 */
function tickSeasonCoarse(state: GameState, dt: number, random: RandomSource): GameState {
  const total = state.seasonSeconds + dt;
  const steps = Math.floor(total / SEASON_SECONDS);
  const season = (state.season + steps) % SEASONS.length;
  const seasonSeconds = total - steps * SEASON_SECONDS;

  let next: GameState = { ...state, season, seasonSeconds };

  // 天象：撑不过这么久就散掉
  const weather = getWeather(next);
  if (weather && next.weatherSeconds <= dt) {
    next = { ...next, weatherId: null, weatherSeconds: 0 };
  } else if (weather) {
    next = { ...next, weatherSeconds: next.weatherSeconds - dt };
  }

  // 离线期间本可以判定很多次，这里只掷一次 —— 见上面的近似说明
  next = { ...next, weatherTimer: WEATHER_ROLL_INTERVAL };
  if (!next.weatherId && random() < WEATHER_CHANCE) {
    next = summonWeather(next, random);
  }

  return next;
}

/** 按权重随机召来一个天象 */
export function summonWeather(state: GameState, random: RandomSource): GameState {
  const [picked] = weightedDraw(
    WEATHERS.map((w) => ({ ...w, weight: w.weight })),
    1,
    random,
  );
  if (!picked) return state;
  return { ...state, weatherId: picked.id, weatherSeconds: picked.duration };
}

/** 立刻结束当前天象（调试 / 测试用） */
export function clearWeather(state: GameState): GameState {
  return { ...state, weatherId: null, weatherSeconds: 0 };
}

/* ------------------------------------------------------------------ */
/* 文案小工具                                                          */
/* ------------------------------------------------------------------ */

function signed(value: number): string {
  const pct = Math.round(value * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function resourceLabel(id: ResourceId): string {
  return RESOURCE_MAP[id]?.name ?? id;
}

function materialLabel(id: MaterialId): string {
  return MATERIAL_MAP[id]?.name ?? id;
}

/** 季节表的 id → 定义（界面用） */
export { SEASON_MAP };
