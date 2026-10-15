/**
 * 灵植园（需求 5）
 *
 * 两块内容：
 *   地块 —— 正在长的东西、催熟、收获
 *   种子 —— 手上有什么种子，可以直接种下去
 *
 * 收获刻意做成手动：挂机一整天回来，一次「全部收获」比默默塞满材料栏
 * 更能让人知道自己攒到了什么。
 */
import { fmt } from '../game/decimal';
import {
  MATERIAL_MAP,
  RARITY_COLORS,
  SEED_MAP,
  hastenQiCost,
  hastenStoneCost,
  // 第 33 轮需求 3：地块阶数曲线与产出加成
  plotTierThreshold,
  plotYieldMultiplier,
  type MaterialId,
} from '../game/content';
import { getPlotCapacity } from '../game/engine';
import {
  canPlant,
  getFreePlots,
  getOwnedSeeds,
  getPlantingProgress,
  getPlantingRemaining,
  getReadyPlantings,
  getUsedPlots,
  isPlantingReady,
} from '../game/planting';
import { useGame } from '../game/store';
import type { GameState, Planting } from '../game/state';

function formatSeconds(seconds: number): string {
  if (seconds <= 90) return `${Math.max(0, Math.round(seconds))} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

/** 一块**空地**的框（第 33 轮需求 3）：有框、有阶数，写明还差几次升阶 */
function EmptyPlotCard({ slot, state }: { slot: number; state: GameState }) {
  const info = state.plotTiers[String(slot)] ?? { tier: 1, count: 0 };
  const need = plotTierThreshold(info.tier);
  return (
    <article className="plot plot--empty">
      <div className="plot__head">
        <span className="plot__icon">🟫</span>
        <span className="plot__name">空地</span>
        <span className="plot__tier">{info.tier} 阶</span>
      </div>
      <p className="plot__note">
        再种 {Math.max(0, need - info.count)} 次升 {info.tier + 1} 阶（产出 +{Math.round(
          (plotYieldMultiplier(info.tier + 1) - 1) * 100,
        )}%）
      </p>
    </article>
  );
}

function PlotCard({ planting, state }: { planting: Planting; state: GameState }) {
  const hasten = useGame((s) => s.hastenPlanting);
  const harvest = useGame((s) => s.harvest);

  const def = MATERIAL_MAP[planting.material];
  const seed = SEED_MAP[planting.material];
  // 第 33 轮需求 3：这块地的阶（缺键即一阶）
  const info = state.plotTiers[String(planting.plot)] ?? { tier: 1, count: 0 };
  const tier = info.tier;
  const ready = isPlantingReady(planting);
  const progress = getPlantingProgress(planting);

  return (
    <article className={ready ? 'plot plot--ready' : 'plot'}>
      <div className="plot__head">
        <span className="plot__icon">{def?.icon ?? '🌱'}</span>
        <span className="plot__name" style={{ color: RARITY_COLORS[seed?.rarity ?? 1] }}>
          {def?.name ?? planting.material}
        </span>
        <span className="plot__time">
          {ready ? '已成熟' : `还需 ${formatSeconds(getPlantingRemaining(planting))}`}
        </span>
        {/* 第 33 轮需求 3：这块地现在是几阶（阶越高产出越高） */}
        <span className="plot__tier">{tier} 阶</span>
      </div>

      <div className="bar">
        <div className="bar__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      <div className="plot__foot">
        <span className="plot__yield">
          可收 {Math.max(1, Math.floor((seed?.yield ?? 1) * plotYieldMultiplier(tier)))} 份
          {tier > 1 && <span className="panel__hint">（{tier} 阶 +{tier}%）</span>}
        </span>
        {ready ? (
          <button type="button" className="btn btn--tiny btn--primary" onClick={() => harvest(planting.id)}>
            收获
          </button>
        ) : (
          <span className="btn-row">
            <button
              type="button"
              className="btn btn--tiny"
              disabled={state.resources.qi.lt(hastenQiCost(seed?.rarity ?? 1))}
              onClick={() => hasten(planting.id, 'qi')}
            >
              催熟 ☯{fmt(hastenQiCost(seed?.rarity ?? 1), 0)}
            </button>
            <button
              type="button"
              className="btn btn--tiny"
              disabled={state.resources.stone.lt(hastenStoneCost(seed?.rarity ?? 1))}
              onClick={() => hasten(planting.id, 'stone')}
            >
              催熟 💎{fmt(hastenStoneCost(seed?.rarity ?? 1), 0)}
            </button>
          </span>
        )}
      </div>
    </article>
  );
}

export function PlantationPanel() {
  const game = useGame((s) => s.game);
  const plantSeed = useGame((s) => s.plantSeed);
  const plantAllSeeds = useGame((s) => s.plantAllSeeds);
  const harvestAll = useGame((s) => s.harvestAll);

  const capacity = getPlotCapacity(game);
  const used = getUsedPlots(game);
  const free = getFreePlots(game);
  const ready = getReadyPlantings(game);
  const seeds = getOwnedSeeds(game);

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2>灵植园</h2>
          <span className="panel__hint">
            地块 {used} / {capacity}
            {free > 0 ? ` · 空闲 ${free}` : ''}
          </span>
        </div>

        {capacity === 0 && (
          <p className="panel__note">
            还没有地块。先钻研「灵植之术」，再在「建筑」页里建一座<strong>灵植园</strong>。
            种子来自探索（稀有材料只有探索才掉）与商行（只卖基础材料种子）。
          </p>
        )}

        {capacity > 0 && (
          <>
            <div className="btn-row btn-row--wrap">
              <button type="button" className="btn" disabled={seeds.length === 0} onClick={plantAllSeeds}>
                全部种下
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={ready.length === 0}
                onClick={harvestAll}
              >
                一键收获 {ready.length > 0 ? `(${ready.length})` : ''}
              </button>
            </div>

            {game.plantings.length === 0 ? (
              <p className="panel__note">地块空着。从下面的种子列表里挑一种种下。</p>
            ) : (
              <div className="plot-grid">
                {/*
                 * 第 33 轮需求 3（玩家原话）：「灵田图片化（或者说要有框框在那）」。
                 *
                 * 原来只渲染**有作物**的地块 —— 空地是"看不见的"，玩家只能从
                 * "还能种几块"这个数字去猜。现在按**容量**渲染：每块地都有框，
                 * 空着的那块也画出来并写明"空地"，一眼能看出田有多大、空了几块。
                 */}
                {Array.from({ length: getPlotCapacity(game) }, (_, slot) => {
                  const planting = game.plantings.find((pl) => pl.plot === slot);
                  return planting ? (
                    <PlotCard key={planting.id} planting={planting} state={game} />
                  ) : (
                    <EmptyPlotCard key={`empty-${slot}`} slot={slot} state={game} />
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>种子</h2>
          <span className="panel__hint">{seeds.length} 种</span>
        </div>

        {seeds.length === 0 ? (
          <p className="panel__note">
            手上一颗种子也没有。出门游历或派弟子探索都有机会带回种子 ——
            材料越稀有，掉率越低。
          </p>
        ) : (
          seeds.map(({ seed, count }) => {
            const def = MATERIAL_MAP[seed.material];
            const check = canPlant(game, seed.material as MaterialId);
            return (
              <div key={seed.material} className="inv-row inv-row--wrap">
                <span className="inv-row__icon">{def?.icon ?? '🌰'}</span>
                <span className="inv-row__name" style={{ color: RARITY_COLORS[seed.rarity] }}>
                  {seed.name}
                </span>
                <span className="inv-row__count">×{count}</span>
                <span className="inv-row__effect">
                  {formatSeconds(seed.growSeconds)} 熟 · 收 {seed.yield} 份 ·{' '}
                  {seed.category === 'base' ? '基础' : '稀有'}
                </span>
                <button
                  type="button"
                  className="btn btn--tiny"
                  disabled={!check.ok}
                  onClick={() => plantSeed(seed.material)}
                >
                  种下
                </button>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}

export default PlantationPanel;
