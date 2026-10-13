/**
 * 商行：卖出与商队（需求 7）
 *
 * 需求原文：
 *   「商行界面过于单调，可以增加**卖出**元素，玩家可以卖出某些材料；
 *     增加**商队事件**，商队来到商行可以与玩家**交换互相需要的材料**；
 *     商行不仅可以购买材料和种子、图纸等，**装备、丹药、符箓、法宝**也可以包含进去，
 *     但是很稀有，而且商行刷新的这些**与玩家等级挂钩**，等级越高刷新的这些装备啥的品阶才越高」
 *
 * 三条分别落在这里：
 *   1. `getSellPrice` / `sellItem` —— 卖价 = 买入价的 40%（与用户确认）；
 *   2. `tickCaravan` / `doBarter` —— 商队按价值以物易物；
 *   3. 稀有货品的上架在 `content/shop.ts` 的 RARE_GOODS 里，
 *      按**宗门品阶**（就是"玩家等级"）解锁品阶。
 */
import Decimal, { D } from './decimal';
import {
  CARAVAN_INTERVAL_SECONDS,
  CARAVAN_MAX_WANTS,
  CARAVAN_STAY_SECONDS,
  ITEM_MAP,
  MATERIAL_MAP,
  RARE_GOODS,
  SELL_RATIO,
  SHOP_GOODS,
  TALISMAN_MAP,
  PILL_MAP,
  GEAR_MAP,
  ARTIFACT_MAP,
  type ItemId,
  type MaterialId,
  type ShopGoodKind,
} from './content';
import { addItem, getAmount, getRealm, hasShop, payCost, toCostMap } from './engine';

/**
 * 安全取数量（需求 7）。
 *
 * ⚠️ `getAmount` 只认"资源 + 材料 + 器物"这些有数量表的键；
 * 商品池里还有**图纸 id**，那种键会返回 undefined，
 * 直接 `.gt(0)` 就会炸（本轮实测踩到过）。所以一律走这个壳。
 */
function amountOf(state: GameState, id: string): Decimal {
  const value = getAmount(state, id as never);
  return value ?? D(0);
}
import { pushJournal } from './disciples';
import { gameRandom, randomId, type RandomSource } from './random';
import type { Caravan, CaravanOffer, CaravanWant, GameState, TradeItemId } from './state';

/* ------------------------------------------------------------------ */
/* 一、卖出（需求 7）                                                  */
/* ------------------------------------------------------------------ */

/**
 * 卖价 = 买入价 × 40%（与用户确认）。
 *
 * ⚠️ 这条比例必须**小于 1 且明显小于 1**：商行是"方便"，不是印钞机。
 * 40% 的好处是"低买高卖"这条套利路径被彻底堵死（同一轮里同一样东西
 * 买进再卖出必亏 60%），同时"把用不上的材料换成灵石"仍然划算。
 */
export function getSellPrice(state: GameState, id: TradeItemId, amount: number): number {
  const good = SHOP_GOODS.find((g) => g.item === id) ?? RARE_GOODS.find((g) => g.item === id);
  // 商行不收的东西（比如刚打出来的秘境特产）不给价
  if (!good) return 0;
  return Math.max(1, Math.floor(good.basePrice * getRealmPriceScale(state, good.kind) * amount * SELL_RATIO));
}

/** 与 shop.ts 里那份价格缩放同口径（避免两处不一致） */
function getRealmPriceScale(state: GameState, kind: ShopGoodKind): number {
  switch (kind) {
    case 'blueprint':
      return 1 + state.realmIndex;
    case 'seed':
      return 1 + state.realmIndex * 0.5;
    default:
      // 与 shop.ts 的 priceScale 同口径：资源与材料按境界倍率放大
      return getRealm(state).realmMultiplier;
  }
}

/** 商行收不收这一样东西（只有商品池里的货才收） */
export function canSell(state: GameState, id: TradeItemId, amount: number): { ok: boolean; reason: string | null; price: number } {
  const price = getSellPrice(state, id, amount);
  if (price <= 0) return { ok: false, reason: '商行不收这样东西', price: 0 };
  if (!hasShop(state)) return { ok: false, reason: '还没有商行', price };
  if (amountOf(state, id).lt(amount)) return { ok: false, reason: '数量不足', price };
  return { ok: true, reason: null, price };
}

export interface SellResult {
  state: GameState;
  gained: number;
  message: string;
}

