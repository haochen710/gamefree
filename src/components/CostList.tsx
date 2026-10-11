/**
 * 价格条：把一份消耗（可能是多种材料）渲染成小标签，
 * 买不起的材料标红。
 */
import { fmt } from '../game/decimal';
import { RESOURCE_MAP } from '../game/content';
import type { CostMap } from '../game/engine';
import type { ResourceMap } from '../game/state';
import type { ResourceId } from '../game/content';

interface Props {
  cost: CostMap;
  resources: ResourceMap;
}

export function CostList({ cost, resources }: Props) {
  const entries = Object.entries(cost) as [ResourceId, (typeof cost)[ResourceId]][];

  return (
    <span className="cost-list">
      {entries.map(([id, amount]) => {
        if (!amount) return null;
        const enough = resources[id].gte(amount);
        const def = RESOURCE_MAP[id];
        return (
          <span key={id} className={enough ? 'cost' : 'cost cost--short'}>
            <span className="cost__icon">{def.icon}</span>
            {fmt(amount)}
          </span>
        );
      })}
    </span>
  );
}

export default CostList;
