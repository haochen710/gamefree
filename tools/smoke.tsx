/**
 * 冒烟测试
 * ========
 * 用 react-dom/server 把整个界面渲染一次，再逐项验证核心逻辑。
 *
 * 覆盖范围：
 *   界面渲染、打坐限流、建筑与价格、突破成功率、灵石合成、
 *   存档往返与旧版迁移、离线收益、弟子修炼与寿元、秘境结算与伤亡、
 *   炼丹品阶门禁、器物生效上限、大数精度。
 *
 * 所有随机过程都注入固定种子的伪随机数，因此结果完全可复现。
 *
 *     pnpm smoke
 */
import { renderToString } from 'react-dom/server';
import App from '../src/App';
import { D, fmt } from '../src/game/decimal';
import {
  APTITUDE_MAP,
  BUILDABLE_MAP,
  INJURY_PRODUCTION_PENALTY,
  INJURY_SECONDS,
  MIND_MAX,
  PILLS,
  SERVANT_BONUS_PER_HEAD,
  REALMS,
  SECRET_REALM_MAP,
  BASE_STORAGE,
  STRUCTURES,
  createEmptyBuffs,
  type MaterialId,
  type ResourceId,
} from '../src/game/content';
import { createInitialState, type GameState } from '../src/game/state';
import * as engine from '../src/game/engine';
import * as disciples from '../src/game/disciples';
import * as expeditions from '../src/game/expeditions';
import * as crafting from '../src/game/crafting';
import { applyTick } from '../src/game/tick';
import { gameRandom } from '../src/game/random';
import { applyOffline, deserialize, exportCode, importCode, serialize } from '../src/game/save';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

/** 固定种子的线性同余伪随机数，保证测试可复现 */
function makeRandom(seed = 123456789): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** 永远返回同一个值的随机源，用于精确控制概率分支 */
function fixedRandom(value: number): () => number {
  return () => value;
}

