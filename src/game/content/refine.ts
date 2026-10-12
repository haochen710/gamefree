/**
 * 合成 / 精炼（需求 4）
 *
 * 需求原文：
 *   「增加进阶资源，可有基础资源合成获取，当前只有灵石合成，过于单调，
 *     进阶资源可用于商行交易或者炼丹炼器，这块需要你重新设计一下」
 *
 * 原来的"合成"只有一条：灵气 + 灵矿 → 灵石。它其实是把**主资源**换成**通货**，
 * 跟"进阶"两个字没关系。所以这里把它重做成一条**三级的加工链**：
 *
 *   基础资源（灵气/灵木/灵矿/灵石/灵草）
 *     ├─→ 灵液 spiritEssence → 炼丹（四品以上的丹方作引）
 *     ├─→ 精金 refinedGold   → 炼器（五品以上的器物主料）
 *     ├─→ 阵枢 arrayCore     → 阵法与宗门建筑（宗门大阵的核心件）
 *     └─→ 灵石 stone         → 通货（保留原来那条，它仍然是最基础的一条）
 *
 * 三条支线各有**唯一出口**，所以"缺哪个该去合成哪个"是一眼能看明白的；
 * 而它们又都不能种、不能从秘境掉 —— 想要就得动手合成。
 *
 * ⚠️ 合成是**立刻完成**的（和原来的灵石合成一致），不占时间。
 * 需求 3 的时空穿梭要结算"在对应时间内能完成的任务"，
 * 即时合成天然不受影响 —— 这一点在那边有单独说明。
 */
import type { ItemId } from './resources';

export interface RefineRecipe {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 一次合成的消耗 */
  cost: Partial<Record<ItemId, number>>;
  /** 一次合成的产出 */
  output: { item: ItemId; amount: number };
  /** 境界门槛（下标对应 REALMS） */
  requiresRealm: number;
  /** 钻研门槛 */
  requiresTech?: string;
}

/**
 * 一次点击合成几批。
 *
 * 给个"批量"档位，否则中期开始合一次只出 1 个灵液、要点几百下。
 */
export const REFINE_BATCHES = [1, 10, 100] as const;

export const REFINE_RECIPES: RefineRecipe[] = [
  {
    id: 'stoneRefine',
    name: '灵石合成',
    icon: '💠',
    /*
     * 本轮需求 5：「灵石合成需求资源有点多了，前期没啥用，后期更没啥用，减少资源需求」。
     *
     * 原来是 5000 灵气 + 500 灵矿 → 25 灵石 —— 开局要攒半天才能合一次，
     * 中后期灵石矿的产量又把这条路挤没了，两头都用不上。
     * 现在降到 800 + 100。`STONE_REFINE_COST` / `STONE_REFINE_OUTPUT`
     * 直接从这个配方**推导**（见文件末尾），不再各存一份 ——
     * 那两份副本这一轮就漂过一次：UI 按新价显示、实际合成按旧价扣。
     */
    desc: '灵气与灵矿压成灵石。最早的一条合成线，也是开局没矿时的应急手段。',
    cost: { qi: 800, ore: 100 },
    output: { item: 'stone', amount: 25 },
    requiresRealm: 0,
  },
  {
    id: 'spiritEssenceRefine',
    name: '熬炼灵液',
    icon: '💧',
    desc: '以灵气反复煎熬灵草，取其精华。四品以上的丹方都要用它作引。',
    cost: { qi: 2e4, herb: 6000 },
    output: { item: 'spiritEssence', amount: 1 },
    /*
     * ⚠️ 门槛从「金丹期」下调到「筑基期」（本轮需求 3）。
     *
     * 原因是一条**真的死循环**：凝金丹（3 品）是用来从筑基突破到金丹的，
     * 而升到炼丹 3 品要 2 份灵液 —— 灵液却要金丹期才能合成。
     * 也就是说"想突破金丹就得先到金丹"。降到筑基之后这条链才走得通：
     *   筑基期 → 熬灵液 → 升炼丹 3 品 → 炼凝金丹 → 突破金丹。
     */
    requiresRealm: 1,
    requiresTech: 'alchemyArt',
  },
  {
    id: 'refinedGoldRefine',
    name: '百炼精金',
    icon: '🥇',
    desc: '灵矿与灵石同炉百炼，去尽杂质。五品以上的器物非它不成。',
    cost: { ore: 9000, stone: 2500 },
    output: { item: 'refinedGold', amount: 1 },
    /*
     * 同样是本轮需求 3 下调的一档：门槛从「元婴期」降到「金丹期」。
     * 升炼器 3 品要 2 份精金，而精金原本要元婴期 —— 于是整条炼器线
     * 在它最该有用的那两品（3~4 品的灵剑 / 洞天罗盘）上完全用不了。
     */
    requiresRealm: 2,
    requiresTech: 'refiningArt',
  },
  {
    id: 'arrayCoreRefine',
    name: '刻制阵枢',
    icon: '🔯',
    desc: '以灵木为骨、灵石为血，一刀一刀刻出符文的枢纽。凡大型阵法都少不了它。',
    cost: { wood: 8000, stone: 2000 },
    output: { item: 'arrayCore', amount: 1 },
    requiresRealm: 3,
    requiresTech: 'architecture',
  },
];

export const REFINE_RECIPE_MAP: Record<string, RefineRecipe> = REFINE_RECIPES.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, RefineRecipe>,
);

/**
 * 灵石合成的成本与产出 —— **从配方推导**，不再各存一份。
 *
 * 原来 `buildables.ts` 里有一份独立的 `STONE_REFINE_COST = { qi: 5000, ore: 500 }`，
 * 和 `REFINE_RECIPES` 里那条配方的数字是两套。本轮需求 5 降价时只改了配方，
 * 于是界面按新价显示、实际却按旧价扣 —— 冒烟里那条"产出量符合合成比例"当场红了。
 * 现在唯一来源就是配方本身。
 */
export const STONE_REFINE_COST = REFINE_RECIPE_MAP.stoneRefine.cost as { qi: number; ore: number };
export const STONE_REFINE_OUTPUT = REFINE_RECIPE_MAP.stoneRefine.output.amount;
