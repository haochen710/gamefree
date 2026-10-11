/**
 * 地图：六大区域 × 十六小区域（需求 1）
 *
 * 需求原文：
 *   「地图分为六大区域，中州，南疆，西漠，北境，东部群山，无垠海，
 *     玩家初始地址在东部群山，初始只能探索附近四个小区域，
 *     每个区域1-2个秘境，练气或者筑基就能探索，
 *     每个大区域分为十六个小区域，但是只有一个小区域秘境有三个以上，
 *     为资源富集区，对应的等级需求变得更高，且资源富集区内有一个
 *     产出该大区特产的秘境。每个小区域在未发现秘境时只能普通探索。」
 *
 * 所以结构是三层：
 *   大区域（6 个，各有特产与境界基调）
 *     └─ 小区域（每个大区域 16 个，共 96 个）—— 这才是**探索的基本单位**
 *          ├─ 普通探索（还没发现秘境时唯一能做的事）
 *          └─ 秘境（每小区域 1~2 处；资源富集区 3 处）
 *
 * ⚠️ 沿用旧名字的说明：`MAP_REGIONS` 现在装的是**小区域**。
 * 全仓库（engine / travel / 界面 / 模拟器）都按"区域"引用它，
 * 改名会牵动几十处调用点，而语义没有变（都是"探索的基本单位"），
 * 所以保留了这个名字，另外新增 `MAJOR_REGIONS` 表示大区域。
 *
 * 资源富集区：每个大区域**只有一个**（下标 15），它的
 *   - 境界门槛比同区其它小区域高一档（`RICH_REALM_BONUS`）
 *   - 有 3 处秘境（其它小区域只有 1~2 处）
 *   - 其中一处是「特产秘境」，产出该大区域独有的特产材料
 */
import { MATERIAL_MAP, type MaterialId } from './resources';

/**
 * 秘境的路数：决定掉落的偏向。
 *
 * 放在 map.ts 而不是 secretRealms.ts，是因为大区域要给自己的小区域定基调
 * （东部群山多药草、西漠多矿脉），而 map.ts 是被 secretRealms.ts 引用的那一层，
 * 反向放会形成循环引用。
 */
export type RealmProfile = 'herb' | 'ore' | 'beast' | 'ruin' | 'frost' | 'void' | 'heaven';

export interface MajorRegionDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 该大区域的**特产材料**：只有它的资源富集区里的特产秘境会大量产出 */
  specialty: MaterialId;
  /** 进入该大区域所需境界（小区域的门槛还会在此基础上再往后排） */
  requiresRealm: number;
  /** 该大区域的基调，用来给小区域里的秘境挑路数 */
  flavor: RealmProfile;
  /** 界面配色用的序号（0~5） */
  index: number;
}

/** 资源富集区比同区其它小区域高多少境界门槛 */
export const RICH_REALM_BONUS = 4;
/** 每个大区域有几个小区域 */
export const SUB_REGIONS_PER_MAJOR = 16;
/** 资源富集区在小区域里的下标（每个大区域的最后一个） */
export const RICH_SUB_INDEX = SUB_REGIONS_PER_MAJOR - 1;

/* ------------------------------------------------------------------ */
/* 六大区域                                                            */
/* ------------------------------------------------------------------ */

export const MAJOR_REGIONS: MajorRegionDef[] = [
  {
    id: 'eastMountains',
    name: '东部群山',
    icon: '🏔',
    desc: '连绵万里的青山，灵脉最浅、也最宜初学。你的洞府就开在这里。',
    specialty: 'demonCore',
    requiresRealm: 0,
    flavor: 'herb',
    index: 0,
  },
  {
    id: 'southFrontier',
    name: '南疆',
    icon: '🌴',
    desc: '瘴气弥漫的蛮荒之地，虫蛇遍地，龙血与蛊术都出自这里。',
    specialty: 'dragonBlood',
    requiresRealm: 1,
    flavor: 'beast',
    index: 1,
  },
  {
    id: 'westDesert',
    name: '西漠',
    icon: '🏜',
    desc: '黄沙万里的戈壁，天外星辰坠落最多，星辰砂俯拾即是。',
    specialty: 'starSand',
    requiresRealm: 2,
    flavor: 'ore',
    index: 2,
  },
  {
    id: 'northReach',
    name: '北境',
    icon: '🧊',
    desc: '终年不化的极寒之地，玄冰之下埋着太阴玄晶与上古寒宫。',
    specialty: 'lunarCrystal',
    requiresRealm: 3,
    flavor: 'frost',
    index: 3,
  },
  {
    id: 'centralState',
    name: '中州',
    icon: '🏯',
    desc: '天下正中，仙门林立、坊市如云。仙玉与传承多出于此。',
    specialty: 'immortalJade',
    requiresRealm: 4,
    flavor: 'ruin',
    index: 4,
  },
  {
    id: 'boundlessSea',
    name: '无垠海',
    icon: '🌊',
    desc: '海天尽头，法则残缺。混沌紫气自界外涌来，寻常修士不敢近。',
    specialty: 'chaosQi',
    requiresRealm: 5,
    flavor: 'void',
    index: 5,
  },
];

