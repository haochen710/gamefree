/**
 * 功法系统（设定集第 7 章）
 *
 * 五档制：**凡品 → 良品 → 上品 → 极品 → 天纵**（与丹器九品制并行）。
 * 每名弟子最多装备 **1 本修炼功法 + 1 本战斗功法**。
 *
 * 设定集里的几条硬规则，落地方式如下：
 *
 * | 设定集 | 本作落地 |
 * |---|---|
 * | 同功法不可叠加，只取最高品级效果 | 「队伍产出」与「全宗心魔抵抗」按最高一项取，不叠加 |
 * | 功法可自由拆卸无损耗 | 卸下即回到仓库（`unequipManual`） |
 * | 5 份同功法碎片合成完整功法，藏经阁等级提升合成成功率 | `synthManual`，成功率随藏经阁座数上升 |
 * | 弟子陨落时身上功法 60% 回收、40% 损毁 | `salvageManualsOnDeath` |
 * | 叛逃弟子带走全部功法 | 叛逃即人走书走（`rollDesertion` 里连人一起删） |
 * | 天纵功法仅金色传说事件 / 域外商人 | 本作只有九档秘境（九档）极小概率掉碎片 |
 * | 修炼功法占用增益装备栏 / 战斗功法占进攻栏 | 弟子身上各有一个字段，界面按"增益/进攻"展示 |
 *
 * ⚠️ 一处**刻意的翻译**：设定集里修炼功法给「大境界突破基础成功率 +4%」，
 * 而本作的**弟子突破是自动结算、不掷骰**的（失败概率只属于掌门，见 realms.ts）。
 * 所以这一条被翻译成等价的**修行加成**（+4% 成功率 ≈ +4% 修行速度），
 * 而不是凭空造一个"弟子突破失败"出来 —— 那会连带推翻需求 9 的丹药节奏。
 */
import type { ItemId } from './resources';

/* ------------------------------------------------------------------ */
/* 品阶                                                                */
/* ------------------------------------------------------------------ */

/** 五档制：1 凡品 → 5 天纵 */
export type ManualGrade = 1 | 2 | 3 | 4 | 5;

export const MANUAL_GRADE_NAMES: Record<ManualGrade, string> = {
  1: '凡品',
  2: '良品',
  3: '上品',
  4: '极品',
  5: '天纵',
};

/** 该品阶需要弟子达到的境界下标（读不懂就白搭） */
export const MANUAL_GRADE_MIN_REALM: Record<ManualGrade, number> = {
  1: 0, // 炼气
  2: 1, // 筑基
  3: 2, // 金丹
  4: 3, // 元婴
  5: 4, // 化神
};

/** 合成一本功法需要几份碎片（设定集：5 份） */
export const FRAGMENTS_PER_MANUAL = 5;
/** 碎片合成的基础成功率 */
export const SYNTH_BASE_RATE = 0.6;
/** 每座藏经阁额外提高的成功率 */
export const SYNTH_PER_LIBRARY = 0.03;
/** 合成成功率上限 */
export const SYNTH_MAX_RATE = 0.98;
/** 失败时损失的碎片数（不是全部 —— 全部损失会让玩家不敢点） */
export const SYNTH_FAIL_LOSS = 1;

/* ------------------------------------------------------------------ */
/* 功法定义                                                            */
/* ------------------------------------------------------------------ */

export type ManualKind = 'cultivation' | 'combat';

export interface ManualDef {
  id: string;
  name: string;
  icon: string;
  kind: ManualKind;
  grade: ManualGrade;
  /** 弟子修行速度加成（加算，0.2 = +20%）。战斗功法一律为 0 */
  cultivationBonus: number;
  /** 该弟子在秘境的伤亡率削减（加算） */
  casualtyReduction: number;
  /** 秘境产出加成（按队伍取最高一项） */
  yieldBonus: number;
  /** 心魔增长抵抗（加算） */
  demonGuard: number;
  /**
   * 该弟子突破境界所需的修为削减（0.05 = −5%）。
   *
   * 设定集写的是「小境界所需修为 −5%」，而本作弟子的"小境界"就是
   * `REALMS[realmIndex].cultivationYears` 这一格进度，所以直接作用在它上面。
   */
  needReduction: number;
  /** 获取途径说明（界面展示用，也提醒数值设计者它的稀有度） */
  source: string;
  desc: string;
}

