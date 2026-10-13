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
 *   1. **护身符** → `buffs.safetyReduction + safetyOnce`：
 *      下一次探索结算时全额减免伤亡（"免死一次"）；
 *   2. **聚灵符** → `buffs.productionMultiplier + productionSeconds`：限时产量加成；
 *   3. **破境符** → `globalBreakthroughBonus`：提高掌门突破成功率（可叠加，但很贵）。
 */
import type { ItemId } from './resources';

export type TalismanKind = 'ward' | 'spirit' | 'break';

export const TALISMAN_KIND_NAMES: Record<TalismanKind, string> = {
  ward: '护身符',
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
  /** 护身符：减伤比例 0~1（配 safetyOnce，一趟用掉） */
  safety?: number;
  /** 聚灵符：产量倍率与持续秒数 */
  productionMult?: number;
  productionSeconds?: number;
  /** 破境符：突破成功率加成（永久累积） */
  breakthroughBonus?: number;
}

export const TALISMANS: TalismanDef[] = [
  /* ---------------- 护身符：一趟免伤 ---------------- */
  {
    id: 'wardBasic',
    name: '护身黄符',
    icon: '🟡',
    kind: 'ward',
    grade: 1,
    desc: '贴在胸口的一张黄符。下一次探索结算时全队伤亡 −12%（用掉即毁）。',
    cost: { herb: 400, spiritSilk: 40, demonCore: 30, qi: 1.2e4 },
    safety: 0.12,
  },
  {
    id: 'wardSilver',
    name: '银纹护符',
    icon: '⚪',
    kind: 'ward',
    grade: 2,
    desc: '银纹走笔，能挡一次大劫。下一次探索全队伤亡 −20%。',
    cost: { herb: 3000, spiritSilk: 300, demonCore: 200, starSand: 40, qi: 2e5 },
    safety: 0.2,
  },
  {
    id: 'wardGold',
    name: '金篆保命符',
    icon: '🟠',
    kind: 'ward',
    grade: 3,
    desc: '金篆天成，抵得上一条命。下一次探索全队伤亡 −30%。',
    cost: { herb: 2e4, spiritSilk: 2000, demonCore: 1200, starSand: 300, lunarCrystal: 60, qi: 4e6 },
    safety: 0.3,
  },

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
