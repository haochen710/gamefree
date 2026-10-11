/** 顶部：境界、小境界层数、全局倍率、道韵 */
import { fmt, fmtMultiplier } from '../game/decimal';
import { getGlobalMultiplier, getRealm, isFinalRealm } from '../game/engine';
import { useGame } from '../game/store';

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function Header() {
  const game = useGame((s) => s.game);
  const realm = getRealm(game);
  const multiplier = getGlobalMultiplier(game);

  const layerText = realm.layerCount > 1 ? `${CN_NUM[game.layer] ?? game.layer}层` : '圆满';
  const realmLabel = isFinalRealm(game) ? `${realm.name}·圆满` : realm.name;

  return (
    <header className="header">
      <div className="header__title">
        <h1>仙途</h1>
        <span className="header__subtitle">修仙放置</span>
      </div>

      <div className="header__stats">
        <div className="stat">
          <span className="stat__label">境界</span>
          <span className="stat__value stat__value--big">
            {realmLabel}
            <em className="stat__layer">{layerText}</em>
          </span>
        </div>

        <div className="stat">
          <span className="stat__label">全局倍率</span>
          <span className="stat__value">{fmtMultiplier(multiplier)}</span>
        </div>

        <div className="stat">
          <span className="stat__label">道韵</span>
          <span className="stat__value stat__value--gold">
            {fmt(game.daoYun)}
            {game.ascensions > 0 && <em className="stat__layer">飞升 {game.ascensions} 次</em>}
          </span>
        </div>
      </div>
    </header>
  );
}

export default Header;
