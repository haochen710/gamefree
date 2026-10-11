/**
 * 建造面板：设施与建筑共用。
 *
 * 两者的价格机制完全一样（等比递增），差别只在「产出什么」还是「提供什么功能」，
 * 所以用同一个组件渲染，只是副标题不同。
 */
import { fmt } from '../game/decimal';
import { RESOURCE_MAP, type BuildableDef, type StructureDef } from '../game/content';
import {
  canAfford,
  getBuildingCount,
  getCost,
  getGeneratorOutput,
  isUnlocked,
  maxAffordable,
} from '../game/engine';
import { useGame } from '../game/store';
import CostList from './CostList';

interface Props {
  title: string;
  hint: string;
  defs: BuildableDef[];
  /** 没有任何可建造项时的提示 */
  emptyHint: string;
}

/** 把建筑效果写成一行短说明（只用于不产出资源的建筑） */
function describeEffect(def: StructureDef): string {
  const parts: string[] = [];
  if (def.capacity) parts.push(`弟子位 +${def.capacity}`);
  if (def.alchemySlots) parts.push(`炼丹位 +${def.alchemySlots}`);
  if (def.refiningSlots) parts.push(`炼器位 +${def.refiningSlots}`);
  return parts.join(' · ') || '—';
}

export function BuildPanel({ title, hint, defs, emptyHint }: Props) {
  const game = useGame((s) => s.game);
  const buy = useGame((s) => s.buy);

  const visible = defs.filter((def) => isUnlocked(def, game));

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{title}</h2>
        <span className="panel__hint">{hint}</span>
      </div>

      {visible.length === 0 && <p className="panel__note">{emptyHint}</p>}

      <div className="generator-list">
        {visible.map((def) => {
          const owned = getBuildingCount(game, def.id);
          const cost1 = getCost(def, owned, 1);
          const cost10 = getCost(def, owned, 10);
          const canBuy1 = canAfford(game, cost1);
          const canBuy10 = canAfford(game, cost10);
          const maxN = maxAffordable(def, owned, game);

          const output =
            def.kind === 'generator' ? getGeneratorOutput(game, def) : null;
          const target = def.kind === 'generator' ? RESOURCE_MAP[def.produces] : null;

          return (
            <article key={def.id} className={canBuy1 ? 'generator' : 'generator generator--locked'}>
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
                  <CostList cost={cost1} state={game} />
                </div>
                <div className="btn-row">
                  <button type="button" className="btn" disabled={!canBuy1} onClick={() => buy(def.id, 1)}>
                    建造 1
                  </button>
                  <button type="button" className="btn" disabled={!canBuy10} onClick={() => buy(def.id, 10)}>
                    建造 10
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={maxN <= 0}
                    onClick={() => buy(def.id, 'max')}
                  >
                    最大 {maxN > 0 ? `(${fmt(maxN, 0)})` : ''}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default BuildPanel;
