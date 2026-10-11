/**
 * 建造队列（需求 2）
 *
 * 需求原文：
 *   「增加建筑建造排队机制，最多允许7个建筑排队。初始只有3个排队名额，
 *     金丹后解锁建筑相关建筑（你起这个名），该建筑唯一，需要特殊升级解锁排队名额」
 *
 * 队列的语义是「排好队，资源一到就自动盖」——不是定时开工。
 * 所以这个面板要把三件事说清楚：
 *   1. 现在有几个名额、还能排几个；
 *   2. 队列里每一项**为什么还没开工**（门槛没过 / 资源不够）——
 *      不写清楚的话，玩家只会以为队列坏了；
 *   3. 名额从哪来（天工院 + 它的特殊升级）。
 */
import type Decimal from '../game/decimal';
import { fmt } from '../game/decimal';
import {
  BUILD_QUEUE_MAX_SLOTS,
  BUILDABLE_MAP,
  ITEM_MAP,
  QUEUE_UPGRADES,
  type ItemId,
} from '../game/content';
import {
  canAfford,
  canUpgradeQueue,
  getBuildGate,
  getBuildingCount,
  getCost,
  getQueueSlots,
  getQueueUpgrade,
  hasQueueBuilding,
  maxAffordable,
} from '../game/engine';
import { useGame } from '../game/store';

export function BuildQueuePanel() {
  const game = useGame((s) => s.game);
  const dequeueBuild = useGame((s) => s.dequeueBuild);
  const moveQueueItem = useGame((s) => s.moveQueueItem);
  const clearBuildQueue = useGame((s) => s.clearBuildQueue);
  const upgradeQueue = useGame((s) => s.upgradeQueue);

  const slots = getQueueSlots(game);
  const queue = game.buildQueue;
  const upgrade = getQueueUpgrade(game);
  const upgradeCheck = canUpgradeQueue(game);
  const built = hasQueueBuilding(game);
  const full = slots >= BUILD_QUEUE_MAX_SLOTS;

  /** 队列里的一项现在能不能开工 */
  const readiness = (id: string): { ok: boolean; why: string | null } => {
    const def = BUILDABLE_MAP[id];
    if (!def) return { ok: false, why: '这个建筑已经不存在了' };
    const gate = getBuildGate(def, game);
    if (gate) return { ok: false, why: gate };
    const owned = getBuildingCount(game, id);
    if (def.max !== undefined && owned >= def.max) return { ok: false, why: '已经建满了' };
    const cost = getCost(def, owned, 1);
    if (!canAfford(game, cost)) {
      // 把缺的那几样点名，玩家才知道该攒什么
      const missing = Object.entries(cost)
        .filter(([item, need]) => {
          const have = (game.resources as Record<string, Decimal | undefined>)[item] ??
            (game.materials as Record<string, Decimal | undefined>)[item];
          return !have || have.lt(need);
        })
        .map(([item]) => ITEM_MAP[item as ItemId]?.name ?? item);
      return { ok: false, why: missing.length > 0 ? `缺 ${missing.join('、')}` : '资源不足' };
    }
    if (maxAffordable(def, owned, game) <= 0) return { ok: false, why: '资源不足' };
    return { ok: true, why: null };
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>建造队列</h2>
        <span className="panel__hint">
          名额 {queue.length}/{slots} · 上限 {BUILD_QUEUE_MAX_SLOTS}
        </span>
      </div>
      <p className="panel__note">
        把想盖的东西排进队列，<strong>资源一到就自动开工</strong>，不用守着。
        队列里第一项不满足条件时会原地等着，不会跳过 ——
        所以哪一项缺什么，这里会直接写出来。
      </p>

      {queue.length === 0 ? (
        <p className="panel__note">队列是空的。在下面的建筑列表里点「排队」即可加入。</p>
      ) : (
        <ol className="queue">
          {queue.map((id, index) => {
            const def = BUILDABLE_MAP[id];
            const state = readiness(id);
            const owned = getBuildingCount(game, id);
            return (
              <li key={`${id}-${index}`} className={state.ok ? 'queue__item queue__item--ready' : 'queue__item'}>
                <span className="queue__no">{index === 0 ? '▶' : index + 1}</span>
                <span className="queue__icon">{def?.icon ?? '❓'}</span>
                <span className="queue__name">
                  {def?.name ?? id}
                  {def && def.max !== undefined && <span className="queue__owned">（已有 {owned}/{def.max}）</span>}
                </span>
                <span className="queue__why">{state.ok ? '就绪，资源够就开工' : state.why}</span>
                <span className="queue__ops">
                  <button type="button" className="btn btn--tiny" disabled={index === 0} onClick={() => moveQueueItem(index, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--tiny"
                    disabled={index === queue.length - 1}
                    onClick={() => moveQueueItem(index, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" className="btn btn--tiny btn--danger" onClick={() => dequeueBuild(index)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="btn-row">
        <button type="button" className="btn" disabled={queue.length === 0} onClick={clearBuildQueue}>
          清空队列
        </button>
      </div>

      {/* ---- 名额的来源：天工院与它的特殊升级 ---- */}
      <div className="queue__slots">
        <div className="queue__slots-head">
          <strong>名额来源</strong>
          <span className="panel__hint">
            {slots} / {BUILD_QUEUE_MAX_SLOTS}
          </span>
        </div>
        <div className="bar">
          <div className="bar__fill" style={{ width: `${Math.round((slots / BUILD_QUEUE_MAX_SLOTS) * 100)}%` }} />
        </div>
        <ul className="queue__sources">
          <li>初始 {3} 个</li>
          <li className={built ? 'queue__src--on' : ''}>
            🏗 天工院 {built ? '+1' : '（未建造，金丹期解锁）'}
          </li>
          {QUEUE_UPGRADES.map((up, i) => (
            <li key={up.name} className={game.tiangongLevel > i ? 'queue__src--on' : ''}>
              {up.name} {game.tiangongLevel > i ? '+1' : `（未升级，需${fmtTooltip(up.cost)}）`}
            </li>
          ))}
        </ul>

        {!full && upgrade && (
          <div className="queue__upgrade">
            <div className="queue__upgrade-head">
              下一级：<strong>{upgrade.name}</strong> —— {upgrade.desc}
            </div>
            <div className="queue__upgrade-cost">花费 {fmtTooltip(upgrade.cost)}</div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!upgradeCheck.ok}
              onClick={upgradeQueue}
            >
              特殊升级（名额 +{upgrade.slots}）
              {!upgradeCheck.ok && upgradeCheck.reason && <span className="btn__sub">{upgradeCheck.reason}</span>}
            </button>
          </div>
        )}
        {full && <p className="panel__note">名额已开满（{BUILD_QUEUE_MAX_SLOTS} 个）。</p>}
      </div>
    </section>
  );
}

function fmtTooltip(cost: Partial<Record<ItemId, number>>): string {
  return Object.entries(cost)
    .map(([item, amount]) => `${ITEM_MAP[item as ItemId]?.name ?? item} ${fmt(amount as number, 0)}`)
    .join(' · ');
}

export default BuildQueuePanel;
