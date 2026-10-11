/**
 * 炼器面板（需求 2）
 *
 * 器物加成有一条重要限制：每件器物最多只有「弟子人数」份生效
 * （相当于每名弟子只能持有一件），界面上要写清楚，
 * 否则玩家会以为造几百把铁剑能把战力堆上天。
 */
import { fmt } from '../game/decimal';
import { ARTIFACTS, TIER_NAMES, tierName } from '../game/content';
import { toCostMap } from '../game/engine';
import {
  canCraftArtifact,
  describeCraftRate,
  getCraftSuccessRate,
  getRefiningUpgradeStatus,
  maxCraftable,
} from '../game/crafting';
import { getGearCharges } from '../game/engine';
import { useGame } from '../game/store';
import CostList from './CostList';

function TierUpgrade() {
  const game = useGame((s) => s.game);
  const upgradeRefining = useGame((s) => s.upgradeRefining);
  const status = getRefiningUpgradeStatus(game);

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          炼器术 <strong>{tierName(game.refiningTier)}</strong>
        </span>
        <span className="tier-upgrade__slots">
          炼器房 {status.slotsHave}
          {status.nextTier !== null && ` / 下一品需 ${status.slotsNeeded}`}
        </span>
      </div>

      {status.nextTier === null ? (
        <p className="panel__note">炼器术已至九品。</p>
      ) : (
        <>
          <div className="tier-upgrade__cost">
            晋升 {tierName(status.nextTier)}：
            <CostList cost={status.cost} state={game} />
          </div>
          <button type="button" className="btn btn--primary btn--wide" disabled={!status.possible} onClick={upgradeRefining}>
            精进炼器术
            {!status.possible && status.reason && <span className="btn__sub">{status.reason}</span>}
          </button>
        </>
      )}
    </div>
  );
}

export function RefiningPanel() {
  const game = useGame((s) => s.game);
  const craftArtifact = useGame((s) => s.craftArtifact);

  const holders = Math.max(1, game.sect.disciples.length);
  const visible = ARTIFACTS.filter((a) => a.tier <= game.refiningTier + 1);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>炼器</h2>
        <span className="panel__hint">{tierName(game.refiningTier)}</span>
      </div>

      <TierUpgrade />

      <p className="panel__note">
        器物加成按「生效件数 = min(持有数, 弟子数)」计算，当前最多 {holders} 件生效。
        想靠器物变强，弟子数量也得跟上。
      </p>

      <div className="recipe-list">
        {visible.map((artifact) => {
          const locked = artifact.tier > game.refiningTier;
          const cost = toCostMap(artifact.cost);
          const check = canCraftArtifact(game, artifact.id);
          const max = maxCraftable(game, cost);
          const owned = game.artifacts[artifact.id] ?? 0;
          const effective = Math.min(owned, holders);
          // 需求 2：炼制有概率失败；可携带器物还要显示剩余次数
          const rate = getCraftSuccessRate(game, 'refining', artifact.tier);
          const charges = artifact.carry ? getGearCharges(game, artifact) : null;

          return (
            <article key={artifact.id} className={locked ? 'recipe recipe--locked' : 'recipe'}>
              <div className="recipe__head">
                <span className="recipe__icon">{artifact.icon}</span>
                <span className="recipe__name">{artifact.name}</span>
                <span className={`tier-badge tier-badge--${artifact.tier}`}>{TIER_NAMES[artifact.tier]}</span>
                <span className={`cat-badge cat-badge--${artifact.category}`}>
                  {artifact.category === 'combat' ? '战斗' : '辅助'}
                </span>
                {owned > 0 && (
                  <span className="recipe__owned">
                    持有 {fmt(owned, 0)} · 生效 {effective}
                  </span>
                )}
                {/* 需求 2：可携带器物会随探索磨损，用完即毁 */}
                {charges !== null && (
                  <span className={charges > 0 ? 'gear-badge' : 'gear-badge gear-badge--broken'}>
                    🎒 可携带 · 剩 {charges}/{artifact.carry?.charges} 次
                    {charges <= 0 && '（已损毁，需重炼）'}
                  </span>
                )}
              </div>

              <div className={rate < 1 ? 'recipe__rate recipe__rate--risk' : 'recipe__rate'}>
                {describeCraftRate(game, 'refining', artifact.tier)}
                {artifact.carry && ` · 每探索一次磨损 1 次`}
              </div>

              <div className="recipe__desc">{artifact.desc}</div>

              <div className="recipe__foot">
                <div className="recipe__cost">
                  <CostList cost={cost} state={game} />
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={locked || !check.ok}
                    onClick={() => craftArtifact(artifact.id, 1)}
                  >
                    炼制
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={locked || max < 1}
                    onClick={() => craftArtifact(artifact.id, max)}
                  >
                    最大 {max > 0 ? `(${max})` : ''}
                  </button>
                </div>
              </div>

              {locked && <div className="recipe__lock">需炼器术 {artifact.tier} 品</div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default RefiningPanel;
