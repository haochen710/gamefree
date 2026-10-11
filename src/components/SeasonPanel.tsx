/**
 * 季节与天象面板（需求 1）
 *
 * 这个面板要回答两个问题，因为季节与天象是两套不同节奏的东西：
 *   1. **现在是哪一季，还剩多久** —— 可预期的节奏，决定这段该囤什么；
 *   2. **现在天上是什么** —— 不可预期的意外，可能是 +40% 产量，也可能是 -25%。
 *
 * 所以上半部分是"当前"，下半部分是"全年图鉴"（四季对照 + 天象一览），
 * 让玩家能提前规划，而不是被随机数牵着走。
 */
import { fmtDuration } from '../game/decimal';
import { SEASONS, WEATHERS, WEATHER_TONE_LABEL, gameYearOf, type SeasonDef } from '../game/content';
import {
  describeSeason,
  describeWeather,
  getSeason,
  getSeasonProgress,
  getSeasonRemaining,
  getWeather,
  getWeatherRemaining,
} from '../game/season';
import { useGame } from '../game/store';

export function SeasonPanel() {
  const game = useGame((s) => s.game);

  const season = getSeason(game);
  const weather = getWeather(game);
  const seasonLeft = getSeasonRemaining(game);
  const weatherLeft = getWeatherRemaining(game);
  const seasonEffects = describeSeason(game);
  const weatherEffects = describeWeather(game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>
          {season.icon} 第 {gameYearOf(game.playTime)} 年 · {season.name}季
        </h2>
        <span className="panel__hint">
          距换季 {fmtDuration(seasonLeft)}
          {weather && ` · ${weather.icon} ${weather.name} 剩 ${fmtDuration(weatherLeft)}`}
        </span>
      </div>

      {/* 本季进度条：季节是玩家的"生产节奏"，得看得见还剩多久 */}
      <div className="bar">
        <div className="bar__fill" style={{ width: `${Math.round(getSeasonProgress(game) * 100)}%` }} />
      </div>

      <p className="panel__note">{season.desc}</p>

      <div className="season__effects">
        {seasonEffects.map((text) => (
          <span
            key={text}
            className={text.includes('-') ? 'season-chip season-chip--down' : 'season-chip season-chip--up'}
          >
            {text}
          </span>
        ))}
      </div>

      {weather ? (
        <div className={`weather weather--${weather.tone}`}>
          <div className="weather__head">
            <span className="weather__icon">{weather.icon}</span>
            <span className="weather__name">{weather.name}</span>
            <span className={`weather__tone weather__tone--${weather.tone}`}>
              {WEATHER_TONE_LABEL[weather.tone]}
            </span>
            <span className="weather__time">剩 {fmtDuration(weatherLeft)}</span>
          </div>
          <p className="weather__desc">{weather.desc}</p>
          <div className="season__effects">
            {weatherEffects.map((text) => (
              <span
                key={text}
                className={text.includes('-') ? 'season-chip season-chip--down' : 'season-chip season-chip--up'}
              >
                {text}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="panel__note">
          此刻天象平静，没有额外的增益或减益。
        </p>
      )}

      {/* ---- 全年图鉴 ---- */}
      <details className="season__book">
        <summary>四季与天象一览</summary>

        <div className="season__grid">
          {SEASONS.map((def) => (
            <SeasonCard key={def.id} def={def} current={def.id === season.id} />
          ))}
        </div>

        <table className="season__table">
          <thead>
            <tr>
              <th>天象</th>
              <th>倾向</th>
              <th>效果</th>
            </tr>
          </thead>
          <tbody>
            {WEATHERS.map((def) => (
              <tr key={def.id}>
                <td>
                  {def.icon} {def.name}
                </td>
                <td>
                  <span className={`weather__tone weather__tone--${def.tone}`}>
                    {WEATHER_TONE_LABEL[def.tone]}
                  </span>
                </td>
                <td>{describeWeatherDef(def.effects)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="panel__note">
          天象每隔约 40 秒判定一次，持续 45~60 秒。注意：<strong>天象不会提高发现秘境的概率</strong> ——
          那条线只有寻宝宝盘能碰。
        </p>
      </details>
    </section>
  );
}

function SeasonCard({ def, current }: { def: SeasonDef; current: boolean }) {
  const parts: string[] = [];
  for (const [id, value] of Object.entries(def.resources)) {
    parts.push(`${RESOURCE_LABEL[id] ?? id} ${signed(value as number)}`);
  }
  for (const [id, value] of Object.entries(def.materials)) {
    parts.push(`${MATERIAL_LABEL[id] ?? id} ${signed(value as number)}`);
  }

  return (
    <div className={current ? 'season-card season-card--current' : 'season-card'}>
      <div className="season-card__head">
        <span className="season-card__icon">{def.icon}</span>
        <span className="season-card__name">{def.name}季</span>
        {current && <span className="season-card__now">当前</span>}
      </div>
      <div className="season__effects">
        {parts.map((text) => (
          <span
            key={text}
            className={text.includes('-') ? 'season-chip season-chip--down' : 'season-chip season-chip--up'}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

function describeWeatherDef(effects: {
  production?: number;
  cultivation?: number;
  expeditionYield?: number;
  expeditionSpeed?: number;
  casualty?: number;
  breakthrough?: number;
  resources?: Record<string, number>;
  materials?: Record<string, number>;
}): string {
  const parts: string[] = [];
  if (effects.production) parts.push(`全局产量 ${signed(effects.production)}`);
  if (effects.cultivation) parts.push(`弟子修行 ${signed(effects.cultivation)}`);
  if (effects.expeditionYield) parts.push(`秘境产出 ${signed(effects.expeditionYield)}`);
  if (effects.expeditionSpeed) parts.push(`探索速度 ${signed(effects.expeditionSpeed)}`);
  if (effects.casualty) parts.push(`伤亡 ${signed(effects.casualty)}`);
  if (effects.breakthrough) parts.push(`突破成功率 ${signed(effects.breakthrough)}`);
  for (const [id, value] of Object.entries(effects.resources ?? {})) {
    parts.push(`${RESOURCE_LABEL[id] ?? id} ${signed(value)}`);
  }
  for (const [id, value] of Object.entries(effects.materials ?? {})) {
    parts.push(`${MATERIAL_LABEL[id] ?? id} ${signed(value)}`);
  }
  return parts.join(' · ');
}

function signed(value: number): string {
  const pct = Math.round(value * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

const RESOURCE_LABEL: Record<string, string> = {
  qi: '灵气',
  wood: '灵木',
  ore: '灵矿',
  stone: '灵石',
  herb: '灵草',
};

const MATERIAL_LABEL: Record<string, string> = {
  demonCore: '妖丹',
  blackIron: '玄铁',
  spiritSilk: '灵蚕丝',
  fireMarrow: '地火髓',
  coldJade: '寒玉',
};

/**
 * 侧栏用的一行紧凑条（需求 1）
 *
 * 季节会改变**所有**资源的产出，所以它不该只出现在「修行」页里 ——
 * 玩家在丹器页、灵植页也该一眼看见"现在是冬天，灵草 -35%"。
 */
export function SeasonStrip() {
  const game = useGame((s) => s.game);
  const season = getSeason(game);
  const weather = getWeather(game);

  return (
    <div className="season-strip">
      <div className="season-strip__row">
        <span className="season-strip__icon">{season.icon}</span>
        <span className="season-strip__name">第 {gameYearOf(game.playTime)} 年 · {season.name}季</span>
        <span className="season-strip__time">{fmtDuration(getSeasonRemaining(game))}</span>
      </div>
      {weather && (
        <div className={`season-strip__row season-strip__row--${weather.tone}`}>
          <span className="season-strip__icon">{weather.icon}</span>
          <span className="season-strip__name">{weather.name}</span>
          <span className="season-strip__time">{fmtDuration(getWeatherRemaining(game))}</span>
        </div>
      )}
    </div>
  );
}

export default SeasonPanel;
