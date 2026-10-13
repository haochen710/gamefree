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
import {
  COMBAT_TALENT_MAP,
  FARM_TALENT_MAP,
  FARM_TALENTS,
  GAME_DAYS_PER_SECOND,
  GAME_DAYS_PER_YEAR,
  APTITUDE_MAP,
  APTITUDES,
  PERSONALITY_MAP,
  PILL_MAP,
  REALMS,
  demonTierOf,
  loyaltyTierOf,
} from '../game/content';
import {
  aptitudeRank,
  getDiscipleCapReason,
  getDiscipleEffectiveSpeed,
  getDiscipleRealmNeed,
  getDiscipleSpeed,
  isRefusingTask,
  refusesHighRisk,
} from '../game/disciples';
import {
  countFarmTalent,
  getDiscipleCapacity,
  getDiscipleHousing,
  getFarmTalentBonus,
  getInsightMax,
} from '../game/engine';
// 心得每点给多少修行加成（需求 1：这一块从 SectHallPanel 并过来了）
import { INSIGHT_SPEED_PER_POINT } from '../game/content';
import { useGame } from '../game/store';
import Panel from './Panel';
import type { Disciple } from '../game/state';

// 需求 1：心得并入弟子管理之后，它也必须是一个可排序的维度
 type SortKey = 'aptitude' | 'realm' | 'age' | 'loyalty' | 'demon' | 'insight';
/** 弟子列表的"状态"筛选（忠诚 / 心魔 / 卡瓶颈） */
type StatusFilter = 'all' | 'refusing' | 'demon' | 'lowLoyalty' | 'stalled';
/** 需求 4：按境界筛选（原来只能按资质看） */
type RealmFilter = 'all' | 'low' | 'mid' | 'high' | 'top';
/** 需求 3：按天赋类别筛选（战斗 / 生产） */
type TalentFilter = 'all' | 'combat' | 'farm';

/**
 * 一次最多渲染多少行；点「显示更多」再放一批。
 *
 * 需求 4 报的是"弟子显示不全，只会显示一些" —— 千人宗门里每页 50 条，
 * 确实像是"只显示了一部分"。现在每页 120 条，并且：
 *   - 顶上写清"当前显示 X / 共 Y"；
 *   - 列表末尾同时给「显示更多」与「收起名单」；
 *   - 筛选条件（境界/资质/天赋/状态）比翻页更能直接找到人。
 */
