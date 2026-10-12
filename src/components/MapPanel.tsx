/**
 * 修仙界地图 + 探索（需求 1）
 *
 * 结构是三层，界面也照着三层来：
 *   大区域（6 个，一块面板）→ 小区域（每个大区域 16 个，4×4 网格）
 *     → 小区域里的事：普通探索 / 已发现的秘境 / 掌门游历目的地
 *
 * 关键规则（需求原文）：
 *   - 「玩家初始地址在东部群山，初始只能探索附近四个小区域」——
 *     所以网格里的格子按境界门槛灰掉，够不着就点不开；
 *   - 「每个区域1-2个秘境……只有一个小区域秘境有三个以上，为资源富集区」——
 *     格子上直接标出"已发现/总数"，富集区另有标记；
 *   - 「每个小区域在未发现秘境时只能普通探索」——
 *     所以还没发现秘境的小区域里，显示的是「普通探索」卡片而不是秘境卡片。
 */
import { useState } from 'react';
import { fmt, fmtDuration } from '../game/decimal';
import {
  APTITUDE_MAP,
  ITEM_MAP,
  MAJOR_REGIONS,
  MAP_REGIONS,
  MAP_REGION_MAP,
  MATERIAL_MAP,
  REALMS,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  TRAVEL_REGIONS,
  TRAVEL_REGION_MAP,
  majorOf,
  realmsOfRegion,
  subRegionsOf,
  type ItemId,
  type MajorRegionDef,
  type MapRegionDef,
  type SecretRealmDef,
  type TravelRegionDef,
} from '../game/content';
import {
  canReachRegion,
  getDiscoveredRealms,
  getDiscoveryBonusFromArtifacts,
  getDiscoveryChance,
  getDiscoveryPityRemaining,
  getExplorationRange,
  canOpenRealm,
  getOpenCost,
  getRealmCooldown,
  isRealmOpened,
  getRealmGate,
  isRegionVisible,
} from '../game/engine';
import {
  autoSelectParty,
  autoSelectSurveyParty,
  canStartExpedition,
  MAX_EXPEDITION_REPEAT,
  clampRepeat,
  canStartSurvey,
  canSurveyRegion,
  getExpeditionProgress,
  getLootRolls,
  getMaxExpeditions,
  getPartySizeFactor,
  getSurveyDuration,
  getSurveyPartyRange,
  getUndiscoveredCount,
  getIdleDisciples,
} from '../game/expeditions';
import { canStartSoloRealm, canStartTravel, getTravelRemaining } from '../game/travel';
import { getPartyPower } from '../game/disciples';
import { useGame } from '../game/store';
import { canStartSoloSurvey, getSoloSurveyDuration } from '../game/travel';
import type { GameState } from '../game/state';

/* ------------------------------------------------------------------ */
/* 秘境卡片                                                            */
/* ------------------------------------------------------------------ */

