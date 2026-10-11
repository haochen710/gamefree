/**
 * 钻研（需求 6）
 *
 * 科技树：基础资源设施之外的所有建筑，都要先钻研出对应技术才能建造。
 * 技术有前置、有境界门槛、有材料消耗，钻研本身还要时间。
 *
 * 图纸（BLUEPRINTS）不在这里 —— 图纸钻研不出来，只能探索或到商行买，
 * 所以只在面板底部给一个「去哪儿找」的提示。
 */
import { fmtDuration } from '../game/decimal';
import { BLUEPRINTS, BUILDABLES, REALMS, TECHS, type TechDef } from '../game/content';
import {
  canStartResearch,
  getResearchProgress,
  getTechCost,
  isTechResearched,
  isTechVisible,
  missingPrereqs,
} from '../game/research';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';
import CostList from './CostList';

/** 该技术解锁了哪些建筑（直接从建筑表反查，避免两处维护） */
function unlockedBuildings(techId: string): string[] {
  return BUILDABLES.filter((def) => def.requiresTech === techId).map((def) => `${def.icon}${def.name}`);
}

function TechRow({ def, state }: { def: TechDef; state: GameState }) {
  const start = useGame((s) => s.startResearch);

  const done = isTechResearched(state, def.id);
  const active = state.research?.id === def.id;
  const check = canStartResearch(state, def.id);
  const missing = missingPrereqs(state, def);
  const unlocks = unlockedBuildings(def.id);

  return (
    <article className={done || active ? 'recipe' : check.ok ? 'recipe' : 'recipe recipe--locked'}>
      <div className="recipe__head">
        <span className="recipe__icon">{def.icon}</span>
        <span className="recipe__name">{def.name}</span>
        <span className="tier-badge">{REALMS[def.requiresRealm].name}</span>
        <span className="tier-badge">{def.seconds} 秒</span>
        {done && <span className="recipe__owned">已掌握</span>}
        {active && <span className="recipe__owned">钻研中…</span>}
      </div>

      <div className="recipe__desc">{def.desc}</div>

      {missing.length > 0 && (
        <div className="recipe__desc">前置：需先钻研「{missing.join('、')}」</div>
      )}

      {unlocks.length > 0 && <div className="recipe__desc">可解锁：{unlocks.join(' ')}</div>}

      <div className="recipe__foot">
        <span className="recipe__cost">
          <CostList cost={getTechCost(def)} state={state} />
        </span>

        {!done && !active && (
          <button type="button" className="btn btn--tiny" disabled={!check.ok} onClick={() => start(def.id)}>
            开始钻研
            {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
          </button>
        )}
      </div>
    </article>
  );
}

export function ResearchPanel() {
  const game = useGame((s) => s.game);
  const cancel = useGame((s) => s.cancelResearch);

  const visible = TECHS.filter((def) => isTechVisible(game, def));
  const done = TECHS.filter((def) => isTechResearched(game, def.id)).length;
  const active = game.research;

  const ownedBlueprints = BLUEPRINTS.filter((bp) => game.blueprints[bp.id] === true);
  const missingBlueprints = BLUEPRINTS.filter((bp) => game.blueprints[bp.id] !== true);

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2>钻研</h2>
          <span className="panel__hint">
            已掌握 {done} / {TECHS.length}
          </span>
        </div>

        <p className="panel__note">
          除基础资源设施外，所有建筑都要先钻研出对应技术。同一时间只能钻研一项，
          改钻研别的技术会放弃当前进度且<strong>材料不退</strong>。
        </p>

        {active && (
          <div className="running">
            <div className="running__head">
              <span>
                {TECHS.find((t) => t.id === active.id)?.icon} 正在钻研：
                {TECHS.find((t) => t.id === active.id)?.name ?? active.id}
              </span>
              <span className="running__time">还需 {fmtDuration(active.remaining)}</span>
            </div>
            <div className="bar">
              <div className="bar__fill" style={{ width: `${Math.round(getResearchProgress(game) * 100)}%` }} />
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn--danger" onClick={cancel}>
                放弃钻研
              </button>
            </div>
          </div>
        )}

        <div className="recipe-list">
          {visible.map((def) => (
            <TechRow key={def.id} def={def} state={game} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>图纸</h2>
          <span className="panel__hint">
            已得 {ownedBlueprints.length} / {BLUEPRINTS.length}
          </span>
        </div>

        <p className="panel__note">
          图纸钻研不出来，只能从秘境探索中寻获，或等商行随机上架。它们解锁的都是
          加成类稀有建筑，不会卡住主线进度。
        </p>

        {missingBlueprints.map((bp) => (
          <div key={bp.id} className="locked-realm">
            <span>
              {bp.icon} {bp.name}
            </span>
            <span className="locked-realm__need">来源：{bp.source}</span>
          </div>
        ))}

        {missingBlueprints.length === 0 && <p className="panel__note">图纸已收集齐全。</p>}

        {ownedBlueprints.map((bp) => (
          <div key={bp.id} className="inv-row">
            <span className="inv-row__icon">{bp.icon}</span>
            <span className="inv-row__name">{bp.name}</span>
            <span className="inv-row__effect">{bp.desc}</span>
          </div>
        ))}
      </section>
    </>
  );
}

export default ResearchPanel;
