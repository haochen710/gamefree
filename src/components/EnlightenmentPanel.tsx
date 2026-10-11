/**
 * 感悟面板（需求 3）
 *
 * 需求原文：
 *   「增加感悟模块，元婴期后，玩家解锁该模块，可以解锁对五行及时空大道的感悟，
 *     感悟分为九个大阶段，每个大阶段十个小阶段，五行可以增加不同基础材料的产出，
 *     时空大道化神期解锁……感悟需消耗大量资源和时间」
 *
 * 这一页的关键是**让 90 阶看得懂**：
 *   - 每条道用一条进度条表示 9 个大阶段，当前修到哪一阶一目了然；
 *   - 五个大阶段节点画出来，"下一个整段在哪"永远看得见；
 *   - 每条道标出它的**实际收益**（哪个材料 + 多少 / 能跳多少年 / 探索 + 多少）。
 */
import { fmt, fmtDuration } from '../game/decimal';
import {
  ENLIGHTEN_PATHS,
  MAX_ENLIGHTEN_LEVEL,
  MINOR_PER_MAJOR,
  SPACE_RING_BONUS,
  TIME_JUMP_COOLDOWN_YEARS,
  type EnlightenPathDef,
} from '../game/content';
import {
  canCraftSpaceRing,
  canEnlighten,
  canTimeJump,
  describeEnlightenCost,
  getElementMaterialBonus,
  getEnlightenLevel,
  getEnlightenProgress,
  getEnlightenRemaining,
  getNextSpaceRingCost,
  getSpaceExploreBonus,
  getSpaceRings,
  getTimeJumpYears,
  isEnlightenmentUnlocked,
  yearsSinceLastJump,
} from '../game/enlightenment';
import { useGame } from '../game/store';
import { ITEM_MAP, stageOf, timeJumpYears } from '../game/content';
import type { ItemId } from '../game/content';
import type { GameState } from '../game/state';

export function EnlightenmentPanel() {
  const game = useGame((s) => s.game);
  const enlighten = useGame((s) => s.enlighten);
  const cancelEnlighten = useGame((s) => s.cancelEnlighten);
  const craftSpaceRing = useGame((s) => s.craftSpaceRing);
  const timeJump = useGame((s) => s.timeJump);

  if (!isEnlightenmentUnlocked(game)) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>感悟</h2>
          <span className="panel__hint">未解锁</span>
        </div>
        <p className="panel__note panel__note--warn">
          需修至<strong>元婴期</strong>方能开启感悟。五行之道在元婴期解锁，时空大道还要再等一境（化神期）。
        </p>
      </section>
    );
  }

  const active = game.enlightening;
  const jumpCheck = canTimeJump(game);
  const ringCheck = canCraftSpaceRing(game);
  const ringCost = getNextSpaceRingCost(game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>感悟</h2>
        <span className="panel__hint">
          每条道 {MAX_ENLIGHTEN_LEVEL} 阶（{MAX_ENLIGHTEN_LEVEL / MINOR_PER_MAJOR} 大阶段 × {MINOR_PER_MAJOR} 小阶段）
        </span>
      </div>
      <p className="panel__note">
        感悟是<strong>贯穿整局的长线</strong>：一阶要花掉大量资源与时间，一条道修满要按天算。
        同一时间只能修一条道，但已经修出来的效果永久生效。
      </p>

      {active && (
        <div className="running">
          <div className="running__head">
            <span>🧘 正在感悟</span>
            <span className="running__time">剩余 {fmtDuration(getEnlightenRemaining(game))}</span>
          </div>
          <div className="bar">
            <div className="bar__fill" style={{ width: `${Math.round(getEnlightenProgress(game) * 100)}%` }} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn--danger" onClick={cancelEnlighten}>
              中断（资源不退）
            </button>
          </div>
        </div>
      )}

      {/* ---- 时间大道：时空穿梭是个大按钮，单独拎出来 ---- */}
      <div className="enlighten-jump">
        <div className="enlighten-jump__head">
          <strong>⏳ 时空穿梭</strong>
          <span className="panel__hint">
            {getEnlightenLevel(game, 'time') <= 0
              ? '需先感悟时间大道'
              : `每 ${TIME_JUMP_COOLDOWN_YEARS} 游戏年一次 · 本次可跳 ${getTimeJumpYears(game)} 年`}
          </span>
        </div>
        <p className="panel__note">
          一次性结算这段时间里的<strong>一切</strong>：基础产出、钻研、灵植、秘境冷却、弟子的修炼。
          但<strong>弟子也会真的老去</strong> —— 寿元不够的会在这一跳里坐化。
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn--primary" disabled={!jumpCheck.ok} onClick={timeJump}>
            发动时空穿梭
            {!jumpCheck.ok && jumpCheck.reason && <span className="btn__sub">{jumpCheck.reason}</span>}
          </button>
          {getEnlightenLevel(game, 'time') > 0 && (
            <span className="refine__max">
              距上次 {yearsSinceLastJump(game).toFixed(1)} 游戏年
            </span>
          )}
        </div>
      </div>

      {/* ---- 空间戒指 ---- */}
      <div className="enlighten-jump">
        <div className="enlighten-jump__head">
          <strong>🌀 空间戒指</strong>
          <span className="panel__hint">
            {getSpaceRings(game)}/9 枚 · 当前探索加成 +
            {Math.round(getSpaceExploreBonus(game) * 100)}%
          </span>
        </div>
        <p className="panel__note">
          每枚戒指 +{Math.round(SPACE_RING_BONUS * 100)}% 探索产出（弟子探索、普通探索、掌门亲往都算）。
          做第 n 枚要求空间大道修到 n×{MINOR_PER_MAJOR} 阶。
        </p>
        <div className="btn-row">
          <button type="button" className="btn" disabled={!ringCheck.ok} onClick={craftSpaceRing}>
            制作空间戒指
            {!ringCheck.ok && ringCheck.reason && <span className="btn__sub">{ringCheck.reason}</span>}
          </button>
          {ringCost && (
            <span className="refine__max">
              花费{' '}
              {Object.entries(ringCost)
                .map(([id, n]) => `${ITEM_MAP[id as ItemId]?.name ?? id} ${fmt((n as { toNumber: () => number }).toNumber(), 0)}`)
                .join(' · ')}
            </span>
          )}
        </div>
      </div>

      {/* ---- 七条道 ---- */}
      <div className="enlighten-paths">
        {ENLIGHTEN_PATHS.map((path) => (
          <PathCard key={path.id} path={path} state={game} onStart={() => enlighten(path.id)} />
        ))}
      </div>
    </section>
  );
}

