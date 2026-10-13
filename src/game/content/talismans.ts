/**
 * 符箓（需求 8）
 *
 * 三类符，各三品，共九件 —— 由「符房」里的**制符**产线做出来（需求 12 的
 * 制符技艺与制符天赋在这里兑现）。
 *
 * 设计口径（与用户确认）：**符箓是消耗品**，不是装备。
 * 所以每一张用掉就没了，而"用哪种、什么时候用"是它真正的玩法。
 *
 * 三种效果各自咬住一条已有的线，不新开系统：
 *   1. **聚灵符** → `buffs.productionMultiplier + productionSeconds`：限时产量加成；
 *   2. **破境符** → `globalBreakthroughBonus`：提高掌门突破成功率（可叠加，但很贵）。
 *
 * ⚠️ **护身符（三类减伤符）在第 18 轮被删掉了** ——
 * 需求原文：「符箓对秘境减伤的增益太大了，删除这类符箓」。
 * 减伤那一份效果现在归**宗门大阵**（见文件末尾）：大阵要**持续烧符**维持，
 * 于是"减伤"从一张纸变成了一件要长期投入的事。
 */
import type { ItemId } from './resources';

export type TalismanKind = 'spirit' | 'break';

export const TALISMAN_KIND_NAMES: Record<TalismanKind, string> = {
  spirit: '聚灵符',
  break: '破境符',
};

export interface TalismanDef {
  id: string;
  name: string;
  icon: string;
  kind: TalismanKind;
  /** 一品 ~ 三品（制符品阶决定能画几品） */
  grade: 1 | 2 | 3;
  desc: string;
  /** 制符花费 */
  cost: Partial<Record<ItemId, number>>;
  /* ---- 效果（按 kind 取其中一项） ---- */
  /** 聚灵符：产量倍率与持续秒数 */
  productionMult?: number;
  productionSeconds?: number;
  /** 破境符：突破成功率加成（永久累积） */
  breakthroughBonus?: number;
}

export const TALISMANS: TalismanDef[] = [
  /* ---------------- 聚灵符：限时产量 ---------------- */
  {
    id: 'spiritBasic',
    name: '聚灵符',
    icon: '🔵',
    kind: 'spirit',
    grade: 1,
    desc: '引四方灵气入山门。产量 ×1.3，持续 5 分钟。',
    cost: { herb: 300, spiritSilk: 30, qi: 8000 },
    productionMult: 1.3,
    productionSeconds: 300,
  },
  {
    id: 'spiritSilver',
    name: '银纹聚灵符',
    icon: '🔷',
    kind: 'spirit',
    grade: 2,
    desc: '银纹引灵。产量 ×1.6，持续 8 分钟。',
    cost: { herb: 2500, spiritSilk: 260, starSand: 30, qi: 1.5e5 },
    productionMult: 1.6,
    productionSeconds: 480,
  },
  {
    id: 'spiritGold',
    name: '金篆聚灵符',
    icon: '🔶',
    kind: 'spirit',
    grade: 3,
    desc: '金篆聚灵，气机如潮。产量 ×2.0，持续 12 分钟。',
    cost: { herb: 1.6e4, spiritSilk: 1800, starSand: 260, lunarCrystal: 50, qi: 3e6 },
    productionMult: 2,
    productionSeconds: 720,
  },

  /* ---------------- 破境符：突破成功率 ---------------- */
  {
    id: 'breakBasic',
    name: '清心破境符',
    icon: '🟢',
    kind: 'break',
    grade: 1,
    desc: '破境时焚于身前。掌门突破成功率 +3%（可累积，用一次加一次）。',
    cost: { herb: 600, spiritSilk: 60, demonCore: 40, qi: 2e4 },
    breakthroughBonus: 0.03,
  },
  {
    id: 'breakSilver',
    name: '银纹破境符',
    icon: '🟩',
    kind: 'break',
    grade: 2,
    desc: '银纹镇心魔。掌门突破成功率 +5%。',
    cost: { herb: 4000, spiritSilk: 400, demonCore: 300, starSand: 50, qi: 3e5 },
    breakthroughBonus: 0.05,
  },
  {
    id: 'breakGold',
    name: '金篆破境符',
    icon: '🟢',
    kind: 'break',
    grade: 3,
    desc: '金篆通天，一念破关。掌门突破成功率 +8%。',
    cost: { herb: 3e4, spiritSilk: 2500, demonCore: 1500, starSand: 400, lunarCrystal: 80, qi: 5e6 },
    breakthroughBonus: 0.08,
  },
];

