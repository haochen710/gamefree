/** 打坐：唯一的手动产出手段，也是开局的启动资金 */
import { fmt, fmtRate } from '../game/decimal';
import { getMeditateGain, getProduction } from '../game/engine';
import { useGame } from '../game/store';

export function ActionPanel() {
  const game = useGame((s) => s.game);
  const meditate = useGame((s) => s.meditate);
  const gain = getMeditateGain(game);
  const qiRate = getProduction(game).qi;

  return (
    <section className="panel panel--action">
      <div className="panel__head">
        <h2>打坐</h2>
        <span className="panel__hint">手动汲取灵气</span>
      </div>

      <button type="button" className="btn btn--primary btn--big" onClick={meditate}>
        打坐吐纳
        <span className="btn__sub">+{fmt(gain)} 灵气</span>
      </button>

      <p className="panel__note">
        每次打坐可获得 3 秒的灵气产量（至少 1 点）。当前灵气 {fmtRate(qiRate)}。
      </p>
    </section>
  );
}

export default ActionPanel;
