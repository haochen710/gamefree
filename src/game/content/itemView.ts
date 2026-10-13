/**
 * 任意物品 id → 名字与图标（本轮需求 3）
 *
 * 本作的"物品"分散在四张表里：资源（`RESOURCE_MAP`）、材料与器物（`ITEM_MAP`）、
 * 符箓（`TALISMAN_MAP`）、图纸（`BLUEPRINT_MAP`）。在符箓可以当建筑材料之前，
 * 各处界面都是 `ITEM_MAP[id]?.name ?? id` 这样写的 —— 于是符箓会显示成
 * `spiritBasic` 这种英文 id（这正是第 17 轮那个"英文材料名"bug 的同族）。
 *
 * ⚠️ 所以统一走这一个函数：**一个效果只能有一个实现**。
 * 以后再加"能当材料的新玩意"，只要在这里加一张表。
 */
import { ITEM_MAP, RESOURCE_MAP } from './resources';
import { BLUEPRINT_MAP } from './techs';
import { TALISMAN_MAP } from './talismans';

export interface ItemView {
  name: string;
  icon: string;
}

const FALLBACK: ItemView = { name: '', icon: '📦' };

/** 名字与图标；认不出来时 name 回落到 id 本身 */
export function itemView(id: string): ItemView {
  const resource = RESOURCE_MAP[id as keyof typeof RESOURCE_MAP];
  if (resource) return { name: resource.name, icon: resource.icon };

  const item = ITEM_MAP[id as keyof typeof ITEM_MAP];
  if (item) return { name: item.name, icon: item.icon };

  const talisman = TALISMAN_MAP[id];
  if (talisman) return { name: talisman.name, icon: talisman.icon };

  const blueprint = BLUEPRINT_MAP[id];
  if (blueprint) return { name: blueprint.name, icon: blueprint.icon };

  return { name: id, icon: FALLBACK.icon };
}

/** 只要名字（认不出来时就是 id） */
export function itemName(id: string): string {
  return itemView(id).name;
}

/** 只要图标 */
export function itemIcon(id: string): string {
  return itemView(id).icon;
}
