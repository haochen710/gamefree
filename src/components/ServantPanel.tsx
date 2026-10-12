/**
 * 仆役面板
 *
 * 仆人从开局就能招收（住**仆役居所**），可以被派去挖矿、采药、伐木等，
 * 给对应资源提供产量加成。
 *
 * ⚠️ 本轮需求 2 改了这里的一条根本规则：**仆役居所与弟子居所是分开的**。
 * 早先仆人和弟子抢同一批床位（`居所 - 仆人数` 才是弟子容量），
 * 于是"多养仆人换产量"必然意味着"少收弟子换战力" —— 一道零和题。
 * 现在两边各自盖各自的房子，取舍从"抢床位"变成"资源先投哪一边"。
 *
 * 另一个容易坑到玩家的交互在这里也修过（见下）：每行只有一对「− / ＋」时，
 * 「−」调的是 `dismissServant`，也就是**真正把人遣散**。玩家想的是"换个岗位"，
 * 于是点一下少一个人、还得重新招。现在的规则是：
 *   ＋ 招收  → 往这个岗位加一名（总人数 +1，要花灵气）
 *   调往…   → 从这岗位调一名去别处（**总人数不变**，免费）
 *   遣散    → 真正少一名（明确文字 + 二次确认）
 *
 * 本轮需求 4 又加了一行「批量调动」：一次把 N 名仆人从 A 岗位搬到 B 岗位。
 * 后期几十上百个仆人时，逐个点「调往…」是不可用的。
 */
import { useState } from 'react';
import { fmt } from '../game/decimal';
import { RESOURCE_MAP, SERVANT_BONUS_PER_HEAD, SERVANT_JOBS } from '../game/content';
import {
  canRecruitServant,
  getFreeServantHousing,
  getServantBonus,
  getServantCapacity,
  getServantCost,
  getServantCount,
  getServantHousing,
} from '../game/engine';
import { useGame } from '../game/store';

/** 需求 4：批量调动 —— 源岗位 → 目标岗位 + 人数 */
function BulkTransfer() {
  const game = useGame((s) => s.game);
  const assignServants = useGame((s) => s.assignServants);
  const total = getServantCount(game);

  const firstWithPeople = SERVANT_JOBS.find((job) => (game.servants[job.id] ?? 0) > 0) ?? SERVANT_JOBS[0];
  const [from, setFrom] = useState(firstWithPeople.id);
  const [to, setTo] = useState(SERVANT_JOBS.find((job) => job.id !== firstWithPeople.id)!.id);
  const [count, setCount] = useState(1);

  if (total === 0) return null;

  const available = game.servants[from] ?? 0;
  const targets = SERVANT_JOBS.filter((job) => job.id !== from);

  return (
    <div className="bulk-transfer">
      <div className="bulk-transfer__head">
        <strong>批量调动</strong>
        <span className="panel__hint">总人数不变、不花灵气 —— 只是换个岗位</span>
      </div>
      <div className="bulk-transfer__row">
        <select value={from} onChange={(e) => setFrom(e.target.value as typeof from)} title="从哪个岗位调出">
          {SERVANT_JOBS.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}（{game.servants[job.id] ?? 0} 人）
            </option>
          ))}
        </select>
        <span className="bulk-transfer__arrow">→</span>
        <select
          value={targets.some((job) => job.id === to) ? to : targets[0].id}
          onChange={(e) => setTo(e.target.value as typeof to)}
          title="调到哪个岗位"
        >
          {targets.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}（{game.servants[job.id] ?? 0} 人）
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={Math.max(1, available)}
          step={1}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          title={`最多 ${available} 人`}
        />
        <button
          type="button"
          className="btn btn--tiny"
          disabled={available <= 0}
          onClick={() => assignServants(from, targets.some((job) => job.id === to) ? to : targets[0].id, count)}
        >
          调动
        </button>
        <button
          type="button"
          className="btn btn--tiny"
          disabled={available <= 0}
          onClick={() => assignServants(from, targets.some((job) => job.id === to) ? to : targets[0].id, available)}
          title="把这个岗位的人全部搬过去"
        >
          全部调走（{available}）
        </button>
      </div>
    </div>
  );
}

export function ServantPanel() {
  const game = useGame((s) => s.game);
  const recruitServant = useGame((s) => s.recruitServant);
  const assignServant = useGame((s) => s.assignServant);
  const dismissServant = useGame((s) => s.dismissServant);
  const dismissAllServants = useGame((s) => s.dismissAllServants);

  const total = getServantCount(game);
  const capacity = getServantCapacity(game);
  const housing = getServantHousing(game);
  const free = getFreeServantHousing(game);
  const cost = getServantCost(game);
  const check = canRecruitServant(game);

  // 还没盖任何仆役居所时，这个面板没意义（避免开局就抛出一堆看不懂的东西）
  if (housing === 0) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>仆役</h2>
          <span className="panel__hint">尚未开辟居所</span>
        </div>
        <p className="panel__note">
          先在「建筑」页的<strong>仆役居所</strong>一组里建一座 <strong>茅屋</strong>，
          就可以招收凡人仆役，派他们去伐木、挖矿、采药，为洞府出力。
          （弟子住的是另一条线 —— <strong>弟子居所</strong>，开宗之后才能建。）
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>仆役</h2>
        <span className="panel__hint">
          {total} / {capacity} 人 · 空余床位 {free}
        </span>
      </div>

      <p className="panel__note">
        每名仆人给对应资源提供 <strong>+{Math.round(SERVANT_BONUS_PER_HEAD * 100)}%</strong> 产量。
        调整岗位请用「<strong>调往</strong>」或下面的「<strong>批量调动</strong>」——
        人数不变、不花灵气；「遣散」才会真正少一名，以后再招要重新花灵气。
        {' 仆役居所与弟子居所是两套，互不占位。'}
      </p>

      <div className="servant-list">
        {SERVANT_JOBS.map((job) => {
          const count = game.servants[job.id] ?? 0;
          const target = RESOURCE_MAP[job.resource];
          const bonus = getServantBonus(game, job.resource);
          // 遣散后再招回来要花的灵气：招收价是固定值（300），所以直接取当前价
          const rehireCost = getServantCost(game);
          const others = SERVANT_JOBS.filter((other) => other.id !== job.id);
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
                  disabled={!check.ok}
                  onClick={() => recruitServant(job.id)}
                  title={check.ok ? `招收一名（☯${fmt(cost)}）` : check.reason ?? ''}
                >
                  ＋ 招收
                </button>

                {count > 0 && (
                  <>
                    {/* 这是「减人数」的正常路径：换岗，总人数不变 */}
                    <select
                      className="servant__move"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) assignServant(job.id, e.target.value);
                      }}
                      title="从本岗位调一名到别处（总人数不变，不花灵气）"
                    >
                      <option value="">调往…</option>
                      {others.map((other) => (
                        <option key={other.id} value={other.id}>
                          → {other.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="btn btn--tiny btn--danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            `确定遣散一名「${job.name}」的仆人？\n\n` +
                              `这会真正少一名仆人，以后重新招收要花 ☯${fmt(rehireCost)}。\n` +
                              '如果只是想换个岗位，请用旁边的「调往…」或下方的「批量调动」。',
                          )
                        ) {
                          dismissServant(job.id);
                        }
                      }}
                      title="彻底遣散一名（总人数 −1）"
                    >
                      遣散
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 本轮需求 4：批量转移仆从到另一个岗位 */}
      <BulkTransfer />

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
              if (window.confirm(`确定遣散全部 ${total} 名仆人？腾出的仆役床位会空出来。`)) {
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
