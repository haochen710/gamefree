/**
 * 合成 / 精炼面板（需求 4）
 *
 * 需求原文：
 *   「增加进阶资源，可有基础资源合成获取，当前只有灵石合成，过于单调，
 *     进阶资源可用于商行交易或者炼丹炼器，这块需要你重新设计一下」
 *
 * 所以这一页要把"合成链"讲成一件事，而不是一排按钮：
 * 每条配方都标出**它的下游是什么**，玩家才知道为什么要合它。
 */
import { fmt } from '../game/decimal';
import {
  AUTO_REFINE_RATES,
  ITEM_MAP,
  MATERIAL_IDS,
  MATERIAL_MAP,
  REFINE_RECIPES,
  type ItemId,
} from '../game/content';
import { getAmount, getAutoRefineRate, getRefineGate, maxRefine, refineCostMap } from '../game/engine';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';
import Panel from './Panel';

/** 每条配方通向哪里（纯文案，帮玩家建立"合它做什么"的直觉） */
const DOWNSTREAM: Record<string, string> = {
  stoneRefine: '通货 —— 招收弟子、商行购物、宗门晋升都要它',
  spiritEssenceRefine: '炼丹 —— 四品以上的丹方都要用它作引',
  refinedGoldRefine: '炼器 —— 五品以上的器物非它不成',
  arrayCoreRefine: '阵法 —— 护山大阵 / 周天星斗大阵 / 混元无极阵的核心件',
};

