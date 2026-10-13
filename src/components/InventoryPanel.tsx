/**
 * 库房面板（需求 3）
 *
 * 需求原文：
 *   「炼丹界面有丹药库，炼器界面为啥还叫丹药库，而且符箓为啥没有对应的库房」
 *
 * 所以原来是**同一个面板被三个页签复用**，标题写死了"丹药库"：
 *   - 炼丹页：该看丹药 → 「丹药库」；
 *   - 炼器页：该看器物与弟子装备 → 「器物库」；
 *   - 符箓页：该看符箓 → 「符箓库」（原先根本没有）。
 * 现在用 `mode` 决定标题与内容，三处各自对得上。
 *
 * ⚠️ 生效中的增益（丹药 buff）在三个页签里都保留 —— 它是"当前状态"，
 * 任何一页看不到都会让玩家以为增益消失了。
 */
import { ARTIFACT_MAP, PILLS, TALISMANS, TIER_NAMES, tierName } from '../game/content';
import { canUsePill } from '../game/crafting';
import { getTalismanCount } from '../game/talismans';
import { useGame } from '../game/store';
import type { ActiveBuffs } from '../game/content';

/** 这个库房是给哪一页看的 */
export type InventoryMode = 'pills' | 'artifacts' | 'talismans';

const MODE_TITLE: Record<InventoryMode, string> = {
  pills: '丹药库',
  artifacts: '器物库',
  talismans: '符箓库',
};

const MODE_HINT: Record<InventoryMode, string> = {
  pills: '丹药库存与生效中增益',
  artifacts: '器物与弟子装备库存',
  talismans: '符箓库存与生效中增益',
};

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
  if (buffs.safetyOnce) {
    // 一次性减伤不受倒计时管，所以单独说清楚"下一次探索"
    rows.push({ label: '下次探索伤亡', value: `-${Math.round(buffs.safetyReduction * 100)}%`, seconds: -1 });
  } else if (buffs.safetySeconds > 0) {
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

  if (rows.length === 0) return <p className="panel__note">当前没有生效中的增益。</p>;

  return (
    <div className="buff-list">
      {rows.map((row) => (
        <div key={row.label} className="buff">
          <span className="buff__label">{row.label}</span>
          <span className="buff__value">{row.value}</span>
          <span className="buff__time">{row.seconds < 0 ? '一次' : fmtSeconds(row.seconds)}</span>
        </div>
      ))}
    </div>
  );
}

/** 丹药那一块（炼丹页） */
function PillStock() {
  const game = useGame((s) => s.game);
  const usePill = useGame((s) => s.usePill);
  const held = PILLS.filter((p) => (game.pills[p.id] ?? 0) > 0);

  return (
    <>
      <div className="panel__head panel__head--sub">
        <h2>持有丹药</h2>
        <span className="panel__hint">{held.length} 种</span>
      </div>
      {held.length === 0 && <p className="panel__note">药架上空空如也。</p>}
      {held.map((pill) => {
        const check = canUsePill(game, pill.id);
        return (
          <div key={pill.id} className="inv-row inv-row--wrap">
            <span className="inv-row__icon">{pill.icon}</span>
            <span className="inv-row__name">{pill.name}</span>
            <span className="inv-row__count">×{game.pills[pill.id] ?? 0}</span>
            <span className="inv-row__effect">
              {tierName(pill.tier)}
              {pill.tier <= 9 ? ` · ${TIER_NAMES[pill.tier] ?? ''}` : ''}
            </span>
            <button type="button" className="btn btn--tiny" disabled={!check.ok} title={check.reason ?? ''} onClick={() => usePill(pill.id)}>
              服用
            </button>
          </div>
        );
      })}
    </>
  );
}

/** 器物那一块（炼器页） */
function ArtifactStock() {
  const game = useGame((s) => s.game);
  const held = Object.entries(game.artifacts).filter(([, count]) => (count ?? 0) > 0);

  return (
    <>
      <div className="panel__head panel__head--sub">
        <h2>持有器物</h2>
        <span className="panel__hint">{held.length} 种</span>
      </div>
      {held.length === 0 && <p className="panel__note">还没有炼出任何器物。</p>}
      {held.map(([id, count]) => (
        <div key={id} className="inv-row inv-row--wrap">
          <span className="inv-row__icon">{ARTIFACT_MAP[id]?.icon ?? '⚙'}</span>
          <span className="inv-row__name">{ARTIFACT_MAP[id]?.name ?? id}</span>
          <span className="inv-row__count">×{count}</span>
          <span className="inv-row__effect">{ARTIFACT_MAP[id]?.desc ?? ''}</span>
        </div>
      ))}
    </>
  );
}

/** 符箓那一块（符箓页，需求 3） */
function TalismanStock() {
  const game = useGame((s) => s.game);
  const held = TALISMANS.filter((def) => getTalismanCount(game, def.id) > 0);

  return (
    <>
      <div className="panel__head panel__head--sub">
        <h2>持有符箓</h2>
        <span className="panel__hint">{held.length} 种</span>
      </div>
      {held.length === 0 && <p className="panel__note">符袋是空的 —— 去符房画几张。</p>}
      {held.map((def) => (
        <div key={def.id} className="inv-row inv-row--wrap">
          <span className="inv-row__icon">{def.icon}</span>
          <span className="inv-row__name">{def.name}</span>
          <span className="inv-row__count">×{getTalismanCount(game, def.id)}</span>
          <span className="inv-row__effect">{def.desc}</span>
        </div>
      ))}
    </>
  );
}

export function InventoryPanel({ mode = 'pills' }: { mode?: InventoryMode } = {}) {
  const game = useGame((s) => s.game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{MODE_TITLE[mode]}</h2>
        <span className="panel__hint">{MODE_HINT[mode]}</span>
      </div>

      <ActiveBuffList buffs={game.buffs} />

      {mode === 'pills' && <PillStock />}
      {mode === 'artifacts' && <ArtifactStock />}
      {mode === 'talismans' && <TalismanStock />}
    </section>
  );
}

export default InventoryPanel;
