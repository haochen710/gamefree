/**
 * 符箓（需求 8）
 *
 * 三类符、各三品：护身符（下一次探索免伤）、聚灵符（限时产量）、破境符（突破成功率）。
 * 都是用掉就没的**消耗品**，由「符房」里的制符产线造出来 ——
 * 制符技能、制符天赋、符房岗位的加成全都作用在这条线上。
 */
import { TALISMAN_GRADE_NAMES, TALISMAN_KIND_NAMES, type TalismanDef } from '../game/content';
import { getCraftSuccessRate } from '../game/crafting';
import {
  canCraftTalisman,
  getTalismanCount,
  getTalismanSlots,
  getTalismanStock,
  getTalismanUpgradeStatus,
  talismansByGrade,
} from '../game/talismans';
import { useGame } from '../game/store';
import CostList from './CostList';
import { toCostMap } from '../game/engine';

function TalismanUpgrade() {
  const game = useGame((s) => s.game);
  const upgrade = useGame((s) => s.upgradeTalisman);
  const status = getTalismanUpgradeStatus(game);

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          制符术 <strong>{game.talismanTier} 品</strong>
        </span>
        <span className="tier-upgrade__slots">
          符房 {getTalismanSlots(game)}
          {status.nextTier !== null && ` / 下一品需 ${status.slotsNeeded}`}
        </span>
      </div>
      {status.nextTier === null ? (
        <p className="panel__note">制符术已至九品。</p>
      ) : (
        <>
          <div className="tier-upgrade__cost">
            晋升 {status.nextTier} 品：
            <CostList cost={toCostMap(status.cost as never)} state={game} />
          </div>
          <button type="button" className="btn btn--primary btn--wide" disabled={!status.possible} onClick={upgrade}>
            精进制符术
            {!status.possible && status.reason && <span className="btn__sub">{status.reason}</span>}
          </button>
        </>
      )}
    </div>
  );
}

function TalismanRow({ def }: { def: TalismanDef }) {
  const game = useGame((s) => s.game);
  const craft = useGame((s) => s.craftTalisman);
  const use = useGame((s) => s.useTalisman);

  const owned = getTalismanCount(game, def.id);
  const rate = getCraftSuccessRate(game, 'talisman', def.grade);
  const check = canCraftTalisman(game, def.id);

  return (
    <article className={def.grade >= 3 ? 'recipe recipe--rare' : 'recipe'}>
      <div className="recipe__head">
        <span className="recipe__icon">{def.icon}</span>
        <span className="recipe__name">{def.name}</span>
        <span className="tier-badge">{TALISMAN_GRADE_NAMES[def.grade]}</span>
        <span className="cat-badge">{TALISMAN_KIND_NAMES[def.kind]}</span>
        {owned > 0 && <span className="recipe__owned">存 {owned} 张</span>}
      </div>
      <div className="recipe__desc">{def.desc}</div>
      <div className={rate < 1 ? 'recipe__rate recipe__rate--risk' : 'recipe__rate'}>
        成功率 {Math.round(rate * 100)}%（失败照样消耗材料）
      </div>
      <div className="recipe__foot">
        <div className="recipe__cost">
          <CostList cost={toCostMap(def.cost as never)} state={game} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn--tiny" disabled={!check.ok} title={check.reason ?? ''} onClick={() => craft(def.id, 1)}>
            画一张
          </button>
          <button type="button" className="btn btn--tiny" disabled={!check.ok} title={check.reason ?? ''} onClick={() => craft(def.id, 10)}>
            画十张
          </button>
          <button type="button" className="btn" disabled={owned <= 0} onClick={() => use(def.id)}>
            用一张
          </button>
        </div>
      </div>
    </article>
  );
}

export function TalismanPanel() {
  const game = useGame((s) => s.game);
  const stock = getTalismanStock(game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>符箓</h2>
        <span className="panel__hint">存货 {stock.reduce((sum, e) => sum + e.count, 0)} 张</span>
      </div>

      <p className="panel__note">
        符箓是<strong>消耗品</strong>：护身符替你挡下一次探索的伤亡，聚灵符限时抬高产量，
        破境符直接加掌门突破成功率。三种都靠<strong>符房</strong>里的制符产线画出来 ——
        制符技艺、制符天赋与符房岗位都会提高成功率。
      </p>

      <TalismanUpgrade />

      {stock.length > 0 && (
        <div className="inv-list">
          <p className="panel__note">当前存货：</p>
          {stock.map(({ def, count }) => (
            <div key={def.id} className="inv-row">
              <span className="inv-row__name">
                {def.icon}
                {def.name}
              </span>
              <span className="inv-row__count">×{count}</span>
              <span className="inv-row__effect">{def.desc}</span>
            </div>
          ))}
        </div>
      )}

      <div className="recipe-list">
        {talismansByGrade().map((band) => (
          <div key={band.grade}>
            <h3 className="panel__subtitle">
              {band.name}符箓
              {band.grade > game.talismanTier && <span className="panel__hint">（尚未掌握）</span>}
            </h3>
            {band.list.map((def) => (
              <TalismanRow key={def.id} def={def} />
            ))}
          </div>
        ))}
      </div>

      <p className="panel__note">
        材料里的灵蚕丝与妖丹来自秘境探索，灵气直接扣。想稳定产符：先盖<strong>符房</strong>，
        再把有<strong>制符天赋</strong>的弟子派进去 —— 他们的制符技艺越高，成功率越高
        （见「宗门 → 派遣与技艺」）。
      </p>
    </section>
  );
}

export default TalismanPanel;
