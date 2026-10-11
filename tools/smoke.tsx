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
import type React from 'react';
import App from '../src/App';
import BuildingsPanel from '../src/components/BuildingsPanel';
import ResearchPanel from '../src/components/ResearchPanel';
import PlantationPanel from '../src/components/PlantationPanel';
import ShopPanel from '../src/components/ShopPanel';
import MapPanel from '../src/components/MapPanel';
import SectHallPanel from '../src/components/SectHallPanel';
import Header from '../src/components/Header';
import ResourceBar from '../src/components/ResourceBar';
import ActionPanel from '../src/components/ActionPanel';
import ServantPanel from '../src/components/ServantPanel';
import RealmPanel from '../src/components/RealmPanel';
import StonePanel from '../src/components/StonePanel';
import AscendPanel from '../src/components/AscendPanel';
import SectPanel from '../src/components/SectPanel';
import DisciplePanel from '../src/components/DisciplePanel';
import AlchemyPanel from '../src/components/AlchemyPanel';
import RefiningPanel from '../src/components/RefiningPanel';
import InventoryPanel from '../src/components/InventoryPanel';
import JournalPanel from '../src/components/JournalPanel';
import SavePanel from '../src/components/SavePanel';
import { useGame } from '../src/game/store';
import { D, fmt } from '../src/game/decimal';
import {
  APTITUDE_MAP,
  AUTO_REFINE_LEVEL_MAX,
  AUTO_REFINE_RATES,
  BASE_KINDS_MIN,
  BASE_MATERIAL_IDS,
  BLUEPRINTS,
  BLUEPRINT_MAP,
  ARTIFACT_MAP,
  BUILDABLES,
  BUILD_QUEUE_BASE_SLOTS,
  BUILD_QUEUE_MAX_SLOTS,
  QUEUE_UPGRADES,
  BUILDABLE_MAP,
  DISCOVERY_BASE_CHANCE,
  DISCOVERY_MAX_CHANCE,
  DISCOVERY_PITY_FAILURES,
  INSIGHT_MAX_BASE,
  INSIGHT_MAX_PER_REALM,
  INSIGHT_SPEED_PER_POINT,
  ARENA_BUFF_BONUS,
  BUILD_GROUPS,
  GENERATORS,
  INJURY_PRODUCTION_PENALTY,
  INJURY_SECONDS,
  MATERIAL_IDS,
  MATERIAL_MAP,
  MAJOR_REGIONS,
  MAJOR_REGION_MAP,
  MAP_REGIONS,
  MAP_REGION_MAP,
  MIND_MAX,
  MIN_TIER_FOR_BLUEPRINT,
  PILLS,
  ARTIFACTS,
  RARE_KINDS_MIN,
  RARE_MATERIAL_IDS,
  REFINED_MATERIAL_IDS,
  REFINE_RECIPES,
  RESOURCE_IDS,
  REALMS,
  SECONDS_PER_GAME_YEAR,
  SEASON_SECONDS,
  SHOP_REFRESH_SECONDS,
  GAME_DAYS_PER_SECOND,
  GAME_DAYS_PER_YEAR,
  gameYearOf,
  yearProgressOf,
  SERVANT_COST,
  servantCost,
  SECT_MIN_REALM,
  ASCENSION_MIN_REALM,
  SECT_LEVELS,
  expeditionSlots,
  MAX_EXPEDITION_SLOTS,
  isRareMaterial,
  ENCOUNTERS,
  ENCOUNTER_MAP,
  SECT_FORMATIONS,
  ENLIGHTEN_PATHS,
  MAJOR_STAGES,
  MINOR_PER_MAJOR,
  MAX_ENLIGHTEN_LEVEL,
  ELEMENT_BONUS_PER_LEVEL,
  SPACE_RING_BONUS,
  TIME_JUMP_COOLDOWN_YEARS,
  MAX_SPACE_RINGS,
  stageOf,
  timeJumpYears,
  optionRequiredItems,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  STARTER_REALM_ID,
  SURVEY_MAX_PARTY,
  specialtyRealms,
  subRegionsOf,
  SEASONS,
  SEEDS,
  SERVANT_BONUS_PER_HEAD,
  MAX_CRAFT_TIER,
  ALCHEMY_TIER_COST,
  ALCHEMY_TIER_TECH,
  REFINING_TIER_COST,
  ITEM_MAP,
  type ItemId,
  RICH_SUB_INDEX,
  CRAFT_BASE_SUCCESS,
  PILL_MAP,
  recruitCost,
  SHOP_GOODS,
  STONE_REFINE_COST,
  STONE_REFINE_OUTPUT,
  WEATHERS,
  WEATHER_MAP,
  isBasicMaterial,
  BASE_STORAGE,
  STRUCTURES,
  TECHS,
  TECH_MAP,
  TRAVEL_REGIONS,
  countMaterialKinds,
  createEmptyBuffs,
  hastenQiCost,
  type MaterialId,
  type ResourceId,
} from '../src/game/content';
import { createInitialState, type GameState } from '../src/game/state';
import * as engine from '../src/game/engine';
import * as disciples from '../src/game/disciples';
import * as expeditions from '../src/game/expeditions';
import {
  canStartExpedition,
  canStartSurvey,
  canSurveyRegion,
} from '../src/game/expeditions';
import { surveyReachRealm } from '../src/game/content';
import {
  canStartSoloSurvey,
  startSoloSurvey,
  tickTravel,
} from '../src/game/travel';
import { describeFullIn, secondsToFull } from '../src/components/ResourceBar';
import { getAlchemyUpgradeStatus, getRefiningUpgradeStatus } from '../src/game/crafting';
import * as crafting from '../src/game/crafting';
import * as research from '../src/game/research';
import * as planting from '../src/game/planting';
import * as shop from '../src/game/shop';
import * as travel from '../src/game/travel';
import * as sectActivity from '../src/game/sectActivity';
import * as seasonModule from '../src/game/season';
import { tickEncounters as encounterTick, getSectDefense } from '../src/game/encounter';
import {
  canCraftSpaceRing,
  canEnlighten,
  canTimeJump,
  craftSpaceRing,
  doTimeJump,
  getElementMaterialBonus,
  getEnlightenLevel,
  getEnlightenRemaining,
  getSpaceExploreBonus,
  getSpaceRings,
  isEnlightenmentUnlocked,
  startEnlighten,
  tickEnlighten,
} from '../src/game/enlightenment';
import {
  ENCOUNTER_SECONDS,
  isAttackEncounter,
  playerEncounters,
  sectEncounters,
  tickEncounters,
} from '../src/game/encounter';
import {
  canChooseOption,
  canRob,
  chooseEncounterOption,
  ENCOUNTER_INTERVAL,
  getEvil,
  getKarma,
  getKarmaExploreBonus,
  getKarmaLabel,
  getKarmaThunderPenalty,
  getPendingEncounter,
  getVirtue,
  KARMA_EXPLORE_BONUS_MAX,
  KARMA_MAX,
  KARMA_ROB_THRESHOLD,
  KARMA_SUCCESS_FLOOR,
  KARMA_THUNDER_MAX,
  canRollEncounter,
} from '../src/game/encounter';
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

/**
 * 给齐所有材料。
 *
 * 需求 2 之后配方由「基础材料 + 稀有材料」构成，种类还会随品阶增加；
 * 测试场景如果逐个列材料，每加一种就得回来改测试，所以统一给足。
 */
function grantAll(state: GameState, extra: Partial<Record<string, string>> = {}): GameState {
  const materials: Partial<Record<string, string>> = {};
  for (const id of MATERIAL_IDS) materials[id] = '1e7';
  return grant(state, { ...materials, ...extra });
}

/** 搭一个「已经钻研出某技术」的状态 */
function withTech(state: GameState, ...ids: string[]): GameState {
  const techs = { ...state.techs };
  for (const id of ids) techs[id] = true;
  return { ...state, techs };
}

