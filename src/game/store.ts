/**
 * 全局状态容器（zustand）。
 *
 * 每个动作都是「读当前 state → 用 game/ 里的纯函数算出新 state → set」，
 * 游戏逻辑与 React 因此完全解耦。
 *
 * 所有会改变状态的动作都经过 nextGame() 收口，它统一做一件事：
 * 刷新建筑解锁。这样无论资源是被动涨上来的、还是一颗丹药瞬间给的，
 * 都不会漏掉解锁时机。
 */
import { create } from 'zustand';
import { fmt, fmtDuration } from './decimal';
import {
  AUTO_REFINE_LEVEL_MAX,
  BUILDABLE_MAP,
  ITEM_MAP,
  REFINE_RECIPE_MAP,
  SERVANT_JOB_MAP,
  type ItemId,
  type MaterialId,
  type ServantJobId,
} from './content';
import * as engine from './engine';
import * as disciples from './disciples';
import * as expeditions from './expeditions';
import * as crafting from './crafting';
import * as research from './research';
import * as planting from './planting';
import * as shop from './shop';
import * as travel from './travel';
import * as encounter from './encounter';
import * as enlightenment from './enlightenment';
import * as tick from './tick';
import { gameRandom } from './random';
import * as sectActivity from './sectActivity';
import { applyTick } from './tick';
import { createAscendedState, createInitialState, type GameState } from './state';
import {
  applyOffline,
  clearLocal,
  exportCode,
  importCode,
  loadFromLocal,
  saveToLocal,
  type OfflineReport,
} from './save';

export interface GameStore {
  game: GameState;
  offline: OfflineReport | null;
  notice: string | null;
  lastSavedAt: number;

  tick(dt: number): void;

  /* 修行 */
  meditate(): void;
  buy(id: string, count: number | 'max'): void;
  /* ---- 建造队列（需求 2） ---- */
  enqueueBuild(id: string): void;
  dequeueBuild(index: number): void;
  moveQueueItem(index: number, delta: number): void;
  clearBuildQueue(): void;
  /** 天工院的特殊升级：解锁一个建造名额 */
  upgradeQueue(): void;
  advanceLayer(): void;
  breakthrough(usePill: boolean): void;
  refineStone(times: number): void;
  setAutoRefine(level: number): void;
  ascend(): void;
  hardReset(): void;

  /* 个人游历（需求 1） */
  startTravel(regionId: string): void;
  cancelTravel(): void;

  /* 种植（需求 5） */
  plantSeed(material: string): void;
  plantAllSeeds(): void;
  harvest(id: string): void;
  harvestAll(): void;
  hastenPlanting(id: string, currency: planting.HastenCurrency): void;

  /* 钻研（需求 6） */
  startResearch(id: string): void;
  cancelResearch(): void;

  /* 商行（需求 3） */
  buyShopOffer(offerId: string): void;

  /* 仆人 */
  recruitServant(job: string): void;
  assignServant(from: string, to: string): void;
  dismissServant(job: string): void;
  dismissAllServants(): void;

  /* 宗门（需求 4） */
  foundSect(): void;
  upgradeSect(): void;
  recruitDisciple(): void;
  dismissDisciple(id: string): void;
  dismissBelow(rank: number): void;
  /** 开启 / 停办宗门大比（需求 4：比武台由玩家决定是否开启） */
  toggleArena(): void;
  /** 立刻举办一次大比（只有已开启且冷却走完时可用） */
  holdArena(): void;

  /* 秘境 */
  startExpedition(realmId: string, ids: string[]): void;
  /** 掌门独自前往已发现的秘境（需求 5） */
  startSoloRealm(realmId: string): void;
  /** 选择随机遭遇里的某个选项（需求 2） */
  chooseEncounter(optionIndex: number): void;
  /** 合成 / 精炼（需求 4） */
  refine(recipeId: string, times: number): void;
  /* ---- 感悟（需求 3） ---- */
  enlighten(pathId: string): void;
  cancelEnlighten(): void;
  /** 制作空间戒指（需求 3） */
  craftSpaceRing(): void;
  /** 时空穿梭（需求 3） */
  timeJump(): void;
  /** 普通探索（需求 1）：小区域还没发现秘境时只能这么做 */
  startSurvey(regionId: string, ids: string[]): void;

