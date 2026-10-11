/**
 * 境界面板：参悟小境界、突破大境界。
 *
 * 突破现在是概率事件（需求 5）：可以选择服用对应的境界丹把成功率拉高，
 * 失败也不会卡死 —— 每次失败累积保底加成，并返还一半灵气。
 */
import { fmt } from '../game/decimal';
import { BREAKTHROUGH_FAIL_BONUS, PILL_MAP } from '../game/content';
import {
  canAdvanceLayer,
  getBreakthroughStatus,
  getLayerCost,
  getRealm,
  getSuccessRate,
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
  const rateWithout = getSuccessRate(game, false);
  const rateWith = getSuccessRate(game, true);
  const pillDef = status.pillId ? PILL_MAP[status.pillId] : null;
  const pity = game.breakthroughPity[game.realmIndex] ?? 0;

  const handleBreakthrough = (usePill: boolean) => {
    if (!status.possible) return;
    const rate = usePill ? rateWith : rateWithout;
    const extra = usePill && pillDef ? `\n将服用 ${pillDef.name}（剩余 ${game.pills[status.pillId] ?? 0} 颗）` : '';
    const ok = window.confirm(
      `确定突破至${realm.name}之后的境界？\n\n` +
        `消耗 ${fmt(realm.breakthroughQi)} 灵气${extra}\n` +
        `成功率 ${Math.round(rate * 100)}%　失败返还一半灵气，并累积 +${Math.round(
          BREAKTHROUGH_FAIL_BONUS * 100,
        )}% 保底成功率`,
    );
    if (ok) breakthrough(usePill);
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
              <span className="btn__sub">☯ {fmt(layerCost)} 灵气</span>
            </button>
          </div>
        )}

        {!layerCost && !final && (
          <div className="realm__action">
            <div className="realm__req">
              突破消耗：☯ {fmt(realm.breakthroughQi)} 灵气
              {pity > 0 && <span className="realm__pity"> · 保底加成 +{Math.round(pity * 100)}%</span>}
            </div>

            <div className="realm__rates">
              <span>
                基础成功率 <strong>{Math.round(rateWithout * 100)}%</strong>
              </span>
              {pillDef && (
                <span className={status.hasPill ? 'realm__rate--pill' : 'realm__rate--nopill'}>
                  {pillDef.icon} 服{pillDef.name} <strong>{Math.round(rateWith * 100)}%</strong>
                  <em>（{game.pills[status.pillId] ?? 0} 颗）</em>
                </span>
              )}
            </div>

            <div className="btn-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!status.possible}
                onClick={() => handleBreakthrough(false)}
              >
                直接突破
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!status.possible || !status.hasPill || !pillDef}
                onClick={() => handleBreakthrough(true)}
              >
                服丹突破
              </button>
            </div>

            {!status.possible && status.reason && <div className="realm__req">{status.reason}</div>}
          </div>
        )}

        {final && <div className="realm__done">已臻仙人之境，此界再无前路。</div>}
      </div>
    </section>
  );
}

export default RealmPanel;
