/**
 * 宗门幸福度（需求 4 / 5 / 6）
 *
 * 这一面板做三件事：
 *   1. 把幸福度显示出来，并**列出它是怎么算出来的**（目标值 + 每一条修正）——
 *      需求 4 的数值只有"看得见原因"才有意义：掉了要能立刻知道该去补什么；
 *   2. 稀有幸福度建筑（需求 5）的建造入口；
 *   3. 空间禁制（需求 6）：感悟空间大道之后，逐座给库房加容量。
 */
import { fmt } from '../game/decimal';
import {
  HAPPINESS_BUILDINGS,
  HAPPINESS_MAX,
  HAPPINESS_MIN,
  HAPPINESS_NEUTRAL,
  STORAGE_BUILDINGS,
  SPATIAL_WARD_CAPACITY_BONUS,
  SPATIAL_WARD_MAX_STACKS,
} from '../game/content';
import {
  describeHappiness,
  getHappinessBase,
  getHappinessCultivationMultiplier,
  getHappinessFactors,
  getHappinessTarget,
} from '../game/happiness';
import { getEnlightenLevel } from '../game/enlightenment';
import { getBuildGate, getBuildingCount, getSpatialWardBonus, toCostMap } from '../game/engine';
import { SPATIAL_WARD_REQUIRED_DAO_LEVEL, canApplyWard, getWardOverview } from '../game/spatial';
import { BUILDABLE_MAP } from '../game/content';
import { useGame } from '../game/store';
import CostList from './CostList';
import Panel from './Panel';

function HappinessBar() {
  const game = useGame((s) => s.game);
  const h = game.happiness;
  const pct = ((h - HAPPINESS_MIN) / (HAPPINESS_MAX - HAPPINESS_MIN)) * 100;
  const mult = getHappinessCultivationMultiplier(game);
  const delta = mult - 1;

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          😊 幸福度 <strong>{h.toFixed(0)}</strong> / {HAPPINESS_MAX}
          <span className="panel__hint">（{HAPPINESS_NEUTRAL} 为中立）</span>
        </span>
        <span className="tier-upgrade__slots">
          弟子修行{' '}
          <strong className={delta >= 0 ? '' : 'text--warn'}>
            {delta >= 0 ? '+' : ''}
            {(delta * 100).toFixed(0)}%
          </strong>
        </span>
      </div>
      {/* 「中立点」在 50，所以进度条要能看出左右两边 */}
      <div className="happiness-bar" title={`${describeHappiness(game)}`}>
        <div className="happiness-bar__zero" style={{ left: '50%' }} />
        <div className="happiness-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="panel__note">
        {describeHappiness(game)}。幸福度越高，全宗弟子修行越快（满值 ×1.30）；
        低于中立点则变成减益（见底 ×0.80）。
      </p>
    </div>
  );
}

function HappinessBreakdown() {
  const game = useGame((s) => s.game);
  const base = getHappinessBase(game);
  const factors = getHappinessFactors(game);
  const target = getHappinessTarget(game);

  return (
    <div className="notice-board">
      <div className="notice-board__head">
        <span>📊 幸福度怎么来的</span>
        <span className="notice-board__sum">目标 {target.toFixed(0)}</span>
      </div>
      <div className="notice-board__row">
        <span className="notice-board__name">稀有建筑</span>
        <span className="notice-board__detail">基础值</span>
        <span className="notice-board__missing">{base >= 0 ? '+' : ''}{base.toFixed(0)}</span>
      </div>
      {factors.map((f) => (
        <div key={f.id} className="notice-board__row">
          <span className="notice-board__name">{f.label}</span>
          <span className="notice-board__detail">{f.detail}</span>
          <span className="notice-board__missing">
            {f.value >= 0 ? '+' : ''}
            {f.value.toFixed(0)}
          </span>
        </div>
      ))}
      <p className="panel__note">
        实际幸福度会**平滑地**朝目标靠拢（约一分钟走掉七成差距）——
        做完一件好事之后，你会看到它慢慢变好，而不是瞬间满格。
      </p>
    </div>
  );
}

