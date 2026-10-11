/**
 * 宗门与弟子（需求 3 / 4 / 6 / 7）
 *
 * 资质决定两件事：修炼速度、以及这辈子能修到什么境界。
 * 这两条合起来让"逐出低资质弟子、招收高资质弟子"成为一个真实的长期决策。
 */
import type { ItemId } from './resources';
import { gameRandom, type RandomSource } from '../random';

/* ------------------------------------------------------------------ */
/* 弟子资质                                                            */
/* ------------------------------------------------------------------ */

export type AptitudeId = 'mortal' | 'low' | 'mid' | 'high' | 'excellent' | 'heaven';

export interface AptitudeDef {
  id: AptitudeId;
  name: string;
  /** 修炼速度倍率。1.0 = 天灵根，正是「五百年到化神」的基准 */
  speed: number;
  /** 能修到的最高境界下标（对应 REALMS） */
  capRealm: number;
  color: string;
  desc: string;
}

export const APTITUDES: AptitudeDef[] = [
  {
    id: 'mortal',
    name: '凡品灵根',
    speed: 0.25,
    capRealm: 4,
    color: '#8a8578',
    desc: '勉强感应到灵气，终其一生难成气候。',
  },
  {
    id: 'low',
    name: '下品灵根',
    speed: 0.35,
    capRealm: 5,
    color: '#5c7a4a',
    desc: '资质平平，可入修行之门，难登大雅之堂。',
  },
  {
    id: 'mid',
    name: '中品灵根',
    speed: 0.45,
    capRealm: 6,
    color: '#3d7a63',
    desc: '中人之姿，勤修苦练可成一方修士。',
  },
  {
    id: 'high',
    name: '上品灵根',
    speed: 0.6,
    capRealm: 7,
    color: '#3a6ea8',
    desc: '资质上佳，各大宗门争抢的好苗子。',
  },
  {
    id: 'excellent',
    name: '极品灵根',
    speed: 0.8,
    capRealm: 8,
    color: '#8a4fa8',
    desc: '百年难遇的良才，未来的一派之主。',
  },
  {
    id: 'heaven',
    name: '天灵根',
    speed: 1.0,
    capRealm: 9,
    color: '#b8860b',
    desc: '天生道体，五百年可至化神，仙途不可限量。',
  },
];

export const APTITUDE_MAP: Record<AptitudeId, AptitudeDef> = APTITUDES.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<AptitudeId, AptitudeDef>,
);

export const APTITUDE_ORDER: AptitudeId[] = APTITUDES.map((a) => a.id);

export function nextAptitude(id: AptitudeId): AptitudeId {
  const index = APTITUDE_ORDER.indexOf(id);
  return APTITUDE_ORDER[Math.min(index + 1, APTITUDE_ORDER.length - 1)];
}

/* ------------------------------------------------------------------ */
/* 招收弟子的资质分布                                                  */
/* ------------------------------------------------------------------ */

/**
 * 宗门品阶 → 招收时各资质的权重（数组顺序同 APTITUDE_ORDER，每行总和 100）。
 * 宗门越强，越容易招到好苗子 —— 这是需求 3 的核心机制。
 */
export const RECRUIT_WEIGHTS: Record<number, number[]> = {
  1: [50, 30, 15, 4, 1, 0],
  2: [42, 30, 18, 7, 2.5, 0.5],
  3: [34, 28, 21, 11, 4.5, 1.5],
  4: [26, 26, 23, 15, 7.5, 2.5],
  5: [18, 23, 24, 19, 11, 5],
  6: [12, 19, 23, 22, 15, 9],
  7: [7, 14, 21, 24, 20, 14],
  8: [4, 9, 17, 24, 25, 21],
  9: [2, 5, 12, 22, 29, 30],
};

/* ------------------------------------------------------------------ */
/* 宗门品阶                                                            */
/* ------------------------------------------------------------------ */

export interface SectLevelDef {
  level: number;
  name: string;
  /** 晋升到该品阶所需的玩家境界下标 */
  requiresRealm: number;
  /** 晋升消耗 */
  cost: Partial<Record<ItemId, number>>;
  desc: string;
}

export const SECT_LEVELS: SectLevelDef[] = [
  {
    level: 1,
    name: '一品宗门',
    // 需求 3：「金丹就可创建宗门」。注意这里**只管开宗**，
    // 飞升的门槛是另一个常量（ASCENSION_MIN_REALM），两者原先共用这一个值，
    // 改成金丹之后必须拆开 —— 否则金丹期就能飞升了。
    requiresRealm: 2,
    cost: { stone: 500 },
    desc: '草创之初，几位道友结庐而居。',
  },
  {
    level: 2,
    name: '二品宗门',
    requiresRealm: 4,
    cost: { stone: 5000, demonCore: 50 },
    desc: '山门初立，方圆百里已闻其名。',
  },
  {
    level: 3,
    name: '三品宗门',
    requiresRealm: 5,
    cost: { stone: 5e4, demonCore: 200, blackIron: 100 },
    desc: '弟子渐众，已有长老执事之制。',
  },
  {
    level: 4,
    name: '四品宗门',
    requiresRealm: 5,
    cost: { stone: 5e5, blackIron: 500, starSand: 100 },
    desc: '一方大派，可开辟洞天福地。',
  },
  {
    level: 5,
    name: '五品宗门',
    requiresRealm: 6,
    cost: { stone: 5e6, starSand: 400, dragonBlood: 80 },
    desc: '雄踞一域，寻常散修不敢仰视。',
  },
  {
    level: 6,
    name: '六品宗门',
    requiresRealm: 6,
    cost: { stone: 5e7, dragonBlood: 300, immortalJade: 30 },
    desc: '名动天下，与世俗王朝分庭抗礼。',
  },
  {
    level: 7,
    name: '七品宗门',
    requiresRealm: 7,
    cost: { stone: 5e8, immortalJade: 150 },
    desc: '传承万载，藏经阁中典籍如海。',
  },
  {
    level: 8,
    name: '八品宗门',
    requiresRealm: 7,
    cost: { stone: 5e9, immortalJade: 600 },
    desc: '修仙界执牛耳者，一言可定兴衰。',
  },
  {
    level: 9,
    name: '九品宗门',
    requiresRealm: 8,
    cost: { stone: 5e10, immortalJade: 2000 },
    desc: '传说中的仙门，与上界已有往来。',
  },
];

