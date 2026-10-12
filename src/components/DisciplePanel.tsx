/**
 * 弟子管理（需求 7）
 *
 * 后期弟子会有几十上百人，所以这里提供排序、筛选、单点逐出和一键清理。
 * 判断标准是「资质」—— 它同时决定修炼速度和终身境界上限。
 *
 * 本轮两处改动都跟"人多"有关：
 *   - 需求 1 把上限抬到 2048，**列表必须分批渲染**（否则一次挂 2000 个节点会卡）；
 *   - 需求 9 之后弟子突破需要丹药，卡在瓶颈的弟子要在列表里说清"缺哪一味"，
 *     否则玩家只会看到"某某人不涨修为"而找不到原因。
 */
import { useMemo, useState } from 'react';
import { GAME_DAYS_PER_SECOND, GAME_DAYS_PER_YEAR, APTITUDE_MAP, APTITUDES, PILL_MAP, REALMS } from '../game/content';
import {
  aptitudeRank,
  getDiscipleCapReason,
  getDiscipleEffectiveSpeed,
  getDiscipleSpeed,
} from '../game/disciples';
import { getDiscipleCapacity, getDiscipleHousing, getInsightMax } from '../game/engine';
import { useGame } from '../game/store';
import type { Disciple } from '../game/state';

type SortKey = 'aptitude' | 'realm' | 'age';

/** 一次最多渲染多少行；点「显示更多」再放一批 */
const PAGE_SIZE = 50;

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
  /*
   * 实际修行速度：资质 × (建筑 + 大比 + 心得)，再加上"在外历练"那一层（本轮需求 10）。
   * 用 effective 而不是 getDiscipleSpeed —— 否则界面上的"还要几年"会偏慢，
   * 玩家会以为派遣拖慢了弟子。
   */
  const speed = getDiscipleEffectiveSpeed(game, disciple);
  const homeSpeed = getDiscipleSpeed(game, disciple);
  const exploring = disciple.status === 'exploring';
  const yearsLeft = atCap ? 0 : (realm.cultivationYears - disciple.progress) / speed;

  /*
   * 需求 9：弟子突破也要吃丹药。修为满了但仓库没丹 → 卡在瓶颈。
   * 这是"弟子怎么不涨了"最常见的答案，所以直接写在行内。
   */
  const pillNeed = realm.breakthroughPill;
  const pillStalled =
    !atCap && realm.cultivationYears > 0 && disciple.progress >= realm.cultivationYears;

  const capText = pillStalled
    ? `修为已满${realm.name}，缺 ${PILL_MAP[pillNeed]?.name ?? '突破丹'} ×1`
    : capReason === 'aptitude'
      ? `资质所限，止步${realm.name}`
      : capReason === 'master'
        ? `已至掌门境界（${realm.name}），待掌门精进`
        : `${yearsLeft.toFixed(0)} 年后入${nextRealm.name}（约 ${yearsToReal(yearsLeft)}）`;

  return (
    <article className={exploring ? 'disciple disciple--busy' : 'disciple'}>
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
        {exploring && (
          <span
            className="disciple__tag disciple__tag--busy"
            title={`在外历练：派遣期间修行速度额外 +${Math.round((speed / homeSpeed - 1) * 100)}%（本轮需求 10）`}
          >
            探索中 · 历练 +{Math.round((speed / homeSpeed - 1) * 100)}%
          </span>
        )}
        {pillStalled && (
          <span className="disciple__tag disciple__tag--warn" title="大境界突破必须服对应境界丹，去丹房炼制">
            缺丹
          </span>
        )}
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
          disabled={exploring}
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
  // 需求 1：上限 2048 人，列表必须分批渲染
  const [shown, setShown] = useState(PAGE_SIZE);

  const capacity = getDiscipleCapacity(game);
  const housing = getDiscipleHousing(game);

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
          {game.sect.disciples.length} / {capacity}（居所 {housing}）
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

      {/*
        需求 9：弟子的大境界突破也吃丹药，而且和掌门**共用同一个仓库**。
        不说清楚的话，玩家会以为自己辛苦炼的那颗丹"凭空少了"。
      */}
      {game.sect.disciples.length > 0 && (
        <p className="panel__note">
          弟子突破大境界同样要消耗仓库里的对应境界丹（与掌门共用同一批丹药）。
          仓库没有时弟子会<strong>卡在瓶颈</strong>、修为不丢，列表里标「缺丹」。
          想去掉这个瓶颈，就在「丹器」页把丹炉开足，或在「工坊」页把炼丹材料的合成线跑起来。
        </p>
      )}

      {/*
        超编（多半来自旧存档）：上限是在本轮需求 1 / 2 才变成
        「min(弟子居所床位, 品阶上限)」的，而旧存档里可能已经有几十号人
        却没有一座弟子居所。这里**不删人**（读档删玩家的弟子比什么都糟），
        只把状态说清楚：不会再招人，遣散/陨落后才恢复。
      */}
      {game.sect.disciples.length > capacity && (
        <p className="panel__note panel__note--warn">
          当前弟子数已超过上限（{game.sect.disciples.length} / {capacity}）——
          多半是旧存档留下来的。不会强制遣散，但在人数降到上限以下之前无法再招收。
          去「建筑」页补几座<strong>弟子居所</strong>通常就能立刻解决。
        </p>
      )}

      <div className="disciple-list">
        {list.slice(0, shown).map((d) => (
          <DiscipleRow key={d.id} disciple={d} />
        ))}
      </div>

      {list.length > shown && (
        <div className="btn-row">
          <button type="button" className="btn btn--wide" onClick={() => setShown((v) => v + PAGE_SIZE)}>
            显示更多（还有 {list.length - shown} 人）
          </button>
        </div>
      )}
    </section>
  );
}

export default DisciplePanel;