export function RefinePanel({ collapsible = false }: { collapsible?: boolean } = {}) {
  const game = useGame((s) => s.game);
  const doRefine = useGame((s) => s.refine);
  const setAutoRefine = useGame((s) => s.setAutoRefine);
  const setAutoRefineTarget = useGame((s) => s.setAutoRefineTarget);
  // 第 28 轮：自动合成也有独立的开关了（不再靠"设个目标"来表达"开"）
  const setAutoRefineOn = useGame((s) => s.setAutoRefineOn);
  const rate = getAutoRefineRate(game);

  return (
    <Panel
      title="合成 · 精炼"
      hint={`进阶资源 ${refinedOwned(game)} 种`}
      collapsible={collapsible}
      storageKey="refine"
    >
      <p className="panel__note">
        基础资源在这里加工成<strong>进阶资源</strong>。进阶资源<strong>不能种、也不会从秘境掉落</strong> ——
        想要就得自己合。合成是立刻完成的，不占时间。
      </p>

      {/*
        本轮需求 2：「合成栏位内所有材料都可以自动合成，可以设置需要合成到多少」。
        所以每条配方多一个"目标存量"输入框 + 总开关：填了数就自动补到那个数，补到就停。
      */}
      <div className="auto-refine">
        <div className="auto-refine__head">
          <strong>自动合成</strong>
          <span className="panel__hint">
            {rate > 0 ? `${rate} 批/秒（全部配方共用）` : '未开启'}
          </span>
        </div>
        <p className="panel__note">
          填一个<strong>目标存量</strong>，系统就会按下面的速率慢慢补到那个数、补到就停手。
          0 表示那条不管。速率是所有配方<strong>共用</strong>的 —— 否则四条一起开会把灵气抽干。
        </p>
        <div className="btn-row btn-row--wrap">
          {AUTO_REFINE_RATES.map((value, level) => (
            <button
              key={value}
              type="button"
              className={game.autoRefineLevel === level ? 'btn btn--primary' : 'btn'}
              onClick={() => setAutoRefine(level)}
            >
              {level === 0 ? '关闭' : `档 ${level}`}
              {level > 0 && <span className="btn__sub">{value} 批/秒</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="refine-list">
        {REFINE_RECIPES.map((recipe) => {
          const gate = getRefineGate(recipe, game);
          const max = maxRefine(game, recipe.id);
          const cost = refineCostMap(recipe);
          const out = ITEM_MAP[recipe.output.item as ItemId];
          const have = getAmount(game, recipe.output.item);

          return (
            <article key={recipe.id} className={gate ? 'refine refine--gated' : 'refine'}>
              <div className="refine__head">
                <span className="refine__icon">{recipe.icon}</span>
                <div>
                  <div className="refine__name">{recipe.name}</div>
                  <div className="refine__desc">{recipe.desc}</div>
                </div>
              </div>

              <div className="refine__flow">
                <span className="refine__in">
                  {Object.entries(cost)
                    .map(([id, amount]) => `${ITEM_MAP[id as ItemId]?.icon ?? ''}${ITEM_MAP[id as ItemId]?.name ?? id} ${fmt(amount, 0)}`)
                    .join(' + ')}
                </span>
                <span className="refine__arrow">→</span>
                <span className="refine__out">
                  {out?.icon} {out?.name} ×{recipe.output.amount}
                </span>
              </div>

              <div className="refine__down">用途：{DOWNSTREAM[recipe.id] ?? '—'}</div>

              <div className="btn-row">
                {gate ? (
                  <span className="panel__note panel__note--warn">{gate}</span>
                ) : (
                  /*
                   * 第 27 轮（需求 2）：玩家原话「所有可以合成的资源，在合成界面那，
                   * 按钮变为"合成""自动合成"」。
                   *
                   * 原来是「合成 1 / 合成 10 / 合成 100」三个按钮，玩家得自己算该点哪个。
                   * 现在只留两个，各自对应一件事：
                   *   - **合成**：把当前能合成的**全部**一次合掉（原来那个"最大"，
                   *     它才是玩家真正想要的动作 —— 点一次把材料用干净）；
                   *   - **自动合成**：把这条线的**目标存量**在"开/关"之间切换。
                   *     开着的时候引擎会按缺口自动补货（见 engine.autoRefine），
                   *     所以它是一个开关，不是一次动作。
                   */
                  (() => {
                    const target = game.autoRefineTargets[recipe.id] ?? 0;
                    // 第 28 轮：开关与目标分开 —— 没设目标也照样能"一直合成"
                    const autoOn = game.autoRefineOn[recipe.id] === true;
                    return (
                      <>
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={max < 1}
                          title={`把能合成的全部合掉（当前可合成 ${max} 次）`}
                          onClick={() => doRefine(recipe.id, max)}
                        >
                          合成
                        </button>
                        <button
                          type="button"
                          className={autoOn ? 'btn btn--primary' : 'btn'}
                          title={
                            autoOn
                              ? target > 0
                                ? '自动合成中：补到目标 ' + fmt(target, 0) + ' 个就停'
                                : '自动合成中：没设目标，会一直合成下去（材料见底才停）'
                              : '开启后引擎会自动补货；设了目标就补到目标，没设就一直合成'
                          }
                          /*
                           * 第 28 轮：**只切开关，不再替玩家设目标**。
                           * 原来这里是 `setAutoRefineTarget(..., Math.max(100, have * 2))`，
                           * 也就是点一下自动就替你填了个目标 —— 玩家明确说不要这个：
                           * 「若玩家没有自己设置目标，则一直合成下去」。
                           * 目标留给他自己在下面的输入框里填。
                           */
                          onClick={() => setAutoRefineOn(recipe.id, !autoOn)}
                        >
                          自动合成{autoOn ? ' ✓' : ''}
                        </button>
                      </>
                    );
                  })()
                )}
                <span className="refine__max">可合成 {max} 次</span>
              </div>

              {/* 需求 2：目标存量 */}
              <div className="refine__target">
                <label>
                  自动合成到
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={game.autoRefineTargets[recipe.id] ?? 0}
                    onChange={(e) => setAutoRefineTarget(recipe.id, Number(e.target.value) || 0)}
                  />
                  个
                </label>
                <span className="refine__max">
                  现有 {fmt(have, 0)}
                  {(game.autoRefineTargets[recipe.id] ?? 0) > 0 &&
                    ` / 目标 ${fmt(game.autoRefineTargets[recipe.id] ?? 0, 0)}`}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function refinedOwned(state: GameState): number {
  return MATERIAL_IDS.filter(
    (id) => MATERIAL_MAP[id].category === 'refined' && state.materials[id]?.gt(0),
  ).length;
}

export default RefinePanel;