const NO_EFFECT = {
  casualtyReduction: 0,
  yieldBonus: 0,
  demonGuard: 0,
  needReduction: 0,
};

export const MANUALS: ManualDef[] = [
  /* ---------------- 修炼功法 ---------------- */
  {
    id: 'qiGuide',
    name: '《引气诀》',
    icon: '📜',
    kind: 'cultivation',
    grade: 1,
    cultivationBonus: 0.04,
    ...NO_EFFECT,
    source: '低阶秘境',
    desc: '最粗浅的引气法门。修炼速度 +4%。',
  },
  {
    id: 'spiritGather',
    name: '《聚灵篇》',
    icon: '📜',
    kind: 'cultivation',
    grade: 1,
    cultivationBonus: 0.05,
    ...NO_EFFECT,
    source: '灵田事件 / 商行',
    desc: '聚拢周身灵气为己用。修炼速度 +5%。',
  },
  {
    id: 'clearMindRecord',
    name: '《清元静心录》',
    icon: '📘',
    kind: 'cultivation',
    grade: 2,
    cultivationBonus: 0.08,
    ...NO_EFFECT,
    demonGuard: 0.08,
    source: '中低阶秘境',
    desc: '以静制妄。修炼速度 +8%，心魔增长 −8%。',
  },
  {
    id: 'moonNurture',
    name: '《月华养元经》',
    icon: '📘',
    kind: 'cultivation',
    grade: 2,
    cultivationBonus: 0.09,
    ...NO_EFFECT,
    demonGuard: 0.05,
    source: '青岚山麓 / 沧澜泽地',
    desc: '采月华养元神。修炼速度 +9%，心魔增长 −5%。',
  },
  {
    id: 'jadeMarrow',
    name: '《碧髓凝真章》',
    icon: '📗',
    kind: 'cultivation',
    grade: 3,
    cultivationBonus: 0.13,
    ...NO_EFFECT,
    needReduction: 0.05,
    source: '万雷山脉',
    desc: '凝真固本。修炼速度 +13%，突破所需修为 −5%。',
  },
  {
    id: 'abyssInsight',
    name: '《玄渊内观经》',
    icon: '📗',
    kind: 'cultivation',
    grade: 3,
    cultivationBonus: 0.14,
    ...NO_EFFECT,
    demonGuard: 0.12,
    source: '幽冥古原',
    desc: '内观玄渊，照见本心。修炼速度 +14%，心魔增长 −12%。',
  },
  {
    id: 'starBreath',
    name: '《星辰吐纳典》',
    icon: '📙',
    kind: 'cultivation',
    grade: 4,
    cultivationBonus: 0.2,
    ...NO_EFFECT,
    demonGuard: 0.06,
    source: '幽冥古原高阶 / 传说事件',
    desc: '吐纳星辰之力。修炼速度 +20%，心魔增长 −6%。',
  },
  {
    id: 'nineHeaven',
    name: '《九天归元秘》',
    icon: '📙',
    kind: 'cultivation',
    grade: 4,
    cultivationBonus: 0.22,
    ...NO_EFFECT,
    needReduction: 0.08,
    source: '高阶传送台解锁的秘境',
    desc: '九天之气归于一炉。修炼速度 +22%，突破所需修为 −8%。',
  },
  {
    id: 'primordialDao',
    name: '《鸿蒙化道经》',
    icon: '📕',
    kind: 'cultivation',
    grade: 5,
    cultivationBonus: 0.3,
    ...NO_EFFECT,
    demonGuard: 0.15,
    needReduction: 0.05,
    source: '九档秘境（极小概率）',
    desc: '传说中化道于鸿蒙的法门。修炼速度 +30%，心魔增长 −15%，突破所需修为 −5%。',
  },

  /* ---------------- 战斗功法 ---------------- */
  {
    id: 'mountainFist',
    name: '《裂山拳经》',
    icon: '📜',
    kind: 'combat',
    grade: 1,
    cultivationBonus: 0,
    casualtyReduction: 0.02,
    yieldBonus: 0,
    demonGuard: 0,
    needReduction: 0,
    source: '低阶秘境',
    desc: '拳出裂石。自己秘境伤亡 −2%。',
  },
  {
    id: 'windDodge',
    name: '《御风遁法》',
    icon: '📜',
    kind: 'combat',
    grade: 1,
    cultivationBonus: 0,
    casualtyReduction: 0.03,
    yieldBonus: 0,
    demonGuard: 0,
    needReduction: 0,
    source: '低阶秘境',
    desc: '身随风走。自己秘境伤亡 −3%。',
  },
  {
    id: 'ironWall',
    name: '《铁壁守御策》',
    icon: '📘',
    kind: 'combat',
    grade: 2,
    cultivationBonus: 0,
    casualtyReduction: 0.04,
    yieldBonus: 0,
    demonGuard: 0,
    needReduction: 0,
    source: '中低阶秘境',
    desc: '守如山岳。自己秘境伤亡 −4%。',
  },
  {
    id: 'swiftHuntRecord',
    name: '《迅猎斩敌录》',
    icon: '📘',
    kind: 'combat',
    grade: 2,
    cultivationBonus: 0,
    casualtyReduction: 0.035,
    yieldBonus: 0.02,
    demonGuard: 0,
    needReduction: 0,
    source: '中低阶秘境',
    desc: '先发制人。自己伤亡 −3.5%，队伍秘境产出 +2%。',
  },
  {
    id: 'dangerManual',
    name: '《御危真解》',
    icon: '📗',
    kind: 'combat',
    grade: 3,
    cultivationBonus: 0,
    casualtyReduction: 0.06,
    yieldBonus: 0,
    demonGuard: 0.06,
    needReduction: 0,
    source: '中高阶秘境',
    desc: '料敌于先。自己伤亡 −6%，心魔增长 −6%。',
  },
  {
    id: 'bloodFormation',
    name: '《浴血破阵诀》',
    icon: '📗',
    kind: 'combat',
    grade: 3,
    cultivationBonus: 0,
    casualtyReduction: 0.07,
    yieldBonus: 0.02,
    demonGuard: 0,
    needReduction: 0,
    source: '中高阶秘境',
    desc: '以血破阵，越险越强。自己伤亡 −7%，队伍秘境产出 +2%。',
  },
  {
    id: 'beastPact',
    name: '《兽神契文》',
    icon: '📙',
    kind: 'combat',
    grade: 4,
    cultivationBonus: 0,
    casualtyReduction: 0.085,
    yieldBonus: 0.05,
    demonGuard: 0,
    needReduction: 0,
    source: '高阶秘境',
    desc: '与兽神立契。自己伤亡 −8.5%，队伍秘境产出 +5%。',
  },
  {
    id: 'soulSubdue',
    name: '《神魂镇魔录》',
    icon: '📙',
    kind: 'combat',
    grade: 4,
    cultivationBonus: 0,
    casualtyReduction: 0.09,
    yieldBonus: 0,
    demonGuard: 0.2,
    needReduction: 0,
    source: '高阶秘境',
    desc: '镇神魂，压魔念。自己伤亡 −9%，心魔增长 −20%。',
  },
  {
    id: 'heavenWar',
    name: '《天地战章》',
    icon: '📕',
    kind: 'combat',
    grade: 5,
    cultivationBonus: 0,
    casualtyReduction: 0.12,
    yieldBonus: 0.08,
    demonGuard: 0.08,
    needReduction: 0,
    source: '九档秘境（极小概率）',
    desc: '传说战章，一气可当千军。自己伤亡 −12%，队伍秘境产出 +8%，心魔增长 −8%。',
  },
];

