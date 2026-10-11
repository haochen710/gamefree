/** 资源与材料栏 */
import { fmt, fmtRate } from '../game/decimal';
import { MATERIALS, RESOURCES, RARITY_COLORS } from '../game/content';
import { getProduction } from '../game/engine';
import { useGame } from '../game/store';

export function ResourceBar() {
  const game = useGame((s) => s.game);
  const production = getProduction(game);

  // 材料在开宗立派（也就是第一次能接触秘境）之前不显示，避免开局一堆看不懂的东西；
  // 之后即使归零也保留，免得玩家以为东西丢了
  const showMaterials = game.sect.founded || MATERIALS.some((m) => game.materials[m.id].gt(0));
  const visibleMaterials = showMaterials ? MATERIALS : [];

  return (
    <section className="resource-bar">
      {RESOURCES.map((def) => {
        const amount = game.resources[def.id];
        const rate = production[def.id];
        const idle = amount.eq(0) && rate.eq(0);

        return (
          <div key={def.id} className={idle ? 'resource resource--idle' : 'resource'} title={def.desc}>
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

      {visibleMaterials.map((def) => (
        <div key={def.id} className="resource resource--material" title={def.desc}>
          <div className="resource__head">
            <span className="resource__icon" style={{ color: RARITY_COLORS[def.rarity] }}>
              {def.icon}
            </span>
            <span className="resource__name">{def.name}</span>
          </div>
          <div className="resource__amount" style={{ color: RARITY_COLORS[def.rarity] }}>
            {fmt(game.materials[def.id])}
          </div>
          <div className="resource__rate resource__rate--zero">秘境产物</div>
        </div>
      ))}
    </section>
  );
}

export default ResourceBar;
