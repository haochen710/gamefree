/**
 * 声望 · 声望商店 · 山门先天特质 · 结局判定（设定集第 1 / 9 / 10 章）
 *
 * 与本作其它模块的分工：
 *   - `content/fame.ts` 只有数据；
 *   - 这里做纯函数与聚合；
 *   - 界面在 `components/FamePanel.tsx`（段位与商店）与
 *     `components/TraitPanel.tsx`（开局三选一）。
 *
 * ⚠️ 本模块的每一条加成都在下面写清了**它被谁读**。这不是形式主义：
 * 本作已经栽过六次"字段声明了、界面显示着、但没有任何读取点"的跟头
 * （宗门防御、破境降心魔、心魔突破惩罚…），所以规则就定成
 * **加一条效果，就在注释里点出它的读取点**。
 */
import { D } from './decimal';
import { addItem } from './engine';
import { addFragments, addManual } from './manuals';
import { gameRandom, weightedDraw, type RandomSource } from './random';
import { pushJournal } from './disciples';
import {
  FAME_GAIN_CAP,
  FAME_GOODS,
  FAME_GOOD_MAP,
  FAME_MAX,
  FAME_PER_KARMA_POINT,
  FAME_PER_REALM_TIER,
  FAME_PER_SURVEY,
  FAME_SHOP_REFRESH_SECONDS,
  FAME_SHOP_SLOTS,
  FAME_TIERS,
  TRAITS,
  TRAIT_MAP,
  TRAIT_OFFER_COUNT,
  DOMINATE_FAME,
  HERMIT_FAME,
  HERMIT_SECT_LEVEL,
  ENDING_MAP,
  type EndingId,
  type FameGoodDef,
  type FameTierDef,
  type TraitDef,
} from './content';
import { manualsOfGrade, type ManualGrade } from './content';
import type { GameState } from './state';

/* ------------------------------------------------------------------ */
/* 声望：段位与增减                                                     */
/* ------------------------------------------------------------------ */

export function getFame(state: GameState): number {
  return Math.max(0, Math.min(FAME_MAX, state.fame));
}

/** 当前段位（从高往低找第一个够门槛的） */
export function getFameTier(state: GameState): FameTierDef {
  const fame = getFame(state);
  for (let i = FAME_TIERS.length - 1; i >= 0; i -= 1) {
    if (fame >= FAME_TIERS[i].min) return FAME_TIERS[i];
  }
  return FAME_TIERS[0];
}

/** 下一个段位（已到顶则为 null） */
export function getNextFameTier(state: GameState): FameTierDef | null {
  const current = getFameTier(state);
  const index = FAME_TIERS.findIndex((t) => t.id === current.id);
  return FAME_TIERS[index + 1] ?? null;
}

/** 距离下一段位还差多少声望 */
export function getFameToNextTier(state: GameState): number | null {
  const next = getNextFameTier(state);
  return next ? Math.max(0, next.min - getFame(state)) : null;
}

export interface FameChange {
  state: GameState;
  /** 实际变动量（已夹到 0~FAME_MAX） */
  delta: number;
  /** 是否因此升了段位 */
  tierUp: FameTierDef | null;
}

/**
 * 改变声望。
 *
 * 单次变动夹到 ±FAME_GAIN_CAP（400）：否则一次"九档秘境 + 大胜"就能从
 * 无名小卒跳到名震天下，段位这套东西就没有过程可言了。
 * 升级时写一条记事 —— 段位是玩家能感知到的少数几个"里程碑"之一。
 */
export function changeFame(state: GameState, rawDelta: number, reason?: string): FameChange {
  if (rawDelta === 0) return { state, delta: 0, tierUp: null };
  const before = getFame(state);
  const delta = Math.max(-FAME_GAIN_CAP, Math.min(FAME_GAIN_CAP, rawDelta));
  const after = Math.max(0, Math.min(FAME_MAX, before + delta));
  if (after === before) return { state, delta: 0, tierUp: null };

  let working: GameState = { ...state, fame: after };
  const beforeTier = getFameTier(state);
  const afterTier = getFameTier(working);
  let tierUp: FameTierDef | null = null;
  if (afterTier.id !== beforeTier.id && after > before) {
    tierUp = afterTier;
    working = {
      ...working,
      journal: pushJournal(working.journal, {
        time: working.playTime,
        kind: 'good',
        text: `声望大振：宗门跻身「${afterTier.name}」（声望 ${Math.round(after)}）${
          reason ? ` · ${reason}` : ''
        }`,
      }),
    };
  }
  return { state: working, delta: after - before, tierUp };
}

