/**
 * 随机数来源 —— 明确区分「游戏运行时」和「分析工具」两条路径。
 *
 * 游戏运行时（浏览器里玩的时候）：一律使用 gameRandom，也就是 Math.random。
 *   Math.random 由引擎从操作系统熵池播种，每次打开游戏都不一样，
 *   **不可复现**，也没有任何存档会记录随机种子。
 *
 * 测试与数值模拟（tools/ 目录）：显式注入固定种子的伪随机数。
 *   这样回归测试才能稳定复现，数值模拟才能在改动前后做严格对比。
 *
 * 两条路径的切换方式：所有涉及随机的函数都接受一个可选的 random 参数，
 * 默认值是 gameRandom；只有 tools/ 里的代码会传入自己的种子随机数。
 * src/ 目录内不允许出现任何带种子的随机数实现。
 */
export type RandomSource = () => number;

/**
 * 游戏运行时使用的随机源。
 *
 * 直接绑定 Math.random（而不是包一层），既省一次调用，
 * 也避免有人在这里偷偷换成带种子的实现。
 */
export const gameRandom: RandomSource = Math.random;

/** 生成一个足够随机的短 id，用于弟子、探索队伍等 */
export function randomId(prefix: string, random: RandomSource = gameRandom): string {
  return `${prefix}${Math.floor(random() * 0xffffffff).toString(36)}`;
}

/**
 * 按权重**不放回**地抽取 count 项。
 *
 * 秘境掉落、游历掉落、商行上架都用它 —— 三处的抽取规则必须完全一致，
 * 否则玩家会发现"同样的权重在不同的地方概率不一样"。
 */
export function weightedDraw<T extends { weight: number }>(
  pool: T[],
  count: number,
  random: RandomSource,
): T[] {
  const available = [...pool];
  const picked: T[] = [];
  while (picked.length < count && available.length > 0) {
    const total = available.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) break;
    let roll = random() * total;
    let index = available.length - 1;
    for (let i = 0; i < available.length; i += 1) {
      roll -= available[i].weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(available[index]);
    available.splice(index, 1);
  }
  return picked;
}
