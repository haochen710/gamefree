/** 境界：参悟小境界、突破大境界 */
import { fmt } from '../game/decimal';
import { RESOURCE_MAP } from '../game/content';
import {
  canAdvanceLayer,
  getBreakthroughStatus,
  getLayerCost,
  getRealm,
  isFinalRealm,
} from '../game/engine';
import { useGame } from '../game/store';

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function RealmPanel() {
  const game = useGame((s) => s.game);
  const advanceLayer = useGame((s) => s.advanceLayer);
  const breakthrough = useGame((s) => s.breakthrough);

  const realm = getRealm(game);
  const layerCost = getLayerCost(game);
  const canLayer = canAdvanceLayer(game);
  const status = getBreakthroughStatus(game);
  const final = isFinalRealm(game);

  const progress = realm.layerCount > 0 ? game.layer / realm.layerCount : 1;

  const handleBreakthrough = () => {
    if (!status.possible) return;
    if (window.confirm(`确定突破至下一境界？将消耗 ${fmt(realm.breakthroughQi)} 灵气。`)) {
      breakthrough();
    }
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>境界</h2>
        <span className="panel__hint">参悟与突破</span>
      </div>

      <div className="realm">
        <div className="realm__name">{realm.name}</div>
        <div className="realm__desc">{realm.desc}</div>

        <div className="bar">
          <div className="bar__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="realm__layers">
          {realm.layerCount > 1
            ? `${CN_NUM[game.layer] ?? game.layer}层 / ${CN_NUM[realm.layerCount] ?? realm.layerCount}层`
            : '圆满'}
          <span className="realm__bonus">每层 +{Math.round(realm.layerBonus * 100)}% 产量</span>
        </div>

        {layerCost && (
          <div className="realm__action">
            <button
              type="button"
              className="btn btn--primary btn--wide"
              disabled={!canLayer}
              onClick={advanceLayer}
            >
              参悟下一层
              <span className="btn__sub">
                ☯ {fmt(layerCost)} 灵气
              </span>
            </button>
          </div>
        )}

        {!layerCost && !final && (
          <div className="realm__action">
            <div className="realm__req">
              突破条件：☯ {fmt(realm.breakthroughQi)} 灵气
              {realm.breakthroughPills > 0 && (
                <>
                  {' · '}
                  {RESOURCE_MAP.pill.icon} {fmt(realm.breakthroughPills)} 丹药
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn--primary btn--wide"
              disabled={!status.possible}
              onClick={handleBreakthrough}
            >
              突破境界
              {!status.possible && status.reason && <span className="btn__sub">{status.reason}</span>}
            </button>
          </div>
        )}

        {final && <div className="realm__done">已臻仙人之境，此界再无前路。</div>}
      </div>
    </section>
  );
}

export default RealmPanel;
