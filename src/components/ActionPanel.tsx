/** 打坐：唯一的手动产出手段。受「心神」限制，无法靠狂点加速游戏（需求 1） */
import { fmt, fmtRate } from '../game/decimal';
import { MEDITATE_COST, MIND_MAX, MIND_REGEN_SECONDS } from '../game/content';
import { canMeditate, getMeditateGain, getProduction } from '../game/engine';
import { useGame } from '../game/store';

export function ActionPanel() {
  const game = useGame((s) => s.game);
  const meditate = useGame((s) => s.meditate);

  const gain = getMeditateGain(game);
  const qiRate = getProduction(game).qi;
  const ready = canMeditate(game);
  const secondsToNextMind = Math.max(0, MIND_REGEN_SECONDS - game.mindProgress);

  return (
    <section className="panel panel--action">
      <div className="panel__head">
        <h2>打坐</h2>
        <span className="panel__hint">
          心神 {Math.floor(game.mind)}/{MIND_MAX}
        </span>
      </div>

      <button
        type="button"
        className="btn btn--primary btn--big"
        disabled={!ready}
        onClick={meditate}
      >
        打坐吐纳
        <span className="btn__sub">{ready ? `+${fmt(gain)} 灵气` : `心神不足，${secondsToNextMind.toFixed(1)} 秒后回复`}</span>
      </button>

      <p className="panel__note">
        每次打坐消耗 {MEDITATE_COST} 点心神，获得约 1.5 秒的灵气产量（至少 3 点）。
        心神每 {MIND_REGEN_SECONDS} 秒回复 1 点，上限 {MIND_MAX} ——
        所以狂点也无法显著加快修行，最多相当于约 25% 的产量加成。
        当前灵气 {fmtRate(qiRate)}。
      </p>
    </section>
  );
}

export default ActionPanel;
