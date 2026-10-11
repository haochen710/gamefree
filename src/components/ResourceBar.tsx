/**
 * 资源与材料栏：显示存量、产量、储存上限与**满仓倒计时**（需求 3）
 *
 * 需求原文：
 *   「基础资源显示框里面同时显示资源满时所需的时间，资源展示界面，
 *     不同种类的资源做划分，分别可以展开和收起。
 *     并且删除资源展示界面最底下有关纪年等的内容」
 *
 * 三件事分别落在：
 *   - **满时所需时间** —— 每小时产量能填满多少，直观回答"我还能挂多久"。
 *     满了、或产率为 0 时不给数字，而是给一句更准确的话。
 *   - **分组可折叠** —— 基础资源 / 基础材料 / 进阶材料 三组各自展开收起，
 *     状态记在 localStorage 里（和面板折叠同一套）。
 *   - **删掉纪年** —— 原来资源栏下面挂着季节与纪年的常驻条，现在纪年移到
 *     页面右上角（见 Header），资源栏只剩资源本身。
 */
import { useEffect, useState } from 'react';
import { D, fmt, fmtDuration, fmtRate } from '../game/decimal';
import { MATERIALS, RESOURCES, RARITY_COLORS, type MaterialDef } from '../game/content';
import { getProduction, getStorageCaps } from '../game/engine';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';

const STORAGE_PREFIX = 'xiantu.resgroup.';

/**
 * 距离填满还差多久（秒）。
 *
 * 返回 null 表示"这个数字没有意义"：已经满了、产率为 0、或者上限为 0。
 * 这三种情况界面会给不同的说法，而不是硬塞一个 ∞。
 */
export function secondsToFull(amount: ReturnType<typeof D>, cap: ReturnType<typeof D>, rate: ReturnType<typeof D>): number | null {
  if (cap.lte(0)) return null;
  if (amount.gte(cap)) return null;
  if (rate.lte(0)) return null;
  const missing = cap.sub(amount);
  const seconds = missing.div(rate).toNumber();
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // 超过 100 天的就不必报了，那和"永远填不满"在体感上没区别
  if (seconds > 86400 * 100) return null;
  return seconds;
}

/** 满仓倒计时那一行的文案 */
export function describeFullIn(amount: ReturnType<typeof D>, cap: ReturnType<typeof D>, rate: ReturnType<typeof D>): string {
  if (cap.lte(0)) return '无上限';
  if (amount.gte(cap)) return '已满';
  if (rate.lte(0)) return '无产出';
  const seconds = secondsToFull(amount, cap, rate);
  if (seconds === null) return '很久以后';
  return `${fmtDuration(seconds)}后满`;
}

function useCollapsed(key: string, defaultOpen = true): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof localStorage === 'undefined') return !defaultOpen;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw === null ? !defaultOpen : raw === '1';
    } catch {
      return !defaultOpen;
    }
  });
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_PREFIX + key, collapsed ? '1' : '0');
    } catch {
      /* 忽略 */
    }
  }, [key, collapsed]);
  return [collapsed, () => setCollapsed((v) => !v)];
}

