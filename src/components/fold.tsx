/**
 * 折叠状态的公共钩子（需求 2 / 3 / 7）
 *
 * 界面上要折叠的东西已经有四类：面板、资源分组、建筑分组、丹药 / 器物按品阶分组。
 * 每类都自己写一遍 `useState` + localStorage 会漂，所以统一到这里。
 *
 * 键带前缀，方便将来一次性清掉；读不到或写不进（隐私模式）就退回默认值。
 */
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'xiantu.fold.';

function read(key: string, defaultOpen: boolean): boolean {
  if (typeof localStorage === 'undefined') return !defaultOpen;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return !defaultOpen;
    return raw === '1';
  } catch {
    return !defaultOpen;
  }
}

function write(key: string, collapsed: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFIX + key, collapsed ? '1' : '0');
  } catch {
    /* 隐私模式下写不进去就算了 —— 折叠状态不值得报错 */
  }
}

/** 返回 [是否收起, 切换] */
export function useCollapsed(key: string, defaultOpen = true): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => read(key, defaultOpen));

  useEffect(() => {
    write(key, collapsed);
  }, [key, collapsed]);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);
  return [collapsed, toggle];
}

/** 折叠区的通用外壳：一个可点的标题 + 展开时的内容 */
export function FoldSection({
  title,
  hint,
  count,
  storageKey,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  hint?: string;
  count?: number | string;
  storageKey: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(storageKey, defaultOpen);
  return (
    <div className={[collapsed ? 'fold fold--collapsed' : 'fold', className].filter(Boolean).join(' ')}>
      <button type="button" className="fold__head" aria-expanded={!collapsed} onClick={toggle}>
        <span className="fold__chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="fold__title">{title}</span>
        {hint && <span className="fold__hint">{hint}</span>}
        {count !== undefined && <span className="fold__count">{count}</span>}
      </button>
      {!collapsed && <div className="fold__body">{children}</div>}
    </div>
  );
}

export default useCollapsed;