function PathCard({
  path,
  state,
  onStart,
}: {
  path: EnlightenPathDef;
  state: GameState;
  onStart: () => void;
}) {
  const level = getEnlightenLevel(state, path.id);
  const { major, minor } = stageOf(level);
  const check = canEnlighten(state, path.id);
  const locked = state.realmIndex < path.requiresRealm;
  const full = level >= MAX_ENLIGHTEN_LEVEL;

  // 当前收益
  let gain = '';
  if (path.material) {
    gain = `${ITEM_MAP[path.material]?.name ?? path.material} 产出 +${((getElementMaterialBonus(state, path.material) ?? 0) * 100).toFixed(1)}%`;
  } else if (path.id === 'time') {
    gain = `穿梭 ${timeJumpYears(level)} 年`;
  } else {
    gain = `探索产出 +${(getSpaceExploreBonus(state) * 100).toFixed(1)}%`;
  }

  return (
    <article className={locked ? 'enlighten enlighten--locked' : 'enlighten'}>
      <div className="enlighten__head">
        <span className="enlighten__icon">{path.icon}</span>
        <div className="enlighten__title">
          <div className="enlighten__name">
            {path.name}
            <span className="enlighten__group">{path.group}</span>
          </div>
          <div className="enlighten__desc">{path.desc}</div>
        </div>
        <span className="enlighten__level">
          {level}/{MAX_ENLIGHTEN_LEVEL}
        </span>
      </div>

      {/* 9 个大阶段：每段 10 小阶，当前那一段高亮 */}
      <div className="enlighten-stages">
        {Array.from({ length: MAX_ENLIGHTEN_LEVEL / MINOR_PER_MAJOR }, (_, i) => {
          const idx = i + 1;
          const done = level >= idx * MINOR_PER_MAJOR;
          const current = !done && level > (idx - 1) * MINOR_PER_MAJOR;
          return (
            <span
              key={idx}
              className={
                done ? 'enlighten-stage enlighten-stage--done' : current ? 'enlighten-stage enlighten-stage--now' : 'enlighten-stage'
              }
              title={`第 ${idx} 大阶段`}
            >
              {idx}
            </span>
          );
        })}
      </div>

      <div className="enlighten__gain">
        {major > 0 ? `第 ${major} 大阶段 · 第 ${minor} 小阶段` : '尚未入门'} · 当前收益：{gain}
      </div>

      <div className="btn-row">
        {locked ? (
          <span className="panel__note panel__note--warn">
            需{path.requiresRealm === 3 ? '元婴期' : '化神期'}解锁
          </span>
        ) : full ? (
          <span className="panel__note">此道已圆满。</span>
        ) : (
          <>
            <button type="button" className="btn btn--primary" disabled={!check.ok} onClick={onStart}>
              感悟第 {level + 1} 阶
              {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
            </button>
            <span className="refine__max">
              花费 {describeEnlightenCost(path, level)} · 耗时 {fmtDuration(enlightenSecondsLocal(level))}
            </span>
          </>
        )}
      </div>
    </article>
  );
}

/** 与 content 里的 enlightenSeconds 保持一致；这里只是为了避免在组件里再 import 一次 */
function enlightenSecondsLocal(level: number): number {
  return Math.round(45 * Math.pow(1.045, level));
}

export default EnlightenmentPanel;
