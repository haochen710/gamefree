/** 离线结算弹窗：回到游戏时告诉你闭关期间攒了多少 */
import { fmt, fmtDuration } from '../game/decimal';
import { RESOURCES } from '../game/content';
import { OFFLINE_EFFICIENCY } from '../game/save';
import { useGame } from '../game/store';

export function OfflineModal() {
  const offline = useGame((s) => s.offline);
  const dismiss = useGame((s) => s.dismissOffline);

  if (!offline) return null;

  const gains = RESOURCES.filter((r) => offline.gains[r.id].gt(0));

  return (
    <div className="modal-mask" role="dialog" aria-modal="true">
      <div className="modal">
        <h2 className="modal__title">闭关归来</h2>
        <p className="modal__text">
          你已闭关 <strong>{fmtDuration(offline.seconds)}</strong>，洞府自行运转，
          以 {Math.round(OFFLINE_EFFICIENCY * 100)}% 的效率积累了以下资源：
        </p>

        <ul className="modal__list">
          {gains.length === 0 && <li>闭关期间并无所获……先去建造些设施吧。</li>}
          {gains.map((r) => (
            <li key={r.id}>
              <span className="modal__icon">{r.icon}</span>
              {r.name}
              <strong> +{fmt(offline.gains[r.id])}</strong>
            </li>
          ))}
        </ul>

        <p className="modal__footnote">离线收益最多累计 8 小时。</p>

        <button type="button" className="btn btn--primary btn--wide" onClick={dismiss}>
          出关
        </button>
      </div>
    </div>
  );
}

export default OfflineModal;