/** 秘境探索的声望收益（按档次） */
export function fameFromRealm(tier: number): number {
  return FAME_PER_REALM_TIER * Math.max(1, tier);
}

/** 善行值换算的声望（设定集第 9 章：善行也能挣名声） */
export function fameFromKarma(karma: number): number {
  return Math.max(0, Math.round(karma * FAME_PER_KARMA_POINT));
}

export function fameFromSurvey(): number {
  return FAME_PER_SURVEY;
}

/* ------------------------------------------------------------------ */
/* 声望商店                                                            */
/* ------------------------------------------------------------------ */

export interface FameOffer {
  goodId: string;
  /*
   * 兑换价（声望点数）。
   *
   * 这里**没有**段位折扣：段位在这条线上只做两件事 —— 决定能看到哪些货
   * （minTier），以及给招收/商行折扣。注释原写成"已按段位折扣算好的实价"，
   * 与实现不符（文档代理核出来的），现在改成实话。
   */
  price: number;
}

function tierRank(id: string): number {
  return FAME_TIERS.findIndex((t) => t.id === id);
}

/** 当前段位能看到的货（段位不足的不出现） */
export function availableFameGoods(state: GameState): FameGoodDef[] {
  const rank = tierRank(getFameTier(state).id);
  return FAME_GOODS.filter((good) => !good.minTier || rank >= tierRank(good.minTier));
}

/**
 * 重摇声望货架。
 *
 * 与灵石商行同一个形状（每 FAME_SHOP_REFRESH_SECONDS 秒重摇、不放回抽 N 件），
 * 这样玩家不用学两套规则。
 */
export function buildFameOffers(state: GameState, random: RandomSource = gameRandom): FameOffer[] {
  const pool = availableFameGoods(state).map((good) => ({ ...good }));
  if (pool.length === 0) return [];
  const picked = weightedDraw(pool, Math.min(FAME_SHOP_SLOTS, pool.length), random);
  return picked.map((good) => ({ goodId: good.id, price: good.price }));
}

export function refreshFameShop(state: GameState, random: RandomSource = gameRandom): GameState {
  return {
    ...state,
    fameShop: { offers: buildFameOffers(state, random), secondsLeft: FAME_SHOP_REFRESH_SECONDS },
  };
}

/**
 * 货架倒计时。
 *
 * 与灵石商行（`shop.tickShop`）保持**同一个形状**：没开宗就没有货；
 * 货架空着就立刻补一次；否则减计时、到点重摇。
 * 两处形状必须一致 —— 否则玩家会发现"两个商店的刷新手感不一样"。
 */
export function tickFameShop(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (!state.sect.founded) {
    return state.fameShop.offers.length === 0 ? state : { ...state, fameShop: { offers: [], secondsLeft: 0 } };
  }
  if (state.fameShop.offers.length === 0) return refreshFameShop(state, random);
  if (dt <= 0) return state;

  const secondsLeft = state.fameShop.secondsLeft - dt;
  if (secondsLeft > 0) return { ...state, fameShop: { ...state.fameShop, secondsLeft } };
  return refreshFameShop(state, random);
}

export interface FameBuyResult {
  state: GameState;
  ok: boolean;
  message: string;
}

export function canBuyFameOffer(state: GameState, goodId: string): { ok: boolean; reason: string | null } {
  const good = FAME_GOOD_MAP[goodId];
  if (!good) return { ok: false, reason: '没有这件货' };
  if (!state.fameShop.offers.some((o) => o.goodId === goodId)) {
    return { ok: false, reason: '货架上已经没有这件东西' };
  }
  if (getFame(state) < good.price) return { ok: false, reason: `声望不足（需 ${good.price}）` };
  const rank = tierRank(getFameTier(state).id);
  if (good.minTier && rank < tierRank(good.minTier)) return { ok: false, reason: '段位不足' };
  return { ok: true, reason: null };
}

/**
 * 用声望兑换。
 *
 * 与灵石商行一样是**先货后钱**：先把东西放进仓库，再扣声望，
 * 中途任何一步失败都不会出现"声望扣了、东西没到"。
 * 兑换完立刻把那一格从货架上撤掉（不是刷新整架）。
 */