const PAGE_SIZE = 120;

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
  const combat = COMBAT_TALENT_MAP[disciple.combatTalent];
  const farm = FARM_TALENT_MAP[disciple.farmTalent];
  const personality = PERSONALITY_MAP[disciple.personality];
  const loyaltyTier = loyaltyTierOf(disciple.loyalty);
  const demonTier = demonTierOf(disciple.demon);
  const realm = REALMS[disciple.realmIndex];
  const nextRealm = REALMS[Math.min(disciple.realmIndex + 1, REALMS.length - 1)];
  const capReason = getDiscipleCapReason(game, disciple);
  const atCap = capReason !== null;
  const lifespan = realm.lifespan * (1 + game.sect.lifespanBonus);
  const ageRatio = Number.isFinite(lifespan) ? Math.min(1, disciple.age / lifespan) : 0;
  const progressRatio =
    atCap || realm.cultivationYears <= 0 ? 1 : Math.min(1, disciple.progress / realm.cultivationYears);
  /*
   * 实际修行速度：资质 × (建筑 + 大比 + 心得 + 性格) × 忠诚档 × 心魔档，
   * 再加上"在外历练"那一层（需求 10）。
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
        {/* 战斗天赋与性格：这两条决定"这个人好不好用" */}
        <span className="disciple__tag" title={combat.desc}>
          {combat.icon} {combat.name}
        </span>
        <span className="disciple__tag" title={personality.desc}>
          {personality.icon} {personality.name}
        </span>
        <span className="disciple__tag" title={farm.desc}>
          {farm.icon} {farm.name}
        </span>
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
        {/*
          忠诚与心魔各占一条细条。它们与修为一样是"会变、要看"的量，
          所以用同一种可视化语言，而不是塞进一行文字里。
        */}
        <div className="mini-bar mini-bar--thin" title={`忠诚 ${Math.round(disciple.loyalty)}/100（${loyaltyTier.name}）`}>
          <div className="mini-bar__fill mini-bar__fill--loyalty" style={{ width: `${disciple.loyalty}%` }} />
        </div>
        <div className="mini-bar mini-bar--thin" title={`心魔 ${Math.round(disciple.demon)}/100（${demonTier.name}）`}>
          <div className="mini-bar__fill mini-bar__fill--demon" style={{ width: `${disciple.demon}%` }} />
        </div>
      </div>

      <div className="disciple__foot">
        {/*
          需求 14「弟子寿命没有显示出来」：原来只画了一条寿元进度条，
          文字里只有"多少岁"。现在把**寿元上限**与**余寿**都写出来 ——
          "还能活几年"才是玩家真正在判断的事（决定派不派他去探索）。
        */}
        <span title={Number.isFinite(lifespan) ? `寿元上限 ${Math.round(lifespan)} 岁` : '寿元无尽'}>
          {disciple.age.toFixed(0)} 岁 / {Number.isFinite(lifespan) ? `${Math.round(lifespan)} 岁` : '无尽'} · 余寿{' '}
          {Number.isFinite(lifespan) ? `${Math.max(0, Math.round(lifespan - disciple.age))} 年` : '—'} · 忠诚{' '}
          {Math.round(disciple.loyalty)}（{loyaltyTier.name}）· 心魔 {Math.round(disciple.demon)}
        </span>
        {disciple.insight > 0 && (
          <span title={`心得：每点 +0.5% 修行速度，上限随掌门境界增长（当前 ${Math.round(disciple.insight)}/${getInsightMax(game)}）`}>
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
        {isRefusingTask(disciple) && (
          <span
            className="disciple__tag disciple__tag--warn"
            title="心魔 61 以上会拒绝出征：先服清心丹，或多建静心阁"
          >
            拒绝出征
          </span>
        )}
        {refusesHighRisk(disciple) && (
          <span className="disciple__tag" title="恬淡性格：不会去高危秘境（基础伤亡 ≥ 30%）">
            拒赴险地
          </span>
        )}
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

/**
 * 弟子管理。
 *
 * 需求 4：「弟子显示不全，只会显示一些。可以改为玩家根据弟子境界、资质、
 * 天赋等显示，并且可以收起」—— 三件事分别落成：
 *   - 每页 120 条 + 「显示更多 / 收起名单」；
 *   - 五个筛选（境界 / 资质 / 天赋类别 / 状态 / 排序）；
 *   - 整个面板由 Panel 承载，标题栏可点、折叠状态记在 localStorage（collapsible）。
 */
export function DisciplePanel({ collapsible }: { collapsible?: boolean } = {}) {
  const game = useGame((s) => s.game);
  const dismissBelow = useGame((s) => s.dismissBelow);

  const [sortKey, setSortKey] = useState<SortKey>('aptitude');
  const [minRank, setMinRank] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [realmFilter, setRealmFilter] = useState<RealmFilter>('all');
  const [talentFilter, setTalentFilter] = useState<TalentFilter>('all');
  // 需求 1：上限 2048 人，列表必须分批渲染
  const [shown, setShown] = useState(PAGE_SIZE);

  const capacity = getDiscipleCapacity(game);
  const housing = getDiscipleHousing(game);

  const list = useMemo(() => {
    const filtered = game.sect.disciples
      .filter((d) => aptitudeRank(d.aptitude) >= minRank)
      /*
       * 需求 4：按**境界**筛选。
       * 分档而不是逐个境界列出来：选项一多，下拉框本身就变成了迷宫。
       *   低 = 炼气~筑基（0~1）· 中 = 金丹~元婴（2~3）
       *   高 = 化神~炼虚（4~5）· 顶尖 = 合体以上（6+）
       */
      .filter((d) => {
        if (realmFilter === 'low') return d.realmIndex <= 1;
        if (realmFilter === 'mid') return d.realmIndex === 2 || d.realmIndex === 3;
        if (realmFilter === 'high') return d.realmIndex === 4 || d.realmIndex === 5;
        if (realmFilter === 'top') return d.realmIndex >= 6;
        return true;
      })
      /* 需求 3 / 4：按**天赋类别**筛选（战斗类 / 生产类） */
      .filter((d) => {
        if (talentFilter === 'all') return true;
        const combat = COMBAT_TALENT_MAP[d.combatTalent];
        if (talentFilter === 'combat') return Boolean(combat);
        // 生产类即"种田天赋"那一栏（炼丹/炼器/制符/种田都在这一栏里）
        return FARM_TALENT_MAP[d.farmTalent] !== undefined;
      })
      .filter((d) => {
        if (statusFilter === 'refusing') return isRefusingTask(d);
        if (statusFilter === 'demon') return d.demon >= 31;
        if (statusFilter === 'lowLoyalty') return d.loyalty < 40;
        if (statusFilter === 'stalled') {
          const need = getDiscipleRealmNeed(d, d.realmIndex);
          return need > 0 && d.progress >= need;
        }
        return true;
      });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortKey === 'aptitude') return aptitudeRank(b.aptitude) - aptitudeRank(a.aptitude);
      if (sortKey === 'realm') return b.realmIndex - a.realmIndex;
      if (sortKey === 'loyalty') return a.loyalty - b.loyalty;
      if (sortKey === 'demon') return b.demon - a.demon;
      // 需求 1：心得也成为一个排序维度（它原来只在那块单独的面板里）
      if (sortKey === 'insight') return b.insight - a.insight;
      return a.age - b.age;
    });
    return sorted;
  }, [game.sect.disciples, sortKey, minRank, statusFilter, realmFilter, talentFilter]);

  if (!game.sect.founded) return null;

  const removable = game.sect.disciples.filter(
    (d) => d.status === 'idle' && aptitudeRank(d.aptitude) < minRank,
  ).length;

  return (
    <Panel
      title="弟子"
      hint={`${game.sect.disciples.length} / ${capacity}（居所 ${housing}）`}
      collapsible={collapsible}
      storageKey="disciples"
    >
      {/*
       * 需求 1：「弟子心得界面和弟子管理合并起来」。
       * 原先心得是宗门左栏里独立的一节（SectHallPanel），现在并到这里 ——
       * 因为"看谁心得高"和"决定派谁去探索"本来就是同一件事的两面。
       */}
      <div className="notice-board">
        <div className="notice-board__head">
          <span>📖 弟子心得</span>
          <span className="notice-board__sum">上限 {getInsightMax(game)} 点 / 人</span>
        </div>
        <p className="panel__note">
          弟子探索秘境归来积累心得，每点使该弟子的修行速度 +
          {(INSIGHT_SPEED_PER_POINT * 100).toFixed(1)}%。心得与宗门建筑、大比处在
          <strong>同一个加算池</strong>里，不会互相翻倍。
        </p>
        {game.sect.disciples.length === 0 ? (
          <p className="panel__note">尚无弟子。</p>
        ) : (
          [...game.sect.disciples]
            .sort((a, b) => b.insight - a.insight)
            .slice(0, 5)
            .map((d) => (
              <div key={d.id} className="notice-board__row">
                <span className="notice-board__name">{d.name}</span>
                <span className="notice-board__detail">
                  心得 {Math.round(d.insight)} / {getInsightMax(game)}
                </span>
                <span className="notice-board__missing">
                  修行 +{(Math.min(d.insight, getInsightMax(game)) * INSIGHT_SPEED_PER_POINT * 100).toFixed(1)}%
                </span>
              </div>
            ))
        )}
        <p className="panel__note">这里只列心得最高的 5 人；完整名单用下面的筛选与排序看。</p>
      </div>

      <div className="disciple-toolbar">
        <label>
          排序
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="aptitude">按资质</option>
            <option value="realm">按境界</option>
            <option value="age">按年龄</option>
            <option value="loyalty">按忠诚（低的在前）</option>
            <option value="demon">按心魔（高的在前）</option>
            <option value="insight">按心得（高的在前）</option>
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

        <label>
          状态
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">全部</option>
            <option value="refusing">拒绝出征（心魔 ≥ 61）</option>
            <option value="demon">心魔 ≥ 31</option>
            <option value="lowLoyalty">忠诚 &lt; 40（离心）</option>
            <option value="stalled">卡在瓶颈（缺丹）</option>
          </select>
        </label>

        {/* 需求 4：按境界筛选 */}
        <label>
          境界
          <select value={realmFilter} onChange={(e) => setRealmFilter(e.target.value as RealmFilter)}>
            <option value="all">全部</option>
            <option value="low">炼气 ~ 筑基</option>
            <option value="mid">金丹 ~ 元婴</option>
            <option value="high">化神 ~ 炼虚</option>
            <option value="top">合体以上</option>
          </select>
        </label>

        {/* 需求 3 / 4：按天赋类别筛选 */}
        <label>
          天赋
          <select value={talentFilter} onChange={(e) => setTalentFilter(e.target.value as TalentFilter)}>
            <option value="all">全部</option>
            <option value="combat">战斗类</option>
            <option value="farm">生产类</option>
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
        全宗天赋一览（设定集第 8.4 章）。
        种田天赋是按 √人数 给全宗加成的，所以"我手下有几个人有这条天赋"
        是玩家唯一能判断该往哪边堆人的依据 —— 不给看，这个系统就等于没有。
      */}
      {game.sect.disciples.length > 0 && (
        <div className="talent-summary">
          <div className="talent-summary__row">
            {FARM_TALENTS.map((t) => {
              const count = countFarmTalent(game, t.id);
              const bonus = getFarmTalentBonus(game, t.target);
              return (
                <span key={t.id} className="talent-summary__item" title={`${t.desc}（全宗合计 +${(bonus * 100).toFixed(1)}%）`}>
                  {t.icon} {t.name} <strong>{count}</strong>
                </span>
              );
            })}
          </div>
          <p className="panel__note">
            种田天赋按 <strong>√人数</strong> 给全宗加成（收益递减，所以人越多边际越小）。
            战斗天赋只护自己；性格决定忠诚与心魔怎么变。
          </p>
        </div>
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

      <div className="btn-row">
        {list.length > shown && (
          <button type="button" className="btn" onClick={() => setShown((v) => v + PAGE_SIZE)}>
            显示更多（还有 {list.length - shown} 人）
          </button>
        )}
        {shown > PAGE_SIZE && (
          <button type="button" className="btn btn--tiny" onClick={() => setShown(PAGE_SIZE)}>
            收起名单
          </button>
        )}
        <span className="panel__hint">
          已显示 {Math.min(shown, list.length)} / {list.length} 人（共 {game.sect.disciples.length} 名弟子）
        </span>
      </div>
    </Panel>
  );
}

export default DisciplePanel;
