/**
 * 统一的「面板」外壳（需求 7）
 *
 * 需求原文：「洞府界面，各个子门类可以展开和收起」。
 *
 * 各面板原来各自写着 `<section className="panel">` + `<div className="panel__head">`，
 * 要加折叠就得改十几处、而且迟早会走样。所以抽成这一个组件：
 *   - `collapsible` 为 false 时行为和以前完全一样（标题栏不可点）；
 *   - 为 true 时标题栏变成开关，右侧有一个箭头，状态记在 localStorage 里，
 *     刷新之后还保持玩家上次的折叠选择。
 */
import { useEffect, useState, type ReactNode } from 'react';

const STORAGE_PREFIX = 'xiantu.panel.';

function readCollapsed(key: string, defaultOpen: boolean): boolean {
  if (typeof localStorage === 'undefined') return !defaultOpen;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return !defaultOpen;
    return raw === '1';
  } catch {
    return !defaultOpen;
  }
}

function writeCollapsed(key: string, collapsed: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, collapsed ? '1' : '0');
  } catch {
    /* 隐私模式下写不进去就算了，折叠状态不值得报错 */
  }
}

export interface PanelProps {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  /** 能不能折叠（需求 7） */
  collapsible?: boolean;
  /** 默认展开还是收起 */
  defaultOpen?: boolean;
  /** 记住折叠状态用的键；不给就用标题的文本 */
  storageKey?: string;
  className?: string;
}

export function Panel({
  title,
  hint,
  children,
  collapsible = false,
  defaultOpen = true,
  storageKey,
  className,
}: PanelProps) {
  const key = storageKey ?? (typeof title === 'string' ? title : undefined);
  const [collapsed, setCollapsed] = useState(() =>
    collapsible && key ? readCollapsed(key, defaultOpen) : !defaultOpen,
  );

  useEffect(() => {
    if (collapsible && key) writeCollapsed(key, collapsed);
  }, [collapsible, key, collapsed]);

  const head = (
    <>
      <h2>{title}</h2>
      <span className="panel__hint">{hint}</span>
      {collapsible && <span className="panel__chevron">{collapsed ? '▸' : '▾'}</span>}
    </>
  );

  return (
    <section className={[className, 'panel', collapsed ? 'panel--collapsed' : ''].filter(Boolean).join(' ')}>
      {collapsible ? (
        <button
          type="button"
          className="panel__head panel__head--toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {head}
        </button>
      ) : (
        <div className="panel__head">{head}</div>
      )}
      {!collapsed && <div className="panel__body">{children}</div>}
    </section>
  );
}

export default Panel;
