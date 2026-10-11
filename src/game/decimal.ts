/**
 * 大数模块：全项目统一从这里取 Decimal。
 *
 * 为什么需要它：修仙游戏的"灵气"后期会涨到 1e30 甚至 1e1000 以上。
 * JS 原生 number 上限约 1.8e308，且有效数字只有 15~17 位，
 * 用原生 number 会在中后期出现精度丢失（买了东西数额不变）甚至变成 Infinity。
 *
 * break_infinity.js 上限约 1e(9e15)，且比 decimal.js 快得多，是放置游戏的行业标配。
 */
import Decimal from 'break_infinity.js';

export { Decimal };
export default Decimal;

/** 可以喂给 Decimal 的任意数值形式 */
export type Num = Decimal | number | string;

/** 把任意数值转成 Decimal（已经是 Decimal 就直接返回，避免无谓的对象分配） */
export function D(value: Num = 0): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/**
 * 中文数量级单位。修仙题材用「万/亿/兆/京…」比 1.23e12 更有代入感。
 * 每 4 个数量级进一位。
 */
const CN_UNITS = ['', '万', '亿', '兆', '京', '垓', '秭', '穰', '沟', '涧', '正', '载', '极'];

/**
 * 格式化显示。小于 1000 显示小数，之后按中文单位缩写，
 * 超出「极」(1e48) 之后退回科学计数法。
 *
 * 注意：这里全程避免直接对超大数调用 toNumber()。
 * break_infinity 能表示到 1e(9e15)，但 JS number 到 1e308 就溢出成 Infinity，
 * 所以必须先除以 10 的幂把数值压到安全区间，再取尾数。
 */
export function fmt(value: Num, digits = 2): string {
  const v = D(value);
  if (v.toString() === 'NaN') return '—';
  if (v.lt(0)) return `-${fmt(v.neg(), digits)}`;
  if (v.eq(0)) return '0';

  const exp = v.log10();
  if (!Number.isFinite(exp)) return v.toString();

  if (exp < 3) {
    const n = v.toNumber();
    if (n < 10) return n.toFixed(digits);
    if (n < 100) return n.toFixed(Math.max(0, digits - 1));
    return n.toFixed(0);
  }

  const tier = Math.floor(exp / 4);

  if (tier <= 0) {
    // 1000 ~ 9999，还没到「万」，直接显示整数
    return v.toNumber().toFixed(0);
  }

  if (tier < CN_UNITS.length) {
    const scaled = v.div(Decimal.pow(10, tier * 4));
    return `${scaled.toNumber().toFixed(2)}${CN_UNITS[tier]}`;
  }

  const e = Math.floor(exp);
  const mantissa = v.div(Decimal.pow(10, e));
  return `${mantissa.toNumber().toFixed(2)}e${e}`;
}

/** 每秒产量之类的速率显示，带正负号 */
export function fmtRate(value: Num, digits = 2): string {
  const v = D(value);
  const sign = v.gte(0) ? '+' : '-';
  return `${sign}${fmt(v.abs(), digits)}/秒`;
}

/** 把秒数变成「3小时24分」这种可读时长 */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

/** 保留 n 位小数但去掉多余的 0，用于显示倍率 */
export function fmtMultiplier(value: Num, digits = 2): string {
  return `×${fmt(value, digits)}`;
}