/** 宗门等级 → 弟子上限（还会再受居所容量限制，取两者较小值） */
export function discipleCapBySect(level: number): number {
  return level * 6;
}

/**
 * 宗门等级 → 可同时进行的秘境探索数量（需求 3）。
 *
 * 需求原文：「宗门等级越高，能够派遣探索秘境的队伍越多，最多9个」。
 * 所以直接**一品 = 1 队、九品 = 9 队**，一一对应 ——
 * 比原来那个 `1 + floor(level / 3)`（九品也只有 4 队）直观得多，
 * 也让"升宗门品阶"第一次真正值钱：每一品都多一支队伍。
 */
export const MAX_EXPEDITION_SLOTS = 9;

export function expeditionSlots(level: number): number {
  return Math.max(1, Math.min(MAX_EXPEDITION_SLOTS, level));
}

/* ------------------------------------------------------------------ */
/* 招收弟子                                                            */
/* ------------------------------------------------------------------ */

/** 招收基础花费系数 */
export const RECRUIT_BASE_COST = 60;

/**
 * 招收一名弟子所需的灵石（需求 3）。
 *
 * 需求原文：「弟子招募在每个宗门品阶都是固定消耗，只是宗门等级越高越贵」。
 *
 * 所以**同一个品阶之内，招第一个和招第五十个一个价** —— 原来是
 * `× 1.1^已有人数` 的等比递增（第 40 个要 43 倍价），于是"多招人"这件事
 * 到中后期变成一笔要精算的开销。现在唯一的变量是宗门品阶：
 * 一品 60、九品 4860 灵石（`60 × 品阶²`）。
 *
 * `currentDisciples` 参数保留（调用点很多），但**已经不参与计算**。
 */
export const RECRUIT_COST_PER_LEVEL = 60;

export function recruitCost(sectLevel: number, _currentDisciples: number): number {
  return Math.ceil(RECRUIT_COST_PER_LEVEL * sectLevel * sectLevel);
}

/* ------------------------------------------------------------------ */
/* 名字                                                                */
/* ------------------------------------------------------------------ */

const SURNAMES = [
  '李', '王', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴',
  '徐', '孙', '马', '朱', '胡', '林', '郭', '何', '高', '罗',
  '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '彭', '曾', '萧', '田', '董', '袁', '潘', '于', '蒋', '蔡',
  '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '沈', '姚',
  '卢', '姜', '崔', '钟', '谭', '陆', '汪', '范', '金', '石',
  '廖', '贾', '夏', '韦', '方', '白', '邹', '孟', '熊', '秦',
  '邱', '江', '尹', '薛', '段', '雷', '侯', '龙', '史', '陶',
  '黎', '贺', '顾', '毛', '郝', '龚', '邵', '万', '钱', '严',
];

const GIVEN_NAMES = [
  '玄清', '云舟', '无涯', '长风', '若水', '抱朴', '守拙', '含光', '承影', '赤霄',
  '太虚', '灵枢', '天罡', '摇光', '玉衡', '紫微', '玄冥', '重光', '明夷', '未央',
  '归尘', '问天', '拂雪', '疏影', '寒山', '拾星', '观澜', '听雨', '洗剑', '焚琴',
  '煮酒', '抱一', '冲虚', '通玄', '得一', '无极', '太初', '鸿蒙', '幽冥', '沧溟',
  '扶摇', '惊鸿', '落雁', '沉舟', '破军', '贪狼', '七杀', '天机', '青冥', '素问',
];

/** 随机生成一个道号 */
export function randomDiscipleName(random: RandomSource = gameRandom): string {
  const surname = SURNAMES[Math.floor(random() * SURNAMES.length)];
  const given = GIVEN_NAMES[Math.floor(random() * GIVEN_NAMES.length)];
  return `${surname}${given}`;
}

/** 按权重随机抽一个资质 */
export function rollAptitude(sectLevel: number, random: RandomSource = gameRandom): AptitudeId {
  const weights = RECRUIT_WEIGHTS[Math.min(Math.max(sectLevel, 1), 9)] ?? RECRUIT_WEIGHTS[1];
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return APTITUDE_ORDER[i];
  }
  return APTITUDE_ORDER[0];
}
