/**
 * 地图与区域划分（需求 5）
 *
 * 需求原文：「由于秘境是发现机制，所以你需要设计一个地图，并划分不同区域，
 *           玩家或者弟子只有等级高了，才能去更远的地域探索
 *           （因为境界越高，可以飞行等，所以探索距离可以增加）」
 *
 * 所以地图不是装饰，而是**一切探索的门禁**：
 *   - 秘境与游历目的地都挂在某个区域下；
 *   - 区域有 requiresRealm，境界不够就去不了；
 *   - 每个区域有 distance（里），掌门能抵达的总距离随境界增长 ——
 *     这就是「境界越高，探索距离越增加」的具象化。
 *
 * 布局上把近处放在下方、远处放在上方，视觉上就是「越往上走得越远」。
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
  /** 该区域内的秘境 id */
  realms: string[];
  /** 该区域内的游历目的地 id */
  travel: string[];
}

export const MAP_REGIONS: MapRegionDef[] = [
  {
    id: 'nearHills',
    name: '近郊山野',
    icon: '🏘',
    desc: '山门之外的凡俗地界，炼气修士举步可至。',
    requiresRealm: 0,
    distance: 10,
    x: 50,
    y: 84,
    realms: ['sunsetValley'],
    travel: ['mortalVillage'],
  },
  {
    id: 'mistyFrontier',
    name: '迷雾边陲',
    icon: '🌫',
    desc: '终年白雾笼罩的边地，须筑基修为方能辨识路径。',
    requiresRealm: 1,
    distance: 40,
    x: 26,
    y: 68,
    realms: ['blackWindRidge'],
    travel: ['mistyForest'],
  },
  {
    id: 'scorchedWilds',
    name: '烈焰荒原',
    icon: '🌋',
    desc: '地火横行的荒原，金丹修士御器飞掠方可越过。',
    requiresRealm: 2,
    distance: 90,
    x: 72,
    y: 62,
    realms: ['boneField'],
    travel: ['emberRavine'],
  },
  {
    id: 'starfallDeep',
    name: '星陨深渊',
    icon: '☄',
    desc: '天外星辰坠落之地，元婴修士方能深入渊底。',
    requiresRealm: 3,
    distance: 200,
    x: 44,
    y: 46,
    realms: ['starfallAbyss'],
    travel: ['frostHollow'],
  },
  {
    id: 'netherVoid',
    name: '幽冥虚空',
    icon: '🕳',
    desc: '虚空夹缝中的幽冥之地，非化神以上不可久留。',
    requiresRealm: 4,
    distance: 500,
    x: 22,
    y: 28,
    realms: ['netherSea', 'voidParadise'],
    travel: ['ancientBattlefield', 'netherRift'],
  },
  {
    id: 'outerChaos',
    name: '界外混沌',
    icon: '🌌',
    desc: '已在本界之外，法则残缺。唯合体大能可横渡而至。',
    requiresRealm: 6,
    distance: 1200,
    x: 60,
    y: 12,
    realms: ['primordialRuins', 'gateOfHeaven'],
    travel: ['chaosSea', 'primordialVoid'],
  },
];

export const MAP_REGION_MAP: Record<string, MapRegionDef> = MAP_REGIONS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, MapRegionDef>,
);

export const REGION_PREVIEW_REALMS = 1;