export function buyFameOffer(state: GameState, goodId: string, random: RandomSource = gameRandom): FameBuyResult {
  const check = canBuyFameOffer(state, goodId);
  if (!check.ok) return { state, ok: false, message: check.reason ?? '无法兑换' };
  const good = FAME_GOOD_MAP[goodId];

  let working = state;
  let label = `${good.icon}${good.name}×${good.amount}`;

  if (good.kind === 'material' && good.materialId) {
    working = addItem(working, good.materialId, D(good.amount));
  } else if (good.kind === 'fragment') {
    // 从对应品阶里随机抽一本功法给碎片
    const grade = fragmentGradeOfGood(good.id);
    const pool = manualsOfGrade(grade);
    if (pool.length === 0) return { state, ok: false, message: '此品阶暂无功法' };
    const def = pool[Math.floor(random() * pool.length)];
    working = addFragments(working, def.id, good.amount);
    label = `${def.name}碎片×${good.amount}`;
  } else if (good.kind === 'manual' && good.manualId) {
    working = addManual(working, good.manualId, good.amount);
  }

  const offers = working.fameShop.offers.filter((o) => o.goodId !== goodId);
  working = {
    ...working,
    fame: Math.max(0, getFame(working) - good.price),
    fameShop: { ...working.fameShop, offers },
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'good',
      text: `以 ${good.price} 点声望兑换 ${label}`,
    }),
  };
  return { state: working, ok: true, message: `兑换 ${label}` };
}

/** 声望商店里"哪几档碎片"由货 id 决定（写成表比在 if 里猜要清楚） */
export function fragmentGradeOfGood(goodId: string): ManualGrade {
  switch (goodId) {
    case 'fameFragmentFine':
      return 2;
    case 'fameFragmentRare':
      return 3;
    case 'fameFragmentEpic':
      return 4;
    default:
      return 1;
  }
}

/* ------------------------------------------------------------------ */
/* 山门先天特质                                                        */
/* ------------------------------------------------------------------ */

/**
 * 抽取开局候选特质（设定集：开局三选一）。
 *
 * 传承特质（`legacy`）只有在**通关过至少一次**之后才会进入候选池 ——
 * 解锁状态存在 `state.legacyEndings` 里，它跨周目保留（存档层面）。
 * 已经选过的不会重复出现（一局只能选一个，这里直接排除掉当前已有的）。
 */
export function rollTraitOffer(
  state: GameState,
  random: RandomSource = gameRandom,
  count = TRAIT_OFFER_COUNT,
): string[] {
  const unlockedLegacy = state.legacyEndings.length > 0;
  const pool = TRAITS.filter((t) => (t.legacy ? unlockedLegacy : true)).filter(
    (t) => !state.traits.includes(t.id),
  );
  if (pool.length === 0) return [];
  const picked = weightedDraw(
    pool.map((t) => ({ ...t, weight: 1 })),
    Math.min(count, pool.length),
    random,
  );
  return picked.map((t) => t.id);
}

export function canChooseTrait(state: GameState, traitId: string): { ok: boolean; reason: string | null } {
  const def = TRAIT_MAP[traitId];
  if (!def) return { ok: false, reason: '没有这个特质' };
  if (state.traits.length > 0) return { ok: false, reason: '山门特质已定，不可更改' };
  if (!state.traitOffer.includes(traitId)) return { ok: false, reason: '不在本次候选之列' };
  if (def.legacy && state.legacyEndings.length === 0) return { ok: false, reason: '需先完成一次周目' };
  return { ok: true, reason: null };
}

/** 选定先天特质（只能选一次） */
export function chooseTrait(state: GameState, traitId: string): GameState {
  if (!canChooseTrait(state, traitId).ok) return state;
  const def = TRAIT_MAP[traitId];
  const working: GameState = {
    ...state,
    traits: [traitId],
    traitOffer: [],
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'good',
      text: `山门气运已定：${def.icon}${def.name} —— ${def.desc}`,
    }),
  };
  return working;
}

export function hasTrait(state: GameState, traitId: string): boolean {
  return state.traits.includes(traitId);
}

/* ---- 特质加成的聚合（每一条都注明读取点） ---- */

/** 灵气产出倍率 —— 读取点：`engine.getProduction` */
export function traitQiMultiplier(state: GameState): number {
  let mult = 1;
  if (hasTrait(state, 'spiritVein')) mult *= 1.25;
  if (hasTrait(state, 'eternalSpring')) mult *= 1.15;
  return mult;
}

/** 灵草产出倍率 —— 读取点：`engine.getProduction` */
export function traitHerbMultiplier(state: GameState): number {
  return hasTrait(state, 'herbGarden') ? 1.25 : 1;
}

