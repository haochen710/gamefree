/**
 * 炼丹面板（需求 2 / 5）
 *
 * 丹方按品阶展示，未解锁的品阶也列出来（灰掉并说明差在哪）——
 * 让玩家一眼看到"再盖两座丹房就能炼三品丹"这种目标。
 */
import { fmt } from '../game/decimal';
import { PILLS, TIER_NAMES, tierName, type PillDef } from '../game/content';
import { toCostMap } from '../game/engine';
import { describeCraftRate, getAlchemyUpgradeStatus, getCraftSuccessRate, maxCraftable } from '../game/crafting';
import { getPillDemand } from '../game/disciples';
import { useGame } from '../game/store';
import { FoldSection } from './fold';
import CostList from './CostList';

const CATEGORY_LABEL: Record<PillDef['category'], string> = {
  breakthrough: '境界',
  support: '辅助',
  combat: '战斗',
};

/**
 * 丹房告示栏（需求 6）
 *
 * 「弟子缺少丹药时显示，例如：筑基丹缺少 x12」。
 * 那个 12 是**卡在这一味丹上的弟子数**，不是"要 12 颗" ——
 * 所以每一行都写清"等丹 N 人 / 库存 M / 还差 K"，
 * 玩家一眼就知道该先炼哪一味（缺得最多的排最前）。
 *
 * 只在**真的有缺口**时才显示：修为没满的弟子不算缺丹，
 * 否则这块告示永远挂着一大片红字，反而没人看。
 */
function PillNoticeBoard() {
  const game = useGame((s) => s.game);
  const demand = getPillDemand(game).filter((entry) => entry.missing > 0);

  if (demand.length === 0) {
    return (
      <p className="panel__note">
        告示栏：暂无弟子因缺丹卡关。修为修满却差一颗丹时，这里会写明"哪一味、缺几颗"。
      </p>
    );
  }

  const total = demand.reduce((sum, entry) => sum + entry.missing, 0);
  return (
    <div className="notice-board">
      <div className="notice-board__head">
        <span>📌 丹房告示栏</span>
        <span className="notice-board__sum">共缺 {total} 颗</span>
      </div>
      {demand.map((entry) => (
        <div key={entry.pillId} className="notice-board__row">
          <span className="notice-board__name">
            {entry.icon}
            {entry.name}
          </span>
          <span className="notice-board__detail">
            等丹 <strong>{entry.waiting}</strong> 人 · 库存 {entry.stock}
          </span>
          <span className="notice-board__missing">缺少 ×{entry.missing}</span>
          {entry.needsMaster && <span className="notice-board__tag">掌门也在等</span>}
        </div>
      ))}
      <p className="panel__note">
        提示：把丹方排进「炼器 / 炼丹」的批量炼制，或去「工坊」把合成线开起来，都能补上这些缺口。
      </p>
    </div>
  );
}

function TierUpgrade() {
  const game = useGame((s) => s.game);
  const upgradeAlchemy = useGame((s) => s.upgradeAlchemy);
  const status = getAlchemyUpgradeStatus(game);

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          炼丹术 <strong>{tierName(game.alchemyTier)}</strong>
        </span>
        <span className="tier-upgrade__slots">
          丹房 {status.slotsHave}
          {status.nextTier !== null && ` / 下一品需 ${status.slotsNeeded}`}
        </span>
      </div>

      {status.nextTier === null ? (
        <p className="panel__note">炼丹术已至九品，炉火纯青。</p>
      ) : (
        <>
          <div className="tier-upgrade__cost">
            晋升 {tierName(status.nextTier)}：
            <CostList cost={status.cost} state={game} />
          </div>
          <button type="button" className="btn btn--primary btn--wide" disabled={!status.possible} onClick={upgradeAlchemy}>
            精进炼丹术
            {!status.possible && status.reason && <span className="btn__sub">{status.reason}</span>}
          </button>
        </>
      )}
    </div>
  );
}

