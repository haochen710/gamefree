/** 顶部：境界、小境界层数、全局倍率、道韵、心神 */
import { fmt, fmtDuration, fmtMultiplier } from '../game/decimal';
import { MIND_MAX, TRAVEL_REGION_MAP, gameYearOf, yearProgressOf } from '../game/content';
import { getSeason } from '../game/season';
import {
  getDiscipleCapacity,
  getGlobalMultiplier,
  getRealm,
  getServantCount,
  isFinalRealm,
} from '../game/engine';
import { useGame } from '../game/store';

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 右上角的纪年（需求 2）
 *
 * 需求原文：「纪年移动到页面右上角」。
 *
 * 原来纪年挂在资源栏底下那条常驻季节条上，而需求 3 又要求
 * 「删除资源展示界面最底下有关纪年等的内容」—— 所以纪年搬到页头右上角，
 * 资源栏只剩资源。这里给的是"第 N 年 + 本季 + 今年过了多少"，
 * 季节名与进度是从日历推出来的，不是另存一份状态。
 */
function YearBadge() {
  const game = useGame((s) => s.game);
  const season = getSeason(game);
  const progress = Math.round(yearProgressOf(game.playTime) * 100);

  return (
    <div className="year-badge" title="一年 = 现实 8 分钟；四季各占四分之一">
      <div className="year-badge__row">
        <span className="year-badge__icon">{season.icon}</span>
        <span className="year-badge__year">第 {gameYearOf(game.playTime)} 年</span>
      </div>
      <div className="year-badge__season">
        {season.name}季 · 今年 {progress}%
      </div>
      <div className="year-badge__bar">
        <span className="year-badge__fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export function Header() {
  const game = useGame((s) => s.game);
  const realm = getRealm(game);
  const multiplier = getGlobalMultiplier(game);

  const layerText = realm.layerCount > 1 ? `${CN_NUM[game.layer] ?? game.layer}层` : '圆满';
  const realmLabel = isFinalRealm(game) ? `${realm.name}·圆满` : realm.name;

  const mindRatio = game.mind / MIND_MAX;
  const discipleCount = game.sect.disciples.length;
  const discipleCap = getDiscipleCapacity(game);
  const servants = getServantCount(game);

  return (
    <header className="header">
      <div className="header__title">
        <h1>仙途</h1>
        <span className="header__subtitle">修仙放置</span>
      </div>

      {/* 需求 2：纪年固定在右上角 */}
      <YearBadge />

      <div className="header__stats">
        <div className="stat">
          <span className="stat__label">境界</span>
          <span className="stat__value stat__value--big">
            {realmLabel}
            <em className="stat__layer">{layerText}</em>
          </span>
        </div>

        <div className="stat">
          <span className="stat__label">全局倍率</span>
          <span className="stat__value">{fmtMultiplier(multiplier)}</span>
        </div>

        <div className="stat">
          <span className="stat__label">心神</span>
          <span className="stat__value">
            {Math.floor(game.mind)}
            <em className="stat__layer">/ {MIND_MAX}</em>
          </span>
          <span className="mind-bar">
            <span className="mind-bar__fill" style={{ width: `${Math.round(mindRatio * 100)}%` }} />
          </span>
        </div>

        {game.sect.founded && (
          <div className="stat">
            <span className="stat__label">弟子</span>
            <span className="stat__value">
              {discipleCount}
              <em className="stat__layer">/ {discipleCap}</em>
            </span>
          </div>
        )}

        <div className="stat">
          <span className="stat__label">道韵</span>
          <span className="stat__value stat__value--gold">
            {fmt(game.daoYun)}
            {game.ascensions > 0 && <em className="stat__layer">飞升 {game.ascensions} 次</em>}
          </span>
        </div>

        {servants > 0 && (
          <div className="stat">
            <span className="stat__label">仆役</span>
            <span className="stat__value">
              {servants}
              <em className="stat__layer">人</em>
            </span>
          </div>
        )}

        {game.personalTravel && (
          <div className="stat stat--injury">
            <span className="stat__label">游历中</span>
            <span className="stat__value stat__value--injury">
              {TRAVEL_REGION_MAP[game.personalTravel.regionId]?.name ?? '在外'}
              <em className="stat__layer">产量下降</em>
            </span>
          </div>
        )}

        {game.research && (
          <div className="stat">
            <span className="stat__label">钻研</span>
            <span className="stat__value">
              {fmtDuration(game.research.remaining)}
              <em className="stat__layer">剩余</em>
            </span>
          </div>
        )}

        {game.injurySeconds > 0 && (
          <div className="stat stat--injury">
            <span className="stat__label">道伤</span>
            <span className="stat__value stat__value--injury">
              {fmtDuration(game.injurySeconds)}
              <em className="stat__layer">产量下降</em>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