/** 灵植成熟时间倍率 —— 读取点：`planting.plantSeed` */
export function traitPlantingSpeed(state: GameState): number {
  return hasTrait(state, 'herbGarden') ? 1.1 : 1;
}

/** 碎片掉落概率倍率 —— 读取点：`manuals.rollFragmentDrop` */
export function traitFragmentMultiplier(state: GameState): number {
  return hasTrait(state, 'scriptureVault') ? 1.5 : 1;
}

/** 宗门防御加成 —— 读取点：`encounter.getSectDefense` */
export function traitSectDefense(state: GameState): number {
  return hasTrait(state, 'ironArmy') ? 0.15 : 0;
}

/** 弟子伤亡率乘数 —— 读取点：`expeditions.resolveExpedition` 的 casualtyRate */
export function traitCasualtyMultiplier(state: GameState): number {
  return hasTrait(state, 'ironArmy') ? 0.98 : 1;
}

/** 商行买入折扣 —— 读取点：`shop.canBuyOffer` / `shop.buyShopOffer` */
export function traitShopBuyMultiplier(state: GameState): number {
  return hasTrait(state, 'merchantRoad') ? 0.85 : 1;
}

/*
 * ⚠️ 这里删掉了三个函数（`traitShopSellMultiplier` / `traitAptitudeBonus` /
 * `traitAlchemyDoubleChance`）：它们写在 fame.ts 里，却被别处用
 * `engine.getTraitEffect(state, 'xxx')` 直接读表实现 —— 于是它们
 * **永远不会被调用**（文档代理核出来的第 93 条坑那一族）。
 *
 * 教训值得写在这儿：**把数值收进一张表、只留一个聚合函数，能防住
 * "文案与代码不一致"，但防不住"另写一个函数、然后没人调用它"。**
 * 所以规则补一条：**一个效果只能有一个实现**。读表就是读表，
 * 不要再在别处包一层同名语义的函数。
 */

/*
 * ⚠️ 这里删掉了三个函数（`traitShopSellMultiplier` / `traitAptitudeBonus` /
 * `traitAlchemyDoubleChance`）：它们写在 fame.ts 里，却被别处用
 * `engine.getTraitEffect(state, 'xxx')` 直接读表实现 —— 于是它们
 * **永远不会被调用**（文档代理核出来的第 93 条坑那一族）。
 *
 * 教训值得写在这儿：**把数值收进一张表、只留一个聚合函数，能防住
 * "文案与代码不一致"，但防不住"另写一个函数、然后没人调用它"。**
 * 所以规则补一条：**一个效果只能有一个实现**。读表就是读表，
 * 不要再在别处包一层同语义的函数。
 *
 * 另外「商道通达」的"卖出 +15%"也被一并删掉了 —— 本作的商行只买不卖，
 * 那个效果没有读取点。
 */

/** 掌门突破成功率加成 —— 读取点：`engine.getSuccessRate` */
export function traitBreakthroughBonus(state: GameState): number {
  return hasTrait(state, 'starGazing') ? 0.06 : 0;
}

/** 弟子修行速度的**加算**项 —— 读取点：`disciples.getDiscipleSpeed` */
export function traitCultivationBonus(state: GameState): number {
  let bonus = 0;
  if (hasTrait(state, 'starGazing')) bonus += 0.05;
  if (hasTrait(state, 'eternalSpring')) bonus += 0.08;
  return bonus;
}

/** 炼丹成功率加成 —— 读取点：`crafting.getCraftSuccessRate` */
export function traitAlchemyBonus(state: GameState): number {
  return hasTrait(state, 'pillFurnace') ? 0.12 : 0;
}

/*
 * 段位折扣（招收 / 商行）的实现在 engine —— 见 engine.getFameTierOf 的注释：
 * disciples.ts 要读它，而 fame.ts 反过来 import 了 disciples，那条路会成环。
 * 这里只是把 engine 的实现重导出，让界面与测试有一个统一的入口。
 */
export { fameRecruitDiscount, fameShopDiscount, getFameTierOf } from './engine';
export type { EndingId } from './content';

/* ------------------------------------------------------------------ */
/* 结局                                                                */
/* ------------------------------------------------------------------ */

export interface EndingCheck {
  id: EndingId;
  /** 当前是否已达成 */
  reached: boolean;
  /** 还差什么（未达成时给玩家看） */
  progress: string;
}