export function AlchemyPanel() {
  const game = useGame((s) => s.game);
  const craftPill = useGame((s) => s.craftPill);
  // 第 27 轮（需求 3）：自动炼制
  const setAutoCraftTarget = useGame((s) => s.setAutoCraftTarget);

  // 只展示已解锁品阶 + 下一个品阶，避免开局就列出九品丹方
  const visible = PILLS.filter((p) => p.tier <= game.alchemyTier + 1);
  /*
   * 需求 2：丹药按品阶分组、各自可折叠。
   * 高品阶那一组默认收起 —— 玩家关心的是"我现在能炼什么"。
   */
  const byTier = new Map<number, PillDef[]>();
  for (const pill of visible) {
    const list = byTier.get(pill.tier) ?? [];
    list.push(pill);
    byTier.set(pill.tier, list);
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>炼丹</h2>
        <span className="panel__hint">{tierName(game.alchemyTier)}</span>
      </div>

      <TierUpgrade />

      {/* 需求 6：丹房告示栏 —— 谁在等哪一味丹 */}
      <PillNoticeBoard />

      <div className="recipe-list">
        {tiers.map((tier) => (
          <FoldSection
            key={tier}
            title={`${tierName(tier)}丹方`}
            hint={tier > game.alchemyTier ? '尚未掌握' : undefined}
            count={byTier.get(tier)?.length ?? 0}
            storageKey={`pill.tier.${tier}`}
            defaultOpen={tier <= game.alchemyTier}
          >
            {(byTier.get(tier) ?? []).map((pill) => {
              const locked = pill.tier > game.alchemyTier;
              const cost = toCostMap(pill.cost);
                          const max = maxCraftable(game, cost);
  // 第 27 轮（需求 3）：自动炼制这条线的目标存量（> 0 即开着）
  const autoTarget = game.autoCraftTargets[pill.id] ?? 0;
  const autoOn = autoTarget > 0;
              const owned = game.pills[pill.id] ?? 0;
              // 需求 2：炼制有概率失败
              const rate = getCraftSuccessRate(game, 'alchemy', pill.tier);

              return (
                <article key={pill.id} className={locked ? 'recipe recipe--locked' : 'recipe'}>
                  <div className="recipe__head">
                <span className="recipe__icon">{pill.icon}</span>
                <span className="recipe__name">{pill.name}</span>
                <span className={`tier-badge tier-badge--${pill.tier}`}>{TIER_NAMES[pill.tier]}</span>
                <span className={`cat-badge cat-badge--${pill.category}`}>{CATEGORY_LABEL[pill.category]}</span>
                {owned > 0 && <span className="recipe__owned">持有 {fmt(owned, 0)}</span>}
              </div>

              <div className="recipe__desc">{pill.desc}</div>

              {/* 需求 2：炼制有概率失败，把成功率摆在按钮上面 */}
              <div className={rate < 1 ? 'recipe__rate recipe__rate--risk' : 'recipe__rate'}>
                {describeCraftRate(game, 'alchemy', pill.tier)}
              </div>

              <div className="recipe__foot">
                <div className="recipe__cost">
                  <CostList cost={cost} state={game} />
                </div>
                <div className="btn-row">
                {/*
                  * 第 27 轮（需求 3）：玩家原话「炼丹和炼器、制符等也变成
                  * “炼制”“自动炼制”」。所以原来的「炼制 1 / 炼制 10 / 最大」
                  * 三个按钮收成两个，与合成面板同一套交互：
                  *   炼制     = 把当前能炼的全部炼掉（原来那个"最大"）
                  *   自动炼制 = 开关（目标存量 > 0 即开着），引擎按缺口自动补
                  */}
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={locked || max < 1}
                  title={max > 0 ? '当前可炼 ' + max + ' 个' : '材料不足'}
                  onClick={() => craftPill(pill.id, Math.max(1, max))}
                >
                  炼制
                </button>
                <button
                  type="button"
                  className={autoOn ? 'btn btn--primary' : 'btn'}
                  disabled={locked}
                  title={
                    autoOn
                      ? '自动炼制中：低于目标 ' + autoTarget + ' 个就自动补'
                      : '开启后每 2 秒自动炼一批，直到囤够目标'
                  }
                  onClick={() => setAutoCraftTarget(pill.id, autoOn ? 0 : Math.max(10, (game.pills[pill.id] ?? 0) * 2))}
                >
                  自动炼制{autoOn ? ' ✓' : ''}
                </button>
                </div>
              </div>

              {locked && <div className="recipe__lock">需炼丹术 {pill.tier} 品</div>}
                </article>
              );
            })}
          </FoldSection>
        ))}
      </div>
    </section>
  );
}

export default AlchemyPanel;
