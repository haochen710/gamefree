/**
 * 仆役面板
 *
 * 仆人从开局就能招收（住在茅屋里），可以被派去挖矿、采药、伐木等，
 * 给对应资源提供产量加成。
 *
 * 关键取舍：**仆人与弟子共用居所名额**（见 engine.getDiscipleCapacity）。
 * 前期名额全给仆人换产量；开宗之后就得决定要不要腾房间收弟子。
 */
import { fmt } from '../game/decimal';
import { RESOURCE_MAP, SERVANT_BONUS_PER_HEAD, SERVANT_JOBS } from '../game/content';
import {
  canRecruitServant,
  getFreeHousing,
  getHousingCapacity,
  getServantBonus,
  getServantCost,
  getServantCapacity,
  getServantCount,
} from '../game/engine';
import { useGame } from '../game/store';

export function ServantPanel() {
  const game = useGame((s) => s.game);
  const recruitServant = useGame((s) => s.recruitServant);
  const assignServant = useGame((s) => s.assignServant);
  const dismissServant = useGame((s) => s.dismissServant);
  const dismissAllServants = useGame((s) => s.dismissAllServants);

  const total = getServantCount(game);
  const capacity = getServantCapacity(game);
  const housing = getHousingCapacity(game);
  const free = getFreeHousing(game);
  const cost = getServantCost(game);
  const check = canRecruitServant(game);

  // 还没盖任何居所时，这个面板没意义（避免开局就抛出一堆看不懂的东西）
  if (housing === 0) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>仆役</h2>
          <span className="panel__hint">尚未开辟居所</span>
        </div>
        <p className="panel__note">
          先在「洞府建设 → 弟子居所」建造一座 <strong>茅屋</strong>，
          就可以招收凡人仆役，派他们去伐木、挖矿、采药，为洞府出力。
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>仆役</h2>
        <span className="panel__hint">
          {total} / {capacity} 人 · 空余居所 {free}
        </span>
      </div>

      <p className="panel__note">
        每名仆人给对应资源提供 <strong>+{Math.round(SERVANT_BONUS_PER_HEAD * 100)}%</strong> 产量。
        仆人与弟子<strong>共用居所名额</strong>
        {game.sect.founded && ' —— 想多收弟子，就得先遣散一部分仆人'}。
      </p>

      <div className="servant-list">
        {SERVANT_JOBS.map((job) => {
          const count = game.servants[job.id] ?? 0;
          const target = RESOURCE_MAP[job.resource];
          const bonus = getServantBonus(game, job.resource);

          return (
            <div key={job.id} className="servant">
              <div className="servant__main">
                <span className="servant__icon">{job.icon}</span>
                <div className="servant__text">
                  <div className="servant__title">
                    <span className="servant__name">{job.name}</span>
                    <span className="servant__count">×{count}</span>
                    {count > 0 && (
                      <span className="servant__bonus">
                        {target.icon} +{Math.round(bonus * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="servant__desc">{job.desc}</div>
                </div>
              </div>

              <div className="servant__actions">
                <button
                  type="button"
                  className="btn btn--tiny"
                  disabled={count <= 0}
                  onClick={() => dismissServant(job.id)}
                  title="遣散一名，腾出居所"
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn btn--tiny"
                  disabled={!check.ok}
                  onClick={() => recruitServant(job.id)}
                  title={check.ok ? `招收一名（☯${fmt(cost)}）` : check.reason ?? ''}
                >
                  ＋
                </button>
                <select
                  className="servant__move"
                  value=""
                  disabled={count <= 0}
                  onChange={(e) => {
                    if (e.target.value) assignServant(job.id, e.target.value);
                  }}
                  title="调派一名到别的岗位"
                >
                  <option value="">调派…</option>
                  {SERVANT_JOBS.filter((other) => other.id !== job.id).map((other) => (
                    <option key={other.id} value={other.id}>
                      → {other.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="btn-row btn-row--wrap">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!check.ok}
          onClick={() => recruitServant('chores')}
        >
          招收仆人 ☯{fmt(cost)}
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
        </button>
        {total > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (window.confirm(`确定遣散全部 ${total} 名仆人？腾出的居所可以留给弟子。`)) {
                dismissAllServants();
              }
            }}
          >
            全部遣散
          </button>
        )}
      </div>
    </section>
  );
}

export default ServantPanel;