/** 卖出一样材料 / 资源，换回灵石 */
export function sellItem(state: GameState, id: TradeItemId, amount: number): SellResult {
  const check = canSell(state, id, amount);
  if (!check.ok) return { state, gained: 0, message: check.reason ?? '无法卖出' };
  const paid = payCost(state, toCostMap({ [id]: amount } as never));
  if (paid === state) return { state, gained: 0, message: '数量不足' };
  const name = goodName(id);
  const next: GameState = {
    ...paid,
    resources: { ...paid.resources, stone: paid.resources.stone.add(check.price) },
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'info',
      text: `卖出 ${name}×${amount}，得灵石 ${check.price}`,
    }),
  };
  return { state: next, gained: check.price, message: `卖出 ${name}×${amount}，得 💎${check.price}` };
}

/** 界面用：商行当前愿意收的东西（玩家手上有的） */
export function getSellableGoods(state: GameState): { id: TradeItemId; name: string; icon: string; have: string; price: number }[] {
  const out: { id: TradeItemId; name: string; icon: string; have: string; price: number }[] = [];
  for (const good of SHOP_GOODS) {
    const have = amountOf(state, good.item);
    if (have.lte(0)) continue;
    const name = ITEM_MAP[good.item as ItemId]?.name ?? MATERIAL_MAP[good.item as MaterialId]?.name ?? String(good.item);
    const icon = ITEM_MAP[good.item as ItemId]?.icon ?? MATERIAL_MAP[good.item as MaterialId]?.icon ?? '📦';
    out.push({
      id: good.item,
      name,
      icon,
      have: have.toString(),
      price: getSellPrice(state, good.item, 1),
    });
  }
  // 单价高的排前面（玩家最想卖的通常是它）
  return out.sort((a, b) => b.price - a.price).slice(0, 24);
}

/* ------------------------------------------------------------------ */
/* 二、商队（需求 7）                                                  */
/* ------------------------------------------------------------------ */

/**
 * 商队交易的物品 id 是**跨表**的：资源、材料、丹药、符箓、装备、器物
 * 各有各的 id 空间，ItemId 只是其中一支 —— 所以这里用一个宽类型，
 * 只在真正落到 addItem / payCost 时断言。
 */
/* 商队的数据结构定义在 state.ts（它是要存档的状态，不能与 state 互相 import） */

/** 一样东西的显示名（商行货架与商队共用一处实现） */
function goodName(item: TradeItemId): string {
  return (
    ITEM_MAP[item as ItemId]?.name ??
    TALISMAN_MAP[item]?.name ??
    PILL_MAP[item]?.name ??
    GEAR_MAP[item]?.name ??
    ARTIFACT_MAP[item]?.name ??
    item
  );
}

/** 一样东西的图标 */
function goodIcon(item: TradeItemId): string {
  return (
    ITEM_MAP[item as ItemId]?.icon ??
    TALISMAN_MAP[item]?.icon ??
    PILL_MAP[item]?.icon ??
    GEAR_MAP[item]?.icon ??
    ARTIFACT_MAP[item]?.icon ??
    '🎁'
  );
}

/** 一样东西的"基准价值"（以商行的买入价为锚） */
function baseValue(state: GameState, id: TradeItemId): number {
  const good = SHOP_GOODS.find((g) => g.item === id) ?? RARE_GOODS.find((g) => g.item === id);
  if (good) return good.basePrice * getRealmPriceScale(state, good.kind);
  /*
   * 不在商品池里的东西（极稀有的进阶材料）：按稀有材料的 tier 估一个价。
   * 用 12^tier 是配着商行自身的价格曲线选的 —— 这样"妖丹换星砂"这类
   * 交易在价值上大致对等，不会出现"拿一颗妖丹换走一堆星砂"。
   */
  const mat = MATERIAL_MAP[id as keyof typeof MATERIAL_MAP];
  const tier = (mat as { tier?: number } | undefined)?.tier ?? 1;
  return Math.pow(12, tier) * 10;
}

/**
 * 商队到访（需求 7）。
 *
 * 设计要点：
 *   - 商队**想要**的东西从"玩家手上确实有的材料"里挑 —— 否则玩家看着
 *     一张换不了的清单，只会觉得这是个摆设；
 *   - 商队**带来**的东西按价值对等折算（`offers` 的总值 ≈ `wants` 的总值），
 *     所以以物易物在数值上是公平的，玩家的决策点是"我舍不舍得换"。
 */
