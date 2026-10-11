/**
 * 内容层统一出口。
 *
 * 所有游戏数值都拆在这个目录下的几个文件里，游戏逻辑一行都不用改：
 *   resources.ts    资源与材料
 *   buildables.ts   设施与建筑（含灵石合成）
 *   realms.ts       境界体系、突破成功率、时间尺度
 *   recipes.ts      丹方、器方、炼丹炼器品阶
 *   sect.ts         弟子资质、宗门品阶、招收规则、名字生成
 *   servants.ts     仆人（杂役）工种与加成
 *   secretRealms.ts 秘境
 *
 * 外界一律 `import { ... } from './content'`，不需要关心内部怎么拆的。
 */
export * from './resources';
export * from './buildables';
export * from './realms';
export * from './recipes';
export * from './sect';
export * from './servants';
export * from './secretRealms';
