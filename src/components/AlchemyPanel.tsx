/**
 * 炼丹面板（需求 2 / 5）
 *
 * 丹方按品阶展示，未解锁的品阶也列出来（灰掉并说明差在哪）——
 * 让玩家一眼看到"再盖两座丹房就能炼三品丹"这种目标。
 */
import { fmt } from '../game/decimal';
import { PILLS, TIER_NAMES, tierName, type PillDef } from '../game/content';
import { canAfford, toCostMap } from '../game/engine';
import { canCraftPill, describeCraftRate, getAlchemyUpgradeStatus, getCraftSuccessRate, maxCraftable } from '../game/crafting';
import { useGame } from '../game/store';
import { FoldSection } from './fold';
import CostList from './CostList';

const CATEGORY_LABEL: Record<PillDef['category'], string> = {
  breakthrough: '境界',
  support: '辅助',
  combat: '战斗',
};

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
              const check = canCraftPill(game, pill.id);
              const max = maxCraftable(game, cost);
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
                  <button
                    type="button"
                    className="btn"
                    disabled={locked || !check.ok || !canAfford(game, cost)}
                    onClick={() => craftPill(pill.id, 1)}
                  >
                    炼制
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={locked || max < 10}
                    onClick={() => craftPill(pill.id, 10)}
                  >
                    炼制 10
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={locked || max < 1}
                    onClick={() => craftPill(pill.id, max)}
                  >
                    最大 {max > 0 ? `(${max})` : ''}
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