  /* 丹器 */
  craftPill(id: string, count: number): void;
  craftArtifact(id: string, count: number): void;
  upgradeAlchemy(): void;
  upgradeRefining(): void;
  usePill(id: string): void;

  /* 存档 */
  dismissOffline(): void;
  setNotice(message: string | null): void;
  saveNow(): void;
  exportSave(): string;
  importSave(code: string): boolean;
}

/** 启动流程：读档 → 结算离线收益。只在模块加载时执行一次 */
function boot(): { game: GameState; offline: OfflineReport | null } {
  const now = Date.now();
  const loaded = loadFromLocal();
  if (!loaded) return { game: createInitialState(now), offline: null };

  const { state, report } = applyOffline(loaded, now);
  return { game: state, offline: report };
}

const booted = boot();

/**
 * 生成状态变更。状态没变就返回空对象（避免无谓重渲染），
 * 变了则顺带做两件收口的事：刷新建筑解锁、把资源砍回储存上限。
 *
 * 收口在这里的意义是：无论资源是被动涨上来的、丹药瞬间给的、
 * 还是秘境掉落带回来的，都不可能突破上限、也不会漏掉解锁时机。
 */
function nextGame(previous: GameState, next: GameState): { game?: GameState } {
  if (next === previous) return {};
  const refreshed = engine.refreshUnlocks(next);
  return { game: engine.clampResources(refreshed) };
}

