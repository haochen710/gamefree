/** 资源与材料栏：显示存量、产量与储存上限 */
import { fmt, fmtRate } from '../game/decimal';
import { MATERIALS, RESOURCES, RARITY_COLORS } from '../game/content';
import { getProduction, getStorageCaps } from '../game/engine';
import { useGame } from '../game/store';

export function ResourceBar() {
  const game = useGame((s) => s.game);
  const production = getProduction(game);
  const caps = getStorageCaps(game);

  // 材料在开宗立派（也就是第一次能接触秘境）之前不显示，避免开局一堆看不懂的东西；
  // 之后即使归零也保留，免得玩家以为东西丢了。
  // 材料不受储存上限约束 —— 它们是秘境随机掉落的，卡上限只会让人烦躁。
  const showMaterials = game.sect.founded || MATERIALS.some((m) => game.materials[m.id].gt(0));
  const visibleMaterials = showMaterials ? MATERIALS : [];

  return (
    <section className="resource-bar">
      {RESOURCES.map((def) => {
        const amount = game.resources[def.id];
        const cap = caps[def.id];
        const rate = production[def.id];
        const idle = amount.eq(0) && rate.eq(0);
        // 灵气是卡进度的瓶颈资源，满了就是实打实的损失，标红；
        // 灵木灵矿这类副资源给人留了充足余量，满了只是提醒，标黄即可
        const full = amount.gte(cap);
        const critical = full && def.id === 'qi';
        const nearly = !full && cap.gt(0) && amount.div(cap).gte(0.9);

        const className = [
          'resource',
          idle ? 'resource--idle' : '',
          critical ? 'resource--full' : full ? 'resource--capped' : nearly ? 'resource--nearly' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div key={def.id} className={className} title={def.desc}>
            <div className="resource__head">
              <span className="resource__icon">{def.icon}</span>
              <span className="resource__name">{def.name}</span>
            </div>
            <div className="resource__amount">
              {fmt(amount)}
              <span className="resource__cap">/ {fmt(cap)}</span>
            </div>
            <div
              className={
                full
                  ? critical
                    ? 'resource__rate resource__rate--full'
                    : 'resource__rate resource__rate--capped'
                  : rate.gt(0)
                    ? 'resource__rate'
                    : 'resource__rate resource__rate--zero'
              }
            >
              {critical ? '已满 · 产量全部溢出' : full ? '已满' : fmtRate(rate)}
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
          <div className="resource__rate resource__rate--zero">秘境产物 · 无上限</div>
        </div>
      ))}
    </section>
  );
}

export default ResourceBar;
