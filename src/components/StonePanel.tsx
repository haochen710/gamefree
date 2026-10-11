/**
 * 灵石合成：用灵气 + 灵矿换灵石。
 *
 * 需求 4 要求「灵石可自动由矿石和灵气合成，玩家可自主选择开启与否」，
 * 所以这里给了三档速率 + 一档关闭，而不是单纯的开/关：
 * 自动合成烧的是突破要用的灵气，只有一个开关很容易一觉醒来灵气全没了。
 */
import { fmt } from '../game/decimal';
import { AUTO_REFINE_RATES, STONE_REFINE_OUTPUT } from '../game/content';
import {
  getAutoRefineRate,
  getStoneRefineCost,
  maxAutoRefineBatches,
  maxStoneRefine,
} from '../game/engine';
import { useGame } from '../game/store';
import CostList from './CostList';
import Panel from './Panel';

const RATE_LABELS = ['关闭', '慢', '中', '快'];

export function StonePanel({ collapsible = false }: { collapsible?: boolean } = {}) {
  const game = useGame((s) => s.game);
  const refineStone = useGame((s) => s.refineStone);
  const setAutoRefine = useGame((s) => s.setAutoRefine);

  const cost = getStoneRefineCost();
  const max = maxStoneRefine(game);
  const rate = getAutoRefineRate(game);
  const autoMax = maxAutoRefineBatches(game);

  return (
    <Panel title="灵石合成" hint="灵气 + 灵矿" collapsible={collapsible} storageKey="stone">
      <p className="panel__note">
        每份消耗 <CostList cost={cost} state={game} /> ，产出 💎 {STONE_REFINE_OUTPUT} 灵石。
        招收弟子、宗门晋升、商行交易都要用灵石；建灵石矿是更省事的路子，早期可以先靠合成应急。
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

      <div className="panel__head panel__head--sub">
        <h3>自动合成</h3>
        <span className="panel__hint">
          {rate > 0 ? `${rate} 批/秒（当前可合成 ${fmt(autoMax, 0)} 批）` : '未开启'}
        </span>
      </div>

      <p className="panel__note panel__note--warn">
        自动合成会持续消耗灵气 —— 灵气也是突破的硬性资源，
        想攒灵气冲击大境界时记得把它关掉。
      </p>

      <div className="btn-row btn-row--wrap">
        {AUTO_REFINE_RATES.map((value, level) => (
          <button
            key={value}
            type="button"
            className={rate === value ? 'btn btn--primary' : 'btn'}
            onClick={() => setAutoRefine(level)}
          >
            {RATE_LABELS[level] ?? level}
            {level > 0 && <span className="btn__sub">{value} 批/秒</span>}
          </button>
        ))}
      </div>
    </Panel>
  );
}

export default StonePanel;
