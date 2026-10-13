/**
 * 内容层统一出口。
 *
 * 所有游戏数值都拆在这个目录下的几个文件里，游戏逻辑一行都不用改：
 *   resources.ts    资源与材料（材料分基础 / 稀有两级）
 *   planting.ts     种子、成熟时间、催熟价格
 *   buildables.ts   设施与建筑（含灵石合成与自动合成档位）
 *   techs.ts        钻研技术与图纸（需求 6）
 *   shop.ts         商行货品与刷新（需求 3 / 6）
 *   map.ts          地图与区域划分（需求 5）
 *   travel.ts       个人游历区域（需求 1）
 *   secretRealms.ts 秘境（发现机制、冷却、人数产出）
 *   sectActivity.ts 心得、宗门随机事件、大比（需求 4）
 *   seasons.ts      季节与天象（需求 1）
 *   realms.ts       境界体系、突破成功率、时间尺度
 *   recipes.ts      丹方、器方、炼丹炼器品阶
 *   sect.ts         弟子资质、宗门品阶、招收规则、名字生成
 *   talents.ts      弟子战斗天赋 / 种田天赋 / 性格 / 忠诚度 / 心魔
 *   manuals.ts      功法（五档制、碎片合成、藏经阁）
 *   furnace.ts      丹炉九件 + 弟子五装备栏
 *   servants.ts     仆人（杂役）工种与加成
 *
 * 外界一律 `import { ... } from './content'`，不需要关心内部怎么拆的。
 */
export * from './resources';
export * from './planting';
export * from './buildables';
export * from './techs';
export * from './shop';
export * from './map';
export * from './travel';
export * from './secretRealms';
export * from './sectActivity';
  export * from './encounters';
  export * from './refine';
export * from './seasons';
export * from './realms';
export * from './recipes';
export * from './sect';
export * from './talents';
export * from './manuals';
export * from './fame';
export * from './diplomacy';
export * from './furnace';
export * from './skills';
export * from './talismans';
export * from './servants';
export * from './enlightenment';