function HappinessBuildings() {
  const game = useGame((s) => s.game);
  const build = useGame((s) => s.enqueueBuild);

  return (
    <>
      <h3 className="panel__subtitle">稀有幸福建筑</h3>
      <p className="panel__note">
        这三座是需求 5 说的「非常稀有」：<strong>每座只能有一座</strong>，
        造价里有<strong>进阶与稀有材料</strong>（星砂 / 月华晶 / 仙人玉 / 鸿蒙灵果）。
        它们给的是<strong>幸福度的基础值</strong> —— 上面的动态修正都在这份基础之上加减。
      </p>
      {HAPPINESS_BUILDINGS.map((def) => {
        const owned = getBuildingCount(game, def.id);
        /*
         * 唯一性（owned > 0）与解锁门槛分开判，界面才能说清「差在哪」；
         * 造价是否够由 enqueueBuild 在入队时再判一次。
         */
        const gate = getBuildGate(BUILDABLE_MAP[def.id], game);
        const check = { ok: owned === 0 && gate === null, reason: owned > 0 ? '此建筑唯一' : gate };
        return (
          <article key={def.id} className={owned > 0 ? 'recipe recipe--rare' : 'recipe'}>
            <div className="recipe__head">
              <span className="recipe__icon">{def.icon}</span>
              <span className="recipe__name">{def.name}</span>
              <span className="recipe__owned">幸福 +{def.happiness}</span>
              {owned > 0 && <span className="tier-badge">已建成</span>}
            </div>
            <div className="recipe__desc">{def.desc}</div>
            <div className="recipe__foot">
              <div className="recipe__cost">
                <CostList cost={toCostMap(def.cost as never)} state={game} />
              </div>
              <button
                type="button"
                className="btn btn--tiny"
                disabled={owned > 0 || !check.ok}
                title={owned > 0 ? '此建筑唯一' : (check.reason ?? '')}
                onClick={() => build(def.id)}
              >
                {owned > 0 ? '已建成' : '建造'}
              </button>
            </div>
            {owned === 0 && !check.ok && <div className="recipe__lock">{check.reason}</div>}
          </article>
        );
      })}
    </>
  );
}

function SpatialWards() {
  const game = useGame((s) => s.game);
  const apply = useGame((s) => s.applySpatialWard);
  const daoLevel = getEnlightenLevel(game, 'spatial');
  const unlocked = daoLevel >= SPATIAL_WARD_REQUIRED_DAO_LEVEL;
  const rows = getWardOverview(game);
  const storageCount = STORAGE_BUILDINGS.filter((b) => (game.buildings[b.id] ?? 0) > 0).length;

  return (
    <>
      <h3 className="panel__subtitle">空间禁制</h3>
      <p className="panel__note">
        感悟<strong>空间大道</strong>之后，可以把空间法则压进库房：
        每次给<strong>某一座库房</strong>永久 +{Math.round(SPATIAL_WARD_CAPACITY_BONUS * 100)}% 容量，
        同一座最多叠 {SPATIAL_WARD_MAX_STACKS} 层，<strong>每叠一层花费翻倍多</strong>。
        当前空间大道 {daoLevel} 级{unlocked ? '' : `（需 ${SPATIAL_WARD_REQUIRED_DAO_LEVEL} 级）`}。
      </p>

      {!unlocked && (
        <p className="panel__note">
          去「感悟」页把<strong>空间大道</strong>修到 {SPATIAL_WARD_REQUIRED_DAO_LEVEL} 级即可解锁
          （空间大道需要先感悟五行、并在化神期之后开放）。
        </p>
      )}

      {storageCount === 0 ? (
        <p className="panel__note">还没有任何库房 —— 先去「建筑」页建一座。</p>
      ) : (
        rows.map((row) => {
          const check = canApplyWard(game, row.id);
          return (
            <div key={row.id} className="notice-board__row">
              <span className="notice-board__name">
                {row.icon}
                {row.name}
              </span>
              <span className="notice-board__detail">
                ×{row.count} · 禁制 {row.stacks} 层（+{Math.round(getSpatialWardBonus(game, row.id) * 100)}% 容量）
              </span>
              <span className="btn-row" style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="btn btn--tiny"
                  disabled={!check.ok}
                  title={check.reason ?? `需 ☯${fmt(row.cost.qi ?? 0)} 等材料`}
                  onClick={() => apply(row.id)}
                >
                  施加禁制
                </button>
              </span>
            </div>
          );
        })
      )}
    </>
  );
}

export function HappinessPanel({ collapsible }: { collapsible?: boolean }) {
  const game = useGame((s) => s.game);

  if (!game.sect.founded) return null;

  return (
    <Panel
      title="宗门气象"
      hint={`幸福度 ${game.happiness.toFixed(0)} · ${describeHappiness(game)}`}
      collapsible={collapsible}
      storageKey="happiness"
    >
      <HappinessBar />
      <HappinessBreakdown />
      <HappinessBuildings />
      <SpatialWards />
    </Panel>
  );
}

export default HappinessPanel;
