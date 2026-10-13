/**
 * 消耗清单：把一份消耗（资源、材料可以混在一起）渲染成小标签，
 * 不够的材料标红。
 */
import Decimal, { fmt } from '../game/decimal';
// ⚠️ 成本里现在可能是符箓（本轮需求 3），所以统一走 itemView
import { itemView, type ItemId } from '../game/content';
import { getAmount, type CostMap } from '../game/engine';
import type { GameState } from '../game/state';

interface Props {
  cost: CostMap;
  state: GameState;
  /** 用来把消耗放大到 N 份（批量炼制时显示总价） */
  multiplier?: number;
}

export function CostList({ cost, state, multiplier = 1 }: Props) {
  const entries = (Object.entries(cost) as [ItemId, Decimal][]).filter(
    ([, amount]) => amount && amount.gt(0),
  );

  return (
    <span className="cost-list">
      {entries.map(([id, amount]) => {
        const total = amount.mul(multiplier);
        const enough = getAmount(state, id).gte(total);
        const view = itemView(id);
        return (
          <span key={id} className={enough ? 'cost' : 'cost cost--short'}>
            <span className="cost__icon">{view.icon}</span>
            {fmt(total)}
          </span>
        );
      })}
    </span>
  );
}

export default CostList;