export const TALISMAN_MAP: Record<string, TalismanDef> = TALISMANS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, TalismanDef>,
);

export const TALISMAN_GRADE_NAMES: Record<number, string> = {
  1: '一品',
  2: '二品',
  3: '三品',
};

/** 制符品阶的升品花费（与炼丹炼器同构，只是材料换成符纸灵笔那一套） */
export const TALISMAN_TIER_COST: Record<number, Partial<Record<ItemId, number>>> = {
  2: { herb: 8000, spiritSilk: 600, demonCore: 400, qi: 5e4 },
  3: { herb: 6e4, spiritSilk: 4000, demonCore: 2000, starSand: 200, qi: 1e6 },
  4: { herb: 4e5, spiritSilk: 2e4, demonCore: 1e4, starSand: 1500, lunarCrystal: 200, qi: 2e7 },
  5: { herb: 3e6, spiritSilk: 1e5, demonCore: 5e4, starSand: 8000, moonDew: 4000, qi: 4e8 },
  6: { herb: 2e7, spiritSilk: 5e5, demonCore: 2e5, dragonBlood: 2000, netherFlame: 800, qi: 6e9 },
  7: { herb: 1e8, spiritSilk: 2e6, demonCore: 1e6, dragonBlood: 8000, netherFlame: 3000, qi: 1e11 },
  8: { herb: 8e8, spiritSilk: 1e7, demonCore: 5e6, immortalJade: 200, chaosQi: 60, qi: 2e12 },
  9: { herb: 6e9, spiritSilk: 5e7, demonCore: 2e7, immortalJade: 1200, primordialFruit: 3, qi: 4e13 },
};

/** 制符品阶所需的符房座数（沿用"建筑数量决定品阶"的老规矩） */
export const TALISMAN_SLOT_REQUIREMENT = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

/* ------------------------------------------------------------------ */
/* 宗门大阵（需求 9）                                                  */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：
 *   「符箓还可以增加设定，**宗门大阵需要消耗符箓**等等」。
 *
 * 口径：大阵是**一座建筑**（sectArray），建成后可以开启/关闭；
 * 开启期间**每秒烧掉一定量的符箓**，烧不起就自动停。
 * 它给的是三样东西：
 *   - 宗门防御（抵御宗门被袭类事件）；
 *   - **全宗弟子修炼加成**；
 *   - 幸福度（士气）。
 *
 * 为什么把减伤从护身符搬到大阵：
 *   一张符就能免掉一趟伤亡，是"一次性、零维护"的收益 —— 太便宜了
 *   （需求 9 的原话就是"增益太大"）。改成持续烧符之后，
 *   同样的效果需要**长期供养**，这才配得上它的强度。
 */
export const SECT_ARRAY_BUILDING_ID = 'sectArray';

/** 大阵每秒消耗的符箓"灵气量"（按符的品阶折算） */
export const SECT_ARRAY_DRAIN_PER_SECOND = 0.05;

/** 符箓的"阵法燃料值"：品阶越高越耐烧 */
export const TALISMAN_FUEL_VALUE: Record<number, number> = {
  1: 1,
  2: 6,
  3: 30,
};

/** 大阵开启时的宗门防御加成 */
export const SECT_ARRAY_DEFENSE = 0.25;
/** 大阵开启时的全宗弟子修炼加成 */
export const SECT_ARRAY_CULTIVATION = 0.15;
/** 大阵开启时的幸福度加成 */
export const SECT_ARRAY_HAPPINESS = 6;