function RealmCard({ def, state }: { def: SecretRealmDef; state: GameState }) {
  const startExpedition = useGame((s) => s.startExpedition);
  const startSoloRealm = useGame((s) => s.startSoloRealm);
  const openRealm = useGame((s) => s.openRealm);
  const [selected, setSelected] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  // 本轮需求 4：循环探索次数（1~30）
  const [repeat, setRepeat] = useState(1);

  const idle = getIdleDisciples(state).filter((d) => d.realmIndex >= def.minRealm);
  const cooldown = getRealmCooldown(state, def.id);
  const gate = getRealmGate(state, def);
  // 需求 1：资源富集区的秘境要先花一笔资源"开启"
  const opened = isRealmOpened(state, def);
  const openCheck = canOpenRealm(state, def);
  const openCost = getOpenCost(def);
  const check = canStartExpedition(state, def.id, selected);
  // 需求 5：掌门独自前往的资格（和派队伍走同一套冷却与发现校验）
  const soloCheck = canStartSoloRealm(state, def.id);
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
    <article
      className={
        (gate === null ? 'realm-card' : 'realm-card realm-card--gated') +
        (def.specialty ? ' realm-card--specialty' : '')
      }
    >
      <div className="realm-card__head">
        <span className="realm-card__icon">{def.icon}</span>
        <div>
          <div className="realm-card__name">
            {def.name}
            {def.specialty && (
              <span className="realm-card__badge">
                特产 · {MATERIAL_MAP[def.specialty]?.name ?? def.specialty}
              </span>
            )}
          </div>
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
            ratio >= 1 ? 'realm-card__power realm-card__power--good' : 'realm-card__power realm-card__power--warn'
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

      {/* 本轮需求 4：可以设置循环探索（上限 30 次） */}
      <div className="repeat-row">
        <label>
          循环
          <input
            type="number"
            min={1}
            max={MAX_EXPEDITION_REPEAT}
            step={1}
            value={repeat}
            onChange={(e) => setRepeat(clampRepeat(Number(e.target.value) || 1))}
          />
          次
        </label>
        <span className="panel__hint">
          做完一趟会<b>原地等冷却</b>再出发，不用回来重派；上限 {MAX_EXPEDITION_REPEAT} 次
        </span>
        {repeat !== 1 && (
          <button type="button" className="btn btn--tiny" onClick={() => setRepeat(1)}>
            只做一趟
          </button>
        )}
      </div>

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
            startExpedition(def.id, selected, repeat);
            setSelected([]);
            setPicking(false);
          }}
        >
          派遣
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
        </button>
        {/* 需求 5：掌门也可以自己去 —— 慢、总量少，但更容易挑出稀有材料 */}
        <button
          type="button"
          className="btn"
          disabled={!soloCheck.ok}
          onClick={() => startSoloRealm(def.id)}
          title="掌门亲往：时长 ×1.4、总量 ×0.45，但稀有材料权重 ×4"
        >
          掌门亲往
          {!soloCheck.ok && soloCheck.reason && <span className="btn__sub">{soloCheck.reason}</span>}
        </button>
      </div>

      {/* 需求 1：资源富集区的秘境要先立阵眼（花一笔资源）才能探 */}
      {!opened && (
        <div className="realm-card__open">
          <div className="realm-card__open-head">
            <strong>🔯 尚未开启</strong>
            <span className="panel__hint">
              资源富集区的秘境要先立起阵眼：
              {Object.entries(openCost)
                .map(([id, amount]) => `${ITEM_MAP[id as ItemId]?.icon ?? ''}${ITEM_MAP[id as ItemId]?.name ?? id} ${fmt(amount, 0)}`)
                .join(' · ')}
            </span>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!openCheck.ok}
              onClick={() => openRealm(def.id)}
            >
              耗费资源开启
              {!openCheck.ok && openCheck.reason && <span className="btn__sub">{openCheck.reason}</span>}
            </button>
          </div>
        </div>
      )}
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
        <button type="button" className="btn btn--primary" disabled={!check.ok} onClick={() => startTravel(def.id)}>
          启程前往
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 普通探索卡片（需求 1）                                               */
/* ------------------------------------------------------------------ */

/**
 * 小区域**还没发现秘境**时唯一能做的事。
 *
 * 需求原文：「普通探索有概率发现秘境和稀有材料，必定产出基础材料，但是数量随机。」
 * 所以卡片上把这三件事都写明白，玩家才知道这一步值不值得走。
 */
