/** 丹药库存与当前增益 */
import { fmt } from '../game/decimal';
import { ARTIFACT_MAP, PILLS, PILL_MAP, TIER_NAMES, tierName } from '../game/content';
import { canUsePill } from '../game/crafting';
import { useGame } from '../game/store';
import type { ActiveBuffs } from '../game/content';

function fmtSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  return `${Math.ceil(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
}

/** 当前生效的增益（只列出真正大于 1 / 大于 0 的项） */
function ActiveBuffList({ buffs }: { buffs: ActiveBuffs }) {
  const rows: { label: string; value: string; seconds: number }[] = [];

  if (buffs.productionSeconds > 0) {
    rows.push({
      label: '全局产量',
      value: `×${buffs.productionMultiplier}`,
      seconds: buffs.productionSeconds,
    });
  }
  if (buffs.powerSeconds > 0) {
    rows.push({ label: '弟子战力', value: `×${buffs.powerMultiplier}`, seconds: buffs.powerSeconds });
  }
  if (buffs.safetySeconds > 0) {
    rows.push({
      label: '伤亡减免',
      value: `-${Math.round(buffs.safetyReduction * 100)}%`,
      seconds: buffs.safetySeconds,
    });
  }
  if (buffs.yieldSeconds > 0) {
    rows.push({ label: '秘境产出', value: `×${buffs.yieldMultiplier}`, seconds: buffs.yieldSeconds });
  }
  if (buffs.speedSeconds > 0) {
    rows.push({ label: '探索速度', value: `×${buffs.speedMultiplier}`, seconds: buffs.speedSeconds });
  }

  if (rows.length === 0) return <p className="panel__note">当前没有生效中的丹药增益。</p>;

  return (
    <div className="buff-list">
      {rows.map((row) => (
        <div key={row.label} className="buff">
          <span className="buff__label">{row.label}</span>
          <span className="buff__value">{row.value}</span>
          <span className="buff__time">{fmtSeconds(row.seconds)}</span>
        </div>
      ))}
    </div>
  );
}

export function InventoryPanel() {
  const game = useGame((s) => s.game);
  const usePill = useGame((s) => s.usePill);

  const held = PILLS.filter((p) => (game.pills[p.id] ?? 0) > 0);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>丹药库</h2>
        <span className="panel__hint">生效中增益</span>
      </div>

      <ActiveBuffList buffs={game.buffs} />

      <div className="panel__head panel__head--sub">
        <h2>持有丹药</h2>
        <span className="panel__hint">{held.length} 种</span>
      </div>

      {held.length === 0 && <p className="panel__note">尚无存丹。到「炼丹」面板炼制。</p>}

      {held.map((pill) => {
        const count = game.pills[pill.id] ?? 0;
        const def = PILL_MAP[pill.id] ?? pill;
        const usable = pill.category !== 'breakthrough';
        const check = canUsePill(game, pill.id);

        return (
          <div key={pill.id} className="inv-row">
            <span className="inv-row__icon">{pill.icon}</span>
            <span className="inv-row__name">{pill.name}</span>
            <span className={`tier-badge tier-badge--${pill.tier}`}>{TIER_NAMES[pill.tier]}</span>
            <span className="inv-row__count">×{fmt(count, 0)}</span>
            <button
              type="button"
              className="btn btn--tiny"
              disabled={!usable || !check.ok}
              onClick={() => usePill(pill.id)}
              title={usable ? def.desc : '该丹药只能在突破时服用'}
            >
              {usable ? '服用' : '突破用'}
            </button>
          </div>
        );
      })}

      {Object.entries(game.artifacts).filter(([, count]) => count > 0).length > 0 && (
        <>
          <div className="panel__head panel__head--sub">
            <h2>持有器物</h2>
            <span className="panel__hint">自动生效</span>
          </div>
          {Object.entries(game.artifacts)
            .filter(([, count]) => count > 0)
            .map(([id, count]) => {
              const artifact = ARTIFACT_MAP[id];
              return (
                <div key={id} className="inv-row">
                  <span className="inv-row__icon">{artifact?.icon ?? '🔨'}</span>
                  <span className="inv-row__name">{artifact?.name ?? id}</span>
                  {artifact && <span className={`tier-badge tier-badge--${artifact.tier}`}>{TIER_NAMES[artifact.tier]}</span>}
                  <span className="inv-row__count">×{fmt(count, 0)}</span>
                  <span className="inv-row__effect">{artifact?.desc ?? ''}</span>
                </div>
              );
            })}
        </>
      )}

      <p className="panel__note">
        当前炼丹术 {tierName(game.alchemyTier)}，炼器术 {tierName(game.refiningTier)}。
      </p>
    </section>
  );
}

export default InventoryPanel;