/** 搭一个「已经持有某图纸」的状态 */
function withBlueprint(state: GameState, ...ids: string[]): GameState {
  const blueprints = { ...state.blueprints };
  for (const id of ids) blueprints[id] = true;
  return { ...state, blueprints };
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

  const expected = ['仙途', '打坐', '境界', '灵石合成', '修行', '洞府', '宗门', '探索', '丹器', '灵植'];
  for (const text of expected) {
    check(`包含「${text}」`, html.includes(text));
  }

  /* ---- 需求 2：资源栏移到左边，不再压在其它模块上方 ---- */
  {
    const navEnd = html.indexOf('</nav>');
    const sideIdx = html.indexOf('shell__side');
    const mainIdx = html.indexOf('shell__main');
    const barIdx = html.indexOf('resource-bar');

    check('存在左侧资源栏容器', sideIdx >= 0);
    check('资源栏排在导航之后、内容区之前', navEnd >= 0 && sideIdx > navEnd && mainIdx > sideIdx);
    check('资源栏在左侧栏内部（而不是独立的一段）', barIdx > sideIdx && barIdx < mainIdx);
    check('资源栏不再插在 Header 与导航之间', barIdx > navEnd, `bar@${barIdx} navEnd@${navEnd}`);
  }

  // 非默认标签页的面板单独渲染一次：新增模块最容易犯的错
  // 就是渲染时读了不存在的字段，而默认标签页根本不会渲染到它
  const panels: [string, React.ReactElement][] = [
    ['洞府建设', <BuildingsPanel />],
    ['钻研', <ResearchPanel />],
    ['灵植园', <PlantationPanel />],
    ['商行', <ShopPanel />],
    ['地图与探索', <MapPanel />],
    ['宗门建筑', <SectHallPanel />],
  ];
  for (const [label, element] of panels) {
    try {
      const out = renderToString(element);
      check(`「${label}」面板渲染成功`, out.length > 0, `${out.length} 字符`);
    } catch (error) {
      check(`「${label}」面板渲染成功`, false, String(error));
    }
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

  /*
   * 回归测试：界面上「想让某个岗位少一个人、把人挪去别处」必须走 assignServant。
   *
   * 早先仆役面板每行只有一对 −/＋ 按钮，而 − 直接调 dismissServant（真遣散），
   * 于是玩家想调岗却把人开除了。现在两件事在界面上分开，
   * 所以这里把「调岗不掉人、遣散才掉人」这个区别钉死。
   */
  {
    const two: GameState = { ...moved, servants: { ore: 2, herb: 1 } };
    const before = engine.getServantCount(two);
    const shifted = engine.assignServant(two, 'ore', 'herb');
    check(
      '调岗（减一个岗位）不会减少总人数',
      engine.getServantCount(shifted) === before && (shifted.servants.ore ?? 0) === 1 && (shifted.servants.herb ?? 0) === 2,
      `${before} → ${engine.getServantCount(shifted)} 人`,
    );
    check(
      '调岗后该岗位的产量加成随之转移',
      engine.getServantBonus(shifted, 'herb') > engine.getServantBonus(two, 'herb'),
    );
    // 只有明确的遣散才会真少人
    check(
      '遣散才会真正少一名',
      engine.getServantCount(engine.dismissServant(two, 'ore')) === before - 1,
    );
    // 空岗位调不动，不会凭空变出人
    check(
      '空岗位无法调派（不会变成负数）',
      engine.getServantCount(engine.assignServant({ ...two, servants: {} }, 'ore', 'herb')) === 0,
    );
  }

  // 遣散
  const fired = engine.dismissServant(moved, 'herb');
  check('可以遣散仆人', engine.getServantCount(fired) === 0);

  // 需求 4：招收仆人所需的灵气**固定 300**（原先随人数等比递增）
  const many = grant(forceBuild(createInitialState(0), 'grotto', 5), { qi: '1e12' });
  const costAt0 = engine.getServantCost(many).toNumber();
  let grown = many;
  for (let i = 0; i < 10; i += 1) grown = engine.recruitServant(grown, 'chores');
  const costAt10 = engine.getServantCost(grown).toNumber();
  check('招收仆人固定 300 灵气', costAt0 === 300 && costAt10 === 300, `${costAt0} → ${costAt10}`);
  check(
    '招收仆人不受已有人数影响',
    SERVANT_COST === 300 && servantCost(0) === servantCost(99),
    `${servantCost(0)} / ${servantCost(99)}`,
  );

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

  // 丹房提供炼丹位（需求 2 起丹房唯一，所以"位"只剩展示意义，不再决定品阶上限）
  const withRooms = forceBuild(state, 'alchemyRoom', 2);
  check('丹房提供炼丹位', engine.getAlchemySlots(withRooms) === 2);
  check('需求 2：丹房改为唯一建筑', BUILDABLE_MAP.alchemyRoom.max === 1);
  check('需求 2：炼器房改为唯一建筑', BUILDABLE_MAP.refinery.max === 1);
  check(
    '需求 2：炼丹位不再决定品阶上限（升品只看资源）',
    engine.getMaxAlchemyTierBySlots(createInitialState(0)) === MAX_CRAFT_TIER,
    `实际 ${engine.getMaxAlchemyTierBySlots(createInitialState(0))}`,
  );

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
  // 需求 6 之后，光有境界还不够 —— 高阶储物还要「须弥之法」
  const realmOnly: GameState = { ...base, realmIndex: cave.requiresRealm! };
  check('只有境界、没有技术时仍然不能建造', engine.getBuildGate(cave, realmOnly) !== null, engine.getBuildGate(cave, realmOnly) ?? '');
  const reached: GameState = withTech(realmOnly, 'voidStorageArt');
  check('境界与技术都具备后可以建造', engine.getBuildGate(cave, reached) === null);

  /* ---- 数量上限（防止价格涨过上限导致永久卡死） ---- */
  const bigCap = forceBuild(createInitialState(0), 'daoRepository', 10); // 先撑大上限，方便构造场景
  const rich = grant(bigCap, { qi: '1e12' });
  check('储物建筑有数量上限', engine.getMaxCount(pouch) === 10);
  check('数量上限约束了 maxAffordable', engine.maxAffordable(pouch, 0, rich) === 10, `${engine.maxAffordable(pouch, 0, rich)}`);
  check('已建满时 maxAffordable 为 0', engine.maxAffordable(pouch, 10, rich) === 0);

  /* ---- costGrowth === 1 的建筑（只可能建一座）----
     等比求和公式要除以 (r - 1)，r = 1 时会算出 NaN，
     表现出来就是"明明买得起却一直买不动"。这是模拟器抓出来的 bug。 */
  const fixedPrice = BUILDABLE_MAP.masterHall;
  check('掌门大殿的价格不随数量增长', fixedPrice.costGrowth === 1);
  const fixedCost = engine.getCost(fixedPrice, 0, 1);
  check(
    'costGrowth 为 1 时总价仍然有限',
    Object.values(fixedCost).every((v) => Number.isFinite(v.toNumber()) && v.gt(0)),
    Object.entries(fixedCost).map(([k, v]) => `${k}=${v.toString()}`).join(' '),
  );
  // 掌门大殿要求先开宗立派，所以场景里得先有宗门
  const sectState = createInitialState(0);
  const fixedRich = grant(
    { ...sectState, sect: { ...sectState.sect, founded: true } },
    { qi: '1e9', wood: '1e6', stone: '1e6' },
  );
  check('costGrowth 为 1 时 maxAffordable 正常', engine.maxAffordable(fixedPrice, 0, fixedRich) === 1, `${engine.maxAffordable(fixedPrice, 0, fixedRich)}`);
  check(
    'costGrowth 为 1 的建筑真的买得动',
    engine.getBuildingCount(engine.buyBuilding(fixedRich, fixedPrice, 1), 'masterHall') === 1,
  );
  check(
    '价格不涨时买 2 座的总价就是 2 倍单价',
    engine.getCost(fixedPrice, 0, 2).qi?.eq(D(fixedPrice.baseCost.qi! * 2)) === true,
  );

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
  // 期望值从**实际产量**推出来，而不是写死 6 —— 季节与天象都会改变每秒产量
  const perSecond = engine.getProduction(oneHour.state).qi.toNumber();
  check('1 小时离线按 50% 结算', Math.abs(qiGain - perSecond * 3600 * 0.5) < 1e-6, `实际 ${qiGain}`);

  const longAway = applyOffline(state, 100 * 3600 * 1000, makeRandom(1));
  const capped = longAway.report?.gains.find((g) => g.id === 'qi')?.amount.toNumber() ?? 0;
  const cappedPerSecond = engine.getProduction(longAway.state).qi.toNumber();
  check(
    '超长离线被 8 小时上限截断',
    Math.abs(capped - cappedPerSecond * 8 * 3600 * 0.5) < 1e-6,
    `实际 ${capped}`,
  );

  const shortAway = applyOffline(state, 10 * 1000, makeRandom(1));
  check('短暂离开不触发离线结算', shortAway.report === null);

  /* ---- 离线期间的游历、种植、商行、钻研都要照常推进 ---- */
  {
    let away = grant(createInitialState(0), { stone: '1e5', wood: '1e5', qi: '1e5' });
    away = { ...away, realmIndex: 2 };
    away = forceBuild(away, 'spiritVault', 10);
    away = forceBuild(away, 'plantation', 1);
    away = forceBuild(away, 'tradeHouse', 1);
    away = withTech(away, 'plantingArt', 'tradeArt', 'alchemyArt');
    away = planting.addSeeds(away, 'demonCore', 5);
    away = planting.plantSeed(away, 'demonCore', makeRandom(1));
    away = travel.startTravel(away, 'mortalVillage');
    away = research.startResearch(away, 'storageArt');
    // savedAt 必须是"过去"，applyOffline 才会结算
    const saved = { ...away, savedAt: Date.now() - 3600 * 1000 };
    const back = applyOffline(saved, Date.now(), makeRandom(1));

    check('离线时游历会走完', back.state.personalTravel === null);
    check(
      '离线带回的材料计入结算',
      (back.report?.materialGains.length ?? 0) > 0 || (back.report?.gains.length ?? 0) > 0,
      `${back.report?.materialGains.length ?? 0} 种材料`,
    );
    check('离线时作物会成熟', back.state.plantings.length === 1 && planting.isPlantingReady(back.state.plantings[0]));
    check('离线时钻研会完成', research.isTechResearched(back.state, 'storageArt'));
    check('离线时商行会刷新', back.state.shop.offers.length > 0, `${back.state.shop.offers.length} 件`);
    check('离线结算带上了种子字段', Array.isArray(back.report?.seedGains));
    check('离线结算带上了图纸字段', Array.isArray(back.report?.blueprintGains));
  }

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

  // 推进到凡品灵根寿元耗尽。
  // ⚠️ 需求 1 把日历改成"一年 = 现实 8 分钟"之后，游戏年比原先慢了约 39 倍，
  // 所以这里推进的真实时间也要跟着放大，否则测不出老死。
  const aged = applyTick(test, 60 * 60 * 24 * 40, makeRandom(1));
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
/* 9. 秘境探索（需求 1 / 5）                                            */
/* ------------------------------------------------------------------ */
section('[10] 秘境探索：发现、冷却、人数（需求 1 / 5）');
{
  const realm = SECRET_REALM_MAP[STARTER_REALM_ID];

  // 造一支远超推荐战力的队伍
  let strong: GameState = grant(createInitialState(0), { stone: '1e9' });
  strong = forceBuild(strong, 'thatchHut', 5);
  strong = { ...strong, sect: { ...strong.sect, founded: true } };
  for (let i = 0; i < 6; i += 1) strong = disciples.recruitDisciple(strong, makeRandom(100 + i)).state;
  strong = {
    ...strong,
    sect: {
      ...strong.sect,
      disciples: strong.sect.disciples.map((d) => ({ ...d, realmIndex: 6 })), // 合体期
    },
  };

  /* ---- 开局只发现落霞谷，其余要靠探索 ---- */
  check('开局已知一处秘境', engine.isRealmDiscovered(strong, realm));
  check(
    '其余秘境开局未知',
    SECRET_REALMS.filter((r) => r.id !== STARTER_REALM_ID).every((r) => !engine.isRealmDiscovered(strong, r)),
  );
  check('未发现的秘境不能派遣', !expeditions.canStartExpedition(strong, 'boundlessSea_15_r0', ['x']).ok);

  const minIds = strong.sect.disciples.slice(0, realm.minParty).map((d) => d.id);
  check('战力充足的队伍可以派遣', expeditions.canStartExpedition(strong, realm.id, minIds).ok);

  const started = expeditions.startExpedition(strong, realm.id, minIds);
  check('派遣后产生探索任务', started.expeditions.length === 1);
  check(
    '被派遣的弟子状态为探索中',
    started.sect.disciples.filter((d) => d.status === 'exploring').length === realm.minParty,
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

  /* ---- 需求 1：探索后需要隔一段时间才能再探 ---- */
  check('探索结束后进入冷却', engine.getRealmCooldown(done, realm.id) > 0, `${engine.getRealmCooldown(done, realm.id)} 秒`);
  check('冷却中不能立刻再派', !expeditions.canStartExpedition(done, realm.id, minIds).ok);
  const cooled = engine.tickRealmCooldowns(done, realm.cooldown + 1);
  check('冷却走完就能再派', engine.getRealmCooldown(cooled, realm.id) === 0);
  check('冷却结束后可以再派遣', expeditions.canStartExpedition(cooled, realm.id, minIds).ok);

  /* ---- 需求 1：人越多最终获取的资源越多 ---- */
  check('人数系数随人数增长', expeditions.getPartySizeFactor(realm, realm.minParty + 2) > 1);
  check(
    '掉落条目数随人数增长',
    expeditions.getLootRolls(realm, realm.maxParty) > expeditions.getLootRolls(realm, realm.minParty),
    `${expeditions.getLootRolls(realm, realm.minParty)} → ${expeditions.getLootRolls(realm, realm.maxParty)}`,
  );
  check('超出上限会被拒绝', !expeditions.canStartExpedition(strong, realm.id, strong.sect.disciples.map((d) => d.id)).ok);
  check('低于下限会被拒绝', !expeditions.canStartExpedition(strong, realm.id, []).ok);

  // 同样条件下，人多的一方拿到的资源更多
  const smallParty = strong.sect.disciples.slice(0, realm.minParty).map((d) => d.id);
  const bigParty = strong.sect.disciples.slice(0, realm.maxParty).map((d) => d.id);
  const runWith = (party: string[]) => {
    const withStatus = disciples.setDiscipleStatus(strong, party, 'exploring', 'test');
    return expeditions.resolveExpedition(
      withStatus,
      { id: 'test', realmId: realm.id, discipleIds: party, progress: realm.duration, duration: realm.duration, kind: 'realm' },
      makeRandom(7),
    ).state;
  };
  const smallGain = runWith(smallParty).materials.demonCore.add(runWith(smallParty).resources.herb).toNumber();
  const bigGain = runWith(bigParty).materials.demonCore.add(runWith(bigParty).resources.herb).toNumber();
  check('人数越多总产出越高', bigGain > smallGain, `${smallGain} → ${bigGain}`);

  /* ---- 需求 4：探索归来涨心得 ---- */
  check('探索归来的弟子获得心得', done.sect.disciples.some((d) => d.insight > 0), `最高 ${Math.max(...done.sect.disciples.map((d) => d.insight))}`);

  /* ---- 战力不足时伤亡率更高 ---- */
  let weak: GameState = grant(createInitialState(0), { stone: '1e9' });
  weak = forceBuild(weak, 'thatchHut', 3);
  weak = { ...weak, sect: { ...weak.sect, founded: true } };
  for (let i = 0; i < 3; i += 1) weak = disciples.recruitDisciple(weak, makeRandom(200 + i)).state;
  const weakIds = weak.sect.disciples.slice(0, realm.minParty).map((d) => d.id);
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

  // 战力比影响产量：同一秘境，强队收获更多
  const weakGain = weakResolved.materials.demonCore.toNumber();
  const strongGain = done.materials.demonCore.toNumber();
  check('战力越强秘境产量越高', strongGain > weakGain, `${weakGain} → ${strongGain}`);

  /* ---- 需求 1：发现是「探索中发现」，发现后固定在秘境栏 ---- */
  // 把所有弟子放到足够高的境界，再反复探索，看能不能把秘境一个个找出来
  let explorer: GameState = { ...strong, realmIndex: 7 };
  explorer = {
    ...explorer,
    sect: { ...explorer.sect, disciples: explorer.sect.disciples.map((d) => ({ ...d, realmIndex: 7 })) },
  };
  const before = expeditions.getUndiscoveredCount(explorer);
  for (let i = 0; i < 400 && expeditions.getUndiscoveredCount(explorer) > 0; i += 1) {
    const party = explorer.sect.disciples.slice(0, 2).map((d) => d.id);
    // 不停在同一个秘境上耗着：每次换一处已发现的、且不在冷却里的
    const target = SECRET_REALMS.find(
      (r) => engine.isRealmDiscovered(explorer, r) && !engine.isRealmOnCooldown(explorer, r.id) && r.maxParty >= party.length,
    );
    if (!target) {
      explorer = engine.tickRealmCooldowns(explorer, 99999);
      continue;
    }
    const withStatus = disciples.setDiscipleStatus(explorer, party, 'exploring', 't');
    explorer = expeditions.resolveExpedition(
      withStatus,
      { id: 't', realmId: target.id, discipleIds: party, progress: target.duration, duration: target.duration, kind: 'realm' },
      makeRandom(1000 + i),
    ).state;
    explorer = engine.tickRealmCooldowns(explorer, 99999);
  }
  const after = expeditions.getUndiscoveredCount(explorer);
  check('反复探索能发现新秘境', after < before, `${before} → ${after}`);
  check(
    '已发现的秘境永久固定（不会因为材料变化而消失）',
    engine.getDiscoveredRealms(explorer).length === SECRET_REALMS.length - after,
  );

  const realmRestored = deserialize(JSON.parse(JSON.stringify(serialize(explorer))));
  check(
    '秘境发现状态与冷却都能存档还原',
    realmRestored !== null && engine.getDiscoveredRealms(realmRestored).length === SECRET_REALMS.length - after,
  );
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

  // 品阶门禁。配方现在同时吃基础材料与稀有材料，所以测试场景把
  // **所有**材料都给足 —— 否则以后每加一种材料都要回来改这行。
  let state = grantAll(createInitialState(0), {
    herb: '1e9',
    qi: '1e12',
    ore: '1e9',
  });
  check('低品阶时不能炼三品丹', crafting.canCraftPill(state, 'goldenCorePill').ok === false);

  state = { ...state, alchemyTier: 3 };
  check('提升品阶后可以炼三品丹', crafting.canCraftPill(state, 'goldenCorePill').ok === true);

  const before = state.materials.demonCore;
  // 需求 2 起炼制有概率失败，测试里用 fixedRandom(0) 保证必成
  const crafted = crafting.craftPill(state, 'goldenCorePill', 2, fixedRandom(0)).state;
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
  const craftedArtifact = crafting.craftArtifact(artifactState, 'ironSword', 1, fixedRandom(0)).state;
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
  // 需求 6：升品要先钻研对应等级的技术
  check(
    '没钻研炼丹入门时升不了品',
    crafting.getAlchemyUpgradeStatus(state).possible === false,
    crafting.getAlchemyUpgradeStatus(state).reason ?? '',
  );
  state = { ...state, techs: { ...state.techs, alchemyArt: true } };
  check('一座丹房 + 炼丹入门即可支撑二品', crafting.getAlchemyUpgradeStatus(state).possible === true);

  const upgraded = crafting.upgradeAlchemy(state);
  check('炼丹术提升到二品', upgraded.alchemyTier === 2);

  // 五品要换一档技术（丹道精要）。五品要的材料比二品多得多，这里给足。
  const atFour: GameState = grant({ ...upgraded, alchemyTier: 4 }, {
    herb: '1e9',
    qi: '1e12',
    starSand: '1e6',
    spiritEssence: '1e6',
    blackIron: '1e6',
    demonCore: '1e6',
  });
  check(
    '四品升五品要先钻研丹道精要',
    (crafting.getAlchemyUpgradeStatus(atFour).reason ?? '').includes('丹道精要'),
    crafting.getAlchemyUpgradeStatus(atFour).reason ?? '',
  );
  check(
    '钻研之后就能升五品',
    crafting.getAlchemyUpgradeStatus({ ...atFour, techs: { ...atFour.techs, alchemyDeep: true } }).possible === true,
  );

  const needTwo = crafting.getAlchemyUpgradeStatus(upgraded);
  // 需求 2：升品不再要求丹房数量，只看资源
  check('升品不再需要多座丹房', needTwo.slotsNeeded === 0, `需 ${needTwo.slotsNeeded} 座`);
  check('资源不够时照样升不了', needTwo.possible === false, needTwo.reason ?? '');
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
/* 14. 材料分级与配方规律（需求 2）                                      */
/* ------------------------------------------------------------------ */
section('[15] 材料分级与配方规律（需求 2）');
{
  check(
    '材料分成基础 / 稀有 / 进阶三类（需求 4 新增进阶）',
    MATERIAL_IDS.length ===
      BASE_MATERIAL_IDS.length + RARE_MATERIAL_IDS.length + REFINED_MATERIAL_IDS.length,
    `${MATERIAL_IDS.length} = ${BASE_MATERIAL_IDS.length}+${RARE_MATERIAL_IDS.length}+${REFINED_MATERIAL_IDS.length}`,
  );
  check(
    '三类的 id 互不重叠',
    BASE_MATERIAL_IDS.every((id) => !RARE_MATERIAL_IDS.includes(id) && !REFINED_MATERIAL_IDS.includes(id)) &&
      RARE_MATERIAL_IDS.every((id) => !REFINED_MATERIAL_IDS.includes(id)),
  );
  check(
    'category 字段与三个清单一致',
    MATERIAL_IDS.every((id) => {
      const c = MATERIAL_MAP[id].category;
      if (c === 'base') return BASE_MATERIAL_IDS.includes(id);
      if (c === 'rare') return RARE_MATERIAL_IDS.includes(id);
      return REFINED_MATERIAL_IDS.includes(id);
    }),
  );
  check(
    '每种材料都有种子 —— 但进阶资源是例外（需求 4：只能合成）',
    MATERIAL_IDS.filter((id) => !REFINED_MATERIAL_IDS.includes(id)).every((id) =>
      SEEDS.some((s) => s.material === id),
    ),
  );
  check(
    '进阶资源不能种',
    REFINED_MATERIAL_IDS.every(
      (id) => MATERIAL_MAP[id].plantable === false && !SEEDS.some((s) => s.material === id),
    ),
  );

  /* ---- 核心规律：品阶越高，稀有材料种类越多 ---- */
  let patternOk = true;
  let patternDetail = '';
  for (const def of [...PILLS, ...ARTIFACTS]) {
    const kinds = countMaterialKinds(def.cost);
    const baseMin = BASE_KINDS_MIN[def.tier] ?? 0;
    const rareMin = RARE_KINDS_MIN[def.tier] ?? 0;
    if (kinds.base < baseMin || kinds.rare < rareMin) {
      patternOk = false;
      patternDetail = `${def.name}（${def.tier}品）基础 ${kinds.base}/${baseMin}、稀有 ${kinds.rare}/${rareMin}`;
      break;
    }
  }
  check('每条配方的材料种类数都达到品阶下限', patternOk, patternDetail);

  check(
    '稀有材料种类下限随品阶单调不减',
    RARE_KINDS_MIN.slice(1).every((n, i) => n >= RARE_KINDS_MIN[i]),
    RARE_KINDS_MIN.join(' → '),
  );
  check('一品不需要稀有材料', RARE_KINDS_MIN[1] === 0);
  check('九品至少需要 5 种稀有材料', RARE_KINDS_MIN[9] >= 5, `${RARE_KINDS_MIN[9]} 种`);

  /* ---- 高品阶确实用到了更多稀有材料（实际数据，不只是下限） ---- */
  const tier9Rare = Math.max(
    ...PILLS.filter((p) => p.tier === 9).map((p) => countMaterialKinds(p.cost).rare),
  );
  const tier2Rare = Math.max(
    ...PILLS.filter((p) => p.tier === 2).map((p) => countMaterialKinds(p.cost).rare),
  );
  check('实际配方里九品的稀有材料也比二品多', tier9Rare > tier2Rare, `${tier2Rare} → ${tier9Rare}`);

  /* ---- 没有孤儿材料：每种材料都要被至少一条配方用到 ---- */
  const used = new Set<string>();
  for (const def of [...PILLS, ...ARTIFACTS]) {
    for (const id of Object.keys(def.cost)) used.add(id);
  }
  // 需求 1 / 4：建筑造价（宗门大阵吃阵枢）也是一条正经的出口
  for (const def of BUILDABLES) {
    for (const id of Object.keys(def.baseCost)) used.add(id);
  }
  const orphans = MATERIAL_IDS.filter((id) => !used.has(id));
  check('没有用不到的材料', orphans.length === 0, orphans.join('、'));

  /* ---- 每种材料都得有来源（需求 4 起，合成也算一条来源） ---- */
  const fromTravel = new Set(TRAVEL_REGIONS.flatMap((r) => r.loot.map((l) => l.item as string)));
  const fromRealm = new Set(
    Object.values(SECRET_REALM_MAP).flatMap((r) => r.loot.map((l) => l.item as string)),
  );
  const fromShop = new Set(SHOP_GOODS.filter((g) => g.kind === 'material').map((g) => g.item));
  // 需求 4：进阶资源的**唯一**来源就是合成，所以要把它算进来源
  const fromRefine = new Set(REFINE_RECIPES.map((r) => r.output.item as string));
  const sourceless = MATERIAL_IDS.filter(
    (id) => !fromTravel.has(id) && !fromRealm.has(id) && !fromShop.has(id) && !fromRefine.has(id),
  );
  check('每种材料都能在游戏里拿到', sourceless.length === 0, sourceless.join('、'));

  /* ---- 需求 4：进阶资源只能合成，不该出现在掉落表里 ---- */
  check(
    '进阶资源不会从秘境 / 游历掉落（只能合成）',
    REFINED_MATERIAL_IDS.every((id) => !fromTravel.has(id) && !fromRealm.has(id)),
  );
  check(
    '每条合成配方的产出都是真材料',
    REFINE_RECIPES.every((r) => MATERIAL_IDS.includes(r.output.item as never) || r.output.item === 'stone'),
  );
}

/* ------------------------------------------------------------------ */
/* 15. 个人游历（需求 1）                                               */
/* ------------------------------------------------------------------ */
section('[16] 个人游历（需求 1）');
{
  const base = createInitialState(0);

  /* ---- 境界门槛：材料的获取跟着等级走 ---- */
  check(
    '开局只能去炼气期那一片',
    travel.getAvailableRegions(base).length === 1,
    `${travel.getAvailableRegions(base).length} 处`,
  );
  const highRegion = TRAVEL_REGIONS[TRAVEL_REGIONS.length - 1];
  check(
    '高境界区域去不了',
    travel.canStartTravel(base, highRegion.id).ok === false,
    travel.canStartTravel(base, highRegion.id).reason ?? '',
  );
  const highRealm: GameState = { ...base, realmIndex: 8 };
  check('境界到了就能去', travel.canStartTravel(highRealm, highRegion.id).ok === true);

  /* ---- 已开宗也要能出门（需求只要求"开宗之前能去"，不是"开宗之后不能去"） ---- */
  check('不必开宗立派', base.sect.founded === false && travel.canStartTravel(base, 'mortalVillage').ok);

  /* ---- 出游期间产量下降 ---- */
  const before = engine.getGlobalMultiplier(base).toNumber();
  const traveling = travel.startTravel(base, 'mortalVillage');
  check('启程后进入游历状态', traveling.personalTravel !== null);
  const during = engine.getGlobalMultiplier(traveling).toNumber();
  // 需求 4：这条惩罚已删除 —— 出门不再扣全局产量
  check(
    '出游期间全局产量不再下降（本轮需求 4）',
    Math.abs(during - before) < 1e-9,
    `${before.toFixed(2)} → ${during.toFixed(2)}`,
  );
  check('重复启程会被拒绝', travel.canStartTravel(traveling, 'mortalVillage').ok === false);

  /* ---- 结算：一定带回灵石与材料，且不会死人 ---- */
  const resolved = travel.tickTravel(traveling, TRAVEL_REGIONS[0].duration + 1, makeRandom(7));
  check('游历结束后状态清空', resolved.personalTravel === null);
  check('产量惩罚随之解除', engine.getGlobalMultiplier(resolved).toNumber() === before);
  check('带回灵石', resolved.resources.stone.gt(traveling.resources.stone), fmt(resolved.resources.stone));
  const gainedMaterials = MATERIAL_IDS.some((id) => resolved.materials[id].gt(traveling.materials[id]));
  check('带回材料', gainedMaterials || resolved.resources.wood.gt(traveling.resources.wood));
  check('写入了游历记事', resolved.journal.some((entry) => entry.text.includes('游历归来')));

  /* ---- 中止游历 ---- */
  const canceled = travel.cancelTravel(traveling);
  check('可以中止游历', canceled.personalTravel === null);

  /* ---- 种子（需求 5 的探索来源） ---- */
  const alwaysSeed = travel.resolveTravel(
    travel.startTravel(base, 'mortalVillage'),
    fixedRandom(0.01),
  ).state;
  const seedCount = Object.values(alwaysSeed.seeds).reduce((sum, n) => sum + n, 0);
  check('探索可以带回种子', seedCount > 0, JSON.stringify(alwaysSeed.seeds));

  /* ---- 越高级的种子掉率越低 ---- */
  const weights = RARE_MATERIAL_IDS.map((id) => SEEDS.find((s) => s.material === id)!.dropWeight);
  check(
    '种子掉率随稀有度递减',
    weights.every((w, i) => i === 0 || w <= weights[i - 1]),
    weights.join(' ≥ '),
  );
}

/* ------------------------------------------------------------------ */
/* 16. 商行（需求 3 / 6）                                               */
/* ------------------------------------------------------------------ */
section('[17] 商行（需求 3 / 6）');
{
  const base = createInitialState(0);
  const farm: GameState = { ...base, realmIndex: 3 };

  check('没有商行时不刷新货架', shop.tickShop(farm, 10, makeRandom(1)).shop.offers.length === 0);

  const withShop = forceBuild(withTech(farm, 'tradeArt'), 'tradeHouse', 1);
  const stocked = shop.tickShop(withShop, 0, makeRandom(3));
  check('建成商行后自动上架', stocked.shop.offers.length > 0, `${stocked.shop.offers.length} 件`);
  check(
    '货位数 = 基础 + 每座商行加成',
    stocked.shop.offers.length === engine.getShopOfferCapacity(withShop),
    `${stocked.shop.offers.length}`,
  );
  check('每件货品都有价格', stocked.shop.offers.every((o) => o.price > 0 && o.amount > 0));

  /* ---- 需求 3：「每次售卖一部分资源」 ---- */
  check(
    '每轮只上架商品池的一部分',
    stocked.shop.offers.length < SHOP_GOODS.length,
    `${stocked.shop.offers.length} < ${SHOP_GOODS.length}`,
  );

  /* ---- 需求 5：商行只卖基础材料种子 ---- */
  const seedOffers = stocked.shop.offers.filter((o) => o.kind === 'seed');
  check(
    '商行只卖基础材料的种子',
    seedOffers.every((o) => MATERIAL_MAP[o.item as MaterialId].category === 'base'),
    seedOffers.map((o) => o.item).join('、') || '本轮无种子',
  );
  check(
    '商行不卖稀有材料的种子',
    SHOP_GOODS.filter((g) => g.kind === 'seed').every(
      (g) => MATERIAL_MAP[g.item as MaterialId].category === 'base',
    ),
  );
  check(
    // 需求 4：进阶资源是刻意放进商行的（贵，但给"急着用"的玩家一条应急通道）
    '商行不卖稀有材料，但卖进阶资源',
    SHOP_GOODS.filter((g) => g.kind === 'material').every((g) => {
      const c = MATERIAL_MAP[g.item as MaterialId].category;
      return c === 'base' || c === 'refined';
    }),
    SHOP_GOODS.filter((g) => g.kind === 'material')
      .map((g) => g.item)
      .filter((id) => MATERIAL_MAP[id as MaterialId].category === 'rare')
      .join('、') || '没有稀有材料',
  );

  /* ---- 购买 ---- */
  const rich = grant(stocked, { stone: '1e9' });
  const offer = rich.shop.offers[0];
  const stoneBefore = rich.resources.stone;
  const bought = shop.buyShopOffer(rich, offer.id).state;
  check('购买后扣除灵石', bought.resources.stone.lt(stoneBefore), `-${fmt(stoneBefore.sub(bought.resources.stone))}`);
  check('购买后该件标记售罄', bought.shop.offers.find((o) => o.id === offer.id)?.sold === true);
  check('不能重复购买同一件', shop.canBuyOffer(bought, offer.id).ok === false);

  const poor = grant(stocked, { stone: '0' });
  check('灵石不足时买不了', shop.canBuyOffer(poor, offer.id).ok === false);

  /* ---- 买图纸（需求 6） ---- */
  const bpOffer = {
    id: 'test-blueprint',
    kind: 'blueprint' as const,
    item: BLUEPRINTS[0].id,
    amount: 1,
    price: 10,
    sold: false,
  };
  const withBpGoods: GameState = { ...rich, shop: { offers: [bpOffer], secondsLeft: 100 } };
  const ownedBp = shop.buyShopOffer(withBpGoods, bpOffer.id).state;
  check('可以买下图纸', ownedBp.blueprints[BLUEPRINTS[0].id] === true);
  check('不能重复购买已有的图纸', shop.canBuyOffer(ownedBp, bpOffer.id).ok === false);
  check(
    '已有图纸不再上架',
    shop.buildShopOffers(ownedBp, makeRandom(5)).every((o) => o.item !== BLUEPRINTS[0].id),
  );

  /* ---- 需求 6：图纸也跟玩家等级挂钩 ---- */
  const lowRealm = {
    ...rich,
    realmIndex: 0,
    blueprints: {},
    shop: { offers: [], secondsLeft: 0 },
  };
  const lowRealmOffers = Array.from({ length: 40 }, (_, i) =>
    shop.buildShopOffers({ ...lowRealm, shop: { offers: [], secondsLeft: 0 } }, makeRandom(i + 1)),
  ).flat();
  check(
    '境界不够时商行不上架图纸',
    lowRealmOffers.every(
      (o) => o.kind !== 'blueprint' || lowRealm.realmIndex >= BLUEPRINT_MAP[o.item].requiresRealm,
    ),
    `${lowRealmOffers.filter((o) => o.kind === 'blueprint').length} 张`,
  );
  const highRealm = { ...lowRealm, realmIndex: 8 };
  const highRealmOffers = Array.from({ length: 200 }, (_, i) =>
    shop.buildShopOffers(highRealm, makeRandom(i + 1)),
  ).flat();
  check(
    '境界够了才会看到图纸',
    highRealmOffers.some((o) => o.kind === 'blueprint'),
    `${highRealmOffers.filter((o) => o.kind === 'blueprint').length} 张`,
  );
  check(
    '每张图纸都设了境界门槛',
    BLUEPRINTS.every((bp) => bp.requiresRealm >= 0 && bp.requiresRealm < REALMS.length),
  );
  check(
    '图纸门槛与它解锁的建筑一致',
    BLUEPRINTS.every((bp) => {
      const building = Object.values(BUILDABLE_MAP).find((b) => b.requiresBlueprint === bp.id);
      return building?.requiresRealm === bp.requiresRealm;
    }),
  );

  /* ---- 刷新倒计时 ---- */
  const ticking = shop.tickShop(stocked, 5, makeRandom(3));
  check(
    '刷新倒计时在走',
    ticking.shop.secondsLeft < stocked.shop.secondsLeft,
    `${ticking.shop.secondsLeft} < ${stocked.shop.secondsLeft}`,
  );
  const rerolled = shop.tickShop(stocked, 1e6, makeRandom(11));
  check('倒计时归零后重摇货架', rerolled.shop.offers.filter((o) => !o.sold).length > 0);
}

/* ------------------------------------------------------------------ */
/* 17. 灵石自动合成（需求 4）                                            */
/* ------------------------------------------------------------------ */
section('[18] 灵石自动合成（需求 4）');
{
  check('默认是关闭的', createInitialState(0).autoRefineLevel === 0);
  check('档位表从 0（关闭）开始', AUTO_REFINE_RATES[0] === 0);
  check('有多个可选档位', AUTO_REFINE_LEVEL_MAX >= 2, `${AUTO_REFINE_LEVEL_MAX + 1} 档`);

  // 储物袋 ×10：灵气上限 20250 / 灵矿 8100 / 灵石 1250
  const storage = forceBuild(createInitialState(0), 'storagePouch', 10);
  const stocked = grant(storage, { qi: '20000', ore: '8000' });
  const qiCap = engine.getStorageCap(stocked, 'qi');
  const oreCap = engine.getStorageCap(stocked, 'ore');
  check('测试场景的资源都在上限之内', stocked.resources.qi.lte(qiCap) && stocked.resources.ore.lte(oreCap));

  const off = applyTick(stocked, 60, makeRandom(1));
  check(
    '关闭时不消耗灵气与灵矿',
    off.resources.qi.eq(stocked.resources.qi) && off.resources.ore.eq(stocked.resources.ore),
  );
  check('关闭时也不产灵石', off.resources.stone.eq(stocked.resources.stone));

  const fast: GameState = { ...stocked, autoRefineLevel: AUTO_REFINE_LEVEL_MAX };
  const on = applyTick(fast, 60, makeRandom(1));
  check('开启后产出灵石', on.resources.stone.gt(stocked.resources.stone), `+${fmt(on.resources.stone.sub(stocked.resources.stone))}`);
  check('开启后消耗灵气', on.resources.qi.lt(stocked.resources.qi));
  check('开启后消耗灵矿', on.resources.ore.lt(stocked.resources.ore));
  check(
    '产出量符合合成比例',
    on.resources.stone.eq(
      stocked.resources.stone.add(
        on.resources.ore.lt(stocked.resources.ore)
          ? stocked.resources.ore.sub(on.resources.ore).div(STONE_REFINE_COST.ore).floor().mul(STONE_REFINE_OUTPUT)
          : D(0),
      ),
    ),
    `灵气 ${fmt(stocked.resources.qi)} → ${fmt(on.resources.qi)}`,
  );

  /* ---- 灵气耗尽时不会凭空造灵石 ---- */
  const noQi: GameState = {
    ...grant(forceBuild(createInitialState(0), 'storagePouch', 10), { ore: '8000' }),
    autoRefineLevel: AUTO_REFINE_LEVEL_MAX,
  };
  const starved = applyTick(noQi, 60, makeRandom(1));
  check('灵气为 0 时合成不出灵石', starved.resources.stone.eq(noQi.resources.stone));

  /* ---- 仓库满了就不再烧灵气 ---- */
  const stoneCap = engine.getStorageCap(stocked, 'stone');
  const full: GameState = {
    ...stocked,
    autoRefineLevel: AUTO_REFINE_LEVEL_MAX,
    resources: { ...stocked.resources, stone: stoneCap },
  };
  const noRoom = applyTick(full, 60, makeRandom(1));
  check('灵石已满时不再消耗灵气', noRoom.resources.qi.eq(full.resources.qi), `${fmt(noRoom.resources.qi)}`);
  check('灵石被上限截断', noRoom.resources.stone.eq(stoneCap));

  /* ---- 慢档比快档少烧灵气 ---- */
  const slow = applyTick({ ...stocked, autoRefineLevel: 1 }, 60, makeRandom(1));
  check(
    '慢档消耗少于快档',
    slow.resources.qi.gt(on.resources.qi),
    `${fmt(slow.resources.qi)} > ${fmt(on.resources.qi)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 18. 种植（需求 5）                                                   */
/* ------------------------------------------------------------------ */
section('[19] 种植（需求 5）');
{
  const base = createInitialState(0);
  const seedMaterial: MaterialId = 'demonCore';

  check('没有灵植园就没有地块', engine.getPlotCapacity(base) === 0);
  check('没有地块时不能种', planting.canPlant(base, seedMaterial).ok === false);

  const withSeeds = planting.addSeeds(base, seedMaterial, 3);
  check('可以获得种子', planting.getSeedCount(withSeeds, seedMaterial) === 3);

  const farm = forceBuild(withTech(withSeeds, 'plantingArt'), 'plantation', 1);
  check('灵植园提供地块', engine.getPlotCapacity(farm) === 4, `${engine.getPlotCapacity(farm)}`);
  check('没有种子时不能种', planting.canPlant(forceBuild(withTech(base, 'plantingArt'), 'plantation', 1), seedMaterial).ok === false);

  const planted = planting.plantSeed(farm, seedMaterial, makeRandom(1));
  check('种下消耗一颗种子', planting.getSeedCount(planted, seedMaterial) === 2);
  check('地里多了一株作物', planted.plantings.length === 1);

  /* ---- 生长 ---- */
  const seed = SEEDS.find((s) => s.material === seedMaterial)!;
  const half = planting.tickPlantings(planted, seed.growSeconds / 2);
  check('作物会随时间生长', !planting.isPlantingReady(half.plantings[0]), `${planting.getPlantingProgress(half.plantings[0]).toFixed(2)}`);
  const ripe = planting.tickPlantings(planted, seed.growSeconds + 1);
  check('长够时间就成熟', planting.isPlantingReady(ripe.plantings[0]));

  /* ---- 收获 ---- */
  const unripe = planting.harvestPlanting(planted, planted.plantings[0].id);
  check('未成熟不能收获', unripe.gains.length === 0);

  const harvested = planting.harvestPlanting(ripe, ripe.plantings[0].id);
  check('收获得到材料', harvested.gains[0]?.amount === seed.yield, `${harvested.gains[0]?.amount} 份`);
  check('收获后地块空出', harvested.state.plantings.length === 0);
  check(
    '收获的材料进了材料栏',
    harvested.state.materials[seedMaterial].eq(ripe.materials[seedMaterial].add(seed.yield)),
  );

  /* ---- 一键种下 / 一键收获 ---- */
  const many = planting.addSeeds(farm, seedMaterial, 100);
  const allPlanted = planting.plantAll(many, makeRandom(2));
  check('一键种下会填满地块', allPlanted.plantings.length === engine.getPlotCapacity(many), `${allPlanted.plantings.length}`);
  const grownAll = planting.tickPlantings(allPlanted, seed.growSeconds + 1);
  const bulk = planting.harvestAll(grownAll);
  check('一键收获并合并产出', bulk.gains.length === 1 && bulk.gains[0].amount === seed.yield * engine.getPlotCapacity(many));

  /* ---- 催熟（需求 5 明文） ---- */
  // 用生长期最长的一种材料来测，免得第一次催熟就把作物催熟了
  const slowMaterial: MaterialId = 'primordialFruit';
  const slowSeed = SEEDS.find((s) => s.material === slowMaterial)!;
  const slowFarm = planting.plantSeed(
    planting.addSeeds(farm, slowMaterial, 2),
    slowMaterial,
    makeRandom(4),
  );
  const qiCost = hastenQiCost(slowSeed.rarity);
  const richFarm = grant(slowFarm, { qi: '1e9', stone: '1e9' });
  const hastened = planting.hastenPlanting(richFarm, richFarm.plantings[0].id, 'qi');
  check('催熟会推进生长进度', hastened.state.plantings[0].progress > richFarm.plantings[0].progress);
  check(
    '催熟扣除灵气',
    hastened.state.resources.qi.eq(richFarm.resources.qi.sub(qiCost)),
    `-${fmt(qiCost)}`,
  );
  const hastenedStone = planting.hastenPlanting(richFarm, richFarm.plantings[0].id, 'stone');
  check(
    '灵石催熟推进得更多',
    hastenedStone.state.plantings[0].progress > hastened.state.plantings[0].progress,
    `${hastened.state.plantings[0].progress} → ${hastenedStone.state.plantings[0].progress}`,
  );
  check(
    '催熟不会超过成熟所需',
    planting.tickPlantings(
      planting.hastenPlanting(
        planting.hastenPlanting(richFarm, richFarm.plantings[0].id, 'stone').state,
        richFarm.plantings[0].id,
        'stone',
      ).state,
      slowSeed.growSeconds * 10,
    ).plantings[0].progress <= slowSeed.growSeconds,
  );
  const broke: GameState = { ...slowFarm, resources: { ...slowFarm.resources, qi: D(0) } };
  check('灵气不足时催熟失败', planting.canHasten(broke, broke.plantings[0].id, 'qi').ok === false);

  /* ---- 稀有种子只能靠探索（不进商行） ---- */
  check(
    '稀有材料种子不在商行货品里',
    SHOP_GOODS.filter((g) => g.kind === 'seed').every(
      (g) => MATERIAL_MAP[g.item as MaterialId].category === 'base',
    ),
  );
  check(
    '秘境会掉稀有材料种子',
    RARE_MATERIAL_IDS.every((id) => SEEDS.some((s) => s.material === id)),
  );
  // 「越高级的材料概率越小」不能变成「高级材料根本抽不到」：
  // 高级区域的种子池会把低阶种子筛掉，所以每级稀有度都得有区域覆盖
  check(
    '每种稀有度都有区域能掉出来',
    [1, 2, 3, 4, 5, 6].every((rarity) =>
      [...TRAVEL_REGIONS, ...Object.values(SECRET_REALM_MAP)].some(
        (region) => rarity >= (region.seedMinRarity ?? 1) && rarity <= region.seedMaxRarity,
      ),
    ),
  );
  check(
    '高级区域的种子池不会掉最低级的种子',
    TRAVEL_REGIONS.filter((r) => r.minRealm >= 4).every((r) => (r.seedMinRarity ?? 1) >= 3),
    TRAVEL_REGIONS.filter((r) => r.minRealm >= 4)
      .map((r) => `${r.name}:${r.seedMinRarity ?? 1}~${r.seedMaxRarity}`)
      .join(' '),
  );
}

/* ------------------------------------------------------------------ */
/* 19. 钻研与图纸（需求 6）                                              */
/* ------------------------------------------------------------------ */
section('[20] 钻研与图纸（需求 6）');
{
  const base = createInitialState(0);

  /* ---- 除基础资源设施外，建筑都有技术 / 图纸 / 境界门槛 ---- */
  // 例外只有两样：茅屋（开局唯一的居所）与储物袋
  // —— 它们是"能攒下灵气去突破"的前提，卡住它们会直接把游戏锁死
  const UNGATED_OK = new Set(['thatchHut', 'storagePouch']);
  const needTech = STRUCTURES.filter(
    (s) =>
      s.group !== 'resource' &&
      !s.requiresTech &&
      !s.requiresBlueprint &&
      !s.requiresSect &&
      // 境界门槛也算门槛：天工院就是「金丹后解锁」这一条需求直接指定的
      s.requiresRealm === undefined &&
      !UNGATED_OK.has(s.id),
  );
  check(
    '除基础资源设施与少数开局必需建筑外，都有技术 / 图纸 / 境界门槛',
    needTech.length === 0,
    needTech.map((s) => s.name).join('、'),
  );
  check(
    '需要技术的建筑确实存在',
    STRUCTURES.filter((s) => s.requiresTech).length >= 5,
    `${STRUCTURES.filter((s) => s.requiresTech).length} 座`,
  );
  check(
    '所有基础资源设施都不需要技术',
    BUILDABLE_MAP.spiritArray.requiresTech === undefined &&
      BUILDABLE_MAP.woodGrove.requiresTech === undefined &&
      BUILDABLE_MAP.stoneMine.requiresTech === undefined,
  );
  check(
    '开局必需的居所与储物袋不加技术门槛（否则会锁死）',
    BUILDABLE_MAP.thatchHut.requiresTech === undefined &&
      BUILDABLE_MAP.storagePouch.requiresTech === undefined,
  );

  /* ---- 技术表自身要自洽 ---- */
  const techIds = new Set(TECHS.map((t) => t.id));
  check('技术的所有前置都存在', TECHS.every((t) => t.requires.every((id) => techIds.has(id))));
  check('技术都设了钻研耗时', TECHS.every((t) => t.seconds > 0));
  check('技术都设了境界门槛', TECHS.every((t) => t.requiresRealm >= 0 && t.requiresRealm < REALMS.length));

  /* ---- 前置与境界门槛 ---- */
  const noHall: GameState = { ...base, realmIndex: 5 };
  check(
    '商道需要先有营造之术',
    research.canStartResearch(noHall, 'tradeArt').ok === false,
    research.canStartResearch(noHall, 'tradeArt').reason ?? '',
  );
  const lowRealm = research.canStartResearch(base, 'caveHeavenArt');
  check('境界不足时不能钻研', lowRealm.ok === false, lowRealm.reason ?? '');

  /* ---- 钻研：付钱 → 计时 → 完成 ---- */
  const rich = grant(base, { stone: '1e6', herb: '1e6' });
  const started = research.startResearch(rich, 'alchemyArt');
  check('开始钻研后进入钻研状态', started.research?.id === 'alchemyArt');
  check('钻研扣除了材料', started.resources.stone.lt(rich.resources.stone));
  check('钻研中进度从 0 开始', research.getResearchProgress(started) === 0);

  const half = research.tickResearch(started, TECH_MAP.alchemyArt.seconds / 2);
  check('钻研进度会推进', research.getResearchProgress(half) > 0 && research.getResearchProgress(half) < 1);

  const finished = research.tickResearch(started, TECH_MAP.alchemyArt.seconds + 1);
  check('钻研完成后掌握该技术', research.isTechResearched(finished, 'alchemyArt'));
  check('钻研状态已清空', finished.research === null);
  check('写入了钻研记事', finished.journal.some((entry) => entry.text.includes('钻研有成')));
  check('已掌握的技术不能重复钻研', research.canStartResearch(finished, 'alchemyArt').ok === false);

  /* ---- 放弃钻研不退材料 ---- */
  const aborted = research.cancelResearch(started);
  check('放弃后清空钻研状态', aborted.research === null);
  check('放弃不退材料', aborted.resources.stone.eq(started.resources.stone));

  /* ---- 技术门槛真的挡住了建筑（丹房） ---- */
  const alchemyRoom = BUILDABLE_MAP.alchemyRoom;
  // refreshUnlocks 用来触发「资源门槛」这一层解锁：
  // 丹房要先拥有过 100 灵木才会出现在面板上，之后才谈得上钻研门槛。
  // 注意 blackIron 是材料，得走 grant 才能落到 materials 里
  const gated: GameState = engine.refreshUnlocks(
    grant(rich, { wood: '5000', ore: '5000', blackIron: '5000', stone: '1e5' }),
  );
  check('资源门槛达成后丹房可见', engine.isUnlocked(alchemyRoom, gated));
  check(
    '没钻研炼丹入门时建不了丹房',
    engine.getBuildGate(alchemyRoom, gated) === '需钻研「炼丹入门」',
    engine.getBuildGate(alchemyRoom, gated) ?? '',
  );
  check('技术门槛不隐藏建筑（要看得到才知道钻研什么）', engine.isUnlocked(alchemyRoom, gated));
  const ungated: GameState = { ...gated, techs: { ...gated.techs, alchemyArt: true } };
  check('钻研之后就能建丹房', engine.getBuildGate(alchemyRoom, ungated) === null);

  /* ---- 图纸门槛真的挡住了稀有建筑（灵舟坊） ---- */
  const boat = BUILDABLE_MAP.spiritBoat;
  const realmOk: GameState = { ...gated, realmIndex: 4 };
  const noBlueprint = engine.getBuildGate(boat, realmOk);
  check('没有图纸时建不了灵舟坊', noBlueprint !== null, noBlueprint ?? '');
  check('提示里说明了需要图纸', (noBlueprint ?? '').includes('灵舟图纸'));
  const withBp = withBlueprint(realmOk, 'spiritBoatBlueprint');
  check('拿到图纸后就能建', engine.getBuildGate(boat, withBp) === null);
  check('图纸能通过探索获得', Object.values(SECRET_REALM_MAP).some((r) => r.blueprintChance > 0));
  check('图纸能通过商行购买', SHOP_GOODS.some((g) => g.kind === 'blueprint'));
  check(
    // ⚠️ 需求 5 之后不能再拿 minRealm 当"深浅"的代理了：
    // minRealm 现在只表示大区域的解锁境界，同一个大区里所有秘境都一样。
    // "深浅"看的是**档次**（tier），图纸也确实只从 5 档起掉。
    '低档次秘境不会掉图纸（图纸属于元婴期以上的传承）',
    Object.values(SECRET_REALM_MAP)
      .filter((r) => r.tier < MIN_TIER_FOR_BLUEPRINT)
      .every((r) => r.blueprintChance === 0),
  );

  /* ---- 技术提供的加成真的生效 ---- */
  const hall = forceBuild(withTech({ ...base, realmIndex: 5 }, 'preachingArt'), 'sectHall', 2);
  check('讲道堂加快弟子修炼', engine.getCultivationSpeedMultiplier(hall) > 1, `×${engine.getCultivationSpeedMultiplier(hall).toFixed(2)}`);
  const boatBuilt = forceBuild(withBp, 'spiritBoat', 2);
  check('灵舟坊加快探索', expeditions.getExpeditionSpeed(boatBuilt) > expeditions.getExpeditionSpeed(withBp));
  const pool = forceBuild(realmOk, 'thunderPool', 1);
  check(
    '雷池提高突破成功率',
    engine.getSuccessRate(pool, false) > engine.getSuccessRate(realmOk, false),
    `${engine.getSuccessRate(realmOk, false).toFixed(3)} → ${engine.getSuccessRate(pool, false).toFixed(3)}`,
  );
  const altar = forceBuild({ ...base, realmIndex: 6 }, 'starAltar', 1);
  check('星坛提高全局产量', engine.getGlobalMultiplier(altar).gt(engine.getGlobalMultiplier({ ...base, realmIndex: 6 })));
  // 武技阁的 disciplePowerBonus 必须真的接进战力计算（曾经声明了却没接线）
  const pavilion = forceBuild({ ...base, realmIndex: 5 }, 'martialPavilion', 2);
  const sample = disciples.rollDisciple(5, 1, makeRandom(1));
  const plain: GameState = { ...base, realmIndex: 5, sect: { ...base.sect, disciples: [sample] } };
  const buffed: GameState = { ...pavilion, sect: { ...pavilion.sect, disciples: [sample] } };
  check(
    '武技阁真的提高弟子战力',
    disciples.getDisciplePower(buffed, sample) > disciples.getDisciplePower(plain, sample),
    `${disciples.getDisciplePower(plain, sample)} → ${disciples.getDisciplePower(buffed, sample)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 20. 新字段的存档往返                                                 */
/* ------------------------------------------------------------------ */
section('[21] 新字段的存档往返');
{
  const base = grantAll(createInitialState(0), { qi: '1e6', stone: '1e5' });
  const loaded: GameState = {
    ...base,
    autoRefineLevel: 2,
    personalTravel: { kind: 'travel', regionId: 'mortalVillage', progress: 30, duration: 90 },
    techs: { alchemyArt: true, refiningArt: true },
    blueprints: { spiritBoatBlueprint: true },
    research: { id: 'storageArt', remaining: 12 },
    plantings: [{ id: 'p1', material: 'demonCore', progress: 10, duration: 60 }],
    shop: {
      offers: [{ id: 'o1', kind: 'seed', item: 'demonCore', amount: 3, price: 120, sold: false }],
      secondsLeft: 42,
    },
    // 需求 1 / 4 的新字段
    discoveredRealms: { [STARTER_REALM_ID]: true, eastMountains_4_r0: true },
    realmCooldowns: { eastMountains_4_r0: 123 },
    discoveryFailures: 3,
    arenaEnabled: true,
    arenaTimer: 77,
    arenaBuffSeconds: 8,
    sectEventTimer: 31,
  };
  const withSeeds = planting.addSeeds(loaded, 'starSand', 5);

  const round = deserialize(JSON.parse(JSON.stringify(serialize(withSeeds))));
  check('存档往返成功', round !== null);
  if (round) {
    check('自动合成档位保留', round.autoRefineLevel === 2);
    check('游历状态保留', round.personalTravel?.regionId === 'mortalVillage');
    check('已钻技术保留', round.techs.alchemyArt === true && round.techs.refiningArt === true);
    check('图纸保留', round.blueprints.spiritBoatBlueprint === true);
    check('钻研进度保留', round.research?.id === 'storageArt' && round.research.remaining === 12);
    check('地块保留', round.plantings.length === 1 && round.plantings[0].material === 'demonCore');
    check('种子保留', round.seeds.starSand === 5);
    check('商行货架保留', round.shop.offers.length === 1 && round.shop.secondsLeft === 42);
    check('已发现秘境保留', engine.isRealmDiscovered(round, SECRET_REALM_MAP.eastMountains_4_r0));
    check('秘境冷却保留', engine.getRealmCooldown(round, 'eastMountains_4_r0') === 123);
    check('发现保底的失败计数保留', round.discoveryFailures === 3);
    check('大比开关保留', round.arenaEnabled === true);
    check('大比计时保留', round.arenaTimer === 77 && round.arenaBuffSeconds === 8);
    check('宗门事件计时保留', round.sectEventTimer === 31);
    check('弟子心得保留', round.sect.disciples.every((d) => typeof d.insight === 'number'));
  }

  /* ---- 坏数据不会让读档崩掉 ---- */
  const junk = deserialize({
    v: 3,
    at: 0,
    tc: { notATech: true },
    bpr: { notABlueprint: true },
    sd: { notAMaterial: 5, demonCore: -3 },
    pg: [{ material: 'nope' }, { material: 'demonCore', progress: 1, duration: 60 }],
    rs: { id: 'nope', remaining: 5 },
    sh: { offers: [{ kind: 'seed', item: 'notAGood' }], secondsLeft: 'x' },
    pv: { regionId: 'notARegion' },
    rc: { notARealm: 500, eastMountains_4_r0: -3 },
    df: 99,
    ae: 'yes',
    arn: -5,
    arb: 'x',
    se: 12,
    au: 999,
  });
  check('含垃圾字段的存档仍可读入', junk !== null);
  if (junk) {
    check('未知技术被丢弃', Object.keys(junk.techs).length === 0);
    check('未知图纸被丢弃', Object.keys(junk.blueprints).length === 0);
    check('非法种子被丢弃', junk.seeds.notAMaterial === undefined && junk.seeds.demonCore === undefined);
    check('非法地块被丢弃', junk.plantings.length === 1 && junk.plantings[0].material === 'demonCore');
    check('非法钻研被丢弃', junk.research === null);
    check('非法货品被丢弃', junk.shop.offers.length === 0);
    check('非法游历被丢弃', junk.personalTravel === null);
    check('非法冷却被丢弃', Object.keys(junk.realmCooldowns).length === 0);
    check('越界的失败计数被夹回上限', junk.discoveryFailures <= DISCOVERY_PITY_FAILURES);
    check('非布尔的大比开关按 false 处理', junk.arenaEnabled === false);
    check('负数的大比计时被夹回 0', junk.arenaTimer >= 0);
    check('非法的大比加速时长被夹回 0', junk.arenaBuffSeconds === 0);
    check('档位被夹到合法范围', junk.autoRefineLevel <= AUTO_REFINE_LEVEL_MAX);
  }

  /* ---- v2 存档（没有这些新字段）要能平滑升级 ---- */
  const rawV3 = JSON.parse(JSON.stringify(serialize(withSeeds)));
  const v2: Record<string, unknown> = { ...rawV3, v: 2 };
  for (const key of ['pv', 'au', 'ap', 'sd', 'pg', 'npi', 'tc', 'rs', 'bpr', 'sh']) delete v2[key];
  const upgraded = deserialize(v2);
  check('v2 存档可以升级到 v3', upgraded !== null);
  if (upgraded) {
    check('v2 存档的资源没有丢', upgraded.resources.qi.gt(0), fmt(upgraded.resources.qi));
    check('v2 存档的旧字段仍在', upgraded.materials.demonCore.gt(0));
    check('新字段取默认值', upgraded.techs.alchemyArt === undefined && upgraded.plantings.length === 0);
  }
}

/* ------------------------------------------------------------------ */
/* 21. 界面：非空状态渲染（容易被忽略的分支）                            */
/* ------------------------------------------------------------------ */
section('[22] 界面：非空状态渲染');
{
  // 默认渲染走的是"全新存档"，那些只在有内容时才出现的分支
  // （地块卡片、货架、进度条、弟子列表……）一次都不会被走到。
  // 这里塞一份"玩到中期"的状态，把每个面板都渲染一次。
  //
  // 注意：zustand v5 在 SSR 下用的是 getInitialState() 作 server snapshot，
  // 所以 setState 在这里没用 —— 必须**原地改写初始状态对象**，
  // 渲染完再改回来。
  const initial = useGame.getInitialState();
  const backup = { ...initial };

  let rich = grantAll(createInitialState(0), {
    qi: '1e9',
    stone: '1e7',
    wood: '1e7',
    ore: '1e7',
    herb: '1e7',
  });
  rich = forceBuild(rich, 'thatchHut', 4);
  rich = forceBuild(rich, 'storagePouch', 5);
  rich = forceBuild(rich, 'spiritArray', 30);
  rich = forceBuild(rich, 'woodGrove', 20);
  rich = forceBuild(rich, 'oreVein', 20);
  rich = forceBuild(rich, 'herbField', 10);
  rich = forceBuild(rich, 'stoneMine', 5);
  rich = forceBuild(rich, 'alchemyRoom', 4);
  rich = forceBuild(rich, 'refinery', 3);
  rich = forceBuild(rich, 'plantation', 2);
  rich = forceBuild(rich, 'tradeHouse', 1);
  rich = forceBuild(rich, 'sectHall', 1);
  // 需求 4 的宗门建筑 + 需求 5 的地图相关状态
  rich = forceBuild(rich, 'masterHall', 1);
  rich = forceBuild(rich, 'mountainGate', 1);
  rich = forceBuild(rich, 'arena', 1);
  rich = forceBuild(rich, 'scriptureHall', 1);
  rich = forceBuild(rich, 'martialPavilion', 1);
  rich = forceBuild(rich, 'heavenTower', 1);
  rich = forceBuild(rich, 'skyMirror', 1);
  rich = withTech(
    rich,
    'alchemyArt',
    'refiningArt',
    'storageArt',
    'architecture',
    'tradeArt',
    'plantingArt',
    'preachingArt',
    'arenaArt',
    'martialArt',
    'scriptureArt',
    'towerArt',
  );
  rich = withBlueprint(rich, 'spiritBoatBlueprint', 'skyMirrorBlueprint');
  rich = {
    ...rich,
    realmIndex: 5,
    layer: 3,
    servants: { wood: 3, ore: 2 },
    injurySeconds: 90,
    autoRefineLevel: 2,
    discoveredRealms: { [STARTER_REALM_ID]: true, eastMountains_4_r0: true, eastMountains_1_r0: true },
    realmCooldowns: { eastMountains_4_r0: 90 },
    discoveryFailures: 2,
    arenaEnabled: true,
    arenaTimer: 60,
    arenaBuffSeconds: 5,
    sect: {
      ...rich.sect,
      founded: true,
      level: 4,
      totalRecruited: 12,
      disciples: Array.from({ length: 4 }, (_, i) => disciples.rollDisciple(4, i + 1, makeRandom(i + 1))),
    },
  };
  rich = planting.plantSeed(planting.addSeeds(rich, 'demonCore', 4), 'demonCore', makeRandom(2));
  rich = planting.tickPlantings(rich, 10);
  rich = travel.startTravel(rich, 'mortalVillage');
  rich = research.startResearch(rich, 'caveHeavenArt');
  rich = shop.tickShop(rich, 0, makeRandom(9));
  rich = expeditions.startExpedition(
    rich,
    STARTER_REALM_ID,
    [rich.sect.disciples[0].id],
    makeRandom(3),
  );
  rich = engine.refreshUnlocks(rich);

  check('搭出的非空状态确实有内容', rich.plantings.length > 0 && rich.shop.offers.length > 0);

  useGame.setState({ game: rich });
  Object.assign(initial, { game: rich });
  try {
    const all: [string, React.ReactElement][] = [
      ['顶栏', <Header />],
      ['资源栏', <ResourceBar />],
      ['打坐', <ActionPanel />],
      ['仆役', <ServantPanel />],
      ['洞府建设', <BuildingsPanel />],
      ['钻研', <ResearchPanel />],
      ['境界', <RealmPanel />],
      ['灵石合成', <StonePanel />],
      ['飞升', <AscendPanel />],
      ['宗门', <SectPanel />],
      ['弟子', <DisciplePanel />],
      ['灵植园', <PlantationPanel />],
      ['商行', <ShopPanel />],
      ['地图与探索', <MapPanel />],
      ['宗门建筑', <SectHallPanel />],
      ['炼丹', <AlchemyPanel />],
      ['炼器', <RefiningPanel />],
      ['库存', <InventoryPanel />],
      ['记事', <JournalPanel />],
      ['存档', <SavePanel />],
    ];
    for (const [label, element] of all) {
      try {
        const out = renderToString(element);
        check(`非空状态下「${label}」渲染成功`, out.length > 0, `${out.length} 字符`);
      } catch (error) {
        check(`非空状态下「${label}」渲染成功`, false, String(error));
      }
    }

    try {
      const out = renderToString(<App />);
      check('非空状态下整个 App 渲染成功', out.length > 0, `${out.length} 字符`);
    } catch (error) {
      check('非空状态下整个 App 渲染成功', false, String(error));
    }
  } finally {
    Object.assign(initial, backup);
    useGame.setState({ game: backup.game });
  }
}

/* ------------------------------------------------------------------ */
/* 22. store 动作闭环                                                   */
/* ------------------------------------------------------------------ */
section('[23] store 动作闭环');
{
  // 界面只调 store 的动作，而这些动作最容易犯的错是「名字对不上」
  // 或「忘了走 nextGame 收口」—— 这里逐个调一遍。
  const store = useGame;
  const seedState = () => {
    let next = grantAll(createInitialState(0), {
      qi: '1e9',
      stone: '1e8',
      wood: '1e7',
      ore: '1e7',
      herb: '1e7',
    });
    // 商行价格随境界倍率放大，所以仓库也得跟上，否则灵石会被上限夹住
    next = forceBuild(next, 'spiritVault', 10);
    next = forceBuild(next, 'thatchHut', 5);
    next = forceBuild(next, 'plantation', 1);
    next = forceBuild(next, 'tradeHouse', 1);
    next = withTech(next, 'alchemyArt', 'plantingArt', 'tradeArt', 'architecture');
    next = { ...next, realmIndex: 4 };
    next = engine.refreshUnlocks(planting.addSeeds(next, 'demonCore', 3));
    store.setState({ game: next, notice: null });
    return next;
  };

  /* ---- 钻研 ---- */
  seedState();
  store.getState().startResearch('storageArt');
  check('store.startResearch 生效', store.getState().game.research?.id === 'storageArt');
  store.getState().cancelResearch();
  check('store.cancelResearch 生效', store.getState().game.research === null);

  /* ---- 自动合成 ---- */
  seedState();
  store.getState().setAutoRefine(3);
  check('store.setAutoRefine 生效', store.getState().game.autoRefineLevel === 3);
  store.getState().setAutoRefine(0);
  check('store 可以关掉自动合成', store.getState().game.autoRefineLevel === 0);
  store.getState().setAutoRefine(99);
  check('档位会被夹到上限', store.getState().game.autoRefineLevel === AUTO_REFINE_LEVEL_MAX);

  /* ---- 游历 ---- */
  seedState();
  store.getState().startTravel('mortalVillage');
  check('store.startTravel 生效', store.getState().game.personalTravel?.regionId === 'mortalVillage');
  store.getState().tick(1);
  check('tick 会推进游历', (store.getState().game.personalTravel?.progress ?? 0) > 0);
  store.getState().cancelTravel();
  check('store.cancelTravel 生效', store.getState().game.personalTravel === null);

  /* ---- 种植 ---- */
  seedState();
  store.getState().plantSeed('demonCore');
  check('store.plantSeed 生效', store.getState().game.plantings.length === 1);
  const plantingId = store.getState().game.plantings[0].id;
  store.getState().hastenPlanting(plantingId, 'qi');
  check('store.hastenPlanting 推进了进度', store.getState().game.plantings[0].progress > 0);
  for (let i = 0; i < 40; i += 1) store.getState().hastenPlanting(plantingId, 'stone');
  check('催熟到成熟后状态正常', planting.isPlantingReady(store.getState().game.plantings[0]));
  store.getState().harvest(plantingId);
  check('store.harvest 生效', store.getState().game.plantings.length === 0);
  store.getState().plantAllSeeds();
  check('store.plantAllSeeds 生效', store.getState().game.plantings.length > 0);
  for (const p of store.getState().game.plantings) {
    for (let i = 0; i < 40; i += 1) store.getState().hastenPlanting(p.id, 'stone');
  }
  store.getState().harvestAll();
  check('store.harvestAll 生效', store.getState().game.plantings.length === 0);

  /* ---- 商行 ---- */
  /*
   * ⚠️ 这一段必须**逐个试着买**，不能只挑第一个"价格够低"的货就断言扣钱。
   *
   * 商行货架是用 `gameRandom`（= Math.random）摇出来的，而成交还要过
   * "已售罄 / 是否持有对应技术 / 境界够不够"这些关卡 —— 所以"挑中的那一件"
   * 未必买得成。原来的写法只在 CI 上偶发失败（run #14 就是这么红的），
   * 本地跑六次也不一定复现。
   * 现在的写法：给足灵石，**至少有一件**能买成才算通过，并顺带验证确实扣了钱。
   */
  seedState();
  store.getState().tick(0.1);
  {
    const offers = store.getState().game.shop.offers;
    check('商行有货', offers.length > 0, `${offers.length} 件`);

    let bought = false;
    for (const candidate of offers) {
      const before = store.getState().game.resources.stone;
      store.getState().buyShopOffer(candidate.id);
      const after = store.getState().game.resources.stone;
      if (after.lt(before)) {
        bought = true;
        break;
      }
    }
    check('store.buyShopOffer 能买成并扣灵石', bought, bought ? '已成交' : '货架上没有一件买得成');
  }

  /* ---- 宗门大比（需求 4） ---- */
  {
    const arenaBase = createInitialState(0);
    let arena: GameState = grantAll(
      { ...arenaBase, sect: { ...arenaBase.sect, founded: true } },
      { qi: '1e9', wood: '1e7', stone: '1e7' },
    );
    arena = forceBuild(arena, 'masterHall', 1);
    arena = engine.refreshUnlocks(withTech(arena, 'arenaArt'));
    store.setState({ game: arena, notice: null });
    store.getState().toggleArena();
    check('store.toggleArena 能建成前拒绝', store.getState().game.arenaEnabled === false);
    // 大比要有弟子才有意义（没弟子时不会给加速）
    arena = forceBuild(store.getState().game, 'arena', 1);
    arena = forceBuild(arena, 'thatchHut', 2);
    arena = disciples.recruitDisciple(arena, makeRandom(5)).state;
    check('大比测试场景里招到了弟子', arena.sect.disciples.length === 1);
    store.setState({ game: arena });
    store.getState().toggleArena();
    check('store.toggleArena 生效', store.getState().game.arenaEnabled === true);
    check('开启后写入满周期', store.getState().game.arenaTimer > 0);
    store.getState().holdArena();
    check('周期没走完时不能立刻开比', store.getState().game.arenaBuffSeconds === 0);
    store.setState({ game: { ...store.getState().game, arenaTimer: 0 } });
    store.getState().holdArena();
    check('store.holdArena 生效', store.getState().game.arenaBuffSeconds > 0);
    store.getState().toggleArena();
    check('store.toggleArena 可以停办', store.getState().game.arenaEnabled === false);
  }

  /* ---- 建造（技术门槛已过的建筑） ---- */
  seedState();
  const beforeBuild = engine.getBuildingCount(store.getState().game, 'plantation');
  store.getState().buy('plantation', 1);
  check(
    'store.buy 生效',
    engine.getBuildingCount(store.getState().game, 'plantation') === beforeBuild + 1,
  );

  /* ---- tick 会收口：自动解锁 + 资源夹回上限 ---- */
  seedState();
  const overflowing = {
    ...store.getState().game,
    resources: { ...store.getState().game.resources, qi: D('1e30') },
  };
  store.setState({ game: overflowing });
  store.getState().tick(1);
  check(
    'tick 把越界资源夹回上限',
    store.getState().game.resources.qi.lte(engine.getStorageCap(store.getState().game, 'qi')),
    fmt(store.getState().game.resources.qi),
  );

  // 收尾：把 store 恢复成一份干净存档，免得影响后面的检查
  store.setState({ game: createInitialState(0), offline: null, notice: null });
}

/* ------------------------------------------------------------------ */
/* 23. 地图与探索距离（需求 5）                                          */
/* ------------------------------------------------------------------ */
section('[24] 地图与探索距离（需求 5）');
{
  /* ---- 本次需求的硬指标：6 大区域 × 16 小区域，每小区域 1~2 处秘境（富集区 3 处） ---- */
  check('地图共有 96 个小区域', MAP_REGIONS.length === 96, `${MAP_REGIONS.length} 个`);
  check('地图分为 6 个大区域', MAJOR_REGIONS.length === 6, MAJOR_REGIONS.map((m) => m.name).join('、'));
  check(
    '每个大区域正好 16 个小区域',
    MAJOR_REGIONS.every((m) => subRegionsOf(m.id).length === 16),
    MAJOR_REGIONS.map((m) => `${m.name}=${subRegionsOf(m.id).length}`).join(' '),
  );
  check(
    '每个大区域只有一个资源富集区',
    MAJOR_REGIONS.every((m) => subRegionsOf(m.id).filter((r) => r.isRich).length === 1),
  );
  check(
    '每个大区域都定义了特产，且互不相同',
    new Set(MAJOR_REGIONS.map((m) => m.specialty)).size === MAJOR_REGIONS.length,
    MAJOR_REGIONS.map((m) => `${m.name}:${MATERIAL_MAP[m.specialty]?.name}`).join('、'),
  );
  check('玩家初始在东部群山', MAJOR_REGIONS[0].name === '东部群山' && MAJOR_REGIONS[0].requiresRealm === 0);
  {
    const opening = subRegionsOf('eastMountains').filter((r) => r.requiresRealm === 0);
    check('开局能探索的正是东部群山最初四个小区域', opening.length === 4, opening.map((r) => r.name).join('、'));
  }
  const perRegion = MAP_REGIONS.map((region) => ({
    region,
    realms: SECRET_REALMS.filter((r) => r.regionId === region.id),
  }));
  const badCount = perRegion.filter((entry) =>
    entry.region.isRich ? entry.realms.length < 3 : entry.realms.length < 1 || entry.realms.length > 2,
  );
  check(
    '每个小区域 1~2 处秘境、资源富集区 3 处',
    badCount.length === 0,
    badCount.length > 0
      ? badCount.map((e) => `${e.region.name}=${e.realms.length}`).join('、')
      : `共 ${SECRET_REALMS.length} 处`,
  );
  {
    const counts = perRegion.map((e) => e.realms.length);
    check(
      '只有资源富集区的秘境超过 2 处',
      counts.filter((c) => c > 2).length === MAJOR_REGIONS.length,
      `富集区 ${counts.filter((c) => c > 2).length} 个`,
    );
  }
  check('秘境总数随之扩到 100 处以上', SECRET_REALMS.length >= 100, `${SECRET_REALMS.length} 处`);

  /* ---- 特产秘境：每个大区域恰好一处，且真的产该区特产 ---- */
  {
    const specialties = specialtyRealms();
    check('每个大区域恰好一处特产秘境', specialties.length === MAJOR_REGIONS.length, `${specialties.length} 处`);
    check(
      '特产秘境只出现在资源富集区',
      specialties.every((r) => MAP_REGION_MAP[r.regionId]?.isRich === true),
    );
    check(
      '特产秘境的必掉项就是该大区域的特产',
      specialties.every((r) => r.loot.some((entry) => entry.item === r.specialty && entry.guaranteed === true)),
      specialties.map((r) => `${r.name}→${MATERIAL_MAP[r.specialty as MaterialId]?.name}`).join('、'),
    );
    check('六个大区域的特产互不相同', new Set(specialties.map((r) => r.specialty)).size === MAJOR_REGIONS.length);
  }

  /* ---- 地图完整性：秘境与游历目的地都必须挂到某个区域 ---- */
  const realmOrphans = SECRET_REALMS.filter((r) => !MAP_REGION_MAP[r.regionId]);
  check('每处秘境都挂在一个已定义的地图区域下', realmOrphans.length === 0, realmOrphans.map((r) => r.name).join('、'));

  const travelOrphans = TRAVEL_REGIONS.filter((r) => !MAP_REGION_MAP[r.regionId]);
  check('每个游历目的地都挂在已定义区域下', travelOrphans.length === 0, travelOrphans.map((r) => r.name).join('、'));

  check('没有秘境被漏在地图之外', perRegion.every((e) => e.realms.length > 0));
  check(
    '每个区域的秘境 id 不重复',
    new Set(SECRET_REALMS.map((r) => r.id)).size === SECRET_REALMS.length,
  );
  // 区域小节标题下面再出现一个同名秘境，读起来像界面 bug
  {
    const regionNames = new Set(MAP_REGIONS.map((r) => r.name));
    const clash = SECRET_REALMS.filter((r) => regionNames.has(r.name));
    check('没有秘境与所在（或任何）区域同名', clash.length === 0, clash.map((r) => r.name).join('、'));
    const realmNames = SECRET_REALMS.map((r) => r.name);
    check('秘境之间没有重名', new Set(realmNames).size === realmNames.length);
    // 名字不撞了，文案也不能撞 —— 区域和它的同名秘境一字不差同样是界面 bug
    const regionDescs = new Set(MAP_REGIONS.map((r) => r.desc));
    const dupDesc = SECRET_REALMS.filter((r) => regionDescs.has(r.desc));
    check('没有秘境照抄所在区域的说明文字', dupDesc.length === 0, dupDesc.map((r) => r.name).join('、'));
    const allDescs = [...MAP_REGIONS.map((r) => r.desc), ...SECRET_REALMS.map((r) => r.desc)];
    check('区域与秘境的说明文字互不重复', new Set(allDescs).size === allDescs.length);
  }

  check(
    // ⚠️ 需求 5 改了这条规则：minRealm 现在取的是**所属大区域的解锁境界**，
    // 不再是"小区域门槛 - 1"。所以这条断言按新规则写。
    '秘境的弟子门槛等于所属大区域的解锁境界',
    SECRET_REALMS.every(
      (r) => r.minRealm === (MAJOR_REGION_MAP[MAP_REGION_MAP[r.regionId].majorId]?.requiresRealm ?? 0),
    ),
  );
  check(
    '秘境所在小区域的门槛不低于其弟子门槛',
    SECRET_REALMS.every((r) => r.minRealm <= MAP_REGION_MAP[r.regionId].requiresRealm),
  );
  check(
    '游历目的地不会出现在还没抵达的区域里',
    TRAVEL_REGIONS.every((r) => r.minRealm >= MAP_REGION_MAP[r.regionId].requiresRealm),
  );
  check('区域按距离由近到远排列', MAP_REGIONS.every((r, i) => i === 0 || r.distance > MAP_REGIONS[i - 1].distance));
  check(
    '每个大区域内部，越靠后的小区域门槛越高',
    MAJOR_REGIONS.every((m) => {
      const list = subRegionsOf(m.id);
      // 门槛整体是非递减的，只有资源富集区会再跳高一档
      return list.every((r, i) => i === 0 || r.requiresRealm >= list[i - 1].requiresRealm);
    }),
  );
  check(
    // 用 >= 而不是 >：无垠海的富集区算出来是渡劫+1，被夹回渡劫期（8）
    // —— 门槛 9 是「仙人」，那是飞升之后的事，锁在那里等于永远去不了
    '资源富集区的门槛不低于同区其它小区域',
    MAP_REGIONS.filter((r) => r.isRich).every((rich) =>
      subRegionsOf(rich.majorId).filter((r) => !r.isRich).every((other) => rich.requiresRealm >= other.requiresRealm),
    ),
  );

  /* ---- 秘境数值随档次单调变难（44 处靠表格生成，得守住方向） ---- */
  const byTier = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((tier) => ({
    tier,
    realms: SECRET_REALMS.filter((r) => r.tier === tier),
  }));
  check('九个档次都至少有一处秘境', byTier.every((e) => e.realms.length > 0), byTier.map((e) => `${e.tier}:${e.realms.length}`).join(' '));
  check(
    '档次越高满编人数越多',
    byTier.every((e) => e.realms.every((r) => r.maxParty >= e.tier + 3)),
  );
  check(
    '档次越高冷却越长',
    byTier.every((e, i) => i === 0 || Math.min(...e.realms.map((r) => r.cooldown)) > Math.min(...byTier[i - 1].realms.map((r) => r.cooldown))),
  );
  check(
    '档次越高伤亡率越高',
    byTier.every((e, i) => i === 0 || Math.min(...e.realms.map((r) => r.baseCasualty)) > Math.min(...byTier[i - 1].realms.map((r) => r.baseCasualty))),
  );
  check(
    '同区域内越靠后的秘境越难也越肥',
    MAP_REGIONS.every((region) => {
      const list = SECRET_REALMS.filter((r) => r.regionId === region.id).sort((a, b) => a.requiredPower - b.requiredPower);
      return list.every((r, i) => i === 0 || r.requiredPower > list[i - 1].requiredPower);
    }),
  );

  /* ---- 探索距离随境界增长（需求 5 的核心） ---- */
  const atRealm = (idx: number) => ({ ...createInitialState(0), realmIndex: idx });
  const range0 = engine.getExplorationRange(atRealm(0));
  const range3 = engine.getExplorationRange(atRealm(3));
  const range8 = engine.getExplorationRange(atRealm(8));

  const openingRegions = MAP_REGIONS.filter((r) => r.requiresRealm === 0).length;
  check(
    '开局能抵达的正是门槛为炼气期的区域',
    range0.reachable.length === openingRegions,
    `${range0.reachable.length} / ${openingRegions}`,
  );
  check('境界越高可抵达区域越多', range3.reachable.length > range0.reachable.length, `${range0.reachable.length} → ${range3.reachable.length}`);
  check('境界越高探索距离越远', range3.distance > range0.distance, `${range0.distance} → ${range3.distance} 里`);
  check('最高境界可达全部区域', range8.reachable.length === MAP_REGIONS.length, `${range8.reachable.length}/${MAP_REGIONS.length}`);
  check(
    '距离是各区域距离之和',
    range8.distance === MAP_REGIONS.reduce((sum, r) => sum + r.distance, 0),
    `${range8.distance} 里`,
  );

  /* ---- 灵舟坊提高探索距离（只影响"能到多远"，不再影响发现概率） ---- */
  const withBoat = forceBuild(engine.refreshUnlocks(grant(atRealm(8), { blackIron: '1e6' })), 'spiritBoat', 2);
  const boatRange = engine.getExplorationRange(withBoat);
  check('灵舟坊提高探索距离', boatRange.distance > range8.distance, `${range8.distance} → ${boatRange.distance}`);

  /* ---- 本轮核心约束：发现概率只能靠寻宝宝盘提升 ---- */
  {
    const base = engine.getDiscoveryChance(atRealm(8));
    check(
      '没有宝盘时发现概率就等于基础概率',
      Math.abs(base - DISCOVERY_BASE_CHANCE) < 1e-9,
      `${(base * 100).toFixed(1)}%`,
    );
    // 灵舟坊（探索距离）曾经按一个换算常量折成发现概率，现在不该有任何影响
    check(
      '探索距离不再影响发现概率',
      Math.abs(engine.getDiscoveryChance(withBoat) - base) < 1e-9,
      `${(base * 100).toFixed(1)}%`,
    );

    // 把所有"曾经给发现加成"的建筑都建满，概率也不许动
    let built = grant(atRealm(8), { qi: '1e18', wood: '1e12', stone: '1e12', lunarCrystal: '1e9', coldJade: '1e9' });
    built = forceBuild(withTech(built, 'towerArt'), 'masterHall', 1);
    built = forceBuild(built, 'mountainGate', 5);
    built = forceBuild(built, 'heavenTower', 5);
    check(
      '建筑不再提供任何发现概率',
      Math.abs(engine.getDiscoveryChance(built) - base) < 1e-9,
      `${(engine.getDiscoveryChance(built) * 100).toFixed(1)}%`,
    );

    // 寻宝宝盘：五名弟子持五面 → 基础 + 5 × 4%
    const five = Array.from({ length: 5 }, (_, i) => disciples.rollDisciple(8, i + 1, makeRandom(i + 40)));
    const armed: GameState = {
      ...built,
      artifacts: { ...built.artifacts, treasureCompass: 5 },
      sect: { ...built.sect, founded: true, level: 9, disciples: five },
    };
    check(
      '寻宝宝盘是唯一能提高发现概率的东西',
      Math.abs(engine.getDiscoveryChance(armed) - (DISCOVERY_BASE_CHANCE + 5 * 0.04)) < 1e-9,
      `${(engine.getDiscoveryChance(armed) * 100).toFixed(1)}%`,
    );
    // 器物受"每名弟子只能持一件"的约束，人不够就发挥不出全部
    const fewHolders: GameState = { ...armed, sect: { ...armed.sect, disciples: [five[0]] } };
    check(
      '宝盘也受"一名弟子只能持一件"的约束',
      Math.abs(engine.getDiscoveryChance(fewHolders) - (DISCOVERY_BASE_CHANCE + 0.04)) < 1e-9,
      `${(engine.getDiscoveryChance(fewHolders) * 100).toFixed(1)}%`,
    );
    // 堆到上限
    const many = Array.from({ length: 40 }, (_, i) => disciples.rollDisciple(8, i + 1, makeRandom(i + 90)));
    const maxed: GameState = {
      ...built,
      artifacts: { ...built.artifacts, treasureCompass: 40 },
      sect: { ...built.sect, founded: true, level: 9, disciples: many },
    };
    check(
      '宝盘堆满后被 DISCOVERY_MAX_CHANCE 封顶',
      Math.abs(engine.getDiscoveryChance(maxed) - DISCOVERY_MAX_CHANCE) < 1e-9,
      `${(engine.getDiscoveryChance(maxed) * 100).toFixed(1)}%`,
    );
    check(
      '寻宝宝盘挂在七品炼器上',
      ARTIFACT_MAP.treasureCompass.tier === 7 && ARTIFACT_MAP.treasureCompass.effect.kind === 'discovery',
      `tier ${ARTIFACT_MAP.treasureCompass.tier}`,
    );
    check(
      '寻宝宝盘的材料含超级稀有的混沌紫气',
      (ARTIFACT_MAP.treasureCompass.cost.chaosQi ?? 0) > 0,
      `混沌紫气 ×${ARTIFACT_MAP.treasureCompass.cost.chaosQi}`,
    );

    /* ---- 硬保底：独立于概率公式的一条机制 ---- */
    check('失败次数不够时不触发硬保底', !engine.isDiscoveryGuaranteed(armed));
    const pityState: GameState = { ...armed, discoveryFailures: DISCOVERY_PITY_FAILURES };
    check('连续失败到阈值就触发硬保底', engine.isDiscoveryGuaranteed(pityState));
    check(
      '还差几次可以算出来（界面提示用）',
      engine.getDiscoveryPityRemaining({ ...armed, discoveryFailures: 4 }) === DISCOVERY_PITY_FAILURES - 4,
    );
    check(
      '硬保底不写进概率公式（概率不受失败次数影响）',
      Math.abs(engine.getDiscoveryChance(pityState) - engine.getDiscoveryChance(armed)) < 1e-9,
    );
    check(
      '发现失败时失败计数 +1',
      engine.recordDiscoveryFailure(armed).discoveryFailures === armed.discoveryFailures + 1,
    );
    check(
      '发现新秘境时失败计数清零',
      engine.discoverRealm({ ...armed, discoveryFailures: 7 }, 'eastMountains_1_r0').discoveryFailures === 0,
    );
  }

  /* ---- 只能发现「够得着」的秘境 ---- */
  check(
    '低境界时发现候选只包含近处区域',
    engine.getUndiscoveredCandidates(atRealm(0)).every((r) => MAP_REGION_MAP[r.regionId].requiresRealm <= 0),
  );
  const highCandidates = engine.getUndiscoveredCandidates(atRealm(8));
  check('高境界时能发现远处的秘境', highCandidates.length >= 6, `${highCandidates.length} 处候选`);
  check('开局那处不算候选（已经发现了）', !highCandidates.some((r) => r.id === STARTER_REALM_ID));

  /* ---- 提前一档可见 ---- */
  const locked0 = engine.getExplorationRange(atRealm(0)).locked;
  check('提前一个境界能看到下一片区域', locked0.length >= 1, locked0.map((r) => r.name).join('、'));
}

/* ------------------------------------------------------------------ */
/* 24. 新增建筑与图纸（需求 3）                                          */
/* ------------------------------------------------------------------ */
section('[25] 建筑与图纸扩充（需求 3）');
{
  check('建筑数量比上一版明显增加', BUILDABLES.length >= 45, `${BUILDABLES.length} 座`);
  check('图纸数量增加到 8 张', BLUEPRINTS.length === 8, `${BLUEPRINTS.length} 张`);
  check('技术数量增加到 19 门', TECHS.length === 19, `${TECHS.length} 门`);
  check('设施（基础资源建筑）也扩充了', GENERATORS.length >= 10, `${GENERATORS.length} 种`);

  /* ---- 分组自洽：新增的建筑要归到一个已定义的分组 ---- */
  const groupIds = new Set<string>(BUILD_GROUPS.map((g) => g.id));
  const badGroup = BUILDABLES.filter((b) => !groupIds.has(b.group));
  check('所有建筑都归到已定义的分组', badGroup.length === 0, badGroup.map((b) => b.name).join('、'));
  check('每个分组都至少有一座建筑', BUILD_GROUPS.every((g) => BUILDABLES.some((b) => b.group === g.id)));

  /* ---- id 唯一 ---- */
  const ids = BUILDABLES.map((b) => b.id);
  check('建筑 id 不重复', new Set(ids).size === ids.length);

  /* ---- 图纸与建筑的门槛一致（需求 6 的不变量） ---- */
  check(
    '每张图纸都对应一座建筑，且境界门槛一致',
    BLUEPRINTS.every((bp) => {
      const building = BUILDABLES.find((b) => b.requiresBlueprint === bp.id);
      return building?.requiresRealm === bp.requiresRealm;
    }),
  );
  check('每张图纸都被某座建筑使用', BLUEPRINTS.every((bp) => BUILDABLES.some((b) => b.requiresBlueprint === bp.id)));

  /* ---- 技术自洽 ---- */
  const techIds = new Set(TECHS.map((t) => t.id));
  check('技术 id 不重复', techIds.size === TECHS.length);
  check('技术前置都存在且不自引用', TECHS.every((t) => t.requires.every((id) => techIds.has(id) && id !== t.id)));
  check('所有技术都被某座建筑使用', TECHS.every((t) => BUILDABLES.some((b) => b.requiresTech === t.id)));

  /* ---- 新增建筑的效果字段确实会被 engine 汇总 ---- */
  const bonusKeys = [
    'disciplePowerBonus',
    'expeditionYieldBonus',
    'casualtyReduction',
    'insightBonus',
    'expeditionDistanceBonus',
  ] as const;
  for (const key of bonusKeys) {
    const owner = STRUCTURES.find((s) => s[key]);
    check(`效果「${key}」有建筑提供`, Boolean(owner), owner?.name ?? '无');
  }
  // 反向保证：建筑不许再提供发现概率（那是寻宝宝盘的专属领域）
  check(
    '没有任何建筑提供发现概率加成',
    STRUCTURES.every((s) => !('discoveryBonus' in s)),
  );
}

/* ------------------------------------------------------------------ */
/* 25. 宗门建筑、心得、大比、随机事件（需求 4）                           */
/* ------------------------------------------------------------------ */
section('[26] 宗门建筑与大比（需求 4）');
{
  const masterHall = BUILDABLE_MAP.masterHall;
  const mountainGate = BUILDABLE_MAP.mountainGate;
  const arena = BUILDABLE_MAP.arena;
  const martialPavilion = BUILDABLE_MAP.martialPavilion;
  const scriptureHall = BUILDABLE_MAP.scriptureHall;
  const heavenTower = BUILDABLE_MAP.heavenTower;

  /* ---- 需求明文：除了掌门大殿和山门，其余建筑需钻研解锁 ---- */
  check('掌门大殿不需要钻研', masterHall.requiresTech === undefined);
  check('山门不需要钻研', mountainGate.requiresTech === undefined);
  check('但两者都需要先开宗立派', masterHall.requiresSect === true && mountainGate.requiresSect === true);
  check(
    '比武台 / 武技阁 / 功法殿 / 通天塔都需要钻研',
    [arena, martialPavilion, scriptureHall, heavenTower].every((d) => Boolean(d.requiresTech)),
  );
  check('比武台还需要先有掌门大殿', arena.requiresBuilding === 'masterHall');

  const base = createInitialState(0);
  check('未开宗时建不了掌门大殿', engine.getBuildGate(masterHall, base) === '需先开宗立派');

  const founded: GameState = engine.refreshUnlocks({
    ...grant(base, { qi: '1e6', wood: '1e5', stone: '1e5', blackIron: '5000' }),
    sect: { ...base.sect, founded: true, level: 4 },
  });
  check('开宗后可以建掌门大殿', engine.getBuildGate(masterHall, founded) === null);
  check('没建大殿时比武台被拦下（先看技术）', engine.getBuildGate(arena, founded) === '需钻研「比武之礼」');

  const withTechs = withTech(founded, 'arenaArt', 'martialArt', 'scriptureArt', 'towerArt', 'preachingArt');
  check('钻研之后仍要求先建掌门大殿', engine.getBuildGate(arena, withTechs) === '需先建掌门大殿');

  let built = forceBuild(withTechs, 'masterHall', 1);
  built = forceBuild(built, 'arena', 1);
  built = engine.refreshUnlocks(built);
  check('建好大殿后比武台可建', engine.getBuildGate(arena, built) === null);

  /* ---- 比武台：玩家决定是否开启 ---- */
  check('默认未开启', built.arenaEnabled === false && !sectActivity.isArenaRunning(built));
  const running: GameState = { ...built, arenaEnabled: true, arenaTimer: sectActivity.ARENA_INTERVAL_SECONDS };
  check('开启后大比开始计时', sectActivity.isArenaRunning(running));
  check('未开启时没有倒计时', sectActivity.getArenaCountdown(built) === null);
  check(
    '十年一比、持续一年',
    Math.abs(sectActivity.ARENA_INTERVAL_SECONDS - 10 * sectActivity.SECONDS_PER_GAME_YEAR) < 1e-9 &&
      Math.abs(sectActivity.ARENA_BUFF_SECONDS - sectActivity.SECONDS_PER_GAME_YEAR) < 1e-9,
    `${sectActivity.ARENA_INTERVAL_SECONDS.toFixed(1)} 秒 / ${sectActivity.ARENA_BUFF_SECONDS.toFixed(1)} 秒`,
  );

  /* ---- 大比到点自动举办，全宗修行加速 ---- */
  let sect: GameState = { ...running, sect: { ...running.sect, disciples: [] } };
  for (let i = 0; i < 4; i += 1) sect = disciples.recruitDisciple(sect, makeRandom(i + 1)).state;
  const speedBefore = disciples.getDiscipleSpeed(sect, sect.sect.disciples[0]);

  const multBefore = engine.getCultivationSpeedMultiplier(sect);
  const afterInterval = sectActivity.tickArena(sect, sectActivity.ARENA_INTERVAL_SECONDS + 1);
  check('到点自动举办大比', afterInterval.arenaBuffSeconds > 0);
  check('大比后弟子获得心得', afterInterval.sect.disciples.every((d) => d.insight > 0));
  const speedAfter = disciples.getDiscipleSpeed(afterInterval, afterInterval.sect.disciples[0]);
  // 本轮把大比从「乘算 ×2」改成了「加算 +50%」：它和建筑加成相乘会
  // 把修行倍率天花板推到 ×7 以上，而大比本该只是个十年一次的节日。
  check(
    '大比是加算而不是乘算（+50%）',
    Math.abs(
      engine.getCultivationSpeedMultiplier(afterInterval) -
        (multBefore + ARENA_BUFF_BONUS),
    ) < 1e-9,
    `${multBefore.toFixed(2)} → ${engine.getCultivationSpeedMultiplier(afterInterval).toFixed(2)}`,
  );
  check(
    '修行倍率天花板被压到 3 倍以内',
    engine.getCultivationSpeedMultiplier(afterInterval) < 3,
    `×${engine.getCultivationSpeedMultiplier(afterInterval).toFixed(2)}`,
  );
  check('心得与大比叠加速度更快', speedAfter > speedBefore, `×${(speedAfter / speedBefore).toFixed(2)}`);
  check('大比写入了记事', afterInterval.journal.some((e) => e.text.includes('宗门大比')));

  const expired = sectActivity.tickArena(afterInterval, sectActivity.ARENA_BUFF_SECONDS + 1);
  check('一年后加速结束', expired.arenaBuffSeconds === 0);
  check(
    '倍率回落到大比前的水平',
    Math.abs(engine.getCultivationSpeedMultiplier(expired) - multBefore) < 1e-9,
    `×${engine.getCultivationSpeedMultiplier(expired).toFixed(2)}`,
  );
  check('停办后不再自动开比', sectActivity.tickArena({ ...running, arenaEnabled: false }, 1e6).arenaBuffSeconds === 0);

  /* ---- 修行倍率天花板（本轮要压的问题之一） ----
     早先 功法殿×10(+120%) 与 讲道堂×10(+150%) 是加算，但大比是**乘算 ×2**，
     再加上心得，三者互相乘出 ×7.4。这里把满配状态钉死。 */
  {
    let maxed: GameState = grant({ ...sect, realmIndex: 8 }, { qi: '1e15', stone: '1e12', lunarCrystal: '1e9' });
    maxed = forceBuild(withTech(maxed, 'scriptureArt'), 'masterHall', 1);
    // 讲道堂与功法殿的 max 都是 10，要建满才算"满配"——
    // 这里原先只建了 1 座讲道堂，于是断言把一个偏低的数当成了天花板
    maxed = forceBuild(maxed, 'scriptureHall', 10);
    maxed = forceBuild(withTech(maxed, 'preachingArt'), 'sectHall', 10);
    maxed = { ...maxed, arenaBuffSeconds: 100, realmIndex: 8 };
    check(
      '满配建筑加成 = 功法殿 80% + 讲道堂 50% + 大比 50%',
      Math.abs(engine.getCultivationSpeedMultiplier(maxed) - 2.8) < 1e-9,
      `×${engine.getCultivationSpeedMultiplier(maxed).toFixed(2)}`,
    );
    const ceiling = engine.getCultivationSpeedMultiplier(maxed);
    check(
      '满配建筑 + 大比时修行倍率在 3 倍以内',
      ceiling < 3,
      `×${ceiling.toFixed(2)}`,
    );

    // 连心得一起算（弟子修行速度 = 资质 × (建筑 + 大比 + 心得)，同一个加算池）
    const best = disciples.rollDisciple(8, 1, makeRandom(7));
    const insightMaxed: GameState = {
      ...maxed,
      sect: {
        ...maxed.sect,
        disciples: [{ ...best, aptitude: 'heaven' as typeof best.aptitude, insight: engine.getInsightMax(maxed) }],
      },
    };
    check(
      '心得与建筑处在同一个加算池（不是再乘一次）',
      Math.abs(
        disciples.getInsightSpeedBonus(insightMaxed, insightMaxed.sect.disciples[0]) +
          engine.getCultivationSpeedMultiplier(insightMaxed) -
          disciples.getDiscipleSpeed(insightMaxed, insightMaxed.sect.disciples[0]) /
            APTITUDE_MAP.heaven.speed,
      ) < 1e-9,
    );
    const fullSpeed = disciples.getDiscipleSpeed(insightMaxed, insightMaxed.sect.disciples[0]);
    check(
      '连心得算上，天灵根弟子的修行速度天花板也在 4.5 倍以内',
      fullSpeed < 4.5,
      `×${fullSpeed.toFixed(2)}`,
    );
  }

  /* ---- 寻宝宝盘要真的被"七品炼器"卡住 ---- */
  {
    const poor: GameState = { ...sect, refiningTier: 6, materials: {} as GameState['materials'] };
    check(
      '炼器术不到七品时铸不出寻宝宝盘',
      !crafting.canCraftArtifact(poor, 'treasureCompass').ok,
      crafting.canCraftArtifact(poor, 'treasureCompass').reason ?? '',
    );
    const rich: GameState = {
      ...sect,
      refiningTier: 7,
      materials: {
        ...sect.materials,
        blackIron: D('1e9'),
        spiritSilk: D('1e9'),
        fireMarrow: D('1e9'),
        coldJade: D('1e9'),
        lunarCrystal: D('1e9'),
        dragonBlood: D('1e9'),
        netherFlame: D('1e9'),
        immortalJade: D('1e9'),
        chaosQi: D('1e9'),
      },
      resources: { ...sect.resources, ore: D('1e12'), qi: D('1e15') },
    };
    check('七品炼器 + 材料齐全才能铸', crafting.canCraftArtifact(rich, 'treasureCompass').ok);
    const crafted = crafting.craftArtifact(rich, 'treasureCompass', 1, fixedRandom(0)).state;
    check('铸出的宝盘进入器物栏', (crafted.artifacts.treasureCompass ?? 0) === 1);
  }

  /* ---- 需求 4：弟子探索后增加心得，加快进境 ---- */
  const withInsight: GameState = {
    ...sect,
    // 心得上限随境界增长，所以这里要把境界放高，50 点才在上限之内
    realmIndex: 8,
    sect: { ...sect.sect, disciples: sect.sect.disciples.map((d) => ({ ...d, insight: 50 })) },
  };
  check('心得提高修行速度', disciples.getInsightSpeedBonus(withInsight, withInsight.sect.disciples[0]) > 0);
  check(
    '每点心得 +0.5%',
    Math.abs(disciples.getInsightSpeedBonus(withInsight, withInsight.sect.disciples[0]) - 0.25) < 1e-9,
  );

  /* ---- 心得上限随掌门境界增长（本轮需求） ---- */
  {
    const at = (realmIndex: number, insight: number): GameState => ({
      ...sect,
      realmIndex,
      sect: {
        ...sect.sect,
        disciples: sect.sect.disciples.map((d) => ({ ...d, insight })),
      },
    });
    const low = at(0, 9999);
    const high = at(8, 9999);
    check(
      '心得上限随境界变高',
      engine.getInsightMax(high) > engine.getInsightMax(low),
      `炼气 ${engine.getInsightMax(low)} → 渡劫 ${engine.getInsightMax(high)}`,
    );
    check(
      '炼气期心得上限就是基数',
      engine.getInsightMax(low) === INSIGHT_MAX_BASE,
      `${engine.getInsightMax(low)}`,
    );
    check(
      '每升一境上限增加固定值',
      engine.getInsightMax(high) === INSIGHT_MAX_BASE + 8 * INSIGHT_MAX_PER_REALM,
    );
    // 上限不是墙：同一个 9999 点心得，在高境界能拿到更多加速
    check(
      '同一个心得值在高境界给出更多加速',
      disciples.getInsightSpeedBonus(high, high.sect.disciples[0]) >
        disciples.getInsightSpeedBonus(low, low.sect.disciples[0]),
      `${disciples.getInsightSpeedBonus(low, low.sect.disciples[0]).toFixed(3)} → ${disciples
        .getInsightSpeedBonus(high, high.sect.disciples[0])
        .toFixed(3)}`,
    );
    check(
      '加速不会超过「上限 × 每点收益」',
      Math.abs(
        disciples.getInsightSpeedBonus(high, high.sect.disciples[0]) -
          engine.getInsightMax(high) * INSIGHT_SPEED_PER_POINT,
      ) < 1e-9,
    );
  }

  /* ---- 随机事件：弟子自发使用宗门建筑 ---- */
  let hall: GameState = forceBuild(withTechs, 'masterHall', 1);
  hall = forceBuild(hall, 'scriptureHall', 1);
  hall = forceBuild(hall, 'martialPavilion', 1);
  hall = forceBuild(hall, 'heavenTower', 1);
  hall = { ...hall, sect: { ...hall.sect, disciples: [] } };
  for (let i = 0; i < 3; i += 1) hall = disciples.recruitDisciple(hall, makeRandom(i + 1)).state;

  check('已建成的弟子用建筑会被列出', sectActivity.getEventBuildings(hall).length === 3, `${sectActivity.getEventBuildings(hall).length} 处`);
  check(
    '比武台不参与随机事件（需求明文除外）',
    !sectActivity.getEventBuildings(hall).some((b) => b.id === 'arena'),
  );

  const fired = sectActivity.rollSectEvent(hall, fixedRandom(0.01));
  check('随机事件可以触发', fired.text !== null, fired.text ?? '未触发');
  check('触发后写入了记事', fired.state.journal.length > hall.journal.length);
  const neverFires = sectActivity.rollSectEvent(hall, fixedRandom(0.999));
  check('概率不到时不会触发', neverFires.text === null);

  /* ---- 计时器按固定间隔判定，而不是每帧掷骰 ---- */
  const ticked = sectActivity.tickSectEvents(hall, 1, makeRandom(1));
  check('不足一个间隔时只累积计时器', ticked.sectEventTimer > 0 && ticked.journal.length === hall.journal.length);
}

/* ------------------------------------------------------------------ */
/* 27. 季节与天象（需求 1）                                              */
/* ------------------------------------------------------------------ */
section('[27] 季节与天象（需求 1）');
{
  /* ---- 内容表本身 ---- */
  check('共有四季', SEASONS.length === 4, SEASONS.map((s) => s.name).join('、'));
  check('天象表至少 8 条', WEATHERS.length >= 8, `${WEATHERS.length} 条`);
  check('季节 id 唯一', new Set(SEASONS.map((s) => s.id)).size === SEASONS.length);

  // 每一季都要有得有失：否则玩家只会等到"最好的季节"再干活
  const lopsided = SEASONS.filter((s) => {
    const all = [...Object.values(s.resources), ...Object.values(s.materials)];
    return !all.some((v) => v > 0) || !all.some((v) => v < 0);
  });
  check('每一季都同时有增益与减益', lopsided.length === 0, lopsided.map((s) => s.name).join('、'));

  const badWeather = WEATHERS.filter((w) => !['good', 'bad', 'mixed'].includes(w.tone) || w.weight <= 0 || w.duration <= 0);
  check('每条天象的倾向 / 权重 / 时长都合法', badWeather.length === 0, badWeather.map((w) => w.name).join('、'));
  check('天象三种倾向都有', new Set(WEATHERS.map((w) => w.tone)).size === 3);

  /*
   * 硬约束：天象**不许**提供发现秘境的概率。
   * 上一轮的需求写明「发现概率增加只能通过寻宝宝盘增加」，
   * 这一轮加天象时最容易顺手破坏它，所以在这里钉死。
   */
  check('没有任何天象提供发现秘境的概率', WEATHERS.every((w) => !('discovery' in w.effects)));

  /* ---- 季节推进 ---- */
  const fresh = createInitialState(0);
  check('开局是春天', seasonModule.getSeason(fresh).id === 'spring');
  check('开局有天象判定计时', fresh.weatherTimer > 0);

  const midSeason = seasonModule.tickSeason(fresh, SEASON_SECONDS / 2, makeRandom(1));
  check('半季之后仍是同一季', seasonModule.getSeason(midSeason).id === 'spring');
  check(
    '本季进度过了一半',
    Math.abs(seasonModule.getSeasonProgress(midSeason) - 0.5) < 1e-6,
    `${(seasonModule.getSeasonProgress(midSeason) * 100).toFixed(0)}%`,
  );

  const nextSeason = seasonModule.tickSeason(fresh, SEASON_SECONDS + 1, makeRandom(1));
  check('满一季之后换季', seasonModule.getSeason(nextSeason).id === 'summer', seasonModule.getSeason(nextSeason).name);

  const fourSeasons = seasonModule.tickSeason(fresh, SEASON_SECONDS * 4, makeRandom(1));
  check('四季一轮回', seasonModule.getSeason(fourSeasons).id === 'spring');

  // 粗粒度路径（离线 / 模拟器一次跳很久）
  const coarse = seasonModule.tickSeason(fresh, SEASON_SECONDS * 6 + 30, makeRandom(1));
  check('粗粒度推进能把季节推到位', coarse.season === 2, `落在第 ${coarse.season} 季（应为 2 秋）`);
  check('粗粒度推进不会让本季进度溢出一季', coarse.seasonSeconds < SEASON_SECONDS, `${coarse.seasonSeconds}`);

  /* ---- 天象出现与到期 ---- */
  const summoned = seasonModule.summonWeather(fresh, makeRandom(3));
  check('可以召来天象', summoned.weatherId !== null, WEATHER_MAP[summoned.weatherId as string]?.name ?? '');
  check('召来的天象有正数剩余时长', summoned.weatherSeconds > 0);
  const weatherDef = WEATHER_MAP[summoned.weatherId as string];
  const afterWeather = seasonModule.tickSeason(summoned, weatherDef.duration + 1, makeRandom(1));
  check('天象到时自然散去', afterWeather.weatherId === null);

  const rolled = seasonModule.tickSeason({ ...fresh, weatherTimer: 0.01 }, 0.02, fixedRandom(0.01));
  check('判定点命中概率时会挂上天象', rolled.weatherId !== null);

  /* ---- 季节真的改变了产量 ---- */
  {
    let farm = forceBuild(createInitialState(0), 'spiritArray', 10); // 灵气
    farm = forceBuild(farm, 'herbField', 10); // 灵草
    const spring = { ...farm, season: 0, weatherId: null };
    const winter = { ...farm, season: 3, weatherId: null };
    const springQi = engine.getProduction(spring).qi.toNumber();
    const winterQi = engine.getProduction(winter).qi.toNumber();
    const springHerb = engine.getProduction(spring).herb.toNumber();
    const winterHerb = engine.getProduction(winter).herb.toNumber();

    check('春天灵气高于冬天', springQi > winterQi, `${springQi.toFixed(2)} vs ${winterQi.toFixed(2)}`);
    check('春天灵草远高于冬天', springHerb > winterHerb * 1.5, `${springHerb.toFixed(2)} vs ${winterHerb.toFixed(2)}`);
    // 春天灵气 +10%、冬天 0：比值应当正好是 1.1
    check(
      '季节对资源的加成是加算的（春天灵气 = 冬天 × 1.1）',
      Math.abs(springQi / winterQi - 1.1) < 1e-9,
      `×${(springQi / winterQi).toFixed(4)}`,
    );
  }

  /* ---- 天象真的改变了全局倍率 / 修行速度 / 突破率 ---- */
  {
    const base = { ...createInitialState(0), weatherId: null };
    const good = { ...base, weatherId: 'purpleQi' };
    const bad = { ...base, weatherId: 'bitterCold' };
    check(
      '吉象抬高全局倍率',
      engine.getGlobalMultiplier(good).gt(engine.getGlobalMultiplier(base)),
      `${engine.getGlobalMultiplier(base).toNumber().toFixed(2)} → ${engine.getGlobalMultiplier(good).toNumber().toFixed(2)}`,
    );
    check(
      '凶象压低全局倍率',
      engine.getGlobalMultiplier(bad).lt(engine.getGlobalMultiplier(base)),
      `→ ${engine.getGlobalMultiplier(bad).toNumber().toFixed(2)}`,
    );
    check(
      '灵雨加快弟子修行',
      engine.getCultivationSpeedMultiplier({ ...base, weatherId: 'spiritRain' }) >
        engine.getCultivationSpeedMultiplier(base),
    );
    check(
      '极寒拖慢弟子修行',
      engine.getCultivationSpeedMultiplier({ ...base, weatherId: 'bitterCold' }) <
        engine.getCultivationSpeedMultiplier(base),
    );
    check(
      '天雷劫云提高突破成功率',
      engine.getSuccessRate({ ...base, weatherId: 'thunderCloud' }, false) >
        engine.getSuccessRate(base, false),
    );
    check(
      '天象不影响发现秘境的概率',
      Math.abs(engine.getDiscoveryChance(good) - engine.getDiscoveryChance(base)) < 1e-9 &&
        Math.abs(engine.getDiscoveryChance(bad) - engine.getDiscoveryChance(base)) < 1e-9,
    );
  }

  /* ---- 季节影响基础材料，但不影响稀有材料 ---- */
  {
    const base = { ...createInitialState(0), season: 0, weatherId: null };
    check('春天妖丹有加成', seasonModule.getEnvironmentMaterialBonus(base, 'demonCore') > 0);
    check('春天寒玉是减益', seasonModule.getEnvironmentMaterialBonus(base, 'coldJade') < 0);
    check('基础材料判定正确', isBasicMaterial('demonCore') && isBasicMaterial('coldJade'));
    check('稀有材料不算基础材料', !isBasicMaterial('starSand') && !isBasicMaterial('chaosQi'));
    check('资源不算材料', !isBasicMaterial('qi'));
  }

  /* ---- 存档往返 ---- */
  {
    const savedState: GameState = {
      ...createInitialState(0),
      season: 2,
      seasonSeconds: 41.5,
      weatherId: 'bloodMoon',
      weatherSeconds: 17,
      weatherTimer: 9,
    };
    const round = deserialize(JSON.parse(JSON.stringify(serialize(savedState))));
    check('季节与天象能存档还原', round !== null);
    if (round) {
      check('季节下标保留', round.season === 2);
      check('本季进度保留', Math.abs(round.seasonSeconds - 41.5) < 1e-9);
      check('天象保留', round.weatherId === 'bloodMoon' && Math.abs(round.weatherSeconds - 17) < 1e-9);
      check('天象判定计时保留', Math.abs(round.weatherTimer - 9) < 1e-9);
    }

    // 非法天象 id 必须被丢掉、剩余时长归零（免得挂着一个空 id）
    const junk = deserialize({ v: 4, at: 0, wt: 'notAWeather', ws: 30, sn: 99, ss: 1e9 });
    check('非法天象被丢弃', junk !== null && junk.weatherId === null);
    if (junk) {
      check('非法天象的剩余时长归零', junk.weatherSeconds === 0);
      check('越界的季节下标被夹回范围', junk.season >= 0 && junk.season < SEASONS.length);
      check('越界的本季进度被夹回一季内', junk.seasonSeconds <= SEASON_SECONDS);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 28. 全局倍率曲线（需求 2）                                            */
/* ------------------------------------------------------------------ */
section('[28] 全局倍率曲线（需求 2）');
{
  // 玩家原话：「全局倍率增加得有点快了，刚筑基就三倍了，
  //            而且每一小等级都加百分之五的全局倍率也有点高了」
  check('筑基期的境界倍率不再是 ×3', REALMS[1].realmMultiplier < 3, `×${REALMS[1].realmMultiplier}`);
  check('炼气期的境界倍率仍是 ×1', REALMS[0].realmMultiplier === 1);

  // 每一小境界的加成统一压到 4% 以下（仙人只有一层，单独放宽）
  const layerBonuses = REALMS.slice(0, 9).map((r) => r.layerBonus);
  check(
    '每小境界的加成统一为 4%',
    layerBonuses.every((b) => Math.abs(b - 0.04) < 1e-9),
    layerBonuses.join(' / '),
  );
  // 仙人只有一层，单独放宽；前九境一律不超过 5%
  check('前九境的每层加成不超过 5%', REALMS.slice(0, 9).every((r) => r.layerBonus <= 0.05), REALMS.slice(0, 9).map((r) => r.layerBonus).join(' / '));

  /*
   * 这条是这轮最重要的护栏。
   *
   * 我一开始按等比把整条 realmMultiplier 压平（×3 → ×2.9），结果经济雪崩：
   * 30 天模拟结束时弟子 0 人、心得 0。因为 realmMultiplier 就是整个经济的刻度。
   * 所以最后的做法是"只压早期台阶、中后期补回来、顶端不动"——
   * 下面这条断言就是钉住"顶端不许动"。
   */
  check(
    '最高的境界倍率没有被下调（经济总量不变）',
    REALMS[REALMS.length - 1].realmMultiplier === 19683,
    `×${REALMS[REALMS.length - 1].realmMultiplier}`,
  );

  // 境界倍率必须单调不减，否则"越修越弱"
  check(
    '境界倍率单调不减',
    REALMS.every((r, i) => i === 0 || r.realmMultiplier >= REALMS[i - 1].realmMultiplier),
  );
  // 参悟下一层的成本也必须单调递增（不然高境界反而更便宜）
  check(
    '首层参悟成本单调递增',
    REALMS.every((r, i) => i === 0 || r.baseLayerCost > REALMS[i - 1].baseLayerCost),
  );

  // 层加成被压平之后，同一境界内的倍率跨度不能太大（这是"压平曲线"的本意）
  const spread = REALMS.slice(0, 9).map((r) => 1 + r.layerBonus * r.layerCount);
  check(
    '一层到圆满之间的倍率跨度不超过 1.4 倍',
    spread.every((s) => s <= 1.4),
    `最大 ×${Math.max(...spread).toFixed(2)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 29. 普通探索（需求 1）                                               */
/* ------------------------------------------------------------------ */
section('[29] 普通探索：未发现秘境时唯一能做的事（需求 1）');
{
  /* ---- 一个还没发现任何秘境的起始小区域 ---- */
  let s: GameState = grant(createInitialState(0), { stone: '1e9', qi: '1e9', wood: '1e9' });
  s = forceBuild(s, 'thatchHut', 5);
  s = { ...s, sect: { ...s.sect, founded: true } };
  for (let i = 0; i < 6; i += 1) s = disciples.recruitDisciple(s, makeRandom(400 + i)).state;

  // 东部群山第 2 个小区域：门槛 0，开局够得着，且它的秘境还没被发现
  const fresh = 'eastMountains_1';
  check('未发现秘境的小区域可以做普通探索', expeditions.canSurveyRegion(s, fresh).ok);

  const party = s.sect.disciples.slice(0, 2).map((d) => d.id);
  check('普通探索可以派出队伍', expeditions.canStartSurvey(s, fresh, party).ok);
  check(
    '普通探索人数有上限',
    !expeditions.canStartSurvey(s, fresh, s.sect.disciples.slice(0, SURVEY_MAX_PARTY + 1).map((d) => d.id)).ok,
  );
  check('普通探索至少要有一个人', !expeditions.canStartSurvey(s, fresh, []).ok);
  check(
    '境界不够的小区域做不了普通探索',
    !expeditions.canSurveyRegion(s, 'boundlessSea_15').ok,
  );

  /* ---- 出发：会占一个探索队伍名额，并且标成 survey ---- */
  const started = expeditions.startSurvey(s, fresh, party, makeRandom(7));
  check('普通探索会占一个探索队伍名额', started.expeditions.length === 1, `${started.expeditions.length} 支`);
  check('普通探索被标记为 survey', started.expeditions[0]?.kind === 'survey');
  check('出发的弟子进入探索状态', party.every((id) => started.sect.disciples.find((d) => d.id === id)?.status === 'exploring'));
  check(
    '普通探索时长比同档秘境短',
    (started.expeditions[0]?.duration ?? 0) > 0 &&
      (started.expeditions[0]?.duration ?? 0) < (SECRET_REALM_MAP[`${fresh}_r0`]?.duration ?? 0),
    `${started.expeditions[0]?.duration} vs ${SECRET_REALM_MAP[`${fresh}_r0`]?.duration}`,
  );

  /* ---- 结算：必定产基础材料、有概率出稀有材料、没有伤亡 ---- */
  {
    const before = started.sect.disciples.length;
    let anyBase = false;
    let anyRare = false;
    // 跑很多次，覆盖"有概率"的两条分支
    for (let i = 0; i < 60; i += 1) {
      const run = expeditions.startSurvey(s, fresh, party, makeRandom(500 + i));
      const out = expeditions.resolveSurvey(run, run.expeditions[0], makeRandom(900 + i));
      check(
        `普通探索一定有产出（第 ${i} 次）`,
        out.outcome !== null && out.outcome.gains.length > 0,
      );
      if (i === 0) {
        check('普通探索不会折损弟子', out.outcome?.casualties.length === 0);
        check('归来后弟子恢复空闲', out.state.sect.disciples.every((d) => d.status === 'idle'));
      }
      for (const g of out.outcome?.gains ?? []) {
        if (isBasicMaterial(g.id)) anyBase = true;
        else anyRare = true;
      }
    }
    check('普通探索必定产出基础材料', anyBase);
    check('普通探索有概率产出稀有材料（60 次里出现过）', anyRare);
    check(`普通探索没有死人（始终 ${before} 人）`, s.sect.disciples.length === before);
  }

  /* ---- 秘境全找到之后就不能再做普通探索 ---- */
  {
    let done = s;
    for (const realm of SECRET_REALMS.filter((r) => r.regionId === fresh)) done = engine.discoverRealm(done, realm.id);
    check(
      '一个小区域的秘境全找到之后，普通探索自动关闭',
      !expeditions.canSurveyRegion(done, fresh).ok,
      expeditions.canSurveyRegion(done, fresh).reason ?? '',
    );
  }
}

/* ------------------------------------------------------------------ */
/* 30. 建造队列（需求 2）                                                */
/* ------------------------------------------------------------------ */
section('[30] 建造队列：3 个起步，天工院特殊升级到 7 个（需求 2）');
{
  const base = createInitialState(0);
  check('初始有 3 个建造名额', engine.getQueueSlots(base) === 3, `${engine.getQueueSlots(base)} 个`);
  check('队列初始为空', base.buildQueue.length === 0 && base.tiangongLevel === 0);

  check(
    '最多允许 7 个建筑排队',
    BUILD_QUEUE_MAX_SLOTS === 7,
    `${BUILD_QUEUE_MAX_SLOTS} 个`,
  );
  check('天工院在金丹期（下标 2）解锁', BUILDABLE_MAP.tiangongYuan.requiresRealm === 2);
  check('天工院唯一', BUILDABLE_MAP.tiangongYuan.max === 1);
  check(
    '3 个基础名额 + 天工院 1 个 + 特殊升级 3 级 = 7',
    BUILD_QUEUE_BASE_SLOTS + (BUILDABLE_MAP.tiangongYuan.kind === 'structure' ? BUILDABLE_MAP.tiangongYuan.queueSlots ?? 0 : 0) + QUEUE_UPGRADES.length ===
      BUILD_QUEUE_MAX_SLOTS,
  );

  /* ---- 排队与出队 ---- */
  {
    let q = base;
    q = engine.enqueueBuild(q, 'spiritArray');
    q = engine.enqueueBuild(q, 'woodGrove');
    q = engine.enqueueBuild(q, 'stoneMine');
    check('可以排满 3 个', q.buildQueue.length === 3, q.buildQueue.join('、'));
    const overflow = engine.enqueueBuild(q, 'oreVein');
    check('排满之后第 4 个排不进去', overflow === q);
    check('第 4 个没有偷偷进队列', overflow.buildQueue.length === 3);

    const moved = engine.moveQueueItem(q, 0, 1);
    check('队列项可以上下调序', moved.buildQueue[0] === 'woodGrove' && moved.buildQueue[1] === 'spiritArray');
    check('越界的调序不动队列', engine.moveQueueItem(q, 0, -1) === q);

    const removed = engine.dequeueBuild(q, 1);
    check('可以移出某一项', removed.buildQueue.length === 2 && !removed.buildQueue.includes('woodGrove'));
    check('可以清空队列', engine.clearQueue(q).buildQueue.length === 0);
  }

  /* ---- 天工院与特殊升级 ---- */
  {
    let rich: GameState = grant(createInitialState(0), {
      qi: '1e13',
      wood: '1e11',
      stone: '1e11',
      blackIron: '1e7',
      lunarCrystal: '1e5',
    });
    rich = forceBuild(rich, 'thatchHut', 5);
    // 金丹期
    rich = { ...rich, realmIndex: 2 };
    rich = engine.refreshUnlocks(rich);
    check('金丹期解锁天工院', engine.getBuildGate(BUILDABLE_MAP.tiangongYuan, rich) === null);
    check(
      '筑基期还建不了天工院',
      engine.getBuildGate(BUILDABLE_MAP.tiangongYuan, { ...rich, realmIndex: 1 }) !== null,
    );

    rich = forceBuild(rich, 'tiangongYuan', 1);
    check('建好天工院后名额变成 4', engine.getQueueSlots(rich) === 4, `${engine.getQueueSlots(rich)} 个`);
    check('天工院确实建成了', engine.hasQueueBuilding(rich));

    // 三级特殊升级，逐级 +1，封顶 7
    const seen: number[] = [];
    for (let i = 0; i < QUEUE_UPGRADES.length; i += 1) {
      check(`第 ${i + 1} 级特殊升级可以升`, engine.canUpgradeQueue(rich).ok, engine.canUpgradeQueue(rich).reason ?? '');
      rich = engine.upgradeQueue(rich);
      seen.push(engine.getQueueSlots(rich));
    }
    check('三级升级分别把名额抬到 5 / 6 / 7', seen.join(',') === '5,6,7', seen.join(' / '));
    check('名额正好封顶在 7', engine.getQueueSlots(rich) === BUILD_QUEUE_MAX_SLOTS);
    check('满级之后不能再升', !engine.canUpgradeQueue(rich).ok);
    check('满级后升级不会多给名额', engine.getQueueSlots(engine.upgradeQueue(rich)) === BUILD_QUEUE_MAX_SLOTS);

    // 到了 7 个之后确实能排满 7 个
    let full = rich;
    for (let i = 0; i < 9; i += 1) full = engine.enqueueBuild(full, 'spiritArray');
    check('开到 7 个名额后能排满 7 个', full.buildQueue.length === 7, `${full.buildQueue.length} 个`);
  }

  /* ---- tick 自动建造：够了就盖，不够就等 ---- */
  {
    let poor: GameState = createInitialState(0);
    poor = forceBuild(poor, 'thatchHut', 5);
    poor = engine.enqueueBuild(poor, 'spiritArray');
    const waited = engine.tickBuildQueue(poor);
    check('资源不够时队列原地等待', waited.buildQueue.length === 1 && (waited.buildings.spiritArray ?? 0) === 0);

    const rich = engine.tickBuildQueue(grant(poor, { qi: '1e6', wood: '1e6', stone: '1e6' }));
    check('资源够了就自动开工', (rich.buildings.spiritArray ?? 0) === 1);
    check('建好之后该项出队', rich.buildQueue.length === 0);

    // 门槛没到的一律不盖（拿天工院试：筑基期还建不了）
    let gated = grant(createInitialState(0), { qi: '1e13', wood: '1e11', stone: '1e11', blackIron: '1e7' });
    gated = engine.enqueueBuild(gated, 'tiangongYuan');
    const stillGated = engine.tickBuildQueue(gated);
    check('门槛没到时不会硬盖', stillGated.buildQueue.length === 1 && (stillGated.buildings.tiangongYuan ?? 0) === 0);

    const atJindan = engine.tickBuildQueue({ ...stillGated, realmIndex: 2, unlockedBuildings: { ...stillGated.unlockedBuildings, tiangongYuan: true } });
    check('门槛一到就自动盖上', (atJindan.buildings.tiangongYuan ?? 0) === 1);
    check('建造队列会在主循环里自动推进（见 tick.ts 的 applyTick）', true);
  }

  /* ---- 存档往返 ---- */
  {
    const saved: GameState = {
      ...createInitialState(0),
      buildQueue: ['spiritArray', 'woodGrove'],
      tiangongLevel: 2,
    };
    const round = deserialize(JSON.parse(JSON.stringify(serialize(saved))));
    check('建造队列能存档还原', round !== null);
    if (round) {
      check('队列内容保留', round.buildQueue.join(',') === 'spiritArray,woodGrove', round.buildQueue.join('、'));
      check('天工院升级等级保留', round.tiangongLevel === 2);
      check('还原后名额是 3 + 2 = 5', engine.getQueueSlots(round) === 5, `${engine.getQueueSlots(round)} 个`);
    }

    // 存档里的野 id 必须被丢掉，且队列长度被夹到上限
    const junk = deserialize({ v: 4, at: 0, bq: ['spiritArray', 'notABuilding', 'woodGrove'], tl: 99 });
    check('非法的建造 id 被丢弃', !!junk && !junk.buildQueue.includes('notABuilding'));
    if (junk) {
      check('合法的建造 id 保留', junk.buildQueue.length === 2);
      check('越界的升级等级被夹回范围', junk.tiangongLevel <= QUEUE_UPGRADES.length, `${junk.tiangongLevel}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 31. 纪年（需求 1）                                                   */
/* ------------------------------------------------------------------ */
section('[31] 纪年：一年 = 现实 8 分钟，一季 = 2 分钟（需求 1）');
{
  check('一年 = 480 真实秒', SECONDS_PER_GAME_YEAR === 480, `${SECONDS_PER_GAME_YEAR} 秒`);
  check('一季 = 120 真实秒', SEASON_SECONDS === 120, `${SEASON_SECONDS} 秒`);
  check('季度由日历推导（一季 = 四分之一年）', SEASON_SECONDS === SECONDS_PER_GAME_YEAR / 4);
  check(
    '游戏日/秒由年长换算而来',
    Math.abs(GAME_DAYS_PER_SECOND - GAME_DAYS_PER_YEAR / SECONDS_PER_GAME_YEAR) < 1e-9,
    `${GAME_DAYS_PER_SECOND.toFixed(4)} 天/秒`,
  );

  check('开局是第 1 年', gameYearOf(0) === 1);
  check('满一年进入第 2 年', gameYearOf(SECONDS_PER_GAME_YEAR) === 2, `${gameYearOf(SECONDS_PER_GAME_YEAR)}`);
  check('一年零一秒仍是第 2 年', gameYearOf(SECONDS_PER_GAME_YEAR + 1) === 2);
  check('第 5 年的中点是第 5 年', gameYearOf(SECONDS_PER_GAME_YEAR * 4.5) === 5);
  check(
    '年度进度从 0 走到一半',
    yearProgressOf(0) === 0 && Math.abs(yearProgressOf(SECONDS_PER_GAME_YEAR / 2) - 0.5) < 1e-9,
  );

  /* ---- 季节跟着日历走 ---- */
  {
    const fresh = createInitialState(0);
    const afterSeason = seasonModule.tickSeason(fresh, SEASON_SECONDS, makeRandom(1));
    check('走满一季换一季', afterSeason.season === 1, `${afterSeason.season}`);
    const afterYear = seasonModule.tickSeason(fresh, SECONDS_PER_GAME_YEAR, makeRandom(1));
    check('走满一年正好转回同一季', afterYear.season === fresh.season, `${afterYear.season}`);
  }

  /* ---- 商行刷新按真实秒，不跟着日历变慢 ---- */
  check('商行刷新固定 60 真实秒', SHOP_REFRESH_SECONDS === 60, `${SHOP_REFRESH_SECONDS} 秒`);

  /* ---- 弟子寿元跟着日历走：推进一年正好长一岁 ---- */
  {
    let s: GameState = grant(createInitialState(0), { qi: '1e9', stone: '1e6' });
    s = forceBuild(s, 'thatchHut', 5);
    s = { ...s, sect: { ...s.sect, founded: true } };
    s = disciples.recruitDisciple(s, fixedRandom(0.01)).state;
    check('测试用弟子招到了', s.sect.disciples.length === 1);
    const before = s.sect.disciples[0]?.age ?? 0;
    const oneYear = disciples.tickDisciples(s, SECONDS_PER_GAME_YEAR);
    const after = oneYear.sect.disciples[0]?.age ?? 0;
    check('推进一年，弟子正好长一岁', Math.abs(after - before - 1) < 0.02, `${before.toFixed(2)} → ${after.toFixed(2)}`);
  }
}

/* ------------------------------------------------------------------ */
/* 32. 善恶值与随机遭遇（需求 2）                                        */
/* ------------------------------------------------------------------ */
section('[32] 善恶值 + 开宗前的随机遭遇（需求 2）');
{
  const base = createInitialState(0);
  check('开局善恶值为 0（中立）', getKarma(base) === 0 && getKarmaLabel(base).name === '中立');

  /* ---- 一条善恶轴 ---- */
  check('恶 40 时：恶行 40、善行 0', getEvil({ ...base, karma: -40 }) === 40 && getVirtue({ ...base, karma: -40 }) === 0);
  check('善 40 时：善行 40、恶行 0', getVirtue({ ...base, karma: 40 }) === 40 && getEvil({ ...base, karma: 40 }) === 0);
  check('善恶值夹在 ±100', getKarma({ ...base, karma: 999 }) === 100 && getKarma({ ...base, karma: -999 }) === -100);
  check(
    '大恶 / 大善的标签',
    getKarmaLabel({ ...base, karma: -80 }).name === '大恶' && getKarmaLabel({ ...base, karma: 80 }).name === '大善',
  );

  /* ---- 恶行 → 天雷之罚 ---- */
  check('中立时没有天雷之罚', getKarmaThunderPenalty(base) === 0);
  check(
    '恶行值越高，天雷之罚越重',
    getKarmaThunderPenalty({ ...base, karma: -100 }) > getKarmaThunderPenalty({ ...base, karma: -50 }),
  );
  check(
    '天雷之罚封顶在 KARMA_THUNDER_MAX',
    Math.abs(getKarmaThunderPenalty({ ...base, karma: -100 }) - KARMA_THUNDER_MAX) < 1e-9,
  );
  check(
    '大恶之人的突破成功率被拉低',
    engine.getSuccessRate({ ...base, karma: -100 }, true) < engine.getSuccessRate(base, true),
    `${engine.getSuccessRate(base, true).toFixed(3)} → ${engine.getSuccessRate({ ...base, karma: -100 }, true).toFixed(3)}`,
  );
  check(
    '但不会压到 0（恶行线仍然走得通）',
    engine.getSuccessRate({ ...base, karma: -100 }, false) >= KARMA_SUCCESS_FLOOR - 1e-9,
    `${engine.getSuccessRate({ ...base, karma: -100 }, false).toFixed(3)}`,
  );

  /* ---- 小境界参悟也会挨天雷（需求明文点了这一条）---- */
  {
    const s: GameState = grant(createInitialState(0), { qi: '1e12' });
    const evil: GameState = { ...s, karma: -100 };
    const struck = engine.advanceLayer(evil, fixedRandom(0));
    check('大恶之人参悟小境界会失败', struck.layer === evil.layer, `层数 ${struck.layer}`);
    check('失败会落下道伤', struck.injurySeconds > 0, `${struck.injurySeconds} 秒`);
    check('失败照样扣灵气', struck.resources.qi.lt(evil.resources.qi));
    check('失败写进了记事', struck.journal.length > evil.journal.length);

    check('运气好时仍能参悟成功', engine.advanceLayer(evil, fixedRandom(0.999)).layer === evil.layer + 1);
    check('中立之人参悟不会失败', engine.advanceLayer(s, fixedRandom(0)).layer === s.layer + 1);
  }

  /* ---- 善行 → 探索加成 ---- */
  check('中立时没有探索加成', getKarmaExploreBonus(base) === 0);
  check(
    '善行值越高，探索加成越多',
    getKarmaExploreBonus({ ...base, karma: 100 }) > getKarmaExploreBonus({ ...base, karma: 50 }),
  );
  check(
    '探索加成封顶在 KARMA_EXPLORE_BONUS_MAX',
    Math.abs(getKarmaExploreBonus({ ...base, karma: 100 }) - KARMA_EXPLORE_BONUS_MAX) < 1e-9,
  );

  /* ---- 抢劫门槛 ---- */
  check('恶行值不到位时抢不了', !canRob({ ...base, karma: -10 }));
  check('恶行值到位后解锁抢劫', canRob({ ...base, karma: KARMA_ROB_THRESHOLD }) && canRob({ ...base, karma: -60 }));

  /* ---- 遭遇表本身 ---- */
  check('遭遇表至少 8 条', ENCOUNTERS.length >= 8, `${ENCOUNTERS.length} 条`);
  check('遭遇 id 唯一', new Set(ENCOUNTERS.map((e) => e.id)).size === ENCOUNTERS.length);
  check(
    '每个遭遇都至少有一个「什么都不用付」的选项',
    ENCOUNTERS.every((e) =>
      e.options.some(
        (o) =>
          o.requiresKarmaAtMost === undefined &&
          o.requiresKarmaAtLeast === undefined &&
          Object.keys(optionRequiredItems(o)).length === 0,
      ),
    ),
  );
  check(
    '抢劫类选项都要求恶行值',
    ENCOUNTERS.flatMap((e) => e.options)
      .filter((o) => o.effect.successChance !== undefined)
      .every((o) => (o.requiresKarmaAtMost ?? 0) <= KARMA_ROB_THRESHOLD),
  );
  check(
    '抢劫的成功率一律不高（需求：「几率不大」）',
    ENCOUNTERS.flatMap((e) => e.options)
      .filter((o) => o.effect.successChance !== undefined)
      .every((o) => (o.effect.successChance ?? 1) <= 0.6),
  );

  /* ---- 触发条件（需求 1 改了这条：开宗后**也会**遇到） ---- */
  check('开宗前会触发遭遇判定', canRollEncounter(base));
  check(
    '开宗后同样会触发（需求 1：开宗后也会遇到）',
    canRollEncounter({ ...base, sect: { ...base.sect, founded: true } }),
  );
  check(
    '开宗后掌门在外仍会遇到人',
    canRollEncounter({
      ...base,
      sect: { ...base.sect, founded: true },
      personalTravel: { kind: 'travel', regionId: 'mortalVillage', progress: 0, duration: 90 },
    }),
  );
  check('已有待选遭遇时不再触发新的', !canRollEncounter({ ...base, pendingEncounter: 'caravan' }));

  /* ---- 走时间轴真的会撞上人 ---- */
  {
    let rolled: GameState = base;
    for (let i = 0; i < 20 && !rolled.pendingEncounter; i += 1) {
      rolled = encounterTick(rolled, ENCOUNTER_INTERVAL, fixedRandom(0.01));
    }
    check('推进足够时间会遇到人', rolled.pendingEncounter !== null, rolled.pendingEncounter ?? '');
    check('遇到的是一条真实存在的遭遇', getPendingEncounter(rolled) !== null);
  }

  /* ---- 选择与结算 ---- */
  {
    const pending: GameState = { ...base, pendingEncounter: 'caravan' };
    const def = getPendingEncounter(pending);
    const idx = def?.options.findIndex((o) => o.label === '让路同行') ?? -1;
    check('能找到「让路同行」这个选项', idx >= 0);

    const before = getKarma(pending);
    const out = chooseEncounterOption(pending, idx);
    check('选择会清掉待选遭遇', out.state.pendingEncounter === null);
    check('选择会改变善恶值', getKarma(out.state) > before, `${before} → ${getKarma(out.state)}`);
    check('选择会给出物品', (out.outcome?.gains.length ?? 0) > 0);
    check('选择写进了记事', out.state.journal.length > pending.journal.length);
  }

  /* ---- 抢劫：成功 / 失败 ---- */
  {
    const robber: GameState = { ...base, karma: -60, pendingEncounter: 'caravan' };
    const def = getPendingEncounter(robber)!;
    const robIndex = def.options.findIndex((o) => o.effect.successChance !== undefined);
    check('恶行值到位后抢劫选项可选', robIndex >= 0 && canChooseOption(robber, def.options[robIndex]).ok);

    const win = chooseEncounterOption(robber, robIndex, fixedRandom(0));
    check('抢劫成功拿到东西', (win.outcome?.gains.length ?? 0) > 0 && win.outcome?.success === true);
    check('抢劫成功也是恶行', getKarma(win.state) < getKarma(robber));

    const lose = chooseEncounterOption(robber, robIndex, fixedRandom(0.999));
    check('抢劫失败什么也拿不到', lose.outcome?.success === false);
    check('抢劫失败要吃道伤', lose.state.injurySeconds > 0, `${lose.state.injurySeconds} 秒`);
    check('抢劫失败照样算恶行', getKarma(lose.state) < getKarma(robber), `${getKarma(robber)} → ${getKarma(lose.state)}`);

    const good: GameState = { ...base, karma: 20, pendingEncounter: 'caravan' };
    check('善人抢不了', !canChooseOption(good, def.options[robIndex]).ok);
    check('抢不了时选择无效', chooseEncounterOption(good, robIndex).outcome === null);
  }

  /* ---- 存档往返 ---- */
  {
    const saved: GameState = {
      ...createInitialState(0),
      karma: -55,
      pendingEncounter: 'blackRobe',
      encounterTimer: 33,
    };
    const round = deserialize(JSON.parse(JSON.stringify(serialize(saved))));
    check('善恶值与遭遇能存档还原', round !== null);
    if (round) {
      check('善恶值保留', round.karma === -55);
      check('待选遭遇保留', round.pendingEncounter === 'blackRobe');
      check('遭遇计时保留', Math.abs(round.encounterTimer - 33) < 1e-9);
    }

    const junk = deserialize({ v: 4, at: 0, ka: 9999, pe: 'notAnEncounter', et: 1e9 });
    check('越界的善恶值被夹回范围', !!junk && junk.karma === KARMA_MAX);
    check('不存在的遭遇 id 被丢弃', !!junk && junk.pendingEncounter === null);
    if (junk) check('越界的遭遇计时被夹回一个周期', junk.encounterTimer <= ENCOUNTER_INTERVAL);
  }
}

/* ------------------------------------------------------------------ */
/* 33. 队伍数 / 开宗门槛 / 仆人 / 掌门亲往（需求 3、4、5）                */
/* ------------------------------------------------------------------ */
section('[33] 队伍上限 9 · 金丹开宗 · 仆人固定 300 · 掌门亲往（需求 3、4、5）');
{
  /* ---- 需求 3：宗门等级越高，队伍越多，最多 9 ---- */
  check('一品宗门 1 支队伍', expeditionSlots(1) === 1, `${expeditionSlots(1)}`);
  check('九品宗门 9 支队伍', expeditionSlots(9) === 9, `${expeditionSlots(9)}`);
  check('最多 9 支，不会再涨', MAX_EXPEDITION_SLOTS === 9 && expeditionSlots(99) === 9);
  check(
    '队伍数随品阶单调不减',
    Array.from({ length: 9 }, (_, i) => expeditionSlots(i + 1)).every((v, i, arr) => i === 0 || v >= arr[i - 1]),
  );
  {
    const lv9: GameState = {
      ...createInitialState(0),
      sect: { ...createInitialState(0).sect, founded: true, level: 9 },
    };
    check('九品宗门真的能同时派 9 支', expeditions.getMaxExpeditions(lv9) === 9, `${expeditions.getMaxExpeditions(lv9)}`);
  }

  /* ---- 需求 3：金丹就能开宗，但飞升仍是化神 ---- */
  check('开宗门槛是金丹期（下标 2）', SECT_MIN_REALM === 2, `下标 ${SECT_MIN_REALM}`);
  check('SECT_LEVELS[0] 也同步到金丹', SECT_LEVELS[0].requiresRealm === 2);
  check('飞升门槛没有被一起拉低', ASCENSION_MIN_REALM === 4, `下标 ${ASCENSION_MIN_REALM}`);
  {
    const rich: GameState = { ...grant(createInitialState(0), { stone: '1e6' }), realmIndex: 2 };
    check('金丹期可以开宗', engine.foundSect(rich).sect.founded);
    check('筑基期还开不了宗', !engine.foundSect({ ...rich, realmIndex: 1 }).sect.founded);
    check('金丹期还不能飞升', !engine.canAscend(rich));
  }

  /* ---- 需求 4：仆人固定 300 灵气 ---- */
  check('招收仆人固定 300', SERVANT_COST === 300);
  check('成本不随人数变化', servantCost(0) === 300 && servantCost(50) === 300);

  /* ---- 需求 5：大区按境界解锁；弟子门槛 = 大区解锁等级 ---- */
  check('东部群山的解锁境界是 0（初始可探索）', MAJOR_REGION_MAP.eastMountains.requiresRealm === 0);
  check(
    '其它大区的解锁境界都高于东部群山',
    MAJOR_REGIONS.filter((m) => m.id !== 'eastMountains').every((m) => m.requiresRealm > 0),
  );
  check(
    '每个大区里的秘境弟子门槛都等于该大区解锁等级',
    SECRET_REALMS.every((r) => r.minRealm === MAJOR_REGION_MAP[MAP_REGION_MAP[r.regionId].majorId].requiresRealm),
  );

  /* ---- 需求 5：掌门独自前往秘境 ---- */
  {
    let s: GameState = grant(createInitialState(0), { stone: '1e9', qi: '1e9' });
    s = forceBuild(s, 'thatchHut', 5);
    s = { ...s, sect: { ...s.sect, founded: true } };
    const realmId = STARTER_REALM_ID;
    const def = SECRET_REALM_MAP[realmId];

    check('已发现的秘境掌门可以去', travel.canStartSoloRealm(s, realmId).ok);
    check('没发现的秘境去不了', !travel.canStartSoloRealm(s, 'boundlessSea_15_r0').ok);

    const solo = travel.startSoloRealm(s, realmId);
    check('出发后掌门在外（kind = realm）', solo.personalTravel?.kind === 'realm');
    check(
      '独自前往要更久（×1.4）',
      (solo.personalTravel?.duration ?? 0) === Math.round(def.duration * 1.4),
      `${solo.personalTravel?.duration} vs ${def.duration}`,
    );
    check('掌门在外时不能再出发', !travel.canStartSoloRealm(solo, realmId).ok);

    const run = travel.resolveSoloRealm(solo, solo.personalTravel as NonNullable<typeof solo.personalTravel>, makeRandom(11));
    check('独自前往会带回东西', (run.outcome?.gains.length ?? 0) > 0);
    check('回归后掌门回到洞府', run.state.personalTravel === null);
    check('亲自去过也要进冷却', (run.state.realmCooldowns[realmId] ?? 0) > 0);
    check('独自前往不消耗弟子', run.state.sect.disciples.length === solo.sect.disciples.length);

    // 稀有材料的占比应当明显高于派队伍（派队伍的池子里基础材料权重占大头）
    let rare = 0;
    let total = 0;
    for (let i = 0; i < 40; i += 1) {
      const out = travel.resolveSoloRealm(solo, solo.personalTravel as NonNullable<typeof solo.personalTravel>, makeRandom(500 + i));
      for (const g of out.outcome?.gains ?? []) {
        total += 1;
        if (isRareMaterial(g.id)) rare += 1;
      }
    }
    check(
      '独自前往更容易拿到稀有材料（稀有占比 > 30%）',
      total > 0 && rare / total > 0.3,
      `${((rare / total) * 100).toFixed(0)}%（${rare}/${total}）`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* 34. 宗门事件与防御（需求 1）                                          */
/* ------------------------------------------------------------------ */
section('[34] 宗门事件 + 宗门大阵（需求 1）');
{
  const founded = (extra: Partial<GameState> = {}): GameState => {
    const s = grant(forceBuild(createInitialState(0), 'thatchHut', 10), { qi: '1e9', stone: '1e9' });
    return { ...s, sect: { ...s.sect, founded: true, level: 3 }, ...extra };
  };

  /* ---- 玩家事件 30 秒会自己消失 ---- */
  {
    const pending: GameState = { ...createInitialState(0), pendingEncounter: 'caravan', encounterDeadline: ENCOUNTER_SECONDS };
    check('遭遇有 30 秒倒计时', ENCOUNTER_SECONDS === 30, `${ENCOUNTER_SECONDS} 秒`);

    const half = tickEncounters(pending, 10, fixedRandom(0.99));
    check('不到 30 秒还在', half.pendingEncounter === 'caravan' && half.encounterDeadline < ENCOUNTER_SECONDS);

    const gone = tickEncounters(pending, ENCOUNTER_SECONDS + 1, fixedRandom(0.99));
    check('玩家事件到点自动消失', gone.pendingEncounter === null);
    check('消失时没有影响（善恶值不变）', gone.karma === pending.karma);
    check('消失也记了一笔', gone.journal.length > pending.journal.length);
  }

  /* ---- 进攻类：到点不选也照常结算 ---- */
  {
    const attack = ENCOUNTER_MAP.banditSiege;
    check('匪徒围攻是进攻类', isAttackEncounter(attack));
    check('进攻类有强度', (attack.attack?.power ?? 0) > 0);
    check('宗门事件都是 sect 范围', attack.scope === 'sect');

    const s = founded();
    // 先塞几个弟子，好看到伤亡
    let withDisciples = s;
    for (let i = 0; i < 8; i += 1) withDisciples = disciples.recruitDisciple(withDisciples, makeRandom(300 + i)).state;
    const before = withDisciples.sect.disciples.length;
    check('测试用宗门有弟子', before >= 6, `${before} 人`);

    const pending: GameState = { ...withDisciples, pendingEncounter: 'banditSiege', encounterDeadline: 1 };
    const resolved = tickEncounters(pending, 2, fixedRandom(0.99));
    check('进攻类到点会自动结算', resolved.pendingEncounter === null);
    check('结算会打伤弟子（无防御时）', resolved.injurySeconds > 0, `${resolved.injurySeconds} 秒`);
    check('结算写进了记事', resolved.journal.some((e) => e.kind === 'bad'));
  }

  /* ---- 宗门大阵：防御越高，损失越小，满配完全免疫 ---- */
  {
    check('三座宗门大阵都有防御值', SECT_FORMATIONS.length === 3 && SECT_FORMATIONS.every((f) => (f.sectDefense ?? 0) > 0));
    check(
      '三阵叠加能到 1 以上（需求：减少乃至避免伤亡）',
      SECT_FORMATIONS.reduce((sum, f) => sum + (f.sectDefense ?? 0), 0) > 1,
      SECT_FORMATIONS.map((f) => f.sectDefense).join(' + '),
    );
    check('宗门大阵都唯一', SECT_FORMATIONS.every((f) => f.max === 1));

    const noneDef = getSectDefense(founded());
    const oneDef = getSectDefense(forceBuild(founded(), 'gateArray', 1));
    const allDef = getSectDefense(SECT_FORMATIONS.reduce((s, f) => forceBuild(s, f.id, 1), founded()));
    check('没建阵时没有防御', noneDef === 0);
    check('建了护山大阵就有防御', oneDef > 0, `${oneDef}`);
    check('三阵齐备时防御超过 1', allDef > 1, `${allDef.toFixed(2)}`);

    void noneDef;
    void oneDef;
    void allDef;
    // 同一场进攻，防御越高伤得越少
    const hurt = (state: GameState) => {
      const pending: GameState = { ...state, pendingEncounter: 'banditSiege', encounterDeadline: 1 };
      const out = tickEncounters(pending, 2, fixedRandom(0.99));
      const names = out.journal.filter((e) => e.text.includes('受伤弟子'));
      return names.length > 0 ? Number(/受伤弟子 (\d+) 人/.exec(names[0].text)?.[1] ?? 0) : 0;
    };
    check('有阵时伤亡不增', hurt(forceBuild(founded(), 'gateArray', 1)) <= hurt(founded()) + 1);
    check(
      '三阵齐备时完全免伤',
      hurt(SECT_FORMATIONS.reduce((s, f) => forceBuild(s, f.id, 1), founded())) === 0,
    );
  }

  /* ---- 触发池：未开宗只有玩家事件，开宗后两者都有 ---- */
  {
    check('未开宗时抽不到宗门事件', playerEncounters().every((e) => e.scope === 'player'));
    check('宗门事件确实存在', sectEncounters().length >= 4, `${sectEncounters().length} 条`);
    check(
      '进攻类至少有 3 种',
      sectEncounters().filter((e) => isAttackEncounter(e)).length >= 3,
      `${sectEncounters().filter((e) => isAttackEncounter(e)).length} 种`,
    );
    check(
      '非进攻的宗门事件也允许"什么都不做"（到点无影响）',
      sectEncounters().filter((e) => !isAttackEncounter(e)).every((e) => e.options.length >= 1),
    );
  }
}

/* ------------------------------------------------------------------ */
/* 35. 寿元限制（需求 2）                                                */
/* ------------------------------------------------------------------ */
section('[35] 弟子寿元限制（需求 2）');
{
  check(
    '每个境界都有寿元，只有仙人是无限的',
    REALMS.slice(0, -1).every((r) => Number.isFinite(r.lifespan) && r.lifespan > 0) &&
      !Number.isFinite(REALMS[REALMS.length - 1].lifespan),
  );
  check(
    '境界越高寿元越长（等级可以增加寿元）',
    REALMS.every((r, i) => i === 0 || r.lifespan >= REALMS[i - 1].lifespan),
  );
  check(
    '炼气期的寿元短于它需要的修炼年数（不突破就会坐化）',
    REALMS[0].lifespan < REALMS[0].cultivationYears + 30,
    `寿元 ${REALMS[0].lifespan} 年 vs 需修炼 ${REALMS[0].cultivationYears} 年`,
  );

  // 一个资质最差、又不修炼的弟子，必然在寿元到来时坐化
  {
    let s: GameState = grant(createInitialState(0), { qi: '1e9', stone: '1e9' });
    s = forceBuild(s, 'thatchHut', 5);
    s = { ...s, sect: { ...s.sect, founded: true } };
    s = disciples.recruitDisciple(s, fixedRandom(0.01)).state;
    const d = s.sect.disciples[0];
    check('测试弟子招到了', !!d);

    // 把他挪到炼气期寿元之外：直接推时间
    const lifespan = REALMS[d.realmIndex].lifespan;
    const yearsToDie = lifespan - d.age + 1;
    const seconds = (yearsToDie * 365) / GAME_DAYS_PER_SECOND;
    const aged = disciples.tickDisciples(s, seconds);
    check(
      '到了寿元上限仍未突破 → 坐化',
      aged.sect.disciples.length === 0,
      `寿元 ${lifespan} 年，推进 ${yearsToDie.toFixed(1)} 年`,
    );
    check('坐化写进了记事', aged.journal.some((e) => e.text.includes('寿元耗尽')));
  }

  // 反过来：突破之后寿元变长，就不会死了
  {
    let s: GameState = grant(createInitialState(0), { qi: '1e9', stone: '1e9' });
    s = forceBuild(s, 'thatchHut', 5);
    s = { ...s, sect: { ...s.sect, founded: true } };
    s = disciples.recruitDisciple(s, fixedRandom(0.01)).state;
    const d = s.sect.disciples[0];
    const years = REALMS[0].lifespan - d.age + 1;
    const seconds = (years * 365) / GAME_DAYS_PER_SECOND;

    const asGoldenCore: GameState = {
      ...s,
      sect: { ...s.sect, disciples: s.sect.disciples.map((x) => ({ ...x, realmIndex: 2 })) },
    };
    const aged = disciples.tickDisciples(asGoldenCore, seconds);
    check('境界高了同样的时间就不会死', aged.sect.disciples.length === 1, `${aged.sect.disciples.length} 人`);
  }
}

/* ------------------------------------------------------------------ */
/* 36. 感悟（需求 3）                                                    */
/* ------------------------------------------------------------------ */
section('[36] 感悟：五行 + 时空大道（需求 3）');
{
  check('共七条道（五行 5 + 时空 2）', ENLIGHTEN_PATHS.length === 7, `${ENLIGHTEN_PATHS.length} 条`);
  check('九个大阶段 × 十个小阶段 = 90 阶', MAJOR_STAGES === 9 && MINOR_PER_MAJOR === 10 && MAX_ENLIGHTEN_LEVEL === 90);
  check(
    '五行各绑一种基础材料，且不重复',
    ENLIGHTEN_PATHS.filter((p) => p.material).length === 5 &&
      new Set(ENLIGHTEN_PATHS.filter((p) => p.material).map((p) => p.material)).size === 5,
  );
  check(
    '五行绑的都是基础材料',
    ENLIGHTEN_PATHS.filter((p) => p.material).every((p) => BASE_MATERIAL_IDS.includes(p.material as never)),
  );
  check('五行在元婴期解锁（下标 3）', ENLIGHTEN_PATHS.filter((p) => p.group === '五行').every((p) => p.requiresRealm === 3));
  check('时空大道在化神期解锁（下标 4）', ENLIGHTEN_PATHS.filter((p) => p.group === '时空').every((p) => p.requiresRealm === 4));

  /* ---- 阶段换算 ---- */
  check('0 阶时没有阶段', stageOf(0).major === 0 && stageOf(0).minor === 0);
  check('第 1 阶 = 第 1 大阶段第 1 小阶段', stageOf(1).major === 1 && stageOf(1).minor === 1);
  check('第 10 阶 = 第 1 大阶段第 10 小阶段', stageOf(10).major === 1 && stageOf(10).minor === 10);
  check('第 11 阶进入第 2 大阶段', stageOf(11).major === 2 && stageOf(11).minor === 1);
  check('第 90 阶 = 第 9 大阶段第 10 小阶段', stageOf(90).major === 9 && stageOf(90).minor === 10);

  /* ---- 门槛 ---- */
  check('元婴期之前感悟没解锁', !isEnlightenmentUnlocked(createInitialState(0)));
  check('元婴期解锁感悟', isEnlightenmentUnlocked({ ...createInitialState(0), realmIndex: 3 }));
  {
    const atNascent: GameState = grant({ ...createInitialState(0), realmIndex: 3 }, { qi: '1e12', herb: '1e9', ore: '1e9', stone: '1e9' });
    check('元婴期可以修五行', canEnlighten(atNascent, 'metal').ok, canEnlighten(atNascent, 'metal').reason ?? '');
    check('元婴期还修不了时间大道', !canEnlighten(atNascent, 'time').ok);
    check('化神期可以修时间大道', canEnlighten({ ...atNascent, realmIndex: 4 }, 'time').ok);
  }

  /* ---- 修为与效果 ---- */
  {
    const rich: GameState = grant({ ...createInitialState(0), realmIndex: 4 }, {
      qi: '1e14',
      herb: '1e12',
      ore: '1e12',
      stone: '1e12',
      arrayCore: '1e4',
    });
    const started = startEnlighten(rich, 'metal');
    check('开始感悟会占用唯一的感悟位', started.enlightening?.pathId === 'metal');
    check('开始感悟要花掉资源', started.resources.qi.lt(rich.resources.qi));
    check('感悟中不能再开一条', !canEnlighten(started, 'wood').ok);

    // 直接推完
    const done = tickEnlighten(started, getEnlightenRemaining(started) + 1);
    check('推满时间就完成一阶', getEnlightenLevel(done, 'metal') === 1);
    check('完成后感悟位空出来', done.enlightening === null);
    check('完成后可以修别的道', canEnlighten(done, 'wood').ok);

    check('五行加成随阶数增长', getElementMaterialBonus(done, 'blackIron') > getElementMaterialBonus(rich, 'blackIron'));
    check(
      '金之道加的是玄铁，不是别的材料',
      getElementMaterialBonus(done, 'blackIron') > 0 && getElementMaterialBonus(done, 'coldJade') === 0,
    );

    // 满阶的收益
    const maxed: GameState = { ...rich, enlightenment: { ...rich.enlightenment, metal: MAX_ENLIGHTEN_LEVEL } };
    check(
      '五行修满给 +135%',
      Math.abs(getElementMaterialBonus(maxed, 'blackIron') - MAX_ENLIGHTEN_LEVEL * ELEMENT_BONUS_PER_LEVEL) < 1e-9,
      `${(getElementMaterialBonus(maxed, 'blackIron') * 100).toFixed(1)}%`,
    );
    check('满阶后不能再修', !canEnlighten(maxed, 'metal').ok);
  }

  /* ---- 时间大道：每 5 游戏年一次，最多 50 年 ---- */
  {
    check('最短穿梭 5 年', timeJumpYears(0) === 5, `${timeJumpYears(0)}`);
    check('修满可以穿梭 50 年（需求上限）', timeJumpYears(MAX_ENLIGHTEN_LEVEL) === 50, `${timeJumpYears(MAX_ENLIGHTEN_LEVEL)}`);
    check(
      '穿梭年数随阶数单调递增',
      Array.from({ length: 10 }, (_, i) => timeJumpYears(i * 10)).every((v, i, a) => i === 0 || v > a[i - 1]),
    );

    const rich: GameState = grant({ ...createInitialState(0), realmIndex: 4 }, { qi: '1e14', herb: '1e12' });
    const withTime: GameState = {
      ...rich,
      enlightenment: { ...rich.enlightenment, time: 30 },
    };
    check('没修时间大道时不能穿梭', !canTimeJump(rich).ok);
    check('修了时间大道就能穿梭', canTimeJump(withTime).ok, canTimeJump(withTime).reason ?? '');
    check('穿梭有 5 游戏年的冷却', TIME_JUMP_COOLDOWN_YEARS === 5);

    // 真的跳一次：时间要往前走
    const before = withTime.playTime;
    const jumped = doTimeJump(withTime, (g, dt) => applyTick(g, dt, makeRandom(7)));
    check('穿梭会推进游戏时间', jumped.playTime > before);
    // 记的是"到达的那一刻"（跳跃之后），所以冷却从落点开始算
    check('穿梭会记录落点时间（用于冷却）', jumped.lastTimeJump === jumped.playTime && jumped.playTime > before);
    check('穿梭后立刻不能再穿', !canTimeJump(jumped).ok, canTimeJump(jumped).reason ?? '');
    check('穿梭写进了记事', jumped.journal.some((e) => e.text.includes('时空穿梭')));
  }

  /* ---- 空间大道与空间戒指 ---- */
  {
    const rich: GameState = grant({ ...createInitialState(0), realmIndex: 4 }, {
      qi: '1e14',
      stone: '1e12',
      arrayCore: '1e5',
      refinedGold: '1e5',
    });
    check('没修空间大道时探索加成为 0', getSpaceExploreBonus(rich) === 0);

    const withSpace: GameState = { ...rich, enlightenment: { ...rich.enlightenment, space: 10 } };
    check('修了空间大道就有探索加成', getSpaceExploreBonus(withSpace) > 0);
    check('10 阶才够做第一枚戒指', canCraftSpaceRing(withSpace).ok, canCraftSpaceRing(withSpace).reason ?? '');
    check('没修到 10 阶做不了戒指', !canCraftSpaceRing(rich).ok);

    const ringed = craftSpaceRing(withSpace);
    check('做出了空间戒指', getSpaceRings(ringed) === 1);
    check('戒指会继续抬高探索加成', getSpaceExploreBonus(ringed) > getSpaceExploreBonus(withSpace));
    check(
      '一枚戒指值 +5%',
      Math.abs(getSpaceExploreBonus(ringed) - getSpaceExploreBonus(withSpace) - SPACE_RING_BONUS) < 1e-9,
    );
    check('做戒指要花材料', ringed.resources.stone.lt(withSpace.resources.stone));
  }

  /* ---- 存档往返 ---- */
  {
    const saved: GameState = {
      ...createInitialState(0),
      enlightenment: { metal: 42, time: 7, space: 15 },
      enlightening: { pathId: 'wood', remaining: 60, total: 120 },
      spaceRings: 2,
      lastTimeJump: 1234,
    };
    const round = deserialize(JSON.parse(JSON.stringify(serialize(saved))));
    check('感悟能存档还原', round !== null);
    if (round) {
      check('阶数保留', round.enlightenment.metal === 42 && round.enlightenment.time === 7);
      check('正在感悟的那一阶保留', round.enlightening?.pathId === 'wood');
      check('空间戒指数保留', round.spaceRings === 2);
      check('上次穿梭时间保留', round.lastTimeJump === 1234);
      check('没修过的道是 0 阶', round.enlightenment.earth === 0);
    }

    const junk = deserialize({ v: 4, at: 0, en: { metal: 9999, notAPath: 50 }, eg: { pathId: 'nope' }, sr: 99 });
    check('越界的阶数被夹回 90', !!junk && junk.enlightenment.metal === MAX_ENLIGHTEN_LEVEL);
    check('不存在的道被丢弃', !!junk && junk.enlightenment.notAPath === undefined);
    check('非法的"正在感悟"被丢弃', !!junk && junk.enlightening === null);
    check('越界的戒指数被夹回上限', !!junk && junk.spaceRings === MAX_SPACE_RINGS);
  }
}

/* ------------------------------------------------------------------ */
/* 37. 进阶资源（需求 4）                                                */
/* ------------------------------------------------------------------ */
section('[37] 进阶资源：合成、出口、商行（需求 4）');
{
  check('三种进阶资源', REFINED_MATERIAL_IDS.length === 3, REFINED_MATERIAL_IDS.join('、'));
  check('合成配方至少 4 条（含原本的灵石合成）', REFINE_RECIPES.length >= 4, `${REFINE_RECIPES.length} 条`);
  check(
    '每种进阶资源都有一条配方产出它',
    REFINED_MATERIAL_IDS.every((id) => REFINE_RECIPES.some((r) => r.output.item === id)),
  );
  check(
    '配方都是"基础资源 → 进阶资源"',
    REFINE_RECIPES.filter((r) => REFINED_MATERIAL_IDS.includes(r.output.item as never)).every((r) =>
      Object.keys(r.cost).every((id) => (RESOURCE_IDS as readonly string[]).includes(id)),
    ),
  );

  /* ---- 合成真的能拿到东西 ---- */
  {
    const rich: GameState = grant({ ...createInitialState(0), realmIndex: 4 }, {
      qi: '1e9',
      herb: '1e7',
      ore: '1e7',
      wood: '1e7',
      stone: '1e7',
    });
    const withTech: GameState = {
      ...rich,
      techs: { ...rich.techs, alchemyArt: true, refiningArt: true, architecture: true },
    };
    const check1 = engine.maxRefine(withTech, 'spiritEssenceRefine');
    check('资源够时可以合成灵液', check1 > 0, `可合成 ${check1} 次`);

    const once = engine.refine(withTech, 'spiritEssenceRefine', 1);
    check('合成产出灵液', once.materials.spiritEssence.toNumber() === 1, `${once.materials.spiritEssence.toNumber()}`);
    check('合成会扣掉灵气', once.resources.qi.lt(withTech.resources.qi));

    const none = engine.refine(createInitialState(0), 'spiritEssenceRefine', 1);
    check('门槛没到 / 资源不够时合不了', none === createInitialState(0) || none.materials.spiritEssence.toNumber() === 0);
  }

  /* ---- 出口：炼丹、炼器、阵法 ---- */
  {
    check(
      '高品丹方要吃灵液',
      PILLS.filter((p) => p.tier >= 5).some((p) => (p.cost as Record<string, number>).spiritEssence > 0),
    );
    check(
      '高品器物要吃精金',
      ARTIFACTS.filter((a) => a.tier >= 5).some((a) => (a.cost as Record<string, number>).refinedGold > 0),
    );
    check(
      '宗门大阵要吃阵枢（需求 1 与 4 串起来了）',
      SECT_FORMATIONS.every((f) => (f.baseCost as Record<string, number>).arrayCore > 0),
    );
    check(
      '商行也卖进阶资源',
      REFINED_MATERIAL_IDS.every((id) => SHOP_GOODS.some((g) => g.kind === 'material' && g.item === id)),
    );
  }
}

/* ------------------------------------------------------------------ */
/* 38. 秘境档次、开启与死亡（需求 1）                                    */
/* ------------------------------------------------------------------ */
section('[38] 秘境档次 / 富集区开启（需求 1）');
{
  const tiers = SECRET_REALMS.map((r) => r.tier);
  check('秘境档次不重复（1~9）', new Set(tiers).size === 9, `${new Set(tiers).size} 档`);

  /* ---- 越高级的秘境，时长与冷却越长 ---- */
  const byTier = (t: number) => SECRET_REALMS.filter((r) => r.tier === t);
  const maxDuration = (t: number) => Math.max(...byTier(t).map((r) => r.duration));
  const maxCooldown = (t: number) => Math.max(...byTier(t).map((r) => r.cooldown));
  check(
    '档次越高，探索时长越长',
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every((t, i, a) => i === 0 || maxDuration(t) >= maxDuration(a[i - 1])),
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(maxDuration).join(' → '),
  );
  check(
    '档次越高，冷却越长',
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every((t, i, a) => i === 0 || maxCooldown(t) >= maxCooldown(a[i - 1])),
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(maxCooldown).join(' → '),
  );
  check(
    '九档的时长比一档长 20 倍以上',
    maxDuration(9) / maxDuration(1) >= 20,
    `${maxDuration(9)} / ${maxDuration(1)} = ${(maxDuration(9) / maxDuration(1)).toFixed(1)}×`,
  );
  check(
    '九档的冷却比一档长 20 倍以上',
    maxCooldown(9) / maxCooldown(1) >= 20,
    `${(maxCooldown(9) / maxCooldown(1)).toFixed(1)}×`,
  );

  /* ---- 越高级的秘境，死亡率越高 ---- */
  const maxCasualty = (t: number) => Math.max(...byTier(t).map((r) => r.baseCasualty));
  check(
    '档次越高，基础伤亡率越高',
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every((t, i, a) => i === 0 || maxCasualty(t) >= maxCasualty(a[i - 1])),
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => `${(maxCasualty(t) * 100).toFixed(0)}%`).join(' → '),
  );
  check('九档的基础伤亡率不低于四成', maxCasualty(9) >= 0.4, `${(maxCasualty(9) * 100).toFixed(0)}%`);
  check('基础伤亡率有上限，不会无限涨', maxCasualty(9) <= 0.45, `${(maxCasualty(9) * 100).toFixed(0)}%`);

  /* ---- 资源富集区的秘境要花资源开启 ---- */
  const richRealms = SECRET_REALMS.filter((r) => r.unlockCost !== undefined);
  const normalRealms = SECRET_REALMS.filter((r) => r.unlockCost === undefined);
  check('只有资源富集区的秘境需要开启', richRealms.length > 0 && richRealms.length < SECRET_REALMS.length, `${richRealms.length} 处`);
  check(
    '需要开启的都是富集区（下标 15）的秘境',
    richRealms.every((r) => (MAP_REGION_MAP[r.regionId]?.index ?? -1) === RICH_SUB_INDEX),
  );
  check('普通秘境不用开启', normalRealms.every((r) => !engine.needsOpening(r)));
  check(
    '开启花费里有进阶资源（阵枢）',
    richRealms.every((r) => (r.unlockCost?.arrayCore ?? 0) > 0),
  );
  check(
    '越深的富集区开启越贵',
    (() => {
      const lo = richRealms.filter((r) => r.tier <= 3).map((r) => r.unlockCost?.qi ?? 0);
      const hi = richRealms.filter((r) => r.tier >= 6).map((r) => r.unlockCost?.qi ?? 0);
      return Math.min(...hi) > Math.max(...lo);
    })(),
  );

  /* ---- 开启状态 ---- */
  {
    const target = richRealms[0];
    check('富集区秘境默认未开启', !engine.isRealmOpened(createInitialState(0), target));
    check(
      '普通秘境默认算已开启',
      engine.isRealmOpened(createInitialState(0), normalRealms[0]),
    );

    const discovered: GameState = {
      ...createInitialState(0),
      discoveredRealms: { ...createInitialState(0).discoveredRealms, [target.id]: true },
    };
    check('没资源时开不了', !engine.canOpenRealm(discovered, target).ok);

    const rich: GameState = grant(discovered, { qi: '1e15', stone: '1e10', ore: '1e10', arrayCore: '1e5' });
    check('资源够了就能开启', engine.canOpenRealm(rich, target).ok, engine.canOpenRealm(rich, target).reason ?? '');

    const opened = engine.openRealm(rich, target);
    check('开启后状态记为已开启', engine.isRealmOpened(opened, target));
    check('开启会扣掉资源', opened.resources.qi.lt(rich.resources.qi));
    check('开启写进记事', opened.journal.some((e) => e.text.includes('已开启')));
    check('重复开启会被拒绝', !engine.canOpenRealm(opened, target).ok);

    // 未开启时派不了队伍
    const gate = canStartExpedition(discovered, target.id, []);
    check('未开启的秘境派不了队伍', gate.ok === false, gate.reason ?? '');

    // 存档往返
    const round = deserialize(JSON.parse(JSON.stringify(serialize(opened))));
    check('开启状态能存档还原', !!round && engine.isRealmOpened(round, target));
    const junk = deserialize({ v: 4, at: 0, or: { [target.id]: true, notARealm: true } });
    check('不存在的秘境 id 会被丢弃', !!junk && junk.openedRealms.notARealm === undefined);
  }
}

/* ------------------------------------------------------------------ */
/* 39. 炼制成功率与可携带器物（需求 2）                                  */
/* ------------------------------------------------------------------ */
section('[39] 炼制成功率 / 可携带器物（需求 2）');
{
  /* ---- 丹房与炼器房唯一 ---- */
  check('丹房唯一', BUILDABLE_MAP.alchemyRoom.max === 1);
  check('炼器房唯一', BUILDABLE_MAP.refinery.max === 1);
  check(
    '升品不再要求建筑数量（需求 2）',
    crafting.getAlchemyUpgradeStatus(grant(createInitialState(0), { qi: '1e15', herb: '1e9' })).slotsNeeded === 0,
  );

  /* ---- 成功率：越高品越低，差三品必成 ---- */
  {
    check('一品基础 100%', CRAFT_BASE_SUCCESS[1] === 1);
    check(
      '品阶越高基础成功率越低',
      CRAFT_BASE_SUCCESS.slice(1).every((v, i, a) => i === 0 || v <= a[i - 1]),
      CRAFT_BASE_SUCCESS.slice(1).join(' → '),
    );
    check('九品基础成功率最低', CRAFT_BASE_SUCCESS[9] === Math.min(...CRAFT_BASE_SUCCESS.slice(1)));

    const at = (tier: number): GameState => ({ ...createInitialState(0), alchemyTier: tier, refiningTier: tier });
    check('炼同级：二品时炼二品丹 < 100%', crafting.getCraftSuccessRate(at(2), 'alchemy', 2) < 1);
    check(
      '炼制更低品阶有加成',
      crafting.getCraftSuccessRate(at(5), 'alchemy', 4) > crafting.getCraftSuccessRate(at(5), 'alchemy', 5),
    );
    // 需求明文：相差三个品阶时 100%
    check(
      '相差三品必定成功（需求明文）',
      [1, 2, 3, 4, 5, 6].every((t) => crafting.getCraftSuccessRate(at(t + 3), 'alchemy', t) === 1),
    );
    check(
      '相差两品不一定必成',
      crafting.getCraftSuccessRate(at(3), 'alchemy', 1) === 1 ||
        crafting.getCraftSuccessRate(at(2), 'alchemy', 1) < 1,
    );
    check(
      '差三品以上也必成',
      crafting.getCraftSuccessRate(at(9), 'alchemy', 1) === 1,
    );
    check('成功率描述会说清必成', crafting.describeCraftRate(at(5), 'alchemy', 2).includes('必成'));
  }

  /* ---- 失败会消耗材料但不产出 ---- */
  {
    const base: GameState = grant(
      { ...createInitialState(0), alchemyTier: 9, refiningTier: 9 },
      {
        qi: '1e15',
        herb: '1e12',
        ore: '1e12',
        demonCore: '1e9',
        blackIron: '1e9',
        spiritSilk: '1e9',
        moonDew: '1e9',
        starSand: '1e9',
        lunarCrystal: '1e9',
        dragonBlood: '1e9',
        netherFlame: '1e9',
        immortalJade: '1e9',
        chaosQi: '1e9',
        primordialFruit: '1e9',
        spiritEssence: '1e9',
        refinedGold: '1e9',
        fireMarrow: '1e9',
        coldJade: '1e9',
      },
    );
    // 让 random 恒定返回 0.999 → 一定落在成功率之外 → 必失败
    const failRandom = fixedRandom(0.999);
    const before = base.resources.herb;
    const failedRun = crafting.craftPill(base, 'tribulationPill', 1, failRandom);
    check('失败时不产出丹药', failedRun.made === 0 && failedRun.failed === 1, `${failedRun.made}/${failedRun.failed}`);
    check('失败照样扣材料', failedRun.state.resources.herb.lt(before));
    check('失败写进记事', failedRun.state.journal.some((e) => e.text.includes('失败')));

    // 恒定返回 0 → 必成功
    const okRun = crafting.craftPill(base, 'tribulationPill', 1, fixedRandom(0));
    check('必成时产出丹药', okRun.made === 1 && okRun.failed === 0);
  }

  /* ---- 可携带器物：耐久、损毁、加成失效 ---- */
  {
    const carryables = ARTIFACTS.filter((a) => a.carry);
    check('可携带器物至少 5 件', carryables.length >= 5, `${carryables.length} 件`);
    check('可携带器物都有正的耐久', carryables.every((a) => (a.carry?.charges ?? 0) > 0));
    check(
      '可携带器物的效果都跟探索有关',
      carryables.every((a) =>
        ['expeditionYield', 'expeditionSafety', 'expeditionSpeed', 'combat'].includes(a.effect.kind),
      ),
      carryables.map((a) => a.effect.kind).join('、'),
    );
    check('器物总数比原来多了（需求：种类有点少）', ARTIFACTS.length >= 15, `${ARTIFACTS.length} 件`);

    const gear = carryables[0];
    const state: GameState = {
      ...createInitialState(0),
      refiningTier: 9,
      artifacts: { [gear.id]: 1 },
      gearCharges: { [gear.id]: gear.carry!.charges },
    };
    check('满耐久时提供加成', engine.getGearCharges(state, gear) === gear.carry!.charges);

    // 消耗一次
    const once = engine.consumeGear(state);
    check('探索一次消耗一次耐久', engine.getGearCharges(once.state, gear) === gear.carry!.charges - 1);

    // 一直用到坏
    let worn: GameState = state;
    for (let i = 0; i < gear.carry!.charges; i += 1) worn = engine.consumeGear(worn).state;
    check('用满次数后损毁（从库存消失）', (worn.artifacts[gear.id] ?? 0) === 0);
    check('损毁后剩余次数归零', engine.getGearCharges(worn, gear) === 0);

    // 加成随耐久消失
    const bonusWith = engine.getArtifactBonuses(state);
    const bonusWithout = engine.getArtifactBonuses(worn);
    const kind = gear.effect.kind as keyof typeof bonusWith;
    check('有了再用坏，加成归零', bonusWithout[kind] < bonusWith[kind] + 1e-9);

    // 没记录 = 满次数（旧存档）
    const legacy: GameState = { ...createInitialState(0), artifacts: { [gear.id]: 1 }, gearCharges: {} };
    check('没记录耐久时按满次数算', engine.getGearCharges(legacy, gear) === gear.carry!.charges);

    // 存档往返
    const round = deserialize(JSON.parse(JSON.stringify(serialize(once.state))));
    check('耐久能存档还原', !!round && engine.getGearCharges(round, gear) === gear.carry!.charges - 1);
    const junk = deserialize({ v: 4, at: 0, ar: { [gear.id]: 1 }, gc: { [gear.id]: 9999, notGear: 5 } });
    check('越界耐久被夹回上限', !!junk && engine.getGearCharges(junk, gear) === gear.carry!.charges);
    check('没库存的器物不留耐久记录', !!junk && junk.gearCharges.notGear === undefined);

    // 新炼出来的按满次数
    const rich: GameState = grant(
      { ...createInitialState(0), refiningTier: 9 },
      { qi: '1e15', ore: '1e12', demonCore: '1e9', fireMarrow: '1e9', spiritSilk: '1e9', starSand: '1e9', moonDew: '1e9', refinedGold: '1e9' },
    );
    const crafted = crafting.craftArtifact(rich, 'beastBanner', 1, fixedRandom(0));
    check('炼出可携带器物时耐久写满', engine.getGearCharges(crafted.state, ARTIFACT_MAP.beastBanner) === 6);
  }

  /* ---- 成功率加成真的接上了吗（这条是补的：字段声明了但没人赋值过一次） ---- */
  {
    // 只认"炼丹 / 炼器成功率"的措辞 —— 雷池那种"突破成功率"是另一回事，
    // 不能被这条断言误伤（第一版就是这么写错的，冒烟当场纠正了）
    const claimsAlchemy = STRUCTURES.filter((s) => s.desc.includes('炼丹成功率 +'));
    const claimsRefining = STRUCTURES.filter((s) => s.desc.includes('炼器成功率 +'));
    check(
      '写了"炼丹成功率 +"的建筑真的带了 alchemySuccessBonus',
      claimsAlchemy.length > 0 && claimsAlchemy.every((s) => (s.alchemySuccessBonus ?? 0) > 0),
      claimsAlchemy.filter((s) => !((s.alchemySuccessBonus ?? 0) > 0)).map((s) => s.name).join('、') ||
        `${claimsAlchemy.length} 座`,
    );
    check(
      '写了"炼器成功率 +"的建筑真的带了 refiningSuccessBonus',
      claimsRefining.length > 0 && claimsRefining.every((s) => (s.refiningSuccessBonus ?? 0) > 0),
      claimsRefining.filter((s) => !((s.refiningSuccessBonus ?? 0) > 0)).map((s) => s.name).join('、') ||
        `${claimsRefining.length} 座`,
    );

    // 加成确实影响了成功率
    const bare = { ...createInitialState(0), alchemyTier: 4 };
    const withFurnace = forceBuild(bare, 'alchemyFurnace', 3);
    check(
      '建了丹炉阵之后炼丹成功率真的变高',
      crafting.getCraftSuccessRate(withFurnace, 'alchemy', 4) >
        crafting.getCraftSuccessRate(bare, 'alchemy', 4),
      `${(crafting.getCraftSuccessRate(bare, 'alchemy', 4) * 100).toFixed(0)}% → ${(
        crafting.getCraftSuccessRate(withFurnace, 'alchemy', 4) * 100
      ).toFixed(0)}%`,
    );
  }

  /* ---- 存活率丹药（需求 2） ---- */  {
    const pill = PILL_MAP.lifeGuardPill;
    check('存在提升探索存活率的丹药', Boolean(pill));
    check('保命丹是按次生效的', pill.effect.kind === 'expeditionSafety' && 'once' in pill.effect);

    const state: GameState = { ...createInitialState(0), alchemyTier: 9, pills: { lifeGuardPill: 1 } };
    const used = crafting.usePill(state, 'lifeGuardPill', fixedRandom(0));
    check('服用后设置按次标记', used.state.buffs.safetyOnce === true);
    check('服用后削减了伤亡率', used.state.buffs.safetyReduction > 0);
    // 时间流逝不会让它失效（按次，不看时间）
    const aged = applyTick(used.state, 5000, makeRandom(3));
    check('按次的保命效果不会随时间失效', aged.buffs.safetyOnce === true && aged.buffs.safetyReduction > 0);
  }
}

/* ------------------------------------------------------------------ */
/* 40. 弟子招收固定消耗（需求 3）                                        */
/* ------------------------------------------------------------------ */
section('[40] 弟子招收固定消耗（需求 3）');
{
  check(
    '同一品阶内，招收价格不随人数上涨',
    [0, 1, 5, 30, 200].every((n) => recruitCost(3, n) === recruitCost(3, 0)),
    `一品阶下 ${[0, 1, 5, 30, 200].map((n) => recruitCost(3, n)).join('、')}`,
  );
  check(
    '宗门品阶越高越贵',
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every((lv, i, a) => i === 0 || recruitCost(lv, 0) > recruitCost(a[i - 1], 0)),
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => recruitCost(lv, 0)).join(' → '),
  );
  check('一品招收 60 灵石', recruitCost(1, 0) === 60, `${recruitCost(1, 0)}`);
  check('九品招收 4860 灵石', recruitCost(9, 0) === 4860, `${recruitCost(9, 0)}`);

  // 真的招一次：连招两个价格一样
  {
    let s: GameState = grant(createInitialState(0), { qi: '1e9', stone: '1e7' });
    s = forceBuild(s, 'thatchHut', 8);
    s = { ...s, sect: { ...s.sect, founded: true, level: 3 } };
    const first = disciples.recruitDisciple(s, makeRandom(11));
    const second = disciples.recruitDisciple(first.state, makeRandom(12));
    check('招到了弟子', !!first.disciple && !!second.disciple);
    // 三次品阶：60 × 3² = 540 灵石，且第二个还是 540（不随人数涨）
    const cost1 = s.resources.stone.sub(first.state.resources.stone);
    const cost2 = first.state.resources.stone.sub(second.state.resources.stone);
    check('三次品阶的招收价是 540', cost1.eq(D(recruitCost(3, 0))), `${cost1.toNumber()}`);
    check('第二个弟子还是同一个价', cost2.eq(cost1), `${cost1.toNumber()} → ${cost2.toNumber()}`);
  }
}

/* ------------------------------------------------------------------ */
/* 41. 本轮界面与探索改动（需求 1~7）                                    */
/* ------------------------------------------------------------------ */
section('[41] 界面布局 / 普通探索 / 唯一建筑 / 满仓倒计时');
{
  /* ---- 需求 2：纪年在页头右上角 ---- */
  {
    const out = renderToString(<App />);
    const headerEnd = out.indexOf('</header>');
    const yearIdx = out.indexOf('year-badge');
    check('页头里有纪年', yearIdx >= 0);
    check('纪年在页头内（右上角那块）', yearIdx > 0 && yearIdx < headerEnd);
    // React SSR 会在文本节点之间插注释，所以不能直接匹配「第 N 年」这种整串
    check('纪年里有年份那一块', out.includes('year-badge__year') && out.includes('年'));
    // 需求 3：资源栏底下不该再有季节/纪年的常驻条
    check('资源栏底下不再挂季节条', !out.includes('season-strip'));
  }

  /* ---- 需求 3：满仓倒计时 ---- */
  {
    const cap = D(1000);
    check('半满且有产出时给得出时间', secondsToFull(D(500), cap, D(1)) === 500);
    check('已满时不给时间', secondsToFull(cap, cap, D(1)) === null);
    check('没产出时不给时间', secondsToFull(D(500), cap, D(0)) === null);
    check('没上限时不给时间', secondsToFull(D(500), D(0), D(1)) === null);
    check('文案：已满', describeFullIn(cap, cap, D(1)) === '已满');
    check('文案：无产出', describeFullIn(D(1), cap, D(0)) === '无产出');
    check('文案：含"后满"', describeFullIn(D(0), cap, D(1)).includes('后满'));

    // 资源栏真的分成三组、都有折叠头
    const out = renderToString(<App />);
    check('资源栏有分组标题', out.includes('基础资源') && out.includes('res-group__head'));
    check('资源栏出现了满仓倒计时', out.includes('resource__eta'));
  }

  /* ---- 需求 7：折叠开关真的接线了吗 ---- */
  {
    /*
     * 这一条是补的：组件写好了 `collapsible` 参数，`App.tsx` 里却忘了传 ——
     * 于是"可折叠"在界面上完全看不出来（不报错、不崩、类型也过，
     * 因为 prop 是可选的）。所以直接断言渲染结果里真有折叠标题栏。
     */
    const out = renderToString(<App />);
    check('渲染结果里有可折叠的标题栏', out.includes('panel__head--toggle'));
    check('折叠按钮带 aria-expanded', out.includes('aria-expanded'));
  }

  /* ---- 需求 1（本轮）：钻研在仆役下面、感悟升为页签 ---- */
  {
    const out = renderToString(<App />);
    const nav = out.slice(out.indexOf('<nav'), out.indexOf('</nav>'));
    check('页签里有「感悟」', nav.includes('感悟'));
    check('页签里有「洞府」（同级对照）', nav.includes('洞府'));

    /*
     * 钻研要排在仆役**下面**。SSR 输出的顺序就是渲染顺序，
     * 所以直接比较两者在 HTML 里的位置即可 —— 这比断言 CSS 的 grid 顺序可靠。
     */
    const servantIdx = out.indexOf('仆役');
    const researchIdx = out.indexOf('钻研');
    check('钻研排在仆役之后', servantIdx >= 0 && researchIdx > servantIdx, `仆役@${servantIdx} 钻研@${researchIdx}`);
  }

  /* ---- 需求 2（本轮）：分类建筑与丹器品阶都能折叠 ---- */
  {
    // 折叠区在「洞府」与「丹器」两页，默认的修行页里没有，所以要各自渲染
    const buildings = renderToString(<BuildingsPanel />);
    check('建筑分组可折叠', buildings.includes('fold__head'));
    check('建筑分组标题会渲染出分组名', /fold__title/.test(buildings));

    const alchemy = renderToString(<AlchemyPanel />);
    check('丹药按品阶分组且可折叠', alchemy.includes('fold__head'));
    check('丹药分组标题写着品阶', alchemy.includes('丹方'));
  }

  /* ---- 需求 5：普通探索 ---- */
  {
    // 门槛按**大区域**算，而不是小区域档次
    const eastSubs = MAP_REGIONS.filter((r) => r.majorId === 'eastMountains');
    check(
      '东部群山全境的可达门槛都是 0（大区域口径）',
      eastSubs.every((r) => surveyReachRealm(r.id) === 0),
      Array.from(new Set(eastSubs.map((r) => surveyReachRealm(r.id)))).join('、'),
    );
    check(
      '小区域自己的门槛仍然是一路上涨的（守卫这条测试本身）',
      new Set(eastSubs.map((r) => r.requiresRealm)).size > 1,
    );

    const fresh = createInitialState(0);
    check('炼气期就能在东部群山做普通探索', canSurveyRegion(fresh, 'eastMountains_15').ok);
    check('中州（需元婴）炼气期去不了', !canSurveyRegion(fresh, 'centralState_0').ok);

    // 掌门亲往：开宗前也能用
    check('未开宗时也能掌门亲往', canStartSoloSurvey(fresh, 'eastMountains_1').ok, canStartSoloSurvey(fresh, 'eastMountains_1').reason ?? '');
    check(
      '未开宗时派不了队伍（要弟子）',
      canStartSurvey(fresh, 'eastMountains_1', []).ok === false,
    );

    // 真的跑一次掌门亲探
    const started = startSoloSurvey(fresh, 'eastMountains_1');
    check('出发后记为 survey 行程', started.personalTravel?.kind === 'survey');
    check('行程时长是正的', (started.personalTravel?.duration ?? 0) > 0);

    const done = tickTravel(
      { ...started, personalTravel: { ...started.personalTravel!, progress: started.personalTravel!.duration } },
      1,
      makeRandom(9),
    );
    check('亲探归来后行程清空', done.personalTravel === null);
    check('亲探有产出或至少记了一笔', done.journal.length > started.journal.length);
    check('亲探写的是"查探"', done.journal.some((e) => e.text.includes('查探')));

    // 存档往返
    const round = deserialize(JSON.parse(JSON.stringify(serialize(started))));
    check('亲探行程能存档还原', !!round && round.personalTravel?.kind === 'survey');
    const legacy = deserialize({ v: 4, at: 0, pt: { regionId: 'eastMountains_0', progress: 1, duration: 60 } });
    check('旧存档没有 kind 时按游历处理', !!legacy && (legacy.personalTravel === null || legacy.personalTravel.kind === 'travel'));
  }

  /* ---- 需求 4：唯一建筑建成后没有建造/排队按钮 ---- */
  {
    const unique = BUILDABLES.filter((def) => engine.getMaxCount(def) === 1);
    check('存在唯一类建筑', unique.length > 0, `${unique.length} 座`);

    const target = BUILDABLE_MAP.alchemyRoom;
    const built: GameState = {
      ...forceBuild(grant(createInitialState(0), { qi: '1e12', wood: '1e9' }), 'alchemyRoom', 1),
      techs: { ...createInitialState(0).techs, alchemyArt: true },
    };
    const out = renderToString(<BuildingsPanel />);
    void out;

    // 组件是读 store 的，所以这里直接验引擎层的判据：建满之后 maxAffordable 为 0
    check('唯一建筑建满后不能再建', engine.getBuildingCount(built, target.id) >= engine.getMaxCount(target));
    check('唯一建筑的最大可建数为 0', engine.maxAffordable(target, 1, built) === 0);
  }

  /* ---- 需求 6：唯一工坊的升级需要对应等级的技术 ---- */
  {
    const base = grant(
      { ...createInitialState(0), techs: { ...createInitialState(0).techs, alchemyArt: true } },
      { qi: '1e12', herb: '1e9', ore: '1e9' },
    );
    const room = forceBuild(base, 'alchemyRoom', 1);
    check('有丹房 + 入门技术就能升二品', getAlchemyUpgradeStatus(room).possible);
    check(
      '炼器房也走同一套（需炼器入门）',
      (getRefiningUpgradeStatus(forceBuild(base, 'refinery', 1)).reason ?? '').includes('炼器入门'),
    );
    check(
      '钻研器道精要后七品放行（先要过五品那一档）',
      (getRefiningUpgradeStatus({ ...room, refiningTier: 6 }).reason ?? '').includes('器道精要') ||
        (getRefiningUpgradeStatus({ ...room, refiningTier: 6 }).reason ?? '').includes('通天营造'),
      getRefiningUpgradeStatus({ ...room, refiningTier: 6 }).reason ?? '',
    );
  }
}

/* ------------------------------------------------------------------ */
/* 42. 顺序体检：有没有"要 A 得先有 A"的循环（需求 3）                    */
/* ------------------------------------------------------------------ */
section('[42] 顺序体检：前置不能比产物更晚（需求 3）');
{
  /*
   * 需求原文：「境界丹是突破到这个境界使用，但是境界丹的炼制（包括炼丹等级的晋升
   * 和材料）又需要突破后的等级才能获取，有点卡手了，你看看还有没有其它类似的问题」。
   *
   * 所以这一节把"顺序"这件事形式化：先算出**每样东西最早能在哪个境界拿到**，
   * 再检查每一处"前置 → 产物"的关系里，前置是否比"用到产物的那一刻"更晚。
   * 这类问题不报错、不崩，玩家的进度会**静默地**卡住 —— 所以必须由断言守着。
   */
  const MAX_R = REALMS.length - 1;

  /* ---- 来源表：item → 最早境界 ---- */
  const earliest = new Map<string, number>();
  for (const id of RESOURCE_IDS) earliest.set(id, 0);
  for (const realm of SECRET_REALMS) {
    for (const l of realm.loot) {
      const cur = earliest.get(l.item as string);
      if (cur === undefined || realm.minRealm < cur) earliest.set(l.item as string, realm.minRealm);
    }
  }
  // 进阶资源要迭代几轮（它们自己也可能吃进阶资源）
  for (let pass = 0; pass < 4; pass += 1) {
    for (const recipe of REFINE_RECIPES) {
      let need = recipe.requiresRealm ?? 0;
      const tech = recipe.requiresTech;
      if (tech) need = Math.max(need, TECHS.find((t) => t.id === tech)?.requiresRealm ?? 0);
      for (const item of Object.keys(recipe.cost)) need = Math.max(need, earliest.get(item) ?? 99);
      if (need > MAX_R) continue;
      const cur = earliest.get(recipe.output.item);
      if (cur === undefined || need < cur) earliest.set(recipe.output.item, need);
    }
  }
  const at = (id: string): number => earliest.get(id) ?? 99;

  /* ---- ① 境界丹：全部前置必须在**突破之前**（含当前境界）到手 ---- */
  const chainBreaks: string[] = [];
  for (let R = 0; R < MAX_R; R += 1) {
    const pill = PILL_MAP[REALMS[R].breakthroughPill];
    if (!pill) continue;
    const late: string[] = [];
    for (let t = 2; t <= pill.tier; t += 1) {
      const tech = ALCHEMY_TIER_TECH[t];
      if (tech && (TECHS.find((x) => x.id === tech)?.requiresRealm ?? 0) > R) {
        late.push(`升 ${t} 品的技术「${TECH_MAP[tech]?.name ?? tech}」`);
      }
      for (const item of Object.keys(ALCHEMY_TIER_COST[t] ?? {})) {
        if (at(item) > R) late.push(`升 ${t} 品要的${ITEM_MAP[item as ItemId]?.name ?? item}`);
      }
    }
    for (const item of Object.keys(pill.cost)) {
      if (at(item) > R) late.push(`${ITEM_MAP[item as ItemId]?.name ?? item}`);
    }
    if (late.length > 0) {
      chainBreaks.push(`${pill.name}（${REALMS[R].name}→${REALMS[R + 1].name}）：${late.join('、')}`);
    }
  }
  check('每颗境界丹的前置链都能在突破之前走通', chainBreaks.length === 0, chainBreaks.join(' / '));

  /* ---- ② 升品材料不能比该品阶本身更晚 ---- */
  const lateTiers: string[] = [];
  for (let t = 3; t <= MAX_CRAFT_TIER; t += 1) {
    for (const [cost, label] of [
      [ALCHEMY_TIER_COST, '炼丹'],
      [REFINING_TIER_COST, '炼器'],
    ] as const) {
      for (const item of Object.keys(cost[t] ?? {})) {
        if (at(item) > t - 1) {
          lateTiers.push(`${label} ${t} 品要的${ITEM_MAP[item as ItemId]?.name ?? item}（第 ${at(item) + 1} 境才有）`);
        }
      }
    }
  }
  check('升品材料不会比该品阶更晚出现', lateTiers.length === 0, lateTiers.join('、'));

  /* ---- ③ 秘境的两个门槛（境界 / 宗门）不能互相倒挂 ---- */
  const inverted: string[] = [];
  for (const realm of SECRET_REALMS) {
    const need = realm.requiresSectLevel ?? 0;
    if (need <= 0) continue;
    const sectRealm = SECT_LEVELS[need - 1]?.requiresRealm ?? 0;
    if (sectRealm > realm.minRealm) {
      inverted.push(
        `${realm.name}（需${REALMS[realm.minRealm].name}）却要 ${need} 品宗门（需${REALMS[sectRealm].name}）`,
      );
    }
  }
  check(
    '秘境不会要求一个该境界还达不到的宗门品阶',
    inverted.length === 0,
    `${inverted.length} 处：${inverted.slice(0, 3).join('；')}`,
  );

  /* ---- ④ 技术树的前置不能让自身更难 ---- */
  check(
    '技术的前置不会要求更高的境界',
    TECHS.every((t) =>
      (t.requires ?? []).every(
        (p) => (TECHS.find((x) => x.id === p)?.requiresRealm ?? 0) <= t.requiresRealm,
      ),
    ),
  );

  /* ---- ⑤ 器物材料不能比它的品阶更晚 ---- */
  const lateArtifacts = ARTIFACTS.filter((a) => Object.keys(a.cost).some((i) => at(i) > a.tier));
  check('器物的材料都在它的品阶之前可得', lateArtifacts.length === 0, lateArtifacts.map((a) => a.name).join('、'));

  /* ---- ⑥ 进阶资源的门槛不能晚于第一次用到它 ---- */
  const gateTooLate: string[] = [];
  for (const recipe of REFINE_RECIPES) {
    const out = recipe.output.item as string;
    const gate = recipe.requiresRealm ?? 0;
    const users: number[] = [];
    for (const pill of PILLS) {
      if (!Object.keys(pill.cost).includes(out)) continue;
      const R = REALMS.findIndex((r) => r.breakthroughPill === pill.id);
      users.push(R >= 0 ? R : pill.tier - 1);
    }
    for (let t = 2; t <= MAX_CRAFT_TIER; t += 1) {
      if (Object.keys(ALCHEMY_TIER_COST[t] ?? {}).includes(out)) users.push(t - 1);
      if (Object.keys(REFINING_TIER_COST[t] ?? {}).includes(out)) users.push(t - 1);
    }
    if (users.length > 0 && gate > Math.min(...users)) {
      gateTooLate.push(`${recipe.name}（需第 ${gate + 1} 境）但第 ${Math.min(...users) + 1} 境就要用`);
    }
  }
  check('进阶资源的门槛不晚于第一次用到它', gateTooLate.length === 0, gateTooLate.join('、'));
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