export const MAJOR_REGION_MAP: Record<string, MajorRegionDef> = MAJOR_REGIONS.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<string, MajorRegionDef>,
);

/* ------------------------------------------------------------------ */
/* 小区域（96 个）                                                      */
/* ------------------------------------------------------------------ */

export interface MapRegionDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 所属大区域 */
  majorId: string;
  /** 在所属大区域里的下标（0~15） */
  index: number;
  /** 是不是该大区域的资源富集区 */
  isRich: boolean;
  /** 抵达该区域所需的掌门境界下标 */
  requiresRealm: number;
  /** 距离（里）。仅用于展示"探索距离" */
  distance: number;
  /** 地图上的相对位置（0~100，百分比）：大区域内部按 4×4 摆放 */
  x: number;
  y: number;
}

/** 每个大区域的名字与图标（16 个，最后一个固定是资源富集区） */
type SubRow = [name: string, icon: string];

const SUB_ROWS: Record<string, SubRow[]> = {
  eastMountains: [
    ['青石谷', '🪨'],
    ['落霞坡', '🌄'],
    ['野狼涧', '🐺'],
    ['药草坳', '🌿'],
    ['黑风岭', '🌫'],
    ['断魂崖', '💀'],
    ['寒泉洞', '🧊'],
    ['迷雾林', '🌲'],
    ['剑冢坡', '🗡'],
    ['灵泉峡', '💧'],
    ['赤铜矿脉', '⛏'],
    ['苍鹰峰', '🦅'],
    ['万药谷', '🌱'],
    ['云隐峰', '☁'],
    ['紫芝崖', '🍄'],
    ['灵脉祖庭', '✨'],
  ],
  southFrontier: [
    ['瘴气林', '🌫'],
    ['百虫谷', '🐛'],
    ['红土坡', '🟥'],
    ['毒龙潭', '🐍'],
    ['蛮荒寨', '🛖'],
    ['血藤林', '🌿'],
    ['妖蛇窟', '🕳'],
    ['古祭坛', '🗿'],
    ['万蛊洞', '🪳'],
    ['赤炎谷', '🔥'],
    ['龙脊山', '🦴'],
    ['幽魂沼', '👻'],
    ['铜鼓峡', '🥁'],
    ['蛇盘岭', '🌀'],
    ['祖巫庙', '🛕'],
    ['真龙葬地', '🐉'],
  ],
  westDesert: [
    ['黄沙口', '🏜'],
    ['枯井镇', '🪣'],
    ['风蚀岩', '🪨'],
    ['流沙河', '⏳'],
    ['黑石城', '🏚'],
    ['星陨坑', '☄'],
    ['月牙泉', '🌙'],
    ['白骨道', '🦴'],
    ['沙暴眼', '🌪'],
    ['琉璃滩', '💠'],
    ['敦煌窟', '🕳'],
    ['火焰山', '🔥'],
    ['千佛洞', '🗿'],
    ['天梯峰', '⛰'],
    ['古佛塔', '🛕'],
    ['星陨深渊', '🌌'],
  ],
  northReach: [
    ['落雪原', '❄'],
    ['冰封湖', '🧊'],
    ['白狼谷', '🐺'],
    ['冻土坡', '🪨'],
    ['寒鸦岭', '🐦'],
    ['玄冰窟', '💠'],
    ['极光台', '🌌'],
    ['雪魔林', '🌲'],
    ['万载寒渊', '🕳'],
    ['冰晶矿洞', '⛏'],
    ['霜牙峰', '⛰'],
    ['玄冥池', '💧'],
    ['雪葬谷', '⚰'],
    ['天柱冰崖', '🗻'],
    ['太阴秘境', '🌙'],
    ['北冥玄宫', '🏯'],
  ],
  centralState: [
    ['洛水岸', '🌊'],
    ['青阳镇', '🏘'],
    ['落雁坡', '🦢'],
    ['古驿道', '🛤'],
    ['云梦泽', '🌫'],
    ['玉虚观', '⛩'],
    ['剑池', '🗡'],
    ['丹霞山', '🌈'],
    ['万宝坊', '💰'],
    ['玲珑塔', '🗼'],
    ['仙宫遗迹', '🏛'],
    ['昆仑墟', '🗻'],
    ['瑶池', '🪷'],
    ['玉京峰', '⛰'],
    ['太虚仙径', '🌠'],
    ['上界云台', '☁'],
  ],
  boundlessSea: [
    ['碎星滩', '🏖'],
    ['渔火镇', '🎣'],
    ['珊瑚礁', '🪸'],
    ['迷雾岛', '🏝'],
    ['海市蜃楼', '🌅'],
    ['鲛人湾', '🧜'],
    ['沉船谷', '🚢'],
    ['归墟口', '🕳'],
    ['龙宫旧址', '🐉'],
    ['黑潮渊', '🌊'],
    ['星槎残骸', '🛶'],
    ['天渊海沟', '🌊'],
    ['混沌漩涡', '🌪'],
    ['鸿蒙残界', '🔮'],
    ['界外之门', '🚪'],
    ['界外混沌', '🌀'],
  ],
};

