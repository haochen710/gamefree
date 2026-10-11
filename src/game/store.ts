/**
 * 全局状态容器（zustand）。
 *
 * 每个动作都是「读当前 state → 用 engine 的纯函数算出新 state → set」，
 * 这样游戏逻辑和 React 完全解耦，将来想换成 Redux 或做联机都不难。
 */
import { create } from 'zustand';
import { fmt } from './decimal';
import { GENERATOR_MAP } from './content';
import * as engine from './engine';
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
  /** 本次进入游戏时的离线结算结果，null 表示没有（或已关闭弹窗） */
  offline: OfflineReport | null;
  /** 顶部飘一条提示 */
  notice: string | null;
  /** 上次成功存档的时间戳，用于界面显示 */
  lastSavedAt: number;

  tick(dt: number): void;
  meditate(): void;
  buy(id: string, count: number | 'max'): void;
  advanceLayer(): void;
  breakthrough(): void;
  ascend(): void;
  hardReset(): void;

  dismissOffline(): void;
  setNotice(message: string | null): void;
  saveNow(): void;
  exportSave(): string;
  importSave(code: string): boolean;
}

/**
 * 启动流程：读档 → 结算离线收益 → 得到初始状态。
 * 只在模块加载时执行一次。
 */
function boot(): { game: GameState; offline: OfflineReport | null } {
  const now = Date.now();
  const loaded = loadFromLocal();
  if (!loaded) return { game: createInitialState(now), offline: null };

  const { state, report } = applyOffline(loaded, now);
  return { game: state, offline: report };
}

const booted = boot();

export const useGame = create<GameStore>()((set, get) => ({
  game: booted.game,
  offline: booted.offline,
  notice: null,
  lastSavedAt: Date.now(),

  tick: (dt) => {
    set((s) => ({ game: engine.applyTick(s.game, dt) }));
  },

  meditate: () => {
    set((s) => ({ game: engine.meditate(s.game) }));
  },

  buy: (id, count) => {
    const def = GENERATOR_MAP[id];
    if (!def) return;

    set((s) => {
      const owned = s.game.generators[id] ?? 0;
      const amount = count === 'max' ? engine.maxAffordable(def, owned, s.game.resources) : count;
      if (amount <= 0) return {};
      return { game: engine.buyGenerator(s.game, def, amount) };
    });
  },

  advanceLayer: () => {
    set((s) => {
      if (!engine.canAdvanceLayer(s.game)) return {};
      return { game: engine.advanceLayer(s.game) };
    });
  },

  breakthrough: () => {
    set((s) => {
      if (!engine.getBreakthroughStatus(s.game).possible) return {};
      const next = engine.breakthrough(s.game);
      return {
        game: next,
        notice: `突破成功，已入${engine.getRealm(next).name}！`,
      };
    });
  },

  ascend: () => {
    set((s) => {
      if (!engine.canAscend(s.game)) return {};
      const gain = engine.getDaoYunGain(s.game);
      const next = createAscendedState(s.game, gain, Date.now());
      saveToLocal(next);
      return {
        game: next,
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
