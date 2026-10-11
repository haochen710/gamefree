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
import { BUILDABLE_MAP, SERVANT_JOB_MAP, type ServantJobId } from './content';
import * as engine from './engine';
import * as disciples from './disciples';
import * as expeditions from './expeditions';
import * as crafting from './crafting';
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
  advanceLayer(): void;
  breakthrough(usePill: boolean): void;
  refineStone(times: number): void;
  ascend(): void;
  hardReset(): void;

  /* 仆人 */
  recruitServant(job: string): void;
  assignServant(from: string, to: string): void;
  dismissServant(job: string): void;
  dismissAllServants(): void;

  /* 宗门 */
  foundSect(): void;
  upgradeSect(): void;
  recruitDisciple(): void;
  dismissDisciple(id: string): void;
  dismissBelow(rank: number): void;

  /* 秘境 */
  startExpedition(realmId: string, ids: string[]): void;

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

  /* ------------------------------------------------------------ 秘境 */

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