export const MANUAL_MAP: Record<string, ManualDef> = MANUALS.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<string, ManualDef>,
);

/** 碎片 id 就是功法 id（`frag:<manualId>`），这样"哪种碎片"天然与功法一一对应 */
export function fragmentIdOf(manualId: string): string {
  return `frag:${manualId}`;
}

export function manualIdOfFragment(fragmentId: string): string | null {
  if (!fragmentId.startsWith('frag:')) return null;
  const id = fragmentId.slice(5);
  return MANUAL_MAP[id] ? id : null;
}

/** 某品阶的功法清单 */
export function manualsOfGrade(grade: ManualGrade, kind?: ManualKind): ManualDef[] {
  return MANUALS.filter((m) => m.grade === grade && (!kind || m.kind === kind));
}

/* ------------------------------------------------------------------ */
/* 获取途径                                                            */
/* ------------------------------------------------------------------ */

/**
 * 秘境档次 → 掉哪种品阶的碎片（设定集第 7.3 章）。
 *
 * 「小怪掉凡品碎片、精英掉良品碎片、BOSS 掉良品/上品碎片、
 *   高阶秘境 BOSS 小概率掉极品碎片；星穹天域极小概率直接掉落完整极品功法」——
 * 本作的秘境只有"档次"这一个粒度（没有把怪物分阶段结算），
 * 所以把它压成一张"档次 → 品阶权重"表：档次越高，能掉到的品阶越高。
 */