export function buildCaravan(state: GameState, random: RandomSource = gameRandom): Caravan {
  const held = SHOP_GOODS.filter((g) => amountOf(state, g.item).gt(0));
  const wants: CaravanWant[] = [];
  const pool = [...held];
  for (let i = 0; i < CARAVAN_MAX_WANTS && pool.length > 0; i += 1) {
    const idx = Math.floor(random() * pool.length);
    const [good] = pool.splice(idx, 1);
    const unit = baseValue(state, good.item);
    // 商队要的数量：让它总价值落在"一次探索收获"这个量级，别开口就要全部家当
    const amount = Math.max(1, Math.round(unit > 0 ? (unit * 4) / unit : 1));
    wants.push({
      id: good.item,
      name: goodName(good.item),
      icon: goodIcon(good.item),
      amount,
      value: unit * amount,
    });
  }

  const totalWant = wants.reduce((sum, w) => sum + w.value, 0);
  const offers: CaravanOffer[] = [];
  // 商队带来的货：优先稀有货（品阶按宗门品阶解锁），不够就拿商品池凑
  const rarePool = RARE_GOODS.filter((g) => g.unlockSectLevel <= state.sect.level);
  let budget = totalWant * 0.95; // 留 5% 的"商队要赚一点"
  const offerPool = [...rarePool];
  while (budget > 0 && offers.length < 4 && offerPool.length > 0) {
    const idx = Math.floor(random() * offerPool.length);
    const [good] = offerPool.splice(idx, 1);
    const unit = baseValue(state, good.item);
    if (unit <= 0) continue;
    const amount = Math.max(1, Math.floor(budget / unit));
    if (amount < 1) continue;
    offers.push({
      id: good.item,
      name: goodName(good.item),
      icon: goodIcon(good.item),
      amount,
      value: unit * amount,
    });
    budget -= unit * amount;
  }

  return {
    id: randomId('c', random),
    wants,
    offers,
    secondsLeft: CARAVAN_STAY_SECONDS,
  };
}

/**
 * 商队计时（需求 7 / 8：所有事件的刷新率都要很低）。
 *
 * ⚠️ 与随机遭遇同一个坑：`applyOffline` 可能一次喂进几小时的 dt，
 * 所以计时器要**封顶**，超长 dt 直接把商队排上（而不是让它过期消失）。
 */
export function tickCaravan(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (!hasShop(state)) return state;
  if (dt <= 0) return state;

  const current = state.caravan;
  if (current) {
    const left = current.secondsLeft - dt;
    if (left > 0) return { ...state, caravan: { ...current, secondsLeft: left } };
    // 商队走了
    return { ...state, caravan: null };
  }

  const timer = Math.min((state.caravanTimer ?? 0) + dt, CARAVAN_INTERVAL_SECONDS);
  if (timer < CARAVAN_INTERVAL_SECONDS) return { ...state, caravanTimer: timer };
  // 到点：来一支商队（计时器清零，下一次重新等）
  return { ...state, caravanTimer: 0, caravan: buildCaravan(state, random) };
}

/** 兑换：把商队要的那一份给它，换回它带来的那一份 */
export function canBarter(state: GameState): { ok: boolean; reason: string | null } {
  const caravan = state.caravan;
  if (!caravan) return { ok: false, reason: '现在没有商队' };
  for (const want of caravan.wants) {
    if (amountOf(state, want.id).lt(want.amount)) {
      return { ok: false, reason: `${want.name}不够（需 ${want.amount}）` };
    }
  }
  return { ok: true, reason: null };
}

export function doBarter(state: GameState): { state: GameState; message: string } {
  const caravan = state.caravan;
  const check = canBarter(state);
  if (!caravan || !check.ok) return { state, message: check.reason ?? '无法兑换' };

  let working = state;
  for (const want of caravan.wants) {
    working = payCost(working, toCostMap({ [want.id]: want.amount } as never));
  }
  for (const offer of caravan.offers) {
    working = addItem(working, offer.id as never, D(offer.amount));
  }

  const gotText = caravan.offers.map((o: CaravanOffer) => `${o.icon}${o.name}×${o.amount}`).join(' ');
  const gaveText = caravan.wants.map((w: CaravanWant) => `${w.icon}${w.name}×${w.amount}`).join(' ');
  working = {
    ...working,
    caravan: null,
    caravanTimer: 0,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'good',
      text: `与商队易货：以 ${gaveText} 换得 ${gotText}`,
    }),
  };
  return { state: working, message: `商队收下货物，留下 ${gotText}` };
}

/** 把商队打发走 */
export function dismissCaravan(state: GameState): GameState {
  if (!state.caravan) return state;
  return { ...state, caravan: null, caravanTimer: 0 };
}

export function getCaravanSummary(state: GameState): string {
  const caravan = state.caravan;
  if (!caravan) return '暂无商队';
  return caravan.wants.map((w: CaravanWant) => `${w.icon}${w.name}×${w.amount}`).join('、');
}