/**
 * 检查四个结局的达成情况。
 *
 * 刻意做成"随时可查"而不是"达成瞬间弹窗"：玩家应当在状态栏里
 * 一直看得见"离称霸仙域还差什么"，否则多结局就变成了开盲盒。
 * `ruin` 也一样 —— 它必须能被提前看见，才不会显得像 bug。
 */
export function checkEndings(state: GameState): EndingCheck[] {
  const fame = getFame(state);
  const alliedOrSubmitted = state.npcSects.filter((s) => s.relation >= 60).length;
  const results: EndingCheck[] = [
    {
      id: 'ascend',
      reached: false, // 飞升由 store.ascend 那条路走，这里只做展示
      progress: '修至渡劫圆满并服下飞升丹',
    },
    {
      id: 'dominate',
      reached: fame >= DOMINATE_FAME && alliedOrSubmitted >= 6,
      progress: `声望 ${Math.round(fame)}/${DOMINATE_FAME} · 结盟或臣服的宗门 ${alliedOrSubmitted}/6`,
    },
    {
      id: 'hermit',
      reached:
        state.sect.level >= HERMIT_SECT_LEVEL && fame >= HERMIT_FAME && !state.everDeclaredWar,
      progress: `宗门品阶 ${state.sect.level}/${HERMIT_SECT_LEVEL} · 声望 ${Math.round(fame)}/${HERMIT_FAME} · ${
        state.everDeclaredWar ? '曾主动宣战（已破誓）' : '从未主动宣战 ✓'
      }`,
    },
    {
      id: 'ruin',
      reached:
        (state.sect.founded && state.sect.disciples.length === 0 && state.sect.totalRecruited > 0) ||
        (fame <= 0 && state.resources.qi.lte(0) && Object.keys(state.materials).length === 0),
      progress: `弟子 ${state.sect.disciples.length} 人 · 声望 ${Math.round(fame)}`,
    },
  ];
  return results;
}

/** 已达成（且不是飞升）的结局 —— 用于结算界面的"本局结局" */
export function getReachedEnding(state: GameState): EndingId | null {
  const hit = checkEndings(state).find((e) => e.reached);
  return hit ? hit.id : null;
}

/** 完成一个结局：记进跨周目的 `legacyEndings` 并给周目奖励 */
/**
 * 把**所有当前已达成**的结局一起记进周目。
 *
 * 原来的实现只记玩家点的那一个，而"称霸仙域"与"隐世传承"完全可以同时成立
 * （外交路线就是这样：六宗全盟 + 从未宣战）。让玩家在两个都做到的情况下面临
 * "只能选一个记"是一种没有意义的惩罚 —— 文档代理把这条列为设计缺口，采纳。
 */
export function completeReachedEndings(state: GameState): { state: GameState; recorded: EndingId[] } {
  const reached = checkEndings(state)
    .filter((e) => e.reached && !state.legacyEndings.includes(e.id))
    .map((e) => e.id);
  let working = state;
  for (const id of reached) working = completeEnding(working, id);
  return { state: working, recorded: reached };
}

export function completeEnding(state: GameState, id: EndingId): GameState {
  const def = ENDING_MAP[id];
  if (!def) return state;
  if (state.legacyEndings.includes(id)) return state;
  return {
    ...state,
    legacyEndings: [...state.legacyEndings, id],
    journal: pushJournal(state.journal, {
      time: state.playTime,
      kind: 'good',
      text: `【${def.name}】${def.text}（周目奖励：道韵 +${def.daoYunReward}）`,
    }),
  };
}

/** 本局已经拿到过的周目奖励合计（飞升结算时叠加） */
export function endingDaoYunBonus(state: GameState): number {
  let total = 0;
  for (const id of state.legacyEndings) total += ENDING_MAP[id as EndingId]?.daoYunReward ?? 0;
  return total;
}

/** 界面上"这局还有哪些结局没解锁" */
export function endingProgressLabel(state: GameState): string {
  const reached = checkEndings(state).filter((e) => e.reached).map((e) => ENDING_MAP[e.id].name);
  return reached.length > 0 ? reached.join('、') : '尚无结局达成';
}

/** 界面用：特质的展示信息 */
export function traitView(id: string): TraitDef | null {
  return TRAIT_MAP[id] ?? null;
}

/** 界面用：声望商店某格的展示信息 */
export function famGoodView(goodId: string): FameGoodDef | null {
  return FAME_GOOD_MAP[goodId] ?? null;
}

/** 诊断/测试用：把一件货的名称说清楚（材料货要带上材料名） */
export function describeFameGood(good: FameGoodDef): string {
  return `${good.icon}${good.name}×${good.amount}`;
}

