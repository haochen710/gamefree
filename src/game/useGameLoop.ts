/**
 * 主循环：驱动游戏时间前进 + 定时自动存档。
 *
 * 用固定间隔 + 真实时间差（dt）推进，而不是"每次 tick 加固定产量"。
 * 这样浏览器把后台标签页降频到 1 秒一次时，产量依然是准确的。
 */
import { useEffect } from 'react';
import { useGame } from './store';
import { MAX_TICK_SECONDS } from './tick';

/** 主循环间隔（毫秒）。200ms ≈ 5 帧/秒，对放置游戏足够流畅 */
export const TICK_MS = 200;
/** 自动存档间隔（毫秒） */
export const AUTOSAVE_MS = 10_000;

export function useGameLoop(): void {
  useEffect(() => {
    let last = performance.now();

    const tickId = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, MAX_TICK_SECONDS);
      last = now;
      if (dt > 0) useGame.getState().tick(dt);
    }, TICK_MS);

    const saveId = window.setInterval(() => {
      useGame.getState().saveNow();
    }, AUTOSAVE_MS);

    // 切到后台 / 关页面时立刻存一次，避免丢进度
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') useGame.getState().saveNow();
    };
    const handleUnload = () => {
      useGame.getState().saveNow();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.clearInterval(tickId);
      window.clearInterval(saveId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);
}
