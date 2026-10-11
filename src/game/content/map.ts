/**
 * 地图与区域划分（需求 5）
 *
 * 需求原文：「由于秘境是发现机制，所以你需要设计一个地图，并划分不同区域，
 *           玩家或者弟子只有等级高了，才能去更远的地域探索
 *           （因为境界越高，可以飞行等，所以探索距离可以增加）」
 *
 * 后续需求把区域从 6 个扩到 **18 个**，每个区域 2~3 处秘境。
 *
 * 所以地图不是装饰，而是**一切探索的门禁**：
 *   - 区域有 requiresRealm，境界不够就去不了；
 *   - 每个区域有 distance（里），掌门能抵达的总距离随境界增长 ——
 *     这就是「境界越高，探索距离越增加」的具象化。
 *
 * ⚠️ 这里刻意**不**存「本区域有哪些秘境 / 哪些游历目的地」。
 * 唯一的事实来源是各秘境自己的 `regionId`（见 secretRealms.ts）与
 * 各游历目的地的 `regionId`（见 travel.ts）—— 两处各存一份必然会漂移。
 * 界面按 regionId 反查即可。
 */
export interface MapRegionDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 抵达该区域所需的掌门境界下标 */
  requiresRealm: number;
  /** 距离（里）。仅用于展示"探索距离"，同时决定发现秘境的优先级 */
  distance: number;
  /** 地图上的相对位置（0~100，百分比） */
  x: number;
  y: number;
}

/**
 * 地图布局：3 列 × 6 行，按蛇形从下往上排。
 *
 * 手写 18 组坐标太容易撞车，所以直接算：近处在下方，越往上走得越远。
 */
const MAP_COLUMNS = 3;
const MAP_ROWS = 6;

export function mapLayout(index: number): { x: number; y: number } {
  const row = Math.min(Math.floor(index / MAP_COLUMNS), MAP_ROWS - 1);
  const within = index % MAP_COLUMNS;
  // 偶数行从左往右、奇数行从右往左 —— 连起来就是一条蛇形路径
  const col = row % 2 === 0 ? within : MAP_COLUMNS - 1 - within;
  return {
    x: 16 + col * 34,
    y: 90 - row * (80 / (MAP_ROWS - 1)),
  };
}

/** 紧凑的区域定义表：id / 名称 / 图标 / 所需境界 / 距离 / 说明 */
type RegionRow = [
  id: string,
  name: string,
  icon: string,
  requiresRealm: number,
  distance: number,
  desc: string,
];

const REGION_ROWS: RegionRow[] = [
  /* 炼气期：山门附近 */
  ['nearHills', '近郊山野', '🏘', 0, 10, '山门之外的凡俗地界，炼气修士举步可至。'],
  ['wildRoad', '荒村古道', '🛤', 0, 25, '荒废多年的古驿道，两侧尽是断壁残垣。'],

  /* 筑基期 */
  ['mistyFrontier', '迷雾边陲', '🌫', 1, 45, '终年白雾笼罩的边地，须筑基修为方能辨识路径。'],
  ['soulCliff', '断魂崖', '🗻', 1, 70, '崖下白骨累累，风过如泣，据说死者神魂不散。'],

  /* 金丹期 */
  ['scorchedWilds', '烈焰荒原', '🌋', 2, 105, '地火横行的荒原，金丹修士御器飞掠方可越过。'],
  ['boneMarsh', '万骨泽', '🪦', 2, 145, '上古战场沉成的淤泽，一脚踩下去不知会翻出什么。'],

  /* 元婴期 */
  ['starfallDeep', '星陨深渊', '☄', 3, 195, '天外星辰坠落之地，元婴修士方能深入渊底。'],
  ['iceValley', '寒泉幽谷', '❄', 3, 255, '万年寒泉自谷底涌出，泉边结满寒玉，月华在此凝露。'],

  /* 化神期：宗门在此期开山，所以这一带秘境最密 */
  ['netherVoid', '幽冥虚空', '🕳', 4, 330, '虚空夹缝中的幽冥之地，非化神以上不可久留。'],
  ['bloodIsles', '血海孤岛', '🩸', 4, 420, '血海之上零星几座孤岛，岛下沉着真龙遗骸。'],
  ['ancientRuin', '古仙遗迹', '🏛', 4, 520, '不知何年何月的仙宫残址，剑冢与古药圃仍在。'],

  /* 炼虚期 */
  ['voidCorridor', '太虚仙径', '🌌', 5, 640, '漂浮于虚空中的上古仙宫，机关重重，仙玉嵌于殿顶。'],
  ['starCorridor', '虚空回廊', '🌀', 5, 780, '以星辰为灯的回廊，走在其中能听见自己的心跳。'],

  /* 合体期 */
  ['outerChaos', '界外混沌', '🌪', 6, 940, '已在本界之外，法则残缺，唯有合体大能可横渡。'],
  ['primordialRemnant', '鸿蒙残界', '🔮', 6, 1120, '开天辟地时残留的一角，紫气自裂隙中溢出。'],

  /* 大乘期 */
  ['starSeaEnd', '星海尽头', '✨', 7, 1320, '星海的边缘，再往外便是什么都没有的虚无。'],
  ['heavenTerrace', '上界云台', '🏯', 7, 1550, '传说中上界垂落的云台，登之可窥仙门。'],

  /* 渡劫期 */
  ['thunderAbyss', '九霄雷渊', '⚡', 8, 1800, '雷劫汇聚之渊，渡劫者十有八九在此化为飞灰。'],
];

export const MAP_REGIONS: MapRegionDef[] = REGION_ROWS.map((row, index) => {
  const [id, name, icon, requiresRealm, distance, desc] = row;
  const { x, y } = mapLayout(index);
  return { id, name, icon, desc, requiresRealm, distance, x, y };
});

export const MAP_REGION_MAP: Record<string, MapRegionDef> = MAP_REGIONS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, MapRegionDef>,
);

/** 该区域在地图上的序号（0 起，由近到远）。找不到返回 -1 */
export function regionIndex(regionId: string): number {
  return MAP_REGIONS.findIndex((r) => r.id === regionId);
}

/**
 * 区域档次 1~9：每两个区域提升一档。
 *
 * 它决定秘境的推荐战力、时长、冷却、伤亡率与掉落档次 ——
 * 18 个区域要是手写 18 套数值，改平衡时就没人找得全了。
 */
export function regionTier(regionId: string): number {
  const index = regionIndex(regionId);
  if (index < 0) return 1;
  return Math.min(9, Math.floor(index / 2) + 1);
}

/** 玩家在某个区域前是否已「看得见」它：提前一个境界显示，便于规划 */
export const REGION_PREVIEW_REALMS = 1;