function SurveyCard({ region, state }: { region: MapRegionDef; state: GameState }) {
  const startSurvey = useGame((s) => s.startSurvey);
  const startSoloSurvey = useGame((s) => s.startSoloSurvey);
  const [selected, setSelected] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  // 本轮需求 4：循环探索次数（1~30）
  const [repeat, setRepeat] = useState(1);

  const { min, max } = getSurveyPartyRange();
  const check = canStartSurvey(state, region.id, selected);
  const soloCheck = canStartSoloSurvey(state, region.id);
  const idle = getIdleDisciples(state);
  const minRealm = Math.max(0, region.requiresRealm - 1);
  const eligible = idle.filter((d) => d.realmIndex >= minRealm);
  const all = realmsOfRegion(region.id);
  const hidden = all.filter((r) => state.discoveredRealms[r.id] !== true).length;

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= max ? prev : [...prev, id]));
  };

  return (
    <article className="realm-card realm-card--survey">
      <div className="realm-card__head">
        <span className="realm-card__icon">🔍</span>
        <div>
          <div className="realm-card__name">普通探索 · {region.name}</div>
          <div className="realm-card__desc">
            此地还有 <strong>{hidden}</strong> 处秘境没找到，只能先做普通探索：
            必定带回基础材料（数量随机），有 30% 概率带回稀有材料，也有机会发现新秘境。
            <strong> 没有冷却，也不会折损弟子。</strong>
          </div>
        </div>
      </div>

      <div className="realm-card__stats">
        <span>人数 {min}~{max}</span>
        <span>{REALMS[minRealm].name}以上</span>
        <span>约 {Math.round(getSurveyDuration(state, region.id) / 60)} 分钟</span>
        <span>无冷却</span>
        <span>无伤亡</span>
      </div>

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
          {eligible.length === 0 && <p className="panel__note">没有符合条件的空闲弟子。</p>}
          {eligible.map((d) => (
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

      {/* 本轮需求 4：普通探索也能循环（它没有冷却，做完直接接上） */}
      <div className="repeat-row">
        <label>
          循环
          <input
            type="number"
            min={1}
            max={MAX_EXPEDITION_REPEAT}
            step={1}
            value={repeat}
            onChange={(e) => setRepeat(clampRepeat(Number(e.target.value) || 1))}
          />
          次
        </label>
        <span className="panel__hint">上限 {MAX_EXPEDITION_REPEAT} 次</span>
        {repeat !== 1 && (
          <button type="button" className="btn btn--tiny" onClick={() => setRepeat(1)}>
            只做一趟
          </button>
        )}
      </div>

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setPicking((v) => !v)}>
          {picking ? '收起名单' : '选择弟子'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={eligible.length === 0}
          onClick={() => setSelected(autoSelectSurveyParty(state, region.id))}
        >
          推荐两人
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!check.ok}
          onClick={() => {
            startSurvey(region.id, selected, repeat);
            setSelected([]);
            setPicking(false);
          }}
        >
          出发
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
        </button>
      </div>

      {/*
        需求 5：掌门可以自己去。
        派队伍要开宗、要有弟子、还要过"小区域档次"和队伍名额；
        掌门亲自去则不分这些 —— 代价只是慢一点、收获减半，
        好处是**不会折损弟子**，而且还没开宗时就能出门。
        （本轮需求 4 起，出门**不再**扣全局产量。）
      */}
      <div className="realm-card__solo">
        <div className="realm-card__solo-head">
          <strong>掌门亲自查探</strong>
          <span className="panel__hint">
            无伤亡 · 产出约一半 · 约 {Math.round(getSoloSurveyDuration(state, region.id) / 60)} 分钟 ·
            稀有材料 30% 概率
          </span>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={!soloCheck.ok}
            onClick={() => startSoloSurvey(region.id)}
            title="掌门本人出去转一圈：拿到的基础材料约为派队的一半，稀有材料只能碰运气，但绝不会折损弟子"
          >
            掌门亲往
            {!soloCheck.ok && soloCheck.reason && <span className="btn__sub">{soloCheck.reason}</span>}
          </button>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 小区域格子 + 大区域面板                                              */
/* ------------------------------------------------------------------ */

function SubRegionCell({
  region,
  state,
  expanded,
  onToggle,
}: {
  region: MapRegionDef;
  state: GameState;
  expanded: boolean;
  onToggle: () => void;
}) {
  const reachable = canReachRegion(state, region);
  /*
   * 需求 5：能"去附近转转"的地方，格子也得点得开。
   *
   * 原来 `disabled={!reachable}` 用的是**小区域档次**（东部群山里从需 0 到需 4），
   * 于是后面那些小区域连点都点不开 —— 可里面本来还有普通探索这条线。
   * 现在只要"这一带能普通探索"就允许展开：能看到里面的秘境列表，
   * 各秘境会各自显示自己还差什么（境界 / 队伍战力 / 是否已开启）。
   */
  const surveyable = canSurveyRegion(state, region.id).ok;
  const openable = reachable || surveyable;
  const visible = reachable || isRegionVisible(state, region);
  const all = realmsOfRegion(region.id);
  const found = all.filter((r) => state.discoveredRealms[r.id] === true).length;
  const full = found >= all.length;

  const classes = [
    'subregion',
    reachable ? 'subregion--on' : visible ? 'subregion--off' : 'subregion--far',
    !reachable && surveyable ? 'subregion--surveyable' : '',
    region.isRich ? 'subregion--rich' : '',
    expanded ? 'subregion--open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={!openable}
      onClick={onToggle}
      title={region.desc}
    >
      <span className="subregion__icon">{region.icon}</span>
      <span className="subregion__name">{region.name}</span>
      <span className="subregion__meta">
        {reachable
          ? full
            ? `秘境 ${found}/${all.length} ✓`
            : `秘境 ${found}/${all.length}`
          : surveyable
            ? `可探查 · 秘境需${REALMS[region.requiresRealm].name}`
            : `需${REALMS[region.requiresRealm].name}`}
      </span>
      {region.isRich && <span className="subregion__badge">富集</span>}
    </button>
  );
}

function SubRegionDetail({ region, state }: { region: MapRegionDef; state: GameState }) {
  const all = realmsOfRegion(region.id);
  const discovered = all.filter((r) => state.discoveredRealms[r.id] === true);
  const hidden = all.length - discovered.length;
  const travelTargets = TRAVEL_REGIONS.filter((t) => t.regionId === region.id);
  /*
   * 需求 5：这里原来写的是 `canStartSurvey(state, region.id, []).ok || hidden > 0` ——
   * 空队伍永远过不了"至少派 1 人"那一关，所以前半句恒为 false，
   * 实际条件退化成 `hidden > 0`。现在直接问"这一带能不能普通探索"，
   * 把"有没有没找到的秘境"和"能不能去"分开判断。
   */
  const canSurvey = canSurveyRegion(state, region.id).ok;

  return (
    <div className="subregion-detail">
      <div className="subregion-detail__head">
        <strong>
          {region.icon} {region.name}
        </strong>
        <span className="panel__hint">
          {region.distance} 里 · 秘境 {discovered.length}/{all.length} · 需{REALMS[region.requiresRealm].name}
        </span>
      </div>
      <p className="panel__note">{region.desc}</p>

      {/* 还有没发现的秘境 → 显示普通探索（需求：未发现秘境时只能普通探索） */}
      {hidden > 0 && canSurvey && <SurveyCard region={region} state={state} />}

      {discovered.map((def) => (
        <RealmCard key={def.id} def={def} state={state} />
      ))}

      {travelTargets.map((def) => (
        <TravelCard key={def.id} def={def} state={state} />
      ))}

      {discovered.length === 0 && travelTargets.length === 0 && hidden === 0 && (
        <p className="panel__note">此地没有可做的事。</p>
      )}
    </div>
  );
}

function MajorRegionSection({ major, state }: { major: MajorRegionDef; state: GameState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const subs = subRegionsOf(major.id);
  const reachable = subs.filter((r) => canReachRegion(state, r));
  const realms = subs.flatMap((r) => realmsOfRegion(r.id));
  const found = realms.filter((r) => state.discoveredRealms[r.id] === true).length;
  const specialty = MATERIAL_MAP[major.specialty];

  // 一个能到的都没有，并且连预览都看不到，就整块不显示
  if (!subs.some((r) => canReachRegion(state, r) || isRegionVisible(state, r))) return null;

  const open = subs.find((r) => r.id === openId) ?? null;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>
          {major.icon} {major.name}
        </h2>
        <span className="panel__hint">
          特产 {specialty?.icon}
          {specialty?.name} · 已探明 {reachable.length}/{subs.length} 小区域 · 秘境 {found}/{realms.length}
        </span>
      </div>
      <p className="panel__note">{major.desc}</p>

      <div className="subgrid">
        {subs.map((region) => (
          <SubRegionCell
            key={region.id}
            region={region}
            state={state}
            expanded={openId === region.id}
            onToggle={() => setOpenId(openId === region.id ? null : region.id)}
          />
        ))}
      </div>

      {open && <SubRegionDetail region={open} state={state} />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 主面板                                                              */
/* ------------------------------------------------------------------ */

export function MapPanel() {
  const game = useGame((s) => s.game);
  const cancelTravel = useGame((s) => s.cancelTravel);
  const range = getExplorationRange(game);
  const travel = game.personalTravel;
  /*
   * 需求 5：掌门出门可能是游历，也可能是独自探秘境。
   *
   * ⚠️ 本轮需求 11：「掌门亲自探索，有时会没有进度条显示」——
   * 根因就在下面这三个变量。掌门出行有三种 `kind`：
   *   travel（游历）/ realm（独自探秘境）/ survey（**亲自普通探索**），
   * 而进度条原来只在 `kind === 'travel' || kind === 'realm'` 时才渲染 ——
   * 也就是说**只有第三种没有进度条**，正好对上"有时"这两个字。
   * 玩家会以为卡住了，其实只是界面上少画了一根条。
   */
  const travelDef = travel && travel.kind === 'travel' ? TRAVEL_REGION_MAP[travel.regionId] : null;
  const soloDef = travel && travel.kind === 'realm' ? SECRET_REALM_MAP[travel.regionId] : null;
  const soloSurvey = travel && travel.kind === 'survey' ? MAP_REGION_MAP[travel.regionId] : null;
  const undiscovered = getUndiscoveredCount(game);
  const compassBonus = getDiscoveryBonusFromArtifacts(game);
  const pityLeft = getDiscoveryPityRemaining(game);

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2>修仙界地图</h2>
          <span className="panel__hint">
            探索距离 {fmt(range.distance, 0)} 里 · 可达 {range.reachable.length}/{MAP_REGIONS.length} 小区域 ·
            已发现 {SECRET_REALMS.length - undiscovered}/{SECRET_REALMS.length} 秘境
          </span>
        </div>
        <p className="panel__note">
          天下分为<strong>六大区域</strong>，每个大区域又有<strong>十六个小区域</strong>。
          你的洞府在<strong>东部群山</strong>，一开始只走得动附近四个小区域 ——
          境界越高越能飞，才谈得上去更远的地方。
          每个小区域只有<strong>一处资源富集区</strong>：它门槛更高、秘境更多，
          还有一处专产该大区域特产的秘境。
        </p>

        {/* 发现机制要讲清楚：概率只有一个来源（寻宝宝盘），保底是另一条独立机制 */}
        {undiscovered > 0 && (
          <p className="panel__note panel__note--warn">
            发现新秘境：<strong>{(getDiscoveryChance(game) * 100).toFixed(1)}%</strong>
            {compassBonus > 0 ? `（寻宝宝盘 +${(compassBonus * 100).toFixed(1)}%）` : '（只有寻宝宝盘能提高它）'}
            {' · '}
            {pityLeft > 0 ? (
              <>再连续 {pityLeft} 次没发现就必定发现一处（保底）</>
            ) : (
              <strong>下一次探索必定发现一处</strong>
            )}
          </p>
        )}
      </section>

      {(game.expeditions.length > 0 || travel) && (
        <section className="panel">
          <div className="panel__head">
            <h2>进行中</h2>
            <span className="panel__hint">
              队伍 {game.expeditions.length}/{getMaxExpeditions(game)}
            </span>
          </div>

          {/*
            ⚠️ 这里的守卫只能是 `travel` 本身。
            原来写的是 `travel && (travelDef || soloDef || soloSurvey)` ——
            只要有一个 def 查不到（旧存档里改名/删掉的区域、或者以后又加了一种 kind），
            整块「进行中」就会**静默消失**：看不到进度、看不到剩余时间、
            也没有「中止」按钮，掌门永远"在外"而玩家无从操作。
            这正是需求 11 那一类问题的另一种形态，所以必须兜底成"照样显示"。
          */}
          {travel && (
            <div className="running">
              <div className="running__head">
                <span>
                  {soloDef
                    ? `🧘 掌门独自探索 ${soloDef.name}`
                    : soloSurvey
                      ? `🧘 掌门亲自查探 ${soloSurvey.name}`
                      : travelDef
                        ? `🧭 掌门游历 ${travelDef.name}`
                        : `🧭 掌门在外（${travel.regionId}）`}
                </span>
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
                  {soloDef || soloSurvey ? '中止探索' : '中止游历'}
                </button>
              </div>
            </div>
          )}

          {game.expeditions.map((expedition) => {
            const isSurvey = expedition.kind === 'survey';
            const def = getDiscoveredRealms(game).find((r) => r.id === expedition.realmId);
            const region = isSurvey ? majorOf(expedition.realmId) : null;
            const names = expedition.discipleIds
              .map((id) => game.sect.disciples.find((d) => d.id === id)?.name ?? '？')
              .join('、');
            const remainSeconds = Math.max(0, expedition.duration - expedition.progress);
            return (
              <div key={expedition.id} className="running">
                <div className="running__head">
                  <span>
                    {isSurvey ? '🔍' : def?.icon} {isSurvey ? `${region?.name ?? ''}普通探索` : def?.name ?? expedition.realmId}
                    （{expedition.discipleIds.length} 人）
                  </span>
                  <span className="running__time">剩余 {fmtDuration(remainSeconds)}</span>
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
          <h2>六大区域</h2>
          <span className="panel__hint">未发现秘境 {undiscovered} 处</span>
        </div>
        <p className="panel__note">
          已发现 <strong>{getDiscoveredRealms(game).length}</strong> 处秘境，共 {SECRET_REALMS.length} 处、
          六个大区域各十六个小区域。点开一个小区域就能看到它里面有什么。
        </p>
      </section>

      {MAJOR_REGIONS.map((major) => (
        <MajorRegionSection key={major.id} major={major} state={game} />
      ))}
    </>
  );
}

export default MapPanel;
