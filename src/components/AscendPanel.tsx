/** 飞升：重置修行，换取跨世保留的「道韵」 */
import { fmt } from '../game/decimal';
import { DAO_YUN_BONUS, REALMS, SECT_LEVELS } from '../game/content';
import { canAscend, getDaoYunGain, getDaoYunMultiplier } from '../game/engine';
import { useGame } from '../game/store';

export function AscendPanel() {
  const game = useGame((s) => s.game);
  const ascend = useGame((s) => s.ascend);

  const minRealm = SECT_LEVELS[0].requiresRealm;
  const unlocked = game.realmIndex >= minRealm;
  const gain = getDaoYunGain(game);
  const possible = canAscend(game);
  const multiplier = getDaoYunMultiplier(game);

  const handleAscend = () => {
    if (!possible) return;
    const discipleNote =
      game.sect.disciples.length > 0
        ? `\n\n注意：宗门与 ${game.sect.disciples.length} 名弟子将一并遣散。`
        : '';
    const ok = window.confirm(
      `确定飞升？\n\n` +
        `所有设施、建筑、境界、资源、宗门都将重置，换取 ${fmt(gain)} 点道韵。\n` +
        `道韵永久保留，当前道韵加成：×${fmt(multiplier)}${discipleNote}`,
    );
    if (ok) ascend();
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>飞升</h2>
        <span className="panel__hint">转世重修</span>
      </div>

      {!unlocked ? (
        <p className="panel__note">
          修至 <strong>{REALMS[minRealm].name}</strong> 方可感应天劫、举霞飞升。
          当前境界：{REALMS[game.realmIndex].name}。
        </p>
      ) : (
        <>
          <div className="ascend__gain">
            本次飞升可得 <strong>{fmt(gain)}</strong> 点道韵
          </div>
          <p className="panel__note">
            每点道韵永久提供 +{Math.round(DAO_YUN_BONUS * 100)}% 全局产量，当前 ×{fmt(multiplier)}。
            飞升会重置设施、资源、境界与宗门，但道韵与历世修为保留。
          </p>
          <button type="button" className="btn btn--danger btn--wide" disabled={!possible} onClick={handleAscend}>
            举霞飞升
          </button>
        </>
      )}
    </section>
  );
}

export default AscendPanel;
