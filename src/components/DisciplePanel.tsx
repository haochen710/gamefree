/**
 * 弟子管理（需求 7）
 *
 * 后期弟子会有几十上百人，所以这里提供排序、筛选、单点逐出和一键清理。
 * 判断标准是「资质」—— 它同时决定修炼速度和终身境界上限。
 */
import { useMemo, useState } from 'react';
import { GAME_DAYS_PER_SECOND, GAME_DAYS_PER_YEAR, APTITUDE_MAP, APTITUDES, REALMS } from '../game/content';
import { aptitudeRank, getDiscipleCapReason, getDiscipleSpeed } from '../game/disciples';
import { getDiscipleCapacity, getInsightMax } from '../game/engine';
import { useGame } from '../game/store';
import type { Disciple } from '../game/state';

type SortKey = 'aptitude' | 'realm' | 'age';

/** 游戏年 → 还要多少真实时间 */
function yearsToReal(years: number): string {
  const seconds = (years * GAME_DAYS_PER_YEAR) / GAME_DAYS_PER_SECOND;
  if (seconds < 90) return `${Math.round(seconds)} 秒`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / 86400).toFixed(1)} 天`;
}

function DiscipleRow({ disciple }: { disciple: Disciple }) {
  const game = useGame((s) => s.game);
  const dismiss = useGame((s) => s.dismissDisciple);

  const aptitude = APTITUDE_MAP[disciple.aptitude];
  const realm = REALMS[disciple.realmIndex];
  const nextRealm = REALMS[Math.min(disciple.realmIndex + 1, REALMS.length - 1)];
  const capReason = getDiscipleCapReason(game, disciple);
  const atCap = capReason !== null;
  const lifespan = realm.lifespan * (1 + game.sect.lifespanBonus);
  const ageRatio = Number.isFinite(lifespan) ? Math.min(1, disciple.age / lifespan) : 0;
  const progressRatio =
    atCap || realm.cultivationYears <= 0 ? 1 : Math.min(1, disciple.progress / realm.cultivationYears);
  // 实际修行速度 = 资质 × (建筑 + 大比 + 心得)，三者同一个加算池（需求 4）
  const speed = getDiscipleSpeed(game, disciple);
  const yearsLeft = atCap ? 0 : (realm.cultivationYears - disciple.progress) / speed;

  const capText =
    capReason === 'aptitude'
      ? `资质所限，止步${realm.name}`
      : capReason === 'master'
        ? `已至掌门境界（${realm.name}），待掌门精进`
        : `${yearsLeft.toFixed(0)} 年后入${nextRealm.name}（约 ${yearsToReal(yearsLeft)}）`;

  return (
    <article className={disciple.status === 'exploring' ? 'disciple disciple--busy' : 'disciple'}>
      <div className="disciple__head">
        <span className="disciple__name">{disciple.name}</span>
        <span className="disciple__aptitude" style={{ color: aptitude.color }}>
          {aptitude.name}
        </span>
        <span className="disciple__realm">{realm.name}</span>
        {disciple.insight > 0 && (
          <span
                  className="disciple__tag"
                  title={`心得：每点 +0.5% 修行速度，上限随掌门境界增长（当前 ${Math.round(disciple.insight)}/${getInsightMax(game)}）`}
                >
            心得 {Math.round(disciple.insight)}/{getInsightMax(game)}
          </span>
        )}
        {disciple.status === 'exploring' && <span className="disciple__tag">探索中</span>}
      </div>

      <div className="disciple__bars">
        <div className="mini-bar" title={`修为 ${disciple.progress.toFixed(1)} / ${realm.cultivationYears} 年`}>
          <div className="mini-bar__fill mini-bar__fill--cultivation" style={{ width: `${progressRatio * 100}%` }} />
        </div>
        <div className="mini-bar" title={`寿元 ${disciple.age.toFixed(0)} / ${lifespan} 年`}>
          <div
            className="mini-bar__fill mini-bar__fill--age"
            style={{ width: `${ageRatio * 100}%` }}
          />
        </div>
      </div>

      <div className="disciple__foot">
        <span>
          {disciple.age.toFixed(0)} 岁 · 寿元 {Number.isFinite(lifespan) ? `${lifespan.toFixed(0)} 岁` : '无尽'}
        </span>
        <span>{capText}</span>
        <button
          type="button"
          className="btn btn--tiny"
          disabled={disciple.status === 'exploring'}
          onClick={() => dismiss(disciple.id)}
        >
          逐出
        </button>
      </div>
    </article>
  );
}

export function DisciplePanel() {
  const game = useGame((s) => s.game);
  const dismissBelow = useGame((s) => s.dismissBelow);

  const [sortKey, setSortKey] = useState<SortKey>('aptitude');
  const [minRank, setMinRank] = useState(0);

  const capacity = getDiscipleCapacity(game);

  const list = useMemo(() => {
    const filtered = game.sect.disciples.filter((d) => aptitudeRank(d.aptitude) >= minRank);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortKey === 'aptitude') return aptitudeRank(b.aptitude) - aptitudeRank(a.aptitude);
      if (sortKey === 'realm') return b.realmIndex - a.realmIndex;
      return a.age - b.age;
    });
    return sorted;
  }, [game.sect.disciples, sortKey, minRank]);

  if (!game.sect.founded) return null;

  const removable = game.sect.disciples.filter(
    (d) => d.status === 'idle' && aptitudeRank(d.aptitude) < minRank,
  ).length;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>弟子</h2>
        <span className="panel__hint">
          {game.sect.disciples.length} / {capacity}
        </span>
      </div>

      <div className="disciple-toolbar">
        <label>
          排序
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="aptitude">按资质</option>
            <option value="realm">按境界</option>
            <option value="age">按年龄</option>
          </select>
        </label>

        <label>
          只看
          <select value={minRank} onChange={(e) => setMinRank(Number(e.target.value))}>
            <option value={0}>全部</option>
            {APTITUDES.map((a, i) => (
              <option key={a.id} value={i}>
                {a.name}及以上
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn"
          disabled={removable === 0 || minRank === 0}
          onClick={() => {
            if (window.confirm(`确定逐出 ${removable} 名低于所选资质的弟子？`)) dismissBelow(minRank);
          }}
        >
          清理低资质 {removable > 0 ? `(${removable})` : ''}
        </button>
      </div>

      {game.sect.disciples.length === 0 && (
        <p className="panel__note">尚无弟子。回到「宗门」面板招收门徒。</p>
      )}

      <div className="disciple-list">
        {list.map((d) => (
          <DiscipleRow key={d.id} disciple={d} />
        ))}
      </div>
    </section>
  );
}

export default DisciplePanel;
