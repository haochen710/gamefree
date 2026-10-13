/**
 * 境界面板：参悟小境界、突破大境界。
 *
 * 突破现在是概率事件，而且**必须消耗一颗对应境界丹**（本轮需求 9）。
 * 也就是说这个面板上有两条独立的路：
 *   - 小境界（参悟）：花灵气，不受丹药影响；
 *   - 大境界（突破）：灵气 + 一颗境界丹，缺一不可。
 *
 * ⚠️ 本轮删掉了「失败累积保底成功率」（原先这里会显示「保底加成 +N%」）。
 * 那条机制让"不花丹药反复撞"成为可行策略，正好抵消了丹药的价值 ——
 * 既然丹药已经是门票，就不该再有第二条路。
 */
import { fmt, fmtDuration } from '../game/decimal';
import {
  BREAKTHROUGH_MAX_SUCCESS,
  BREAKTHROUGH_PILL_GAP_RECOVERY,
  INJURY_FROM_REALM,
  INJURY_PRODUCTION_PENALTY,
  PILL_MAP,
  REALMS,
  // 需求 16：突破所需灵气的实际值（含"越到后面越陡"的系数）
  scaledBreakthroughQi,
} from '../game/content';
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
  // 丹药是硬门槛，所以只有一个成功率（服丹之后的那一个）
  const rate = getSuccessRate(game);
  const pillDef = status.pillId ? PILL_MAP[status.pillId] : null;
  const pillOwned = status.pillId ? (game.pills[status.pillId] ?? 0) : 0;

  const handleBreakthrough = () => {
    if (!status.possible) return;
    const risk = status.safe
      ? `\n失败无任何负面影响：灵气全额返还，可立即再试（但丹药已消耗）。`
      : `\n失败将道伤缠身，一段时间内无法再度突破，且期间产量下降。\n失败返还一半灵气（丹药不返还）。`;
    const ok = window.confirm(
      `确定突破至${realm.name}之后的境界？\n\n` +
        `消耗 ${fmt(scaledBreakthroughQi(game.realmIndex))} 灵气\n` +
        `消耗 ${pillDef?.name ?? '境界丹'} ×1（现有 ${pillOwned} 颗）\n` +
        `成功率 ${Math.round(rate * 100)}%${risk}`,
    );
    if (ok) breakthrough();
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
            <p className="panel__note">小境界只需积累灵气，不耗丹药。</p>
          </div>
        )}

        {!layerCost && !final && (
          <div className="realm__action">
            {status.injurySeconds > 0 && (
              <div className="injury">
                <span className="injury__icon">🩸</span>
                <div>
                  <strong>道伤未愈</strong>
                  <span className="injury__time">
                    还需 {fmtDuration(status.injurySeconds)} 才能再次突破
                  </span>
                  <span className="injury__note">
                    期间全局产量 −{Math.round(INJURY_PRODUCTION_PENALTY * 100)}%
                  </span>
                </div>
              </div>
            )}

            <div className="realm__req">
              突破消耗：☯ {fmt(scaledBreakthroughQi(game.realmIndex))} 灵气 +{' '}
              {pillDef ? `${pillDef.icon}${pillDef.name} ×1` : '境界丹 ×1'}
              <em>（丹药与弟子共用仓库）</em>
            </div>

            <div className="realm__rates">
              {pillDef && (
                <span className={status.hasPill ? 'realm__rate--pill' : 'realm__rate--nopill'}>
                  {pillDef.icon} {pillDef.name}
                  <strong>
                    {status.hasPill ? `已有 ${pillOwned} 颗` : '仓库无货'}
                  </strong>
                </span>
              )}
              <span>
                成功率 <strong>{Math.round(rate * 100)}%</strong>
                <em>
                  （丹药补足差额的 {Math.round(BREAKTHROUGH_PILL_GAP_RECOVERY * 100)}%，上限{' '}
                  {Math.round(BREAKTHROUGH_MAX_SUCCESS * 100)}%）
                </em>
              </span>
            </div>

            {/* 需求 9 的核心提示：丹药是门票，不是可选项 */}
            <div
              className={
                status.hasPill ? 'realm__risk realm__risk--safe' : 'realm__risk realm__risk--hard'
              }
            >
              {!status.hasPill
                ? `缺 ${pillDef?.name ?? '境界丹'} —— 大境界突破必须服丹，去「丹器」页的丹房炼制，或让弟子从秘境带回来`
                : status.safe
                  ? `境界尚浅，突破失败没有负面影响（灵气全额返还，可立即再试）——但丹药照扣；从${REALMS[INJURY_FROM_REALM].name}起才会留下道伤`
                  : `突破失败将道伤缠身，一段时间内无法再度突破，且期间产量下降`}
            </div>

            <div className="btn-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!status.possible}
                onClick={handleBreakthrough}
              >
                服丹突破
              </button>
            </div>

            {!status.possible && status.reason && status.reason !== '道伤未愈' && (
              <div className="realm__req">{status.reason}</div>
            )}
          </div>
        )}

        {final && <div className="realm__done">已臻仙人之境，此界再无前路。</div>}
      </div>
    </section>
  );
}

export default RealmPanel;
