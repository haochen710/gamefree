/**
 * 洞府建设：所有可建造物集中在一个模块里，按用途分组。
 *
 * 可见性规则（这里曾经有过一个 bug）：
 *   只要**曾经**达成过解锁条件，或者已经建过，就永远显示。
 *   早期版本用「当前资源是否达标」来判断，导致玩家一花掉灵气，
 *   已经建了好几座的灵木林就从面板上消失了。
 */
import { fmt } from '../game/decimal';
import {
  BUILDABLES,
  BUILD_GROUPS,
  RESOURCE_MAP,
  type BuildableDef,
  type BuildGroupId,
  type StructureDef,
} from '../game/content';
import {
  canAfford,
  getBuildingCount,
  getCost,
  getGeneratorOutput,
  getUnlockProgress,
  isUnlocked,
  maxAffordable,
} from '../game/engine';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';
import CostList from './CostList';

/** 建筑效果的一行短说明（只用于不产出资源的建筑） */
function describeEffect(def: StructureDef): string {
  const parts: string[] = [];
  if (def.capacity) parts.push(`弟子位 +${def.capacity}`);
  if (def.alchemySlots) parts.push(`炼丹位 +${def.alchemySlots}`);
  if (def.refiningSlots) parts.push(`炼器位 +${def.refiningSlots}`);
  return parts.join(' · ') || '—';
}

function BuildRow({ def, state }: { def: BuildableDef; state: GameState }) {
  const buy = useGame((s) => s.buy);

  const owned = getBuildingCount(state, def.id);
  const cost1 = getCost(def, owned, 1);
  const cost10 = getCost(def, owned, 10);
  const canBuy1 = canAfford(state, cost1);
  const canBuy10 = canAfford(state, cost10);
  const maxN = maxAffordable(def, owned, state);

  const output = def.kind === 'generator' ? getGeneratorOutput(state, def) : null;
  const target = def.kind === 'generator' ? RESOURCE_MAP[def.produces] : null;

  return (
    <article className={canBuy1 ? 'generator' : 'generator generator--locked'}>
      <div className="generator__main">
        <span className="generator__icon">{def.icon}</span>
        <div className="generator__text">
          <div className="generator__title">
            <span className="generator__name">{def.name}</span>
            <span className="generator__count">×{owned}</span>
          </div>
          <div className="generator__output">
            {def.kind === 'generator' && target
              ? `产出 ${target.icon} ${fmt(output ?? 0)}/秒`
              : def.kind === 'structure'
                ? describeEffect(def)
                : '—'}
          </div>
          <div className="generator__desc">{def.desc}</div>
        </div>
      </div>

      <div className="generator__buy">
        <div className="generator__price">
          <CostList cost={cost1} state={state} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn" disabled={!canBuy1} onClick={() => buy(def.id, 1)}>
            建造 1
          </button>
          <button type="button" className="btn" disabled={!canBuy10} onClick={() => buy(def.id, 10)}>
            建造 10
          </button>
          <button type="button" className="btn" disabled={maxN <= 0} onClick={() => buy(def.id, 'max')}>
            最大 {maxN > 0 ? `(${fmt(maxN, 0)})` : ''}
          </button>
        </div>
      </div>
    </article>
  );
}

/** 未解锁建筑的提示：告诉玩家还差什么，而不是一片空白 */
function LockedHint({ state }: { state: GameState }) {
  const locked = BUILDABLES.filter((def) => !isUnlocked(def, state));
  if (locked.length === 0) return null;

  // 挑最接近解锁的那一个显示进度
  const nearest = locked
    .map((def) => ({ def, progress: getUnlockProgress(def, state) }))
    .find((item) => item.progress !== null);

  return (
    <p className="panel__note panel__note--locked">
      还有 <strong>{locked.length}</strong> 处建筑尚未解锁
      {nearest?.progress && (
        <>
          ，最近的一处需要{' '}
          <strong>
            {RESOURCE_MAP[nearest.progress.id as keyof typeof RESOURCE_MAP]?.name ?? nearest.progress.id}{' '}
            {fmt(nearest.progress.need, 0)}
          </strong>
          （已有 {fmt(nearest.progress.have, 0)}）
        </>
      )}
      。
    </p>
  );
}

export function BuildingsPanel() {
  const game = useGame((s) => s.game);

  const visibleByGroup = BUILD_GROUPS.map((group) => ({
    group,
    defs: BUILDABLES.filter((def) => def.group === (group.id as BuildGroupId) && isUnlocked(def, game)),
  })).filter((entry) => entry.defs.length > 0);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>洞府建设</h2>
        <span className="panel__hint">设施 · 居所 · 工坊</span>
      </div>

      {visibleByGroup.length === 0 && <p className="panel__note">暂无可建造的项目。</p>}

      {visibleByGroup.map(({ group, defs }) => (
        <div key={group.id} className="build-group">
          <div className="build-group__head">
            <h3 className="build-group__title">{group.title}</h3>
            <span className="build-group__hint">{group.hint}</span>
          </div>
          <div className="generator-list">
            {defs.map((def) => (
              <BuildRow key={def.id} def={def} state={game} />
            ))}
          </div>
        </div>
      ))}

      <LockedHint state={game} />
    </section>
  );
}

export default BuildingsPanel;
