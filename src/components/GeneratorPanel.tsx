/** 洞府设施：建造与升级自动产出 */
import { fmt } from '../game/decimal';
import { GENERATORS, RESOURCE_MAP } from '../game/content';
import {
  canAfford,
  getCost,
  getGeneratorOutput,
  isUnlocked,
  maxAffordable,
} from '../game/engine';
import { useGame } from '../game/store';
import CostList from './CostList';

export function GeneratorPanel() {
  const game = useGame((s) => s.game);
  const buy = useGame((s) => s.buy);

  const visible = GENERATORS.filter((def) => isUnlocked(def, game));

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>洞府设施</h2>
        <span className="panel__hint">持续产出资源</span>
      </div>

      <div className="generator-list">
        {visible.map((def) => {
          const owned = game.generators[def.id] ?? 0;
          const output = getGeneratorOutput(game, def);
          const produceDef = RESOURCE_MAP[def.produces];

          const cost1 = getCost(def, owned, 1);
          const cost10 = getCost(def, owned, 10);
          const canBuy1 = canAfford(cost1, game.resources);
          const canBuy10 = canAfford(cost10, game.resources);
          const maxN = maxAffordable(def, owned, game.resources);

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
                    产出 {produceDef.icon} {fmt(output)}/秒
                  </div>
                  <div className="generator__desc">{def.desc}</div>
                </div>
              </div>

              <div className="generator__buy">
                <div className="generator__price">
                  <CostList cost={cost1} resources={game.resources} />
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={!canBuy1}
                    onClick={() => buy(def.id, 1)}
                  >
                    建造 1
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!canBuy10}
                    onClick={() => buy(def.id, 10)}
                  >
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

export default GeneratorPanel;
