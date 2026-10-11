/** 灵石合成：用灵气 + 灵矿换灵石（需求 6 的另一条获取途径） */
import { fmt } from '../game/decimal';
import { STONE_REFINE_OUTPUT } from '../game/content';
import { getStoneRefineCost, maxStoneRefine } from '../game/engine';
import { useGame } from '../game/store';
import CostList from './CostList';

export function StonePanel() {
  const game = useGame((s) => s.game);
  const refineStone = useGame((s) => s.refineStone);

  const cost = getStoneRefineCost();
  const max = maxStoneRefine(game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>灵石合成</h2>
        <span className="panel__hint">灵气 + 灵矿</span>
      </div>

      <p className="panel__note">
        每份消耗 <CostList cost={cost} state={game} /> ，产出 💎 {STONE_REFINE_OUTPUT} 灵石。
        宗门招收弟子、晋升品阶都要用灵石；建灵石矿是更省事的路子，早期则可以先靠合成应急。
      </p>

      <div className="btn-row btn-row--wrap">
        <button type="button" className="btn" disabled={max < 1} onClick={() => refineStone(1)}>
          合成 1 份
        </button>
        <button type="button" className="btn" disabled={max < 10} onClick={() => refineStone(10)}>
          合成 10 份
        </button>
        <button type="button" className="btn" disabled={max < 1} onClick={() => refineStone(max)}>
          全部合成 {max > 0 ? `(${fmt(max, 0)})` : ''}
        </button>
      </div>
    </section>
  );
}

export default StonePanel;
