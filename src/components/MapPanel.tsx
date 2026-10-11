/**
 * 修仙界地图 + 探索（需求 1 / 5）
 *
 * 这一页承担三件事：
 *   1. **地图**：画出各界区域，只有境界够了才到得了更远的地方（需求 5）；
 *   2. **秘境**：已发现的固定在对应区域里，带冷却与人数选择（需求 1）；
 *   3. **游历**：掌门可去的目的地也挂在地图上，不再另开一页。
 *
 * 「发现后固定在秘境栏」是需求原文，所以未发现的秘境只给一个
 * 「未探明」的暗示和当前发现概率 —— 玩家知道自己还没找全，但不知道是什么。
 */
import { useState } from 'react';
import { fmt, fmtDuration } from '../game/decimal';
import {
  APTITUDE_MAP,
  ITEM_MAP,
  MAP_REGIONS,
  REALMS,
  TRAVEL_REGION_MAP,
  type ItemId,
  type MapRegionDef,
  type SecretRealmDef,
  type TravelRegionDef,
} from '../game/content';
import {
  canReachRegion,
  getDiscoveryChance,
  getDiscoveredRealms,
  getExplorationRange,
  getRealmCooldown,
  getRealmGate,
  isRegionVisible,
} from '../game/engine';
import {
  autoSelectParty,
  canStartExpedition,
  getExpeditionProgress,
  getLootRolls,
  getMaxExpeditions,
  getPartySizeFactor,
  getUndiscoveredCount,
  getIdleDisciples,
} from '../game/expeditions';
import { canStartTravel, getTravelRemaining } from '../game/travel';
import { getPartyPower } from '../game/disciples';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';

/* ------------------------------------------------------------------ */
/* 地图总览                                                            */
/* ------------------------------------------------------------------ */

