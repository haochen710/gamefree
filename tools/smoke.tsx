/**
 * 冒烟测试
 * ========
 * 用 react-dom/server 把整个界面渲染一次，检查:
 *   1. 所有模块能正常加载（导入路径、类型、循环依赖问题都会在这里暴露）；
 *   2. 组件树不会崩（状态选择器写错、访问了 undefined 属性等）；
 *   3. 关键的界面元素确实渲染出来了。
 *
 * 它不需要浏览器，因此可以放进 CI，每次提交都跑一遍。
 *
 *     pnpm smoke
 */
import { renderToString } from 'react-dom/server';
import App from '../src/App';
import { D, fmt } from '../src/game/decimal';
import { createInitialState } from '../src/game/state';
import { applyTick, getProduction, buyGenerator } from '../src/game/engine';
import { GENERATOR_MAP } from '../src/game/content';
import { deserialize, exportCode, importCode, applyOffline, serialize } from '../src/game/save';

/** 界面里必须出现的文字 */
const EXPECTED_TEXT = [
  '仙途',
  '打坐',
  '洞府设施',
  '聚灵阵',
  '灵气',
  '境界',
  '炼气期',
  '飞升',
  '导出存档码',
];

function check(label: string, condition: boolean, detail = ''): boolean {
  const mark = condition ? '  ✓' : '  ✗';
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  return condition;
}

console.log('仙途 · 冒烟测试');
console.log('='.repeat(60));

let passed = true;

/* ---------------------------------------------------------------- 界面渲染 */
console.log('\n[1] 界面渲染');
let html = '';
try {
  html = renderToString(<App />);
  passed = check('组件树渲染成功', html.length > 0, `${html.length} 字符`) && passed;
} catch (error) {
  passed = check('组件树渲染成功', false, String(error)) && passed;
}

for (const text of EXPECTED_TEXT) {
  passed = check(`包含「${text}」`, html.includes(text)) && passed;
}

/* ---------------------------------------------------------------- 游戏逻辑 */
console.log('\n[2] 游戏逻辑');
{
  let state = createInitialState(0);

  passed = check('开局灵气为 10', state.resources.qi.eq(10), `实际 ${state.resources.qi.toString()}`) &&
    passed;
  passed = check('开局没有任何产量', getProduction(state).qi.eq(0)) && passed;

  // 打坐 5 次应该够买一个聚灵阵（15 灵气）
  for (let i = 0; i < 5; i += 1) state = { ...state, resources: { ...state.resources, qi: state.resources.qi.add(1) } };
  state = buyGenerator(state, GENERATOR_MAP.spiritArray, 1);
  passed = check('买下第一个聚灵阵', (state.generators.spiritArray ?? 0) === 1) && passed;
  passed = check('灵气被正确扣除', state.resources.qi.lt(15), `余 ${state.resources.qi.toString()}`) &&
    passed;

  // 推进 10 秒，聚灵阵应该产出 6 点灵气
  const before = state.resources.qi;
  state = applyTick(state, 10);
  const gained = state.resources.qi.sub(before);
  passed = check('推进 10 秒产出约 6 灵气', Math.abs(gained.toNumber() - 6) < 1e-6, `实际 ${gained.toString()}`) &&
    passed;
  passed = check('累计灵气同步记录', state.totalQi.gt(0)) && passed;
}

/* ---------------------------------------------------------------- 大数 */
console.log('\n[3] 大数精度（超过 JS number 上限的场景）');
{
  // 原生 number 到 1e308 就溢出，break_infinity 能到 1e(9e15)。
  const nativeOverflow = Number('1e400');
  passed = check('对照组：原生 number 在 1e400 溢出', !Number.isFinite(nativeOverflow)) && passed;

  const huge = D('1e400');
  const bigger = huge.mul('1e12');
  passed = check('1e412 仍可计算且未退化成 Infinity', bigger.toString() !== 'Infinity', bigger.toString()) &&
    passed;
  passed = check('超大数比较正确', bigger.gt(huge)) && passed;

  // 格式化必须能处理超出原生 number 范围的数值（曾经会显示成 ∞）
  const text = fmt(bigger);
  passed = check('超大数格式化正常', text !== '∞' && text.includes('e'), text) && passed;

  // 中文单位换算要准确
  passed = check('1e4 显示为 1.00万', fmt(D(1e4)) === '1.00万', fmt(D(1e4))) && passed;
  passed = check('1e8 显示为 1.00亿', fmt(D(1e8)) === '1.00亿', fmt(D(1e8))) && passed;
  passed = check('9999 显示为整数', fmt(D(9999)) === '9999', fmt(D(9999))) && passed;
  passed = check('6.5 保留两位小数', fmt(D(6.5)) === '6.50', fmt(D(6.5))) && passed;
}

/* ---------------------------------------------------------------- 存档 */
console.log('\n[4] 存档往返');
{
  const original = createInitialState(1_700_000_000_000);
  original.generators.spiritArray = 42;
  original.realmIndex = 3;
  original.layer = 5;
  original.daoYun = original.daoYun.add(123);
  original.ascensions = 2;
  original.resources.pill = original.resources.pill.add(7);

  const restored = deserialize(JSON.parse(JSON.stringify(serialize(original))));
  passed = check('存档可序列化并还原', restored !== null) && passed;

  if (restored) {
    passed = check('设施数量还原', restored.generators.spiritArray === 42) && passed;
    passed = check('境界还原', restored.realmIndex === 3 && restored.layer === 5) && passed;
    passed = check('道韵还原', restored.daoYun.eq(123)) && passed;
    passed = check('丹药还原', restored.resources.pill.eq(7)) && passed;
  }

  const code = exportCode(original);
  const fromCode = importCode(code);
  passed = check('导出码可导入', fromCode !== null && fromCode.daoYun.eq(123)) && passed;
  passed = check('乱码存档被拒绝', importCode('这不是一个合法存档!!!') === null) && passed;
  passed = check('空存档被拒绝', importCode('') === null) && passed;
}

/* ---------------------------------------------------------------- 离线收益 */
console.log('\n[5] 离线收益');
{
  const state = createInitialState(0);
  state.generators.spiritArray = 10; // 6 灵气/秒

  // 离线 1 小时
  const oneHour = applyOffline(state, 3600 * 1000);
  const expected = 6 * 3600 * 0.5;
  const gained = oneHour.report ? oneHour.report.gains.qi.toNumber() : 0;
  passed = check('1 小时离线按 50% 结算', Math.abs(gained - expected) < 1e-6, `实际 ${gained}`) && passed;

  // 离线 100 小时应该被 8 小时上限截断
  const longAway = applyOffline(state, 100 * 3600 * 1000);
  const capped = longAway.report ? longAway.report.gains.qi.toNumber() : 0;
  passed = check('超长离线被 8 小时上限截断', Math.abs(capped - 6 * 8 * 3600 * 0.5) < 1e-6, `实际 ${capped}`) &&
    passed;

  // 离开 10 秒不应该是"离线"
  const shortAway = applyOffline(state, 10 * 1000);
  passed = check('短暂离开不触发离线结算', shortAway.report === null) && passed;
}

/* ---------------------------------------------------------------- 结果 */
console.log('');
console.log('='.repeat(60));
if (!passed) {
  throw new Error('冒烟测试未通过');
}
console.log('全部通过 ✓');