export const useGame = create<GameStore>()((set, get) => ({
  game: booted.game,
  offline: booted.offline,
  notice: null,
  lastSavedAt: Date.now(),

  tick: (dt) => {
    set((s) => nextGame(s.game, applyTick(s.game, dt)));
  },

  /* ------------------------------------------------------------ 修行 */

  meditate: () => {
    set((s) => nextGame(s.game, engine.meditate(s.game)));
  },

  buy: (id, count) => {
    set((s) => {
      const def = BUILDABLE_MAP[id];
      if (!def) return {};
      const owned = engine.getBuildingCount(s.game, id);
      const amount = count === 'max' ? engine.maxAffordable(def, owned, s.game) : count;
      if (amount <= 0) return {};
      return nextGame(s.game, engine.buyBuilding(s.game, def, amount));
    });
  },

  /* ---- 建造队列（需求 2） ---- */

  enqueueBuild: (id) => {
    set((s) => {
      if (s.game.buildQueue.length >= engine.getQueueSlots(s.game)) {
        return { notice: '建造队列已满，升级天工院可增加名额' };
      }
      const next = engine.enqueueBuild(s.game, id);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已加入建造队列' };
    });
  },

  dequeueBuild: (index) => {
    set((s) => {
      const next = engine.dequeueBuild(s.game, index);
      return next === s.game ? {} : nextGame(s.game, next);
    });
  },

  moveQueueItem: (index, delta) => {
    set((s) => {
      const next = engine.moveQueueItem(s.game, index, delta);
      return next === s.game ? {} : nextGame(s.game, next);
    });
  },

  clearBuildQueue: () => {
    set((s) => {
      const next = engine.clearQueue(s.game);
      return next === s.game ? {} : nextGame(s.game, next);
    });
  },

  upgradeQueue: () => {
    set((s) => {
      const check = engine.canUpgradeQueue(s.game);
      if (!check.ok) return { notice: check.reason ?? '无法升级' };
      return { ...nextGame(s.game, engine.upgradeQueue(s.game)), notice: '天工院扩建完成，建造名额 +1' };
    });
  },

  advanceLayer: () => {
    set((s) => (engine.canAdvanceLayer(s.game) ? nextGame(s.game, engine.advanceLayer(s.game)) : {}));
  },

  breakthrough: (usePill) => {
    set((s) => {
      const result = engine.breakthrough(s.game, usePill);
      if (!result) return {};

      const realm = engine.getRealm(result.state);
      if (result.success) {
        return { ...nextGame(s.game, result.state), notice: `突破成功，已入${realm.name}！` };
      }
      if (result.injurySeconds > 0) {
        return {
          ...nextGame(s.game, result.state),
          notice: `突破失败（成功率 ${Math.round(result.rate * 100)}%），道伤缠身，${fmtDuration(
            result.injurySeconds,
          )}内无法再度突破`,
        };
      }
      return {
        ...nextGame(s.game, result.state),
        notice: `突破失败（成功率 ${Math.round(result.rate * 100)}%）。境界尚浅，并无大碍，可即刻再试`,
      };
    });
  },

  refineStone: (times) => {
    set((s) => {
      const updated = nextGame(s.game, engine.refineStone(s.game, times));
      return updated.game ? { ...updated, notice: '灵石合成完成' } : {};
    });
  },

  setAutoRefine: (level) => {
    set((s) => {
      const clamped = Math.min(Math.max(Math.floor(level), 0), AUTO_REFINE_LEVEL_MAX);
      if (clamped === s.game.autoRefineLevel) return {};
      const rate = clamped > 0 ? engine.getAutoRefineRate({ ...s.game, autoRefineLevel: clamped }) : 0;
      return {
        game: { ...s.game, autoRefineLevel: clamped, autoRefineProgress: clamped > 0 ? s.game.autoRefineProgress : 0 },
        notice:
          clamped === 0
            ? '已关闭灵石自动合成'
            : `灵石自动合成已开启（${rate} 批/秒）`,
      };
    });
  },

  /* ------------------------------------------------------ 个人游历（需求 1） */

  startTravel: (regionId) => {
    set((s) => {
      const check = travel.canStartTravel(s.game, regionId);
      if (!check.ok) return { notice: check.reason ?? '无法出行' };
      const next = travel.startTravel(s.game, regionId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '掌门已启程，洞府产量下降' };
    });
  },

  cancelTravel: () => {
    set((s) => {
      if (!s.game.personalTravel) return { notice: '掌门并未在外' };
      return { ...nextGame(s.game, travel.cancelTravel(s.game)), notice: '掌门已折返' };
    });
  },

  /* --------------------------------------------------------- 种植（需求 5） */

  plantSeed: (material) => {
    set((s) => {
      const check = planting.canPlant(s.game, material as MaterialId);
      if (!check.ok) return { notice: check.reason ?? '无法种植' };
      const next = planting.plantSeed(s.game, material as MaterialId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已种下种子' };
    });
  },

  plantAllSeeds: () => {
    set((s) => {
      const next = planting.plantAll(s.game);
      if (next === s.game) return { notice: '没有可种的种子，或地块已满' };
      return {
        ...nextGame(s.game, next),
        notice: `已种下 ${next.plantings.length - s.game.plantings.length} 块地`,
      };
    });
  },

  harvest: (id) => {
    set((s) => {
      const result = planting.harvestPlanting(s.game, id);
      if (result.gains.length === 0) return { notice: '这块地还没成熟' };
      const gain = result.gains[0];
      return { ...nextGame(s.game, result.state), notice: `收获 ${gain.name}×${gain.amount}` };
    });
  },

  harvestAll: () => {
    set((s) => {
      const result = planting.harvestAll(s.game);
      if (result.gains.length === 0) return { notice: '没有成熟的地块' };
      const summary = result.gains.map((g) => `${g.name}×${g.amount}`).join('、');
      return { ...nextGame(s.game, result.state), notice: `收获 ${summary}` };
    });
  },

  hastenPlanting: (id, currency) => {
    set((s) => {
      const result = planting.hastenPlanting(s.game, id, currency);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  /* --------------------------------------------------------- 钻研（需求 6） */

  startResearch: (id) => {
    set((s) => {
      const check = research.canStartResearch(s.game, id);
      if (!check.ok) return { notice: check.reason ?? '无法钻研' };
      const next = research.startResearch(s.game, id);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已开始钻研' };
    });
  },

  cancelResearch: () => {
    set((s) => {
      if (!s.game.research) return { notice: '当前没有在钻研的技术' };
      return { ...nextGame(s.game, research.cancelResearch(s.game)), notice: '已放弃钻研，材料不退' };
    });
  },

  /* --------------------------------------------------------- 商行（需求 3） */

  buyShopOffer: (offerId) => {
    set((s) => {
      const result = shop.buyShopOffer(s.game, offerId);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  ascend: () => {
    set((s) => {
      if (!engine.canAscend(s.game)) return {};
      const gain = engine.getDaoYunGain(s.game);
      const next = createAscendedState(s.game, gain, Date.now());
      saveToLocal(next);
      return {
        ...nextGame(s.game, next),
        notice: `飞升成功！获得 ${fmt(gain)} 点道韵`,
        lastSavedAt: Date.now(),
      };
    });
  },

  hardReset: () => {
    const fresh = createInitialState(Date.now());
    clearLocal();
    saveToLocal(fresh);
    set({ game: fresh, offline: null, notice: '已重开修行', lastSavedAt: Date.now() });
  },

  /* ------------------------------------------------------------ 仆人 */

  recruitServant: (job) => {
    set((s) => {
      const check = engine.canRecruitServant(s.game);
      if (!check.ok) return { notice: check.reason ?? '无法招收' };
      const next = engine.recruitServant(s.game, job as ServantJobId);
      if (next === s.game) return {};
      const def = SERVANT_JOB_MAP[job as ServantJobId];
      return {
        ...nextGame(s.game, next),
        notice: `一名仆人来到洞府，安排去${def?.name ?? '做事'}`,
      };
    });
  },

  assignServant: (from, to) => {
    set((s) => {
      const next = engine.assignServant(s.game, from as ServantJobId, to as ServantJobId);
      if (next === s.game) return {};
      const def = SERVANT_JOB_MAP[to as ServantJobId];
      return { ...nextGame(s.game, next), notice: `一名仆人改派去${def?.name ?? '做事'}` };
    });
  },

  dismissServant: (job) => {
    set((s) => {
      const next = engine.dismissServant(s.game, job as ServantJobId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已遣散一名仆人，腾出一间居所' };
    });
  },

  dismissAllServants: () => {
    set((s) => {
      const count = engine.getServantCount(s.game);
      if (count === 0) return { notice: '当前没有仆人' };
      return {
        ...nextGame(s.game, engine.dismissAllServants(s.game)),
        notice: `已遣散全部 ${count} 名仆人`,
      };
    });
  },

  /* ------------------------------------------------------------ 宗门 */

  foundSect: () => {
    set((s) => {
      const updated = nextGame(s.game, engine.foundSect(s.game));
      return updated.game ? { ...updated, notice: '开宗立派！' } : {};
    });
  },

  upgradeSect: () => {
    set((s) => {
      const status = engine.getSectUpgradeStatus(s.game);
      if (!status.possible) return { notice: status.reason ?? '暂不可晋升' };
      const next = engine.upgradeSect(s.game);
      return {
        ...nextGame(s.game, next),
        notice: `宗门晋升为${engine.getSectLevelDef(next.sect.level).name}`,
      };
    });
  },

  recruitDisciple: () => {
    set((s) => {
      const result = disciples.recruitDisciple(s.game);
      if (!result.disciple) return { notice: result.reason ?? '招收失败' };
      return {
        ...nextGame(s.game, result.state),
        notice: `${result.disciple.name} 拜入宗门`,
      };
    });
  },

  dismissDisciple: (id) => {
    set((s) => {
      const target = s.game.sect.disciples.find((d) => d.id === id);
      if (!target) return {};
      if (target.status === 'exploring') return { notice: `${target.name} 正在探索，无法逐出` };
      return {
        ...nextGame(s.game, disciples.dismissDisciple(s.game, id)),
        notice: `${target.name} 已被逐出宗门`,
      };
    });
  },

  dismissBelow: (rank) => {
    set((s) => {
      const result = disciples.dismissBelowAptitude(s.game, rank);
      if (result.count === 0) return { notice: '没有符合条件的弟子' };
      return {
        ...nextGame(s.game, result.state),
        notice: `已逐出 ${result.count} 名低资质弟子`,
      };
    });
  },

  toggleArena: () => {
    set((s) => {
      if (!sectActivity.hasArena(s.game)) return { notice: '尚未建成比武台' };
      const enabled = !s.game.arenaEnabled;
      return {
        game: {
          ...s.game,
          arenaEnabled: enabled,
          // 开启时给一个满周期，免得一开就立刻开比
          arenaTimer: enabled ? sectActivity.ARENA_INTERVAL_SECONDS : s.game.arenaTimer,
        },
        notice: enabled ? '宗门大比已开启，十年一比' : '宗门大比已停办',
      };
    });
  },

  holdArena: () => {
    set((s) => {
      if (!sectActivity.isArenaRunning(s.game)) return { notice: '需先建成比武台并开启大比' };
      if (s.game.arenaTimer > 0) {
        return { notice: `距下次大比还有 ${fmtDuration(s.game.arenaTimer)}` };
      }
      const result = sectActivity.runArena(s.game);
      return {
        ...nextGame(s.game, result.state),
        notice: `大比落幕，${result.participants} 名弟子各得心得，全宗修行加速一年`,
      };
    });
  },

  /* ------------------------------------------------------------ 秘境 */

  /** 合成 / 精炼（需求 4） */
  refine: (recipeId, times) => {
    set((s) => {
      const recipe = REFINE_RECIPE_MAP[recipeId];
      if (!recipe) return {};
      const next = engine.refine(s.game, recipeId, times);
      if (next === s.game) return { notice: '材料不足，或还没到能合成的境界' };
      const out = ITEM_MAP[recipe.output.item as ItemId];
      return {
        ...nextGame(s.game, next),
        notice: `合成完成：${out?.icon ?? ''}${out?.name ?? recipe.output.item} ×${recipe.output.amount * times}`,
      };
    });
  },

  /* ---- 感悟（需求 3） ---- */

  enlighten: (pathId) => {
    set((s) => {
      const check = enlightenment.canEnlighten(s.game, pathId);
      if (!check.ok) return { notice: check.reason ?? '无法感悟' };
      return { ...nextGame(s.game, enlightenment.startEnlighten(s.game, pathId)), notice: '开始感悟' };
    });
  },

  cancelEnlighten: () => {
    set((s) => {
      const next = enlightenment.cancelEnlighten(s.game);
      return next === s.game ? {} : { ...nextGame(s.game, next), notice: '感悟已中断（投入的资源不退）' };
    });
  },

  craftSpaceRing: () => {
    set((s) => {
      const check = enlightenment.canCraftSpaceRing(s.game);
      if (!check.ok) return { notice: check.reason ?? '无法制作' };
      return { ...nextGame(s.game, enlightenment.craftSpaceRing(s.game)), notice: '空间戒指已成' };
    });
  },

  /**
   * 时空穿梭（需求 3）。
   *
   * 结算就是把一大段时间交给 `applyTick` —— 所以产出、钻研、灵植、
   * 弟子的修炼与寿元、秘境冷却全都会按"这些时间真的过了一遍"来算。
   */
  timeJump: () => {
    set((s) => {
      const check = enlightenment.canTimeJump(s.game);
      if (!check.ok) return { notice: check.reason ?? '还不能穿梭' };
      const years = enlightenment.getTimeJumpYears(s.game);
      const next = enlightenment.doTimeJump(s.game, (g, dt) => tick.applyTick(g, dt, gameRandom));
      return { ...nextGame(s.game, next), notice: `时空穿梭 ${years} 年` };
    });
  },

  chooseEncounter: (optionIndex) => {
    set((s) => {
      const result = encounter.chooseEncounterOption(s.game, optionIndex);
      if (!result.outcome) return { notice: '这个选择现在做不了' };
      const o = result.outcome;
      const loot = o.gains
        .map((g) => `${g.icon}${g.name}${g.amount > 0 ? '+' : ''}${g.amount}`)
        .join(' ');
      return {
        ...nextGame(s.game, result.state),
        notice: `${o.text}${loot ? `（${loot}）` : ''}`,
      };
    });
  },

  startSoloRealm: (realmId) => {
    set((s) => {
      const check = travel.canStartSoloRealm(s.game, realmId);
      if (!check.ok) return { notice: check.reason ?? '无法前往' };
      return {
        ...nextGame(s.game, travel.startSoloRealm(s.game, realmId)),
        notice: '掌门已独自前往秘境（洞府产量下降）',
      };
    });
  },

  startExpedition: (realmId, ids) => {
    set((s) => {
      const check = expeditions.canStartExpedition(s.game, realmId, ids);
      if (!check.ok) return { notice: check.reason ?? '无法派遣' };
      return {
        ...nextGame(s.game, expeditions.startExpedition(s.game, realmId, ids)),
        notice: '已派遣弟子前往探索',
      };
    });
  },

  /* 普通探索（需求 1）：还没发现秘境的小区域只能这么探 */
  startSurvey: (regionId, ids) => {
    set((s) => {
      const check = expeditions.canStartSurvey(s.game, regionId, ids);
      if (!check.ok) return { notice: check.reason ?? '无法派遣' };
      return {
        ...nextGame(s.game, expeditions.startSurvey(s.game, regionId, ids)),
        notice: '已派遣弟子在附近做普通探索',
      };
    });
  },

  /* ------------------------------------------------------------ 丹器 */

  craftPill: (id, count) => {
    set((s) => {
      const check = crafting.canCraftPill(s.game, id);
      if (!check.ok) return { notice: check.reason ?? '无法炼制' };
      const next = crafting.craftPill(s.game, id, count);
      if (next === s.game) return { notice: '材料不足' };
      return { ...nextGame(s.game, next), notice: '丹药炼成' };
    });
  },

  craftArtifact: (id, count) => {
    set((s) => {
      const check = crafting.canCraftArtifact(s.game, id);
      if (!check.ok) return { notice: check.reason ?? '无法炼制' };
      const next = crafting.craftArtifact(s.game, id, count);
      if (next === s.game) return { notice: '材料不足' };
      return { ...nextGame(s.game, next), notice: '器物出炉' };
    });
  },

  upgradeAlchemy: () => {
    set((s) => {
      const status = crafting.getAlchemyUpgradeStatus(s.game);
      if (!status.possible) return { notice: status.reason ?? '无法提升' };
      const next = crafting.upgradeAlchemy(s.game);
      return { ...nextGame(s.game, next), notice: `炼丹术精进至 ${next.alchemyTier} 品` };
    });
  },

  upgradeRefining: () => {
    set((s) => {
      const status = crafting.getRefiningUpgradeStatus(s.game);
      if (!status.possible) return { notice: status.reason ?? '无法提升' };
      const next = crafting.upgradeRefining(s.game);
      return { ...nextGame(s.game, next), notice: `炼器术精进至 ${next.refiningTier} 品` };
    });
  },

  usePill: (id) => {
    set((s) => {
      const result = crafting.usePill(s.game, id);
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  /* ------------------------------------------------------------ 存档 */

  dismissOffline: () => set({ offline: null }),

  setNotice: (message) => set({ notice: message }),

  saveNow: () => {
    const ok = saveToLocal(get().game);
    set({ lastSavedAt: Date.now(), notice: ok ? null : '存档失败（浏览器存储不可用）' });
  },

  exportSave: () => exportCode(get().game),

  importSave: (code) => {
    const loaded = importCode(code);
    if (!loaded) {
      set({ notice: '存档码无法识别，请检查是否复制完整' });
      return false;
    }
    const now = Date.now();
    const { state, report } = applyOffline(loaded, now);
    saveToLocal(state);
    set({ game: state, offline: report, notice: '存档导入成功', lastSavedAt: now });
    return true;
  },
}));