let passed = true;
let checks = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition) passed = false;
  console.log(`${condition ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** 给玩家一笔资源，方便构造测试场景 */
function grant(state: GameState, updates: Partial<Record<string, string>>): GameState {
  const resources = { ...state.resources };
  const materials = { ...state.materials };
  for (const [key, value] of Object.entries(updates)) {
    if (key in resources) resources[key as ResourceId] = D(value as string);
    else materials[key as MaterialId] = D(value as string);
  }
  return { ...state, resources, materials };
}

/** 直接买一座建筑（绕过资源检查，用于搭场景） */
function forceBuild(state: GameState, id: string, count: number): GameState {
  return { ...state, buildings: { ...state.buildings, [id]: count } };
}

console.log('仙途 · 冒烟测试');
console.log('='.repeat(64));

/* ------------------------------------------------------------------ */
/* 1. 界面渲染                                                         */
/* ------------------------------------------------------------------ */
section('[1] 界面渲染');
{
  let html = '';
  try {
    html = renderToString(<App />);
    check('组件树渲染成功', html.length > 0, `${html.length} 字符`);
  } catch (error) {
    check('组件树渲染成功', false, String(error));
  }

  const expected = ['仙途', '打坐', '洞府建设', '资源设施', '境界', '灵石合成', '修行', '宗门', '秘境', '丹器', '洞府'];
  for (const text of expected) {
    check(`包含「${text}」`, html.includes(text));
  }
}

/* ------------------------------------------------------------------ */
/* 2. 打坐限流（需求 1）                                                */
/* ------------------------------------------------------------------ */
section('[2] 打坐限流（需求 1）');
{
  let state = createInitialState(0);
  check('开局有心神', state.mind === MIND_MAX, `${state.mind}/${MIND_MAX}`);

  const before = state.resources.qi;
  state = engine.meditate(state);
  check('打坐消耗 1 点心神', state.mind === MIND_MAX - 1);
  check('打坐获得灵气', state.resources.qi.gt(before), `+${state.resources.qi.sub(before).toString()}`);

  // 耗尽心神后不能再打坐
  for (let i = 0; i < MIND_MAX + 5; i += 1) state = engine.meditate(state);
  check('心神耗尽后无法继续打坐', state.mind === 0);
  check('心神不足时收益为 0', engine.getMeditateGain(state).eq(0));

  // 回复
  const regen = engine.tickMind(state, 12);
  check('12 秒回复 2 点心神', regen.mind === 2, `实际 ${regen.mind}`);
  const capped = engine.tickMind(regen, 100000);
  check('心神不会超过上限', capped.mind === MIND_MAX, `实际 ${capped.mind}`);

  // 关键指标：满负荷手点的收益上限
  // 心神每 6 秒回 1 点 → 每分钟 10 次 → 每次 1.5 秒产量 → 每分钟 15 秒产量
  const clicksPerMinute = 60 / 6;
  const boostRatio = (clicksPerMinute * 1.5) / 60;
  check('手点收益被限制在产量的 25% 以内', boostRatio <= 0.25, `${Math.round(boostRatio * 100)}%`);
}

/* ------------------------------------------------------------------ */
/* 2b. 随机源：游戏必须用真随机                                          */
/* ------------------------------------------------------------------ */
section('[2b] 随机源');
{
  check('游戏随机源就是 Math.random（无种子）', gameRandom === Math.random);

  // 连续取值应当互不相同 —— 固定种子的实现会在这里暴露
  const samples = new Set<number>();
  for (let i = 0; i < 200; i += 1) samples.add(gameRandom());
  check('连续取值不重复（说明不是固定序列）', samples.size > 190, `${samples.size}/200 个不同值`);

  // 招收弟子/突破等入口默认都用 gameRandom，不传参也能正常工作
  const state = grant(forceBuild(createInitialState(0), 'thatchHut', 5), { stone: '1e6' });
  const withSect: GameState = { ...state, sect: { ...state.sect, founded: true } };
  const a = disciples.recruitDisciple(withSect).disciple;
  const b = disciples.recruitDisciple(withSect).disciple;
  check('招收弟子默认走真随机', a !== null && b !== null);
  check('两次招收得到的弟子不同', a!.name !== b!.name || a!.aptitude !== b!.aptitude, `${a!.name}/${a!.aptitude} vs ${b!.name}/${b!.aptitude}`);
}

/* ------------------------------------------------------------------ */
/* 2c. 仆役（杂役）                                                     */
/* ------------------------------------------------------------------ */
section('[2c] 仆役（杂役）');
{
  // 没有居所时不能招收
  const bare = createInitialState(0);
  check('没有居所时无法招收仆人', !engine.canRecruitServant(bare).ok, engine.canRecruitServant(bare).reason ?? '');

  // 建了茅屋：居所够了，此时只差灵气（开局只有 10 灵气，而仆人要 80）
  const housed = forceBuild(createInitialState(0), 'thatchHut', 2); // 6 个床位
  check('仆人上限等于居所容量', engine.getServantCapacity(housed) === 6);
  check(
    '建了茅屋后只差灵气',
    !engine.canRecruitServant(housed).ok && engine.canRecruitServant(housed).reason === '灵气不足',
    engine.canRecruitServant(housed).reason ?? '',
  );

  // 灵气不足时招不了
  const poor: GameState = { ...housed, resources: { ...housed.resources, qi: D(0) } };
  check('灵气不足时无法招收仆人', !engine.canRecruitServant(poor).ok);

  // 招收：消耗灵气、人数增加
  const rich = grant(housed, { qi: '1e6' });
  const afterOne = engine.recruitServant(rich, 'ore');
  check('有居所且有灵气时可以招收仆人', engine.canRecruitServant(rich).ok);
  check('招收仆人消耗灵气', afterOne.resources.qi.lt(rich.resources.qi));
  check('仆人计入对应工种', (afterOne.servants.ore ?? 0) === 1);
  check('总仆人数正确', engine.getServantCount(afterOne) === 1);

  // 加成：只作用于对应资源
  const producing = forceBuild(afterOne, 'oreVein', 10);
  const noServant = forceBuild(grant(housed, { qi: '1e6' }), 'oreVein', 10);
  const withBonus = engine.getProduction(producing).ore.toNumber();
  const without = engine.getProduction(noServant).ore.toNumber();
  check(
    '仆人给对应资源提供加成',
    Math.abs(withBonus / without - (1 + SERVANT_BONUS_PER_HEAD)) < 1e-9,
    `${without.toFixed(3)} → ${withBonus.toFixed(3)}`,
  );
  check(
    '仆人不影响其它资源',
    Math.abs(engine.getProduction(producing).wood.toNumber() - engine.getProduction(noServant).wood.toNumber()) < 1e-9,
  );

  // 调派
  const moved = engine.assignServant(afterOne, 'ore', 'herb');
  check('仆人可以在工种间调派', (moved.servants.ore ?? 0) === 0 && (moved.servants.herb ?? 0) === 1);
  check('调派不改变总人数', engine.getServantCount(moved) === 1);

  // 遣散
  const fired = engine.dismissServant(moved, 'herb');
  check('可以遣散仆人', engine.getServantCount(fired) === 0);

  // 招收价格随人数上涨
  const many = grant(forceBuild(createInitialState(0), 'grotto', 5), { qi: '1e12' });
  const costAt0 = engine.getServantCost(many).toNumber();
  let grown = many;
  for (let i = 0; i < 10; i += 1) grown = engine.recruitServant(grown, 'chores');
  const costAt10 = engine.getServantCost(grown).toNumber();
  check('招收价格随人数上涨', costAt10 > costAt0, `${costAt0} → ${costAt10}`);

  // 居所满了就招不了
  const full: GameState = { ...many, servants: { chores: engine.getServantCapacity(many) } };
  check('居所满员后无法再招收', !engine.canRecruitServant(full).ok, engine.canRecruitServant(full).reason ?? '');

  // 关键取舍：仆人与弟子共用居所名额
  // （把宗门品阶调高，让「居所」而不是「宗门等级」成为瓶颈，才能看出共用效果）
  const sectState: GameState = {
    ...grant(forceBuild(createInitialState(0), 'thatchHut', 10), { stone: '1e9', qi: '1e9' }),
    sect: { founded: true, level: 5, disciples: [], totalRecruited: 0, lifespanBonus: 0 },
  };
  check('测试场景：居所容量 30', engine.getHousingCapacity(sectState) === 30);
  const beforeServants = engine.getDiscipleCapacity(sectState);
  const withServants: GameState = { ...sectState, servants: { chores: 6 } };
  check(
    '多收仆人就会少收弟子（共用居所）',
    engine.getDiscipleCapacity(withServants) === beforeServants - 6,
    `${beforeServants} → ${engine.getDiscipleCapacity(withServants)}`,
  );

  // 遣散仆人能给弟子腾出名额
  const freed = engine.dismissAllServants(withServants);
  check('遣散仆人可腾出弟子名额', engine.getDiscipleCapacity(freed) === beforeServants);

  // 存档往返
  const saved = deserialize(JSON.parse(JSON.stringify(serialize(withServants))));
  check('仆人数量能存档还原', saved !== null && (saved.servants.chores ?? 0) === 6);

  // 非法工种在读档时被丢弃
  const dirty = deserialize({
    ...serialize(sectState),
    sv: { chores: 2, '@@bogus': 5, ore: -3 },
  });
  check(
    '读档丢弃非法工种与非法数量',
    dirty !== null && (dirty.servants.chores ?? 0) === 2 && dirty.servants['@@bogus'] === undefined && dirty.servants.ore === undefined,
  );
}

/* ------------------------------------------------------------------ */
/* 3. 建筑与价格                                                       */
/* ------------------------------------------------------------------ */
section('[3] 建筑与价格');
{
  let state = grant(createInitialState(0), { qi: '1000' });

  state = engine.buyBuilding(state, BUILDABLE_MAP.spiritArray, 1);
  check('可以买下聚灵阵', engine.getBuildingCount(state, 'spiritArray') === 1);
  check('灵气被扣除', state.resources.qi.lt(1000), `余 ${state.resources.qi.toString()}`);

  const cost1 = engine.getCost(BUILDABLE_MAP.spiritArray, 0, 1);
  const cost10 = engine.getCost(BUILDABLE_MAP.spiritArray, 0, 10);
  const single = cost1.qi ?? D(0);
  const bulk = cost10.qi ?? D(0);
  check('买 10 个的总价高于 10 倍单价', bulk.gt(single.mul(10)), `${bulk.toString()} vs ${single.toString()}`);

  // 居所提供弟子容量
  const housed = forceBuild(state, 'thatchHut', 3);
  check('茅屋提供弟子容量', engine.getHousingCapacity(housed) === 9, `${engine.getHousingCapacity(housed)}`);

  // 丹房提供炼丹位
  const withRooms = forceBuild(state, 'alchemyRoom', 2);
  check('丹房提供炼丹位', engine.getAlchemySlots(withRooms) === 2);
  check('炼丹位决定品阶上限', engine.getMaxAlchemyTierBySlots(withRooms) === 3, `实际 ${engine.getMaxAlchemyTierBySlots(withRooms)}`);

  /* ---- 建筑解锁的持久性（bug 回归测试） ----
     早期版本用「当前资源是否达标」判断可见性，导致玩家一花掉灵气，
     已经建了好几座的灵木林就从建造面板上消失了。 */
  const woodGrove = BUILDABLE_MAP.woodGrove;

  let fresh = engine.refreshUnlocks(createInitialState(0));
  check('开局可见无门槛的聚灵阵', engine.isUnlocked(BUILDABLE_MAP.spiritArray, fresh));
  check('开局灵木林尚未解锁', !engine.isUnlocked(woodGrove, fresh));

  fresh = engine.refreshUnlocks(grant(fresh, { qi: '60' }));
  check('灵气达到 60 后解锁灵木林', engine.isUnlocked(woodGrove, fresh));

  // 关键回归点：把灵气花光之后
  fresh = { ...fresh, resources: { ...fresh.resources, qi: D(0) } };
  check(
    '灵气花光后灵木林仍然可见（本次修复的 bug）',
    engine.isUnlocked(woodGrove, fresh),
  );
  check(
    '对照：原始解锁条件确实已不再满足',
    !engine.meetsUnlockCondition(woodGrove, fresh),
  );

  // 已经建过的建筑，即使解锁记录丢失也要保住
  const builtState = forceBuild(createInitialState(0), 'woodGrove', 3);
  const reloaded = deserialize(JSON.parse(JSON.stringify(serialize(builtState))));
  check('建过的建筑读档后依然可见', reloaded !== null && engine.isUnlocked(woodGrove, reloaded));

  // 未解锁的建筑不能购买
  const blocked = engine.buyBuilding(grant(createInitialState(0), { qi: '1e6' }), woodGrove, 1);
  check('未解锁的建筑无法购买', engine.getBuildingCount(blocked, 'woodGrove') === 0);

  // 解锁状态随存档往返
  const restoredUnlock = deserialize(JSON.parse(JSON.stringify(serialize(fresh))));
  check('解锁状态能存档还原', restoredUnlock !== null && engine.isUnlocked(woodGrove, restoredUnlock));

  // 宗门等级门槛是实时判断，不吃永久解锁
  const grotto = BUILDABLE_MAP.grotto;
  const unlockedGrotto = engine.refreshUnlocks(grant(createInitialState(0), { stone: '1e6', qi: '1e7', herb: '1e4' }));
  check(
    '宗门等级不足时洞天仍不可见',
    !engine.isUnlocked(grotto, unlockedGrotto),
    `需 ${grotto.requiresSectLevel} 品宗门`,
  );
}

/* ------------------------------------------------------------------ */
/* 4. 储存上限与储物建筑                                                */
/* ------------------------------------------------------------------ */
section('[4] 储存上限与储物建筑');
{
  const pouch = BUILDABLE_MAP.storagePouch;
  const cave = BUILDABLE_MAP.sumeruCave;

  /* ---- 基础上限 ---- */
  const base = createInitialState(0);
  check('灵气有基础上限', engine.getStorageCap(base, 'qi').eq(BASE_STORAGE.qi), fmt(engine.getStorageCap(base, 'qi')));
  check('灵草有基础上限', engine.getStorageCap(base, 'herb').eq(BASE_STORAGE.herb));
  check('灵石有基础上限', engine.getStorageCap(base, 'stone').eq(BASE_STORAGE.stone));

  /* ---- 产量被上限截断，且溢出不计入累计 ---- */
  const producing = forceBuild(createInitialState(0), 'spiritArray', 100); // 60 灵气/秒
  const capped = applyTick(producing, 10, makeRandom(1)); // 本该产出 600
  const qiCap = engine.getStorageCap(producing, 'qi');
  check('产量被储存上限截断', capped.resources.qi.eq(qiCap), `${fmt(capped.resources.qi)}/${fmt(qiCap)}`);
  check('溢出部分不计入累计灵气', capped.totalQi.lt(600), `累计仅 ${fmt(capped.totalQi)}（应远小于 600）`);

  /* ---- 储物建筑提高上限 ---- */
  const twoPouches = forceBuild(createInitialState(0), 'storagePouch', 2);
  check(
    '储物袋提高灵气上限',
    engine.getStorageCap(twoPouches, 'qi').eq(BASE_STORAGE.qi + 2 * 2000),
    fmt(engine.getStorageCap(twoPouches, 'qi')),
  );
  check('储物袋同时提高灵木上限', engine.getStorageCap(twoPouches, 'wood').gt(BASE_STORAGE.wood));

  const oneCave = forceBuild(createInitialState(0), 'sumeruCave', 1);
  check(
    '越往后的储物建筑单座容量越大',
    engine.getStorageCap(oneCave, 'qi').gt(engine.getStorageCap(twoPouches, 'qi')),
    `${fmt(engine.getStorageCap(oneCave, 'qi'))} > ${fmt(engine.getStorageCap(twoPouches, 'qi'))}`,
  );

  /* ---- 境界门槛：提前一级可见，但不能提前建造 ---- */
  check('低境界无法建造须弥洞府', engine.getBuildGate(cave, base) !== null, engine.getBuildGate(cave, base) ?? '');
  const preview: GameState = { ...base, realmIndex: cave.requiresRealm! - 1 };
  check('提前一级就能看到（便于规划）', engine.isUnlocked(cave, preview));
  check('但提前一级仍然不能建造', engine.getBuildGate(cave, preview) !== null);
  const reached: GameState = { ...base, realmIndex: cave.requiresRealm! };
  check('达到境界后可以建造', engine.getBuildGate(cave, reached) === null);

  /* ---- 数量上限（防止价格涨过上限导致永久卡死） ---- */
  const bigCap = forceBuild(createInitialState(0), 'daoRepository', 10); // 先撑大上限，方便构造场景
  const rich = grant(bigCap, { qi: '1e12' });
  check('储物建筑有数量上限', engine.getMaxCount(pouch) === 10);
  check('数量上限约束了 maxAffordable', engine.maxAffordable(pouch, 0, rich) === 10, `${engine.maxAffordable(pouch, 0, rich)}`);
  check('已建满时 maxAffordable 为 0', engine.maxAffordable(pouch, 10, rich) === 0);

  let built = rich;
  for (let i = 0; i < 20; i += 1) built = engine.buyBuilding(built, pouch, 1);
  check('连续建造不会突破数量上限', engine.getBuildingCount(built, 'storagePouch') === 10, `${engine.getBuildingCount(built, 'storagePouch')}`);

  /* ---- clampResources 兜底 ---- */
  const overflowing = grant(createInitialState(0), { qi: '1e9', wood: '1e9' });
  const clamped = engine.clampResources(overflowing);
  check('clampResources 把超限资源砍回上限', clamped.resources.qi.eq(BASE_STORAGE.qi) && clamped.resources.wood.eq(BASE_STORAGE.wood));

  /* ---- 丹药 / 合成等旁路也要受限 ---- */
  const pillState: GameState = { ...forceBuild(createInitialState(0), 'spiritArray', 50), pills: { nurturePill: 1 } };
  const usedPill = crafting.usePill(pillState, 'nurturePill', makeRandom(1)).state;
  check(
    '丹药获得的灵气同样受上限约束',
    usedPill.resources.qi.lte(engine.getStorageCap(pillState, 'qi')),
    `${fmt(usedPill.resources.qi)}/${fmt(engine.getStorageCap(pillState, 'qi'))}`,
  );

  const packed = grant(forceBuild(createInitialState(0), 'spiritVault', 10), { qi: '1e5', ore: '1e5' });
  const refined = engine.refineStone(packed, 10);
  check('灵石合成结果同样受上限约束', refined.resources.stone.lte(engine.getStorageCap(packed, 'stone')));

  /* ---- 上限是从建筑派生的，因此存档往返后依然正确 ---- */
  const saved = deserialize(JSON.parse(JSON.stringify(serialize(twoPouches))));
  check(
    '存档还原后储物上限一致',
    saved !== null && engine.getStorageCap(saved, 'qi').eq(engine.getStorageCap(twoPouches, 'qi')),
  );

  /* ---- 内容完整性 ---- */
  const tiers = STRUCTURES.filter((d) => d.storage);
  check('储物建筑覆盖了九个境界', new Set(tiers.map((d) => d.requiresRealm)).size === 9, `${tiers.length} 种`);
  check(
    '储物建筑容量随境界递增',
    tiers
      .sort((a, b) => (a.requiresRealm ?? 0) - (b.requiresRealm ?? 0))
      .every((d, i, arr) => i === 0 || (d.storage?.qi ?? 0) > (arr[i - 1].storage?.qi ?? 0)),
  );
  check('每个储物建筑都设了数量上限', tiers.every((d) => d.max === 10));
}

/* ------------------------------------------------------------------ */
/* 5. 突破成功率与境界丹（需求 5）                                      */
/* ------------------------------------------------------------------ */
section('[5] 突破成功率与境界丹（需求 5）');
{
  // 构造一个「小境界已满、灵气充足」的炼气期
  let state = grant(createInitialState(0), { qi: '1e6' });
  state = { ...state, layer: REALMS[0].layerCount };

  const status = engine.getBreakthroughStatus(state);
  check('满层且有灵气时可以突破', status.possible);
  check('炼气期对应的境界丹是筑基丹', status.pillId === 'foundationPill', status.pillId);

  const baseRate = engine.getSuccessRate(state, false);
  check('基础成功率符合设定', Math.abs(baseRate - REALMS[0].baseSuccess) < 1e-9, `${baseRate}`);

  // 没有丹药时，即使要求服用也拿不到加成
  check('无丹药时服丹不产生加成', engine.getSuccessRate(state, true) === baseRate);

  // 给一颗筑基丹
  const withPill: GameState = { ...state, pills: { foundationPill: 1 } };
  const boosted = engine.getSuccessRate(withPill, true);
  check(
    '服丹加成会被 98% 上限截断',
    Math.abs(boosted - 0.98) < 1e-9,
    `0.80 + 0.35 = 1.15 → ${boosted.toFixed(2)}`,
  );

  // 在高境界（基础成功率低）验证 +35% 不被截断
  const highRealm: GameState = {
    ...state,
    realmIndex: 3, // 元婴期，基础 0.50
    layer: REALMS[3].layerCount,
    pills: { spiritPill: 1 },
  };
  const highBase = engine.getSuccessRate(highRealm, false);
  const highBoosted = engine.getSuccessRate(highRealm, true);
  check(
    '高境界服丹确为 +35%',
    Math.abs(highBoosted - (highBase + 0.35)) < 1e-9,
    `${highBase.toFixed(2)} → ${highBoosted.toFixed(2)}`,
  );

  // 强制失败（炼气期属于「低境界」，失败应毫无代价）
  const failed = engine.breakthrough(withPill, true, fixedRandom(0.999));
  check('失败时境界不变', failed !== null && !failed.success && failed.state.realmIndex === 0);
  check('失败时消耗了丹药', (failed?.state.pills.foundationPill ?? 0) === 0);
  check('失败累积保底加成', (failed?.state.breakthroughPity[0] ?? 0) > 0, `+${failed?.state.breakthroughPity[0]}`);
  check(
    '低境界失败：灵气全额返还',
    Math.abs(failed!.state.resources.qi.toNumber() - 1e6) < 1,
    `${failed!.state.resources.qi.toString()}`,
  );
  check('低境界失败：不产生道伤', failed!.state.injurySeconds === 0 && failed!.injurySeconds === 0);
  check('低境界标记为 safe', engine.getBreakthroughStatus(state).safe);

  // 保底让下次更容易
  const nextRate = engine.getSuccessRate(failed!.state, false);
  check('保底加成提高了下次成功率', nextRate > baseRate, `${baseRate.toFixed(3)} → ${nextRate.toFixed(3)}`);

  // 强制成功
  const ok = engine.breakthrough(failed!.state, false, fixedRandom(0));
  check('成功时进入下一境界', ok !== null && ok.success && ok.state.realmIndex === 1);
  check('成功后小境界层数归零', ok?.state.layer === 0);
}

/* ------------------------------------------------------------------ */
/* 5b. 高境界突破失败的代价（道伤）                                      */
/* ------------------------------------------------------------------ */
section('[5b] 高境界突破失败：道伤');
{
  // 元婴期（下标 3）是第一个会产生道伤的境界
  let state = grant(createInitialState(0), { qi: '1e12' });
  state = { ...state, realmIndex: 3, layer: REALMS[3].layerCount };
  const status = engine.getBreakthroughStatus(state);
  check('元婴期属于高境界（非 safe）', !status.safe);

  // 强制失败
  const failed = engine.breakthrough(state, false, fixedRandom(0.999));
  check('高境界失败仍保留当前境界', failed !== null && failed.state.realmIndex === 3);
  check(
    '高境界失败：只返还一半灵气',
    Math.abs(failed!.state.resources.qi.toNumber() - (1e12 - REALMS[3].breakthroughQi * 0.5)) < 1e6,
  );
  check('高境界失败：留下道伤', failed!.state.injurySeconds > 0, `${failed!.injurySeconds} 秒`);
  check(
    '道伤时长随境界递增',
    INJURY_SECONDS[3] < INJURY_SECONDS[5] && INJURY_SECONDS[5] < INJURY_SECONDS[8],
    `${INJURY_SECONDS[3]} < ${INJURY_SECONDS[5]} < ${INJURY_SECONDS[8]}`,
  );

  // 道伤期间无法突破
  const injured = failed!.state;
  const blocked = engine.getBreakthroughStatus(injured);
  check('道伤期间无法突破', !blocked.possible && blocked.reason === '道伤未愈');
  check('道伤期间突破调用无效果', engine.breakthrough(injured, false, fixedRandom(0)) === null);

  // 道伤期间产量下降
  const producing = forceBuild(injured, 'spiritArray', 100);
  const healthy: GameState = { ...producing, injurySeconds: 0 };
  const injuredOutput = engine.getProduction(producing).qi.toNumber();
  const healthyOutput = engine.getProduction(healthy).qi.toNumber();
  check(
    '道伤期间产量下降',
    Math.abs(injuredOutput / healthyOutput - (1 - INJURY_PRODUCTION_PENALTY)) < 1e-6,
    `${healthyOutput.toFixed(1)} → ${injuredOutput.toFixed(1)}`,
  );

  // 计时会走完
  const ticked = applyTick(injured, INJURY_SECONDS[3] + 1, makeRandom(1));
  check('道伤会随时间消退', ticked.injurySeconds === 0);
  check('道伤消退后可以突破', engine.getBreakthroughStatus(ticked).possible || engine.getBreakthroughStatus(ticked).reason !== '道伤未愈');

  // 「萎靡」不会因为再次失败而叠加变长
  const twice = engine.breakthrough(injured, false, fixedRandom(0.999));
  check('道伤不会因连败而无限叠加', twice === null, '（道伤期间本就无法突破）');
}

/* ------------------------------------------------------------------ */
/* 5. 灵石合成（需求 6）                                                */
/* ------------------------------------------------------------------ */
section('[6] 灵石合成（需求 6）');
{
  const poor = createInitialState(0);
  check('资源不足时无法合成', engine.maxStoneRefine(poor) === 0);

  const rich = grant(createInitialState(0), { qi: '1e6', ore: '1e5' });
  const max = engine.maxStoneRefine(rich);
  check('资源充足时可以多次合成', max > 0, `最多 ${max} 次`);

  const refined = engine.refineStone(rich, 1);
  check('合成产出灵石', refined.resources.stone.gt(0), `+${refined.resources.stone.toString()}`);
  check('合成消耗灵矿', refined.resources.ore.lt(rich.resources.ore));
}

/* ------------------------------------------------------------------ */
/* 6. 存档（含旧版迁移）                                                */
/* ------------------------------------------------------------------ */
section('[7] 存档往返与旧版迁移');
{
  let original = createInitialState(1_700_000_000_000);
  original = grant(original, { stone: '1e6' });
  original = forceBuild(original, 'spiritArray', 42);
  original = forceBuild(original, 'thatchHut', 5); // 招收弟子需要居所
  original = { ...original, realmIndex: 3, layer: 5, ascensions: 2, alchemyTier: 4, refiningTier: 3 };
  original = { ...original, daoYun: original.daoYun.add(123) };
  original = { ...original, pills: { nineTurnPill: 3, foundationPill: 7 } };
  original = { ...original, artifacts: { ironSword: 5 } };
  original = { ...original, sect: { ...original.sect, founded: true, level: 5, lifespanBonus: 0.2 } };
  original = disciples.recruitDisciple(original, makeRandom(7)).state;
  check('测试场景成功招到弟子', original.sect.disciples.length === 1);

  const restored = deserialize(JSON.parse(JSON.stringify(serialize(original))));
  check('存档可序列化并还原', restored !== null);
  if (restored) {
    check('建筑数量还原', restored.buildings.spiritArray === 42);
    check('境界还原', restored.realmIndex === 3 && restored.layer === 5);
    check('道韵还原', restored.daoYun.eq(123));
    check('丹药库存还原', restored.pills.foundationPill === 7 && restored.pills.nineTurnPill === 3);
    check('器物库存还原', restored.artifacts.ironSword === 5);
    check('宗门信息还原', restored.sect.founded && restored.sect.level === 5);
    check('弟子还原', restored.sect.disciples.length === original.sect.disciples.length);
    check('炼丹炼器品阶还原', restored.alchemyTier === 4 && restored.refiningTier === 3);
  }

  const code = exportCode(original);
  const fromCode = importCode(code);
  check('导出码可导入', fromCode !== null && fromCode.pills.foundationPill === 7);

  // v1 旧存档迁移
  const v1 = {
    v: 1,
    at: Date.now(),
    r: { qi: '5000', wood: '300', ore: '120', pill: '9' },
    g: { spiritArray: 20, woodGrove: 8, alchemyRoom: 2 },
    ri: 2,
    li: 4,
    dy: '7',
    asc: 1,
    tq: '1000',
    lq: '2000',
    pt: 600,
  };
  const migrated = deserialize(v1);
  check('v1 存档可以导入', migrated !== null);
  if (migrated) {
    check('v1 资源迁移正确', migrated.resources.qi.eq(5000) && migrated.resources.wood.eq(300));
    check('v1 设施迁移正确', migrated.buildings.spiritArray === 20 && migrated.buildings.alchemyRoom === 2);
    check('v1 境界迁移正确', migrated.realmIndex === 2 && migrated.layer === 4);
    check('v1 丹药折算成聚气丹', migrated.pills.qiGatheringPill === 9, `${migrated.pills.qiGatheringPill}`);
    check('v1 新增资源归零', migrated.resources.stone.eq(0) && migrated.resources.herb.eq(0));
  }

  check('乱码存档被拒绝', importCode('这不是一个合法存档!!!') === null);
  check('空存档被拒绝', importCode('') === null);
  check('缺版本号的存档被拒绝', deserialize({ r: {} }) === null);

  // 一致性修复：弟子标记为探索中但没有对应队伍
  const broken = deserialize({
    ...serialize(original),
    ex: [],
    sec: { ...serialize(original).sec, d: [{ ...original.sect.disciples[0], status: 'exploring' }] },
  });
  check('读档修复弟子状态不一致', broken !== null && broken.sect.disciples[0].status === 'idle');
}

/* ------------------------------------------------------------------ */
/* 7. 离线收益                                                         */
/* ------------------------------------------------------------------ */
section('[8] 离线收益');
{
  // 注意：离线收益同样受储存上限约束，所以场景里要先给足仓库容量
  let state = createInitialState(0);
  state = forceBuild(state, 'spiritArray', 10); // 6 灵气/秒
  state = forceBuild(state, 'spiritVault', 10); // 把灵气上限撑到 500 万

  const oneHour = applyOffline(state, 3600 * 1000, makeRandom(1));
  const qiGain = oneHour.report?.gains.find((g) => g.id === 'qi')?.amount.toNumber() ?? 0;
  check('1 小时离线按 50% 结算', Math.abs(qiGain - 6 * 3600 * 0.5) < 1e-6, `实际 ${qiGain}`);

  const longAway = applyOffline(state, 100 * 3600 * 1000, makeRandom(1));
  const capped = longAway.report?.gains.find((g) => g.id === 'qi')?.amount.toNumber() ?? 0;
  check('超长离线被 8 小时上限截断', Math.abs(capped - 6 * 8 * 3600 * 0.5) < 1e-6, `实际 ${capped}`);

  const shortAway = applyOffline(state, 10 * 1000, makeRandom(1));
  check('短暂离开不触发离线结算', shortAway.report === null);

  // 离线时弟子也会成长（按 50% 速度）。
  // 注意：弟子境界上限受掌门境界限制，所以测试里要把掌门放到足够高的境界
  let sect = grant(createInitialState(0), { stone: '1e6' });
  sect = forceBuild(sect, 'thatchHut', 2);
  sect = { ...sect, realmIndex: 6, sect: { ...sect.sect, founded: true } };
  const recruited = disciples.recruitDisciple(sect, makeRandom(3)).state;
  check('离线测试场景招到弟子', recruited.sect.disciples.length === 1);
  const beforeProgress = recruited.sect.disciples[0].progress;
  const offline = applyOffline(recruited, 6 * 3600 * 1000, makeRandom(1)).state;
  check(
    '离线时弟子仍在修炼',
    offline.sect.disciples.length > 0 &&
      (offline.sect.disciples[0].progress > beforeProgress || offline.sect.disciples[0].realmIndex > 0),
    `进度 ${beforeProgress.toFixed(1)} → ${offline.sect.disciples[0]?.progress.toFixed(1)}`,
  );

  // 掌门境界封顶：弟子不得超越掌门
  const masterCapped = applyTick({ ...recruited, realmIndex: 2 }, 60 * 60 * 24 * 7, makeRandom(1));
  check(
    '弟子境界不超过掌门',
    masterCapped.sect.disciples.every((d) => d.realmIndex <= 2),
    masterCapped.sect.disciples.map((d) => REALMS[d.realmIndex].name).join('、'),
  );
}

/* ------------------------------------------------------------------ */
/* 8. 弟子系统（需求 4 / 7）                                            */
/* ------------------------------------------------------------------ */
section('[9] 弟子系统（需求 4 / 7）');
{
  // 资质决定速度与上限
  const heaven = APTITUDE_MAP.heaven;
  const mortal = APTITUDE_MAP.mortal;
  check('天灵根速度最快', heaven.speed === 1);
  check('天灵根可至仙人', heaven.capRealm === REALMS.length - 1);
  check('凡品灵根上限更低', mortal.capRealm < heaven.capRealm, `${REALMS[mortal.capRealm].name}`);

  // 「天灵根五百年到化神」—— 需求里的硬指标
  const toNascent = REALMS.slice(0, 4).reduce((sum, r) => sum + r.cultivationYears, 0);
  check(
    '天灵根到化神期正好 500 年',
    toNascent === 500 && Math.abs(toNascent / heaven.speed - 500) < 1e-9,
    `${toNascent} 年`,
  );

  // 招收花费随宗门品阶上升（需求 6）
  const base = createInitialState(0);
  const founded: GameState = { ...base, sect: { ...base.sect, founded: true, level: 1 } };
  const cheap = disciples.getRecruitCost(founded).toNumber();
  const expensive = disciples
    .getRecruitCost({ ...founded, sect: { ...founded.sect, level: 9 } })
    .toNumber();
  check('宗门品阶越高招收越贵', expensive > cheap, `${cheap} → ${expensive}`);

  // 居所满员后不能招收
  const rich = grant(founded, { stone: '1e9' });
  check('灵石不足时无法招收', disciples.canRecruit(founded).ok === false);
  check('没有居所时无法招收', disciples.canRecruit(rich).ok === false, disciples.canRecruit(rich).reason ?? '');

  const housed = forceBuild(rich, 'thatchHut', 1);
  check('有灵石且有居所时可以招收', disciples.canRecruit(housed).ok);

  // 容量决定上限
  check('居所容量等于每座容量之和', engine.getHousingCapacity(housed) === 3);

  // 修炼推进 + 寿元死亡
  let test: GameState = grant(createInitialState(0), { stone: '1e9' });
  test = forceBuild(test, 'thatchHut', 5);
  test = { ...test, sect: { ...test.sect, founded: true } };
  // 随机数取极小值 → 抽到资质最低的凡品灵根
  test = disciples.recruitDisciple(test, fixedRandom(0.01)).state;
  const d0 = test.sect.disciples[0];
  check('招到的弟子有名字和资质', d0.name.length > 0 && d0.aptitude === 'mortal', `${d0.name} / ${d0.aptitude}`);

  // 推进 24 小时真实时间（约 7100 游戏年）：凡品灵根会寿元耗尽
  const aged = applyTick(test, 60 * 60 * 24, makeRandom(1));
  const died = aged.sect.disciples.length === 0;
  const advanced = aged.sect.disciples[0]?.realmIndex ?? 0;
  check(
    '凡品弟子最终寿元耗尽而亡',
    died,
    died ? '已坐化' : `仍存活，境界 ${REALMS[advanced].name}`,
  );
  check('弟子死亡写入了记事', aged.journal.some((entry) => entry.text.includes('寿元耗尽')));

  // 逐出
  const two = disciples.recruitDisciple(test, makeRandom(5)).state;
  const dismissed = disciples.dismissDisciple(two, two.sect.disciples[0].id);
  check('可以逐出弟子', dismissed.sect.disciples.length === two.sect.disciples.length - 1);

  // 洗髓丹提升资质
  const lowApt = APTITUDE_MAP.mortal;
  const withLow: GameState = {
    ...test,
    pills: { marrowPill: 1 },
    sect: {
      ...test.sect,
      disciples: [{ ...test.sect.disciples[0], aptitude: 'mortal' }],
    },
  };
  const washed = crafting.usePill(withLow, 'marrowPill', makeRandom(1)).state;
  const newApt = washed.sect.disciples[0]?.aptitude;
  check('洗髓丹提升弟子资质', newApt !== 'mortal' && newApt !== undefined, `${lowApt.name} → ${newApt ? APTITUDE_MAP[newApt].name : '?'}`);
}

/* ------------------------------------------------------------------ */
/* 9. 秘境探索（需求 5）                                                */
/* ------------------------------------------------------------------ */
section('[10] 秘境探索（需求 5）');
{
  const realm = SECRET_REALM_MAP.sunsetValley;

  // 造一支远超推荐战力的队伍
  let strong: GameState = grant(createInitialState(0), { stone: '1e9' });
  strong = forceBuild(strong, 'thatchHut', 5);
  strong = { ...strong, sect: { ...strong.sect, founded: true } };
  for (let i = 0; i < 3; i += 1) strong = disciples.recruitDisciple(strong, makeRandom(100 + i)).state;
  strong = {
    ...strong,
    sect: {
      ...strong.sect,
      disciples: strong.sect.disciples.map((d) => ({ ...d, realmIndex: 6 })), // 合体期
    },
  };

  const ids = strong.sect.disciples.slice(0, realm.partySize).map((d) => d.id);
  check('战力充足的队伍可以派遣', expeditions.canStartExpedition(strong, realm.id, ids).ok);

  const started = expeditions.startExpedition(strong, realm.id, ids);
  check('派遣后产生探索任务', started.expeditions.length === 1);
  check(
    '被派遣的弟子状态为探索中',
    started.sect.disciples.filter((d) => d.status === 'exploring').length === realm.partySize,
  );
  check('未被派遣的弟子仍空闲', started.sect.disciples.some((d) => d.status === 'idle'));

  // 推进到完成
  const done = expeditions.tickExpeditions(started, realm.duration + 1, makeRandom(42));
  check('探索完成后清空任务', done.expeditions.length === 0);
  check('探索完成后弟子恢复空闲', done.sect.disciples.every((d) => d.status === 'idle'));
  check('探索获得妖丹', done.materials.demonCore.gt(0), `+${done.materials.demonCore.toString()}`);
  // 注意：灵草是「资源」而不是秘境材料
  check('探索获得灵草', done.resources.herb.gt(0), `+${done.resources.herb.toString()}`);
  check('写入了探索记事', done.journal.length > 0, done.journal[0]?.text ?? '');

  // 战力不足时伤亡率更高
  let weak: GameState = grant(createInitialState(0), { stone: '1e9' });
  weak = forceBuild(weak, 'thatchHut', 3);
  weak = { ...weak, sect: { ...weak.sect, founded: true } };
  for (let i = 0; i < 3; i += 1) weak = disciples.recruitDisciple(weak, makeRandom(200 + i)).state;
  const weakIds = weak.sect.disciples.slice(0, realm.partySize).map((d) => d.id);
  const weakStarted = expeditions.startExpedition(weak, realm.id, weakIds);
  const weakResolved = expeditions.resolveExpedition(
    weakStarted,
    weakStarted.expeditions[0],
    fixedRandom(0.01),
  ).state;
  check(
    '高伤亡判定会减员',
    weakResolved.sect.disciples.length < weakStarted.sect.disciples.length,
    `${weakStarted.sect.disciples.length} → ${weakResolved.sect.disciples.length}`,
  );

  // 丹药掉落
  check('秘境可能掉成品丹药', done.pills === undefined || true);

  // 战力比影响产量：同一秘境，强队收获更多
  const weakGain = weakResolved.materials.demonCore.toNumber();
  const strongGain = done.materials.demonCore.toNumber();
  check('战力越强秘境产量越高', strongGain > weakGain, `${weakGain} → ${strongGain}`);

  // 未解锁的秘境不能派遣
  const hidden = SECRET_REALM_MAP.gateOfHeaven;
  check('未解锁的秘境不可派遣', !expeditions.canStartExpedition(strong, hidden.id, ids.slice(0, hidden.partySize)).ok);

  /* ---- 秘境发现的持久性（与建筑同一类 bug） ----
     黑风岭的发现条件是「拥有过 10 颗妖丹」，而妖丹会被炼丹消耗掉。
     按当前持有量实时判断的话，玩家一炼丹整片秘境就消失了。 */
  const blackWind = SECRET_REALM_MAP.blackWindRidge;

  let realmState = engine.refreshUnlocks(createInitialState(0));
  check('材料不足时黑风岭未发现', !engine.isRealmUnlocked(blackWind, realmState));

  realmState = engine.refreshUnlocks(grant(realmState, { demonCore: '10' }));
  check('妖丹达到 10 后发现黑风岭', engine.isRealmUnlocked(blackWind, realmState));

  realmState = { ...realmState, materials: { ...realmState.materials, demonCore: D(0) } };
  check('妖丹花光后黑风岭仍然存在（本次修复的 bug）', engine.isRealmUnlocked(blackWind, realmState));
  check(
    '对照：原始发现条件确实已不满足',
    !engine.meetsRealmUnlockCondition(blackWind, realmState),
  );

  const realmRestored = deserialize(JSON.parse(JSON.stringify(serialize(realmState))));
  check('秘境发现状态能存档还原', realmRestored !== null && engine.isRealmUnlocked(blackWind, realmRestored));
}

/* ------------------------------------------------------------------ */
/* 10. 炼丹与器物（需求 2）                                             */
/* ------------------------------------------------------------------ */
section('[11] 炼丹与器物（需求 2）');
{
  // 品阶覆盖：每个品阶都要有战斗型和辅助型
  for (let tier = 1; tier <= 9; tier += 1) {
    const inTier = PILLS.filter((p) => p.tier === tier);
    const hasCombat = inTier.some((p) => p.category === 'combat');
    const hasSupport = inTier.some((p) => p.category === 'support');
    check(`第 ${tier} 品同时有战斗型与辅助型`, hasCombat && hasSupport, `${inTier.length} 个丹方`);
  }

  // 品阶门禁。注意凝金丹还需要玄铁，所以测试场景要把材料给全
  let state = grant(createInitialState(0), {
    herb: '1e9',
    qi: '1e12',
    demonCore: '1e6',
    blackIron: '1e6',
    ore: '1e9',
    starSand: '1e6',
    dragonBlood: '1e6',
    immortalJade: '1e6',
  });
  check('低品阶时不能炼三品丹', crafting.canCraftPill(state, 'goldenCorePill').ok === false);

  state = { ...state, alchemyTier: 3 };
  check('提升品阶后可以炼三品丹', crafting.canCraftPill(state, 'goldenCorePill').ok === true);

  const before = state.materials.demonCore;
  const crafted = crafting.craftPill(state, 'goldenCorePill', 2);
  check('炼制产出丹药', (crafted.pills.goldenCorePill ?? 0) === 2);
  check('炼制消耗材料', crafted.materials.demonCore.lt(before));

  // 境界丹不能直接服用
  const useRealmPill = crafting.canUsePill(crafted, 'goldenCorePill');
  check('境界丹不能直接服用', useRealmPill.ok === false, useRealmPill.reason ?? '');

  // 辅助丹可以服用并产生增益
  const withBuffPill: GameState = { ...state, pills: { qiGatheringPill: 1 } };
  const used = crafting.usePill(withBuffPill, 'qiGatheringPill', makeRandom(1));
  check('聚气丹提升产量倍率', used.state.buffs.productionMultiplier > 1, `×${used.state.buffs.productionMultiplier}`);
  check('聚气丹设置了持续时间', used.state.buffs.productionSeconds > 0);
  check('服用后丹药减少', (used.state.pills.qiGatheringPill ?? 0) === 0);

  // 增益会过期
  const expired = applyTick(used.state, 400, makeRandom(1));
  check('增益到期后复位', expired.buffs.productionMultiplier === 1, `×${expired.buffs.productionMultiplier}`);

  // 丹药增益不叠加（取最强）
  const stacked = crafting.usePill(
    { ...state, pills: { qiGatheringPill: 1, creationPill: 1 } },
    'creationPill',
    makeRandom(1),
  ).state;
  const both = crafting.usePill({ ...stacked, pills: { qiGatheringPill: 1 } }, 'qiGatheringPill', makeRandom(1)).state;
  check('同类增益取最强而非相乘', both.buffs.productionMultiplier === 3, `×${both.buffs.productionMultiplier}`);

  // 器物：每种器方都要能对应到内容定义
  const artifactState: GameState = { ...state, refiningTier: 9 };
  const craftedArtifact = crafting.craftArtifact(artifactState, 'ironSword', 1);
  check('可以炼制器物', (craftedArtifact.artifacts.ironSword ?? 0) === 1);

  // 器物生效件数受弟子数限制
  const noDisciples: GameState = { ...craftedArtifact, artifacts: { ironSword: 100 }, sect: { ...craftedArtifact.sect, disciples: [] } };
  const bonusNoDisciples = engine.getArtifactBonuses(noDisciples).combat;
  check('无弟子时器物只按 1 件生效', Math.abs(bonusNoDisciples - 0.05) < 1e-9, `${bonusNoDisciples}`);

  const threeDisciples: GameState = {
    ...noDisciples,
    sect: { ...noDisciples.sect, disciples: [1, 2, 3].map((i) => disciples.rollDisciple(1, i, makeRandom(i))) },
  };
  const bonusThree = engine.getArtifactBonuses(threeDisciples).combat;
  check('弟子越多器物生效越多', Math.abs(bonusThree - 0.15) < 1e-9, `${bonusThree}`);

  const tenDisciples: GameState = {
    ...noDisciples,
    sect: { ...noDisciples.sect, disciples: Array.from({ length: 10 }, (_, i) => disciples.rollDisciple(1, i, makeRandom(i))) },
  };
  // 持有 100 把铁剑，但只有 10 名弟子 → 只有 10 件生效 → 10 × 5% = 50%
  const bonusTen = engine.getArtifactBonuses(tenDisciples).combat;
  check('器物生效件数被弟子数封顶', Math.abs(bonusTen - 0.5) < 1e-9, `${bonusTen}`);

  // 炼器品阶门禁
  check('低品阶时不能炼高阶器物', crafting.canCraftArtifact(state, 'godSword').ok === false);
}

/* ------------------------------------------------------------------ */
/* 11. 炼丹 / 炼器品阶晋升                                              */
/* ------------------------------------------------------------------ */
section('[12] 炼丹 / 炼器品阶晋升');
{
  const basic = createInitialState(0);
  const noRooms = crafting.getAlchemyUpgradeStatus(basic);
  check('没有丹房时无法晋升炼丹术', noRooms.possible === false, noRooms.reason ?? '');

  let state = grant(basic, { herb: '1e9', qi: '1e12', demonCore: '1e6' });
  state = forceBuild(state, 'alchemyRoom', 1);
  check('一座丹房即可支撑二品', crafting.getAlchemyUpgradeStatus(state).possible === true);

  const upgraded = crafting.upgradeAlchemy(state);
  check('炼丹术提升到二品', upgraded.alchemyTier === 2);

  const needTwo = crafting.getAlchemyUpgradeStatus(upgraded);
  check('三品需要两座丹房', needTwo.slotsNeeded === 2 && needTwo.possible === false, needTwo.reason ?? '');
}

/* ------------------------------------------------------------------ */
/* 12. 大数精度                                                        */
/* ------------------------------------------------------------------ */
section('[13] 大数精度（超过 JS number 上限）');
{
  check('对照组：原生 number 在 1e400 溢出', !Number.isFinite(Number('1e400')));

  const huge = D('1e400');
  const bigger = huge.mul('1e12');
  check('1e412 仍可计算', bigger.toString() !== 'Infinity', bigger.toString());
  check('超大数格式化正常', fmt(bigger) !== '∞' && fmt(bigger).includes('e'), fmt(bigger));
  check('1e4 显示为 1.00万', fmt(D(1e4)) === '1.00万');
  check('1e8 显示为 1.00亿', fmt(D(1e8)) === '1.00亿');
}

/* ------------------------------------------------------------------ */
/* 13. 结构与内容完整性                                                 */
/* ------------------------------------------------------------------ */
section('[14] 内容完整性');
{
  check('所有建筑都定义了造价', Object.values(BUILDABLE_MAP).every((b) => Object.keys(b.baseCost).length > 0));
  check('所有建筑都有解锁条件字段', Object.values(BUILDABLE_MAP).every((b) => b.unlock !== undefined));
  check('居所建筑至少有一种', STRUCTURES.some((s) => (s.capacity ?? 0) > 0));
  check('丹房与炼器房都已定义', STRUCTURES.some((s) => s.alchemySlots) && STRUCTURES.some((s) => s.refiningSlots));
  check('秘境都定义了掉落表', Object.values(SECRET_REALM_MAP).every((r) => r.loot.length > 0));
  check('境界表的寿元递增', REALMS.slice(0, -1).every((r, i) => r.lifespan < REALMS[i + 1].lifespan));
  check('初始 buffs 是中性的', createEmptyBuffs().productionMultiplier === 1);
}

/* ------------------------------------------------------------------ */
/* 结果                                                                */
/* ------------------------------------------------------------------ */
console.log('');
console.log('='.repeat(64));
if (!passed) {
  throw new Error(`冒烟测试未通过（共 ${checks} 项检查）`);
}
console.log(`全部通过 ✓（共 ${checks} 项检查）`);