/** 大区域内部的 4×4 摆位，界面画小地图用 */
function subLayout(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 12 + col * 25.33, y: 88 - row * 25.33 };
}

/**
 * 小区域的境界门槛：每 4 个一档，资源富集区再高一档。
 *
 * 上限夹到 8（渡劫期）：无垠海的资源富集区算出来是 9，
 * 而 9 是「仙人」—— 那是飞升之后的事，把一处小区域锁在飞升后面等于永远去不了。
 */
function subRealm(major: MajorRegionDef, index: number): number {
  const raw =
    index >= RICH_SUB_INDEX
      ? major.requiresRealm + RICH_REALM_BONUS
      : major.requiresRealm + Math.floor(index / 4);
  return Math.min(8, raw);
}

/** 每个大区域有几处秘境：偶数下标 1 处、奇数 2 处，资源富集区 3 处 */
export function subRealmCount(index: number): number {
  if (index >= RICH_SUB_INDEX) return 3;
  return index % 2 === 0 ? 1 : 2;
}

function subDesc(major: MajorRegionDef, name: string, index: number, realmCount: number): string {
  if (index >= RICH_SUB_INDEX) {
    return (
      `${name}是${major.name}灵气最盛之处，藏着 ${realmCount} 处秘境 —— 其中「特产秘境」` +
      `专产${MATERIAL_MAP[major.specialty]?.name ?? major.specialty}，境界要求也比别处更高。`
    );
  }
  return `${name}，${major.name}的一处地界，有 ${realmCount} 处秘境隐于其间。`;
}

export const MAP_REGIONS: MapRegionDef[] = MAJOR_REGIONS.flatMap((major) =>
  (SUB_ROWS[major.id] ?? []).map((row, index) => {
    const [name, icon] = row;
    const { x, y } = subLayout(index);
    const globalIndex = major.index * SUB_REGIONS_PER_MAJOR + index;
    return {
      id: `${major.id}_${index}`,
      name,
      icon,
      desc: subDesc(major, name, index, subRealmCount(index)),
      majorId: major.id,
      index,
      isRich: index >= RICH_SUB_INDEX,
      requiresRealm: subRealm(major, index),
      // 距离随全局序号线性增长：越靠后的大区域越远
      distance: 10 + globalIndex * 15,
      x,
      y,
    };
  }),
);

export const MAP_REGION_MAP: Record<string, MapRegionDef> = MAP_REGIONS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, MapRegionDef>,
);

/** 某个大区域的全部小区域 */
export function subRegionsOf(majorId: string): MapRegionDef[] {
  return MAP_REGIONS.filter((r) => r.majorId === majorId);
}

/** 该区域在地图上的序号（0 起，由近到远）。找不到返回 -1 */
export function regionIndex(regionId: string): number {
  return MAP_REGIONS.findIndex((r) => r.id === regionId);
}

/** 某个小区域所属的大区域 */
export function majorOf(regionId: string): MajorRegionDef {
  const region = MAP_REGION_MAP[regionId];
  return MAJOR_REGION_MAP[region?.majorId ?? 'eastMountains'] ?? MAJOR_REGIONS[0];
}

/**
 * 区域档次 1~9：直接由境界门槛换算（门槛 0 → 1 档，门槛 8 → 9 档）。
 *
 * 旧版是"每两个区域一档"，因为那时只有 18 个区域。
 * 现在有 96 个小区域、境界门槛本身就是分档依据，直接用门槛更直观，
 * 也让"同档次"与"同境界"变成同一件事。
 */
export function regionTier(regionId: string): number {
  const region = MAP_REGION_MAP[regionId];
  if (!region) return 1;
  return Math.min(9, Math.max(1, region.requiresRealm + 1));
}

/** 玩家在某个区域前是否已「看得见」它：提前一个境界显示，便于规划 */
export const REGION_PREVIEW_REALMS = 1;

/* ------------------------------------------------------------------ */
/* 特产                                                                */
/* ------------------------------------------------------------------ */

/** 大区域 → 特产秘境 id（由 secretRealms.ts 生成，这里只描述约定） */
export const SPECIALTY_REALM_SUFFIX = 'specialty';

/** 该小区域产出的特产（只有资源富集区有） */
export function specialtyOf(regionId: string): MaterialId | null {
  const region = MAP_REGION_MAP[regionId];
  if (!region || !region.isRich) return null;
  return MAJOR_REGION_MAP[region.majorId]?.specialty ?? null;
}