function Group({
  id,
  title,
  count,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(id, defaultOpen);
  return (
    <div className={collapsed ? 'res-group res-group--collapsed' : 'res-group'}>
      <button type="button" className="res-group__head" aria-expanded={!collapsed} onClick={toggle}>
        <span className="res-group__chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="res-group__title">{title}</span>
        <span className="res-group__count">{count}</span>
      </button>
      {!collapsed && <div className="res-group__body">{children}</div>}
    </div>
  );
}

function MaterialCard({ def, game }: { def: MaterialDef; game: GameState }) {
  const amount = game.materials[def.id];
  return (
    <div className="resource resource--material" title={def.desc}>
      <div className="resource__head">
        <span className="resource__icon" style={{ color: RARITY_COLORS[def.rarity] }}>
          {def.icon}
        </span>
        <span className="resource__name">{def.name}</span>
        <span
          className={
            def.category === 'rare'
              ? 'material-tag material-tag--rare'
              : def.category === 'refined'
                ? 'material-tag material-tag--refined'
                : 'material-tag'
          }
        >
          {def.category === 'rare' ? '稀有' : def.category === 'refined' ? '进阶' : '基础'}
        </span>
      </div>
      <div className="resource__amount" style={{ color: RARITY_COLORS[def.rarity] }}>
        {fmt(amount)}
      </div>
      <div className="resource__rate resource__rate--zero">
        {def.category === 'refined' ? '合成获得 · 无上限' : '游历 / 探索 / 种植 · 无上限'}
      </div>
    </div>
  );
}

export function ResourceBar() {
  const game = useGame((s) => s.game);
  const production = getProduction(game);
  const caps = getStorageCaps(game);

  // 材料在开宗立派（也就是第一次能接触秘境）之前不显示，避免开局一堆看不懂的东西；
  // 之后即使归零也保留，免得玩家以为东西丢了。
  const showMaterials = game.sect.founded || MATERIALS.some((m) => game.materials[m.id].gt(0));

  const baseMaterials = showMaterials ? MATERIALS.filter((m) => m.category === 'base') : [];
  const rareMaterials = showMaterials ? MATERIALS.filter((m) => m.category === 'rare') : [];
  const refinedMaterials = showMaterials ? MATERIALS.filter((m) => m.category === 'refined') : [];

  return (
    <section className="resource-bar">
      {/* 需求 3：不同种类的资源分开、各自可折叠 */}
      <Group id="resources" title="基础资源" count={RESOURCES.length}>
        {RESOURCES.map((def) => {
          const amount = game.resources[def.id];
          const cap = caps[def.id];
          const rate = production[def.id];
          const idle = amount.eq(0) && rate.eq(0);
          // 灵气是卡进度的瓶颈资源，满了就是实打实的损失，标红；
          // 灵木灵矿这类副资源给人留了充足余量，满了只是提醒，标黄即可
          const full = amount.gte(cap);
          const critical = full && def.id === 'qi';
          const nearly = !full && cap.gt(0) && amount.div(cap).gte(0.9);

          const className = [
            'resource',
            idle ? 'resource--idle' : '',
            critical ? 'resource--full' : full ? 'resource--capped' : nearly ? 'resource--nearly' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={def.id} className={className} title={def.desc}>
              <div className="resource__head">
                <span className="resource__icon">{def.icon}</span>
                <span className="resource__name">{def.name}</span>
              </div>
              <div className="resource__amount">
                {fmt(amount)}
                <span className="resource__cap">/ {fmt(cap)}</span>
              </div>
              <div
                className={
                  full
                    ? critical
                      ? 'resource__rate resource__rate--full'
                      : 'resource__rate resource__rate--capped'
                    : rate.gt(0)
                      ? 'resource__rate'
                      : 'resource__rate resource__rate--zero'
                }
              >
                {critical ? '已满 · 产量全部溢出' : full ? '已满' : fmtRate(rate)}
              </div>
              {/* 需求 3：还要显示"照这个速度多久填满" */}
              <div className="resource__eta">{describeFullIn(amount, cap, rate)}</div>
            </div>
          );
        })}
      </Group>

      {baseMaterials.length > 0 && (
        <Group id="matBase" title="基础材料" count={baseMaterials.length}>
          {baseMaterials.map((def) => (
            <MaterialCard key={def.id} def={def} game={game} />
          ))}
        </Group>
      )}

      {rareMaterials.length > 0 && (
        <Group id="matRare" title="稀有材料" count={rareMaterials.length} defaultOpen={false}>
          {rareMaterials.map((def) => (
            <MaterialCard key={def.id} def={def} game={game} />
          ))}
        </Group>
      )}

      {refinedMaterials.length > 0 && (
        <Group id="matRefined" title="进阶材料" count={refinedMaterials.length}>
          {refinedMaterials.map((def) => (
            <MaterialCard key={def.id} def={def} game={game} />
          ))}
        </Group>
      )}
    </section>
  );
}

export default ResourceBar;
