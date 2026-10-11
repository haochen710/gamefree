/** 离线结算弹窗：回到游戏时告诉你闭关期间发生了什么 */
import { fmt, fmtDuration } from '../game/decimal';
import { ITEM_MAP } from '../game/content';
import { OFFLINE_EFFICIENCY } from '../game/save';
import { useGame } from '../game/store';

export function OfflineModal() {
  const offline = useGame((s) => s.offline);
  const dismiss = useGame((s) => s.dismissOffline);

  if (!offline) return null;

  const hasGains = offline.gains.length > 0 || offline.materialGains.length > 0 || offline.pillGains.length > 0;

  return (
    <div className="modal-mask" role="dialog" aria-modal="true">
      <div className="modal">
        <h2 className="modal__title">闭关归来</h2>
        <p className="modal__text">
          你已闭关 <strong>{fmtDuration(offline.seconds)}</strong>，洞府自行运转，
          以 {Math.round(OFFLINE_EFFICIENCY * 100)}% 的效率积累了以下收获：
        </p>

        {!hasGains && <p className="modal__text">闭关期间并无所获……先去建造些设施吧。</p>}

        {offline.gains.length > 0 && (
          <ul className="modal__list">
            {offline.gains.map((entry) => (
              <li key={entry.id}>
                <span className="modal__icon">{ITEM_MAP[entry.id].icon}</span>
                {ITEM_MAP[entry.id].name}
                <strong> +{fmt(entry.amount)}</strong>
              </li>
            ))}
          </ul>
        )}

        {offline.materialGains.length > 0 && (
          <ul className="modal__list modal__list--material">
            {offline.materialGains.map((entry) => (
              <li key={entry.id}>
                <span className="modal__icon">{ITEM_MAP[entry.id].icon}</span>
                {ITEM_MAP[entry.id].name}
                <strong> +{fmt(entry.amount)}</strong>
              </li>
            ))}
          </ul>
        )}

        {offline.pillGains.length > 0 && (
          <ul className="modal__list modal__list--pill">
            {offline.pillGains.map((entry) => (
              <li key={entry.id}>
                <span className="modal__icon">{entry.icon}</span>
                {entry.name}
                <strong> +{entry.amount}</strong>
              </li>
            ))}
          </ul>
        )}

        {offline.journal.length > 0 && (
          <div className="modal__journal">
            <div className="modal__journal-title">闭关期间记事</div>
            <ul className="journal journal--compact">
              {offline.journal.slice(0, 6).map((entry, index) => (
                <li key={index} className={`journal__item journal__item--${entry.kind}`}>
                  <span className="journal__text">{entry.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="modal__footnote">
          离线收益最多累计 8 小时；弟子修炼与增益计时同样按 {Math.round(OFFLINE_EFFICIENCY * 100)}% 推进。
        </p>

        <button type="button" className="btn btn--primary btn--wide" onClick={dismiss}>
          出关
        </button>
      </div>
    </div>
  );
}

export default OfflineModal;
