/**
 * 个人游历（需求 1）
 *
 * 掌门亲自出门，按境界开放区域。这里是"开宗立派之前"唯一的材料来源，
 * 也是全游戏唯一会**降低全局产量**的主动行为 ——
 * 所以每张卡片都必须把「出门要付什么代价」写清楚。
 */
import { ITEM_MAP, REALMS, TRAVEL_PRODUCTION_PENALTY, type ItemId } from '../game/content';
import {
  canStartTravel,
  getAvailableRegions,
  getLockedRegions,
  getTravelProgress,
  getTravelRemaining,
} from '../game/travel';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';
import type { TravelRegionDef } from '../game/content';

/** 把掉落的稀有度用「材料种类数」直观地表现出来 */
function lootSummary(def: TravelRegionDef): string {
  const names = def.loot.filter((entry) => !entry.guaranteed).map((entry) => {
    const item = ITEM_MAP[entry.item as ItemId];
    return `${item?.icon ?? '?'}${item?.name ?? entry.item}`;
  });
  return names.join(' ');
}

function RegionCard({ def, state }: { def: TravelRegionDef; state: GameState }) {
  const startTravel = useGame((s) => s.startTravel);
  const check = canStartTravel(state, def.id);
  const busy = state.personalTravel !== null;

  return (
    <article className="realm-card">
      <div className="realm-card__head">
        <span className="realm-card__icon">{def.icon}</span>
        <div>
          <div className="realm-card__name">{def.name}</div>
          <div className="realm-card__desc">{def.desc}</div>
        </div>
      </div>

      <div className="realm-card__stats">
        <span>约 {Math.round(def.duration / 60)} 分钟</span>
        <span>{REALMS[def.minRealm].name}以上</span>
        <span>种子概率 {Math.round(def.seedChance * 100)}%</span>
        <span>最高 {def.seedMaxRarity} 级种子</span>
      </div>

      <div className="realm-card__loot">可能带回：{lootSummary(def) || '—'}</div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!check.ok}
          onClick={() => startTravel(def.id)}
        >
          启程前往
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
          {check.ok && busy && <span className="btn__sub">需先等掌门回来</span>}
        </button>
      </div>
    </article>
  );
}

export function TravelPanel() {
  const game = useGame((s) => s.game);
  const cancelTravel = useGame((s) => s.cancelTravel);

  const travel = game.personalTravel;
  const available = getAvailableRegions(game);
  const locked = getLockedRegions(game);

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2>掌门游历</h2>
          <span className="panel__hint">需求 1 · 亲自出门取材</span>
        </div>

        <p className="panel__note">
          出门期间洞府无人监管，<strong>全局产量下降 {Math.round(TRAVEL_PRODUCTION_PENALTY * 100)}%</strong>
          。掌门不会陨落，但材料只按你的境界给 —— 境界越高，能去的区域越好。
        </p>

        {travel ? (
          <div className="running">
            <div className="running__head">
              <span>
                {available.find((r) => r.id === travel.regionId)?.icon ?? '🧭'}{' '}
                {available.find((r) => r.id === travel.regionId)?.name ?? travel.regionId}
              </span>
              <span className="running__time">
                剩余{' '}
                {getTravelRemaining(travel) > 90
                  ? `${Math.round(getTravelRemaining(travel) / 60)} 分钟`
                  : `${Math.round(getTravelRemaining(travel))} 秒`}
              </span>
            </div>
            <div className="bar">
              <div className="bar__fill" style={{ width: `${Math.round(getTravelProgress(travel) * 100)}%` }} />
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn--danger" onClick={cancelTravel}>
                中止游历
              </button>
            </div>
          </div>
        ) : (
          <p className="panel__note panel__note--warn">
            掌门此刻在洞府中，产量正常。选一处启程即可开始采集材料。
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>可去之地</h2>
          <span className="panel__hint">{available.length} 处</span>
        </div>
        <div className="realm-card-list">
          {available.map((def) => (
            <RegionCard key={def.id} def={def} state={game} />
          ))}
        </div>
      </section>

      {locked.length > 0 && (
        <section className="panel">
          <div className="panel__head">
            <h2>尚未能去</h2>
            <span className="panel__hint">{locked.length} 处</span>
          </div>
          {locked.map((def) => (
            <div key={def.id} className="locked-realm">
              <span>
                {def.icon} {def.name}
              </span>
              <span className="locked-realm__need">需 {REALMS[def.minRealm].name}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export default TravelPanel;
