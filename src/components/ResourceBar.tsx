/** 资源栏：四种资源的存量与每秒产量 */
import { fmt, fmtRate } from '../game/decimal';
import { RESOURCES } from '../game/content';
import { getProduction } from '../game/engine';
import { useGame } from '../game/store';

export function ResourceBar() {
  const game = useGame((s) => s.game);
  const production = getProduction(game);

  return (
    <section className="resource-bar">
      {RESOURCES.map((def) => {
        const amount = game.resources[def.id];
        const rate = production[def.id];
        const idle = amount.eq(0) && rate.eq(0);

        return (
          <div key={def.id} className={idle ? 'resource resource--idle' : 'resource'}>
            <div className="resource__head">
              <span className="resource__icon">{def.icon}</span>
              <span className="resource__name">{def.name}</span>
            </div>
            <div className="resource__amount">{fmt(amount)}</div>
            <div className={rate.gt(0) ? 'resource__rate' : 'resource__rate resource__rate--zero'}>
              {fmtRate(rate)}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default ResourceBar;