function MapNode({ region, state }: { region: MapRegionDef; state: GameState }) {
  const reachable = canReachRegion(state, region);
  const visible = isRegionVisible(state, region);
  if (!visible) return null;

  const found = region.realms.filter((id) => state.discoveredRealms[id] === true).length;

  return (
    <div
      className={reachable ? 'map-node map-node--on' : 'map-node map-node--off'}
      style={{ left: `${region.x}%`, top: `${region.y}%` }}
      title={region.desc}
    >
      <span className="map-node__icon">{region.icon}</span>
      <span className="map-node__name">{region.name}</span>
      <span className="map-node__meta">
        {region.distance} 里
        {reachable ? ` · 秘境 ${found}/${region.realms.length}` : ` · 需${REALMS[region.requiresRealm].name}`}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 秘境卡片                                                            */
/* ------------------------------------------------------------------ */

function RealmCard({ def, state }: { def: SecretRealmDef; state: GameState }) {
  const startExpedition = useGame((s) => s.startExpedition);
  const [selected, setSelected] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);

  const idle = getIdleDisciples(state).filter((d) => d.realmIndex >= def.minRealm);
  const cooldown = getRealmCooldown(state, def.id);
  const gate = getRealmGate(state, def);
  const check = canStartExpedition(state, def.id, selected);
  const partyPower = getPartyPower(state, selected);
  const ratio = def.requiredPower > 0 ? partyPower / def.requiredPower : 3;
  const sizeFactor = getPartySizeFactor(def, selected.length);
  const rolls = getLootRolls(def, selected.length);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= def.maxParty ? prev : [...prev, id],
    );
  };

  const lootText = def.loot
    .map((entry) => `${ITEM_MAP[entry.item as ItemId].icon}${ITEM_MAP[entry.item as ItemId].name}`)
    .join(' ');

  return (
    <article className={gate === null ? 'realm-card' : 'realm-card realm-card--gated'}>
      <div className="realm-card__head">
        <span className="realm-card__icon">{def.icon}</span>
        <div>
          <div className="realm-card__name">{def.name}</div>
          <div className="realm-card__desc">{def.desc}</div>
        </div>
      </div>

      <div className="realm-card__stats">
        <span>推荐战力 <strong>{fmt(def.requiredPower)}</strong></span>
        <span>人数 {def.minParty}~{def.maxParty}</span>
        <span>{REALMS[def.minRealm].name}以上</span>
        <span>约 {Math.round(def.duration / 60)} 分钟</span>
        <span>伤亡率 {(def.baseCasualty * 100).toFixed(0)}%</span>
        <span>冷却 {fmtDuration(def.cooldown)}</span>
      </div>

      <div className="realm-card__loot">产出倾向：{lootText}</div>

      {gate ? (
        <div className="realm-card__power realm-card__power--warn">
          <em>{cooldown > 0 ? `冷却中，还需 ${fmtDuration(cooldown)}` : gate}</em>
        </div>
      ) : (
        <div
          className={
            ratio >= 1
              ? 'realm-card__power realm-card__power--good'
              : 'realm-card__power realm-card__power--warn'
          }
        >
          当前队伍战力 {fmt(Math.round(partyPower))} / {fmt(def.requiredPower)}
          <em>
            （{selected.length}/{def.maxParty} 人 · 产量 ×{sizeFactor.toFixed(2)} · 抽 {rolls} 条）
          </em>
        </div>
      )}

      {selected.length > 0 && (
        <div className="chip-row">
          {selected.map((id) => {
            const d = state.sect.disciples.find((x) => x.id === id);
            if (!d) return null;
            return (
              <button key={id} type="button" className="chip" onClick={() => toggle(id)}>
                {d.name}
                <span className="chip__sub" style={{ color: APTITUDE_MAP[d.aptitude].color }}>
                  {REALMS[d.realmIndex].name}
                </span>
                ×
              </button>
            );
          })}
        </div>
      )}

      {picking && (
        <div className="picker">
          {idle.length === 0 && <p className="panel__note">没有符合条件的空闲弟子。</p>}
          {idle.map((d) => (
            <button
              key={d.id}
              type="button"
              className={selected.includes(d.id) ? 'picker__item picker__item--on' : 'picker__item'}
              onClick={() => toggle(d.id)}
            >
              <span className="picker__name">{d.name}</span>
              <span className="picker__apt" style={{ color: APTITUDE_MAP[d.aptitude].color }}>
                {APTITUDE_MAP[d.aptitude].name}
              </span>
              <span className="picker__realm">{REALMS[d.realmIndex].name}</span>
              <span className="picker__power">心得 {Math.round(d.insight)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setPicking((v) => !v)}>
          {picking ? '收起名单' : '选择弟子'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={idle.length < def.minParty}
          onClick={() => setSelected(autoSelectParty(state, def.id))}
        >
          满编推荐
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!check.ok}
          onClick={() => {
            startExpedition(def.id, selected);
            setSelected([]);
            setPicking(false);
          }}
        >
          派遣
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 游历卡片                                                            */
/* ------------------------------------------------------------------ */

function TravelCard({ def, state }: { def: TravelRegionDef; state: GameState }) {
  const startTravel = useGame((s) => s.startTravel);
  const check = canStartTravel(state, def.id);

  const lootText = def.loot
    .filter((entry) => !entry.guaranteed)
    .map((entry) => `${ITEM_MAP[entry.item as ItemId]?.icon ?? '?'}${ITEM_MAP[entry.item as ItemId]?.name ?? entry.item}`)
    .join(' ');

  return (
    <article className="realm-card realm-card--travel">
      <div className="realm-card__head">
        <span className="realm-card__icon">{def.icon}</span>
        <div>
          <div className="realm-card__name">{def.name}</div>
          <div className="realm-card__desc">{def.desc}</div>
        </div>
      </div>

      <div className="realm-card__stats">
        <span>掌门亲往</span>
        <span>约 {Math.round(def.duration / 60)} 分钟</span>
        <span>种子概率 {Math.round(def.seedChance * 100)}%</span>
        <span>最高 {def.seedMaxRarity} 级种子</span>
      </div>

      <div className="realm-card__loot">可能带回：{lootText || '—'}</div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!check.ok}
          onClick={() => startTravel(def.id)}
        >
          启程前往
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 区域小节                                                            */
/* ------------------------------------------------------------------ */

function RegionSection({ region, state }: { region: MapRegionDef; state: GameState }) {
  const reachable = canReachRegion(state, region);
  const discovered = getDiscoveredRealms(state);
  const realms = region.realms
    .map((id) => discovered.find((r) => r.id === id))
    .filter((r): r is SecretRealmDef => Boolean(r));
  const hidden = region.realms.length - realms.length;

  const travelTargets = region.travel
    .map((id) => TRAVEL_REGION_MAP[id])
    .filter((t): t is TravelRegionDef => Boolean(t));

  const visible = reachable || isRegionVisible(state, region);
  if (!visible) return null;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>
          {region.icon} {region.name}
        </h2>
        <span className="panel__hint">
          {region.distance} 里 ·{' '}
          {reachable ? `秘境 ${realms.length}/${region.realms.length}` : `需${REALMS[region.requiresRealm].name}`}
        </span>
      </div>

      {!reachable ? (
        <p className="panel__note panel__note--warn">
          探索距离不足。修至<strong>{REALMS[region.requiresRealm].name}</strong>后可飞行至此。
        </p>
      ) : (
        <>
          {hidden > 0 && (
            <p className="panel__note">
              此地尚有 <strong>{hidden}</strong> 处秘境未被发现 ——
              派弟子探索或掌门亲自游历都有机会找到（当前发现概率约{' '}
              {Math.round(getDiscoveryChance(state) * 100)}%）。
            </p>
          )}
          {realms.map((def) => (
            <RealmCard key={def.id} def={def} state={state} />
          ))}
          {travelTargets.map((def) => (
            <TravelCard key={def.id} def={def} state={state} />
          ))}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 进行中                                                              */
/* ------------------------------------------------------------------ */

export function MapPanel() {
  const game = useGame((s) => s.game);
  const cancelTravel = useGame((s) => s.cancelTravel);
  const range = getExplorationRange(game);
  const travel = game.personalTravel;
  const travelDef = travel ? TRAVEL_REGION_MAP[travel.regionId] : null;
  const undiscovered = getUndiscoveredCount(game);

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2>修仙界地图</h2>
          <span className="panel__hint">
            探索距离 {fmt(range.distance, 0)} 里 · 可达 {range.reachable.length}/{MAP_REGIONS.length} 区
          </span>
        </div>
        <p className="panel__note">
          境界越高、越能飞行，探索距离就越远。远处的区域藏着更好的秘境与材料 ——
          已发现的秘境会<strong>永久固定</strong>在对应区域里，但每次探索后都要等冷却结束才能再探。
        </p>

        <div className="map">
          {MAP_REGIONS.map((region) => (
            <MapNode key={region.id} region={region} state={game} />
          ))}
        </div>
      </section>

      {(game.expeditions.length > 0 || travel) && (
        <section className="panel">
          <div className="panel__head">
            <h2>进行中</h2>
            <span className="panel__hint">
              队伍 {game.expeditions.length}/{getMaxExpeditions(game)}
            </span>
          </div>

          {travel && travelDef && (
            <div className="running">
              <div className="running__head">
                <span>🧭 掌门游历 {travelDef.name}</span>
                <span className="running__time">
                  剩余{' '}
                  {getTravelRemaining(travel) > 90
                    ? `${Math.round(getTravelRemaining(travel) / 60)} 分钟`
                    : `${Math.round(getTravelRemaining(travel))} 秒`}
                </span>
              </div>
              <div className="bar">
                <div
                  className="bar__fill"
                  style={{ width: `${Math.round((travel.progress / travel.duration) * 100)}%` }}
                />
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn--danger" onClick={cancelTravel}>
                  中止游历
                </button>
              </div>
            </div>
          )}

          {game.expeditions.map((expedition) => {
            const def = getDiscoveredRealms(game).find((r) => r.id === expedition.realmId);
            const names = expedition.discipleIds
              .map((id) => game.sect.disciples.find((d) => d.id === id)?.name ?? '？')
              .join('、');
            const remainSeconds = Math.max(0, expedition.duration - expedition.progress);
            return (
              <div key={expedition.id} className="running">
                <div className="running__head">
                  <span>
                    {def?.icon} {def?.name ?? expedition.realmId}（{expedition.discipleIds.length} 人）
                  </span>
                  <span className="running__time">剩余 {Math.round(remainSeconds)} 秒</span>
                </div>
                <div className="bar">
                  <div
                    className="bar__fill"
                    style={{ width: `${Math.round(getExpeditionProgress(expedition) * 100)}%` }}
                  />
                </div>
                <div className="running__party">{names}</div>
              </div>
            );
          })}
        </section>
      )}

      <section className="panel">
        <div className="panel__head">
          <h2>地图区域</h2>
          <span className="panel__hint">未发现秘境 {undiscovered} 处</span>
        </div>
        <p className="panel__note">
          已发现 <strong>{getDiscoveredRealms(game).length}</strong> 处秘境，共 {MAP_REGIONS.length} 个区域。
        </p>
      </section>

      {MAP_REGIONS.map((region) => (
        <RegionSection key={region.id} region={region} state={game} />
      ))}
    </>
  );
}

export default MapPanel;