export const FRAGMENT_GRADE_WEIGHTS: Record<number, Record<ManualGrade, number>> = {
  1: { 1: 10, 2: 0, 3: 0, 4: 0, 5: 0 },
  2: { 1: 8, 2: 2, 3: 0, 4: 0, 5: 0 },
  3: { 1: 5, 2: 4, 3: 1, 4: 0, 5: 0 },
  4: { 1: 3, 2: 5, 3: 2, 4: 0, 5: 0 },
  5: { 1: 1, 2: 4, 3: 4, 4: 1, 5: 0 },
  6: { 1: 0, 2: 3, 3: 5, 4: 2, 5: 0 },
  7: { 1: 0, 2: 1, 3: 5, 4: 4, 5: 0 },
  8: { 1: 0, 2: 0, 3: 4, 4: 5, 5: 1 },
  9: { 1: 0, 2: 0, 3: 2, 4: 6, 5: 2 },
};

/** 一次秘境探索掉碎片的概率 */
export const FRAGMENT_DROP_CHANCE = 0.45;
/** 一次掉几份碎片 */
export const FRAGMENT_DROP_COUNT = 2;

/** 藏经阁参悟：用宗门灵气换碎片的价目（按品阶） */
export const CONTEMPLATE_QI_COST: Record<ManualGrade, number> = {
  1: 2e4,
  2: 1.2e5,
  3: 8e5,
  4: 6e6,
  5: 0, // 天纵不可参悟，只能靠秘境
};

/** 参悟一次给几份碎片 */
export const CONTEMPLATE_FRAGMENTS = 1;

/** 论道大比的碎片奖励（设定集：第一名上品碎片×2、二三名良品×2、参与奖凡品×1） */
export const ARENA_FIRST_FRAGMENTS = 2;
export const ARENA_RUNNERUP_FRAGMENTS = 2;
export const ARENA_PARTICIPANT_FRAGMENTS = 1;

/** 弟子陨落时功法的回收率（设定集：60% 回收、40% 损毁） */
export const MANUAL_SALVAGE_RATE = 0.6;

/** 装上去之后需要多少境界才能用（界面提示用） */
export function canDiscipleUse(grade: ManualGrade, realmIndex: number): boolean {
  return realmIndex >= MANUAL_GRADE_MIN_REALM[grade];
}

/** 碎片或功法在界面上的展示信息 */
export interface ManualItemView {
  id: string;
  name: string;
  icon: string;
  grade: ManualGrade;
  gradeName: string;
  kind: ManualKind;
}

export function manualViewOf(manualId: string): ManualItemView | null {
  const def = MANUAL_MAP[manualId];
  if (!def) return null;
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    grade: def.grade,
    gradeName: MANUAL_GRADE_NAMES[def.grade],
    kind: def.kind,
  };
}

/** 槽位（界面与规则共用） */
export type ManualSlot = ManualKind;

export const MANUAL_SLOT_NAMES: Record<ManualSlot, string> = {
  cultivation: '增益位（修炼功法）',
  combat: '进攻位（战斗功法）',
};

/** 空占位（未装备） */
export const NO_MANUAL = '';

/** 类型守卫：给道具 id 判一下是不是碎片 */
export function isFragmentId(id: string): boolean {
  return manualIdOfFragment(id) !== null;
}

/** 参悟、合成都要用到的"通用代价"形状 */
export type ManualCost = Partial<Record<ItemId, number>>;
