/** 宗门记事：突破、陨落、秘境收获等事件流 */
import { fmtDuration } from '../game/decimal';
import { useGame } from '../game/store';

export function JournalPanel() {
  const game = useGame((s) => s.game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>宗门记事</h2>
        <span className="panel__hint">最近 {game.journal.length} 条</span>
      </div>

      {game.journal.length === 0 && <p className="panel__note">暂无记事。</p>}

      <ul className="journal">
        {game.journal.map((entry, index) => (
          <li key={`${entry.time}-${index}`} className={`journal__item journal__item--${entry.kind}`}>
            <span className="journal__time">{fmtDuration(entry.time)}</span>
            <span className="journal__text">{entry.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default JournalPanel;
