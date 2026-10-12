/**
 * 商行（需求 3 / 6）
 *
 * 每隔 SHOP_REFRESH_SECONDS 秒重摇一次货架：
 *   从 SHOP_GOODS 里按权重不放回地抽「货位数」件商品。
 *
 * 「商行每次售卖一部分资源」（需求 3 原文）—— 就是靠这个不放回抽样实现的：
 * 每次上架的只是商品池里的一小部分，玩家想买到某样东西得等下一轮。
 *
 * 货品数量与价格按境界倍率放大，保证到了后期数字仍然有意义
 * （十颗妖丹在大乘期毫无用处）。
 */
import { D } from './decimal';
import {
  BLUEPRINT_MAP,
  ITEM_MAP,
  MATERIAL_MAP,
  SEED_MAP,
  SHOP_GOODS,
  SHOP_REFRESH_SECONDS,
  type ShopGoodDef,
  type ShopGoodKind,
  type ShopOffer,
} from './content';
import { addItem, fameShopDiscount, getRealm, getShopOfferCapacity, getTraitEffect, hasShop } from './engine';
import { pushJournal } from './disciples';
import { addSeeds } from './planting';
import { gameRandom, randomId, weightedDraw, type RandomSource } from './random';
import type { GameState } from './state';

/* ------------------------------------------------------------------ */
/* 价格与数量缩放                                                      */
/* ------------------------------------------------------------------ */

/** 货品数量随境界放大的倍率 */
function amountScale(state: GameState, kind: ShopGoodKind): number {
  switch (kind) {
    case 'blueprint':
    case 'seed':
      // 图纸与种子是一次性解锁物，不该随境界成倍增长
      return 1;
    default:
      return getRealm(state).realmMultiplier;
  }
}

/**
 * 价格缩放。
 *
 * 资源 / 材料与数量同倍放大 —— 相当于汇率恒定，商行永远只是"方便"，
 * 不会变成一台越到后期越划算的印钞机。
 * 图纸与种子的价格只随境界温和上涨。
 */
function priceScale(state: GameState, kind: ShopGoodKind): number {
  switch (kind) {
    case 'blueprint':
      return 1 + state.realmIndex;
    case 'seed':
      return 1 + state.realmIndex * 0.5;
    default:
      return getRealm(state).realmMultiplier;
  }
}

/* ------------------------------------------------------------------ */
/* 刷新                                                                */
/* ------------------------------------------------------------------ */

/** 生成一批货品（不放回抽样，所以每轮商品组合都不同） */
export function buildShopOffers(state: GameState, random: RandomSource = gameRandom): ShopOffer[] {
  const capacity = getShopOfferCapacity(state);
  if (capacity <= 0) return [];

  // 已经拿到手的图纸不再上架 —— 否则货架上会出现毫无意义的商品。
  // 境界不够的图纸也不上架（需求 6：图纸要跟玩家等级挂钩），
  // 免得玩家花大价钱买一张暂时用不了的图。
  const pool: ShopGoodDef[] = SHOP_GOODS.filter((good) => {
    if (good.kind !== 'blueprint') return true;
    if (state.blueprints[good.item] === true) return false;
    const def = BLUEPRINT_MAP[good.item];
    return !def || state.realmIndex >= def.requiresRealm;
  });

  const picked = weightedDraw(pool, capacity, random);

  return picked.map((good) => ({
    id: randomId('o', random),
    kind: good.kind,
    item: good.item,
    amount: Math.max(1, Math.round(good.baseAmount * amountScale(state, good.kind))),
    price: Math.max(1, Math.round(good.basePrice * priceScale(state, good.kind))),
    sold: false,
  }));
}

/** 手动刷新货架（商行建成时、以及倒计时归零时调用） */
export function refreshShop(state: GameState, random: RandomSource = gameRandom): GameState {
  if (!hasShop(state)) {
    return state.shop.offers.length === 0 ? state : { ...state, shop: { offers: [], secondsLeft: 0 } };
  }
  return {
    ...state,
    shop: { offers: buildShopOffers(state, random), secondsLeft: SHOP_REFRESH_SECONDS },
  };
}

/** 倒计时推进；到点就重摇货架 */
export function tickShop(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (!hasShop(state)) {
    return state.shop.offers.length === 0 ? state : { ...state, shop: { offers: [], secondsLeft: 0 } };
  }
  if (state.shop.offers.length === 0) return refreshShop(state, random);
  if (dt <= 0) return state;

  const secondsLeft = state.shop.secondsLeft - dt;
  if (secondsLeft > 0) return { ...state, shop: { ...state.shop, secondsLeft } };
  return refreshShop(state, random);
}

/* ------------------------------------------------------------------ */
/* 购买                                                                */
/* ------------------------------------------------------------------ */

export interface ShopBuyResult {
  state: GameState;
  message: string;
}

/** 货品的显示名与图标（图纸、种子、材料、资源的名字来源各不相同） */
export function describeOffer(offer: ShopOffer): { name: string; icon: string; note: string } {
  switch (offer.kind) {
    case 'blueprint': {
      const def = BLUEPRINT_MAP[offer.item];
      return { name: def?.name ?? offer.item, icon: def?.icon ?? '📜', note: '图纸' };
    }
    case 'seed': {
      const def = SEED_MAP[offer.item];
      return { name: def?.name ?? offer.item, icon: def?.icon ?? '🌰', note: '种子' };
    }
    case 'material': {
      const def = MATERIAL_MAP[offer.item as keyof typeof MATERIAL_MAP];
      return { name: def?.name ?? offer.item, icon: def?.icon ?? '?', note: '材料' };
    }
    default: {
      const def = ITEM_MAP[offer.item as keyof typeof ITEM_MAP];
      return { name: def?.name ?? offer.item, icon: def?.icon ?? '?', note: '资源' };
    }
  }
}

/**
 * 商行的实际买入价 = 标价 × 段位折扣 × 「商道通达」特质。
 *
 * ⚠️ 折扣必须在**同一处**算，而且买卖两边都用它 ——
 * 本作踩过"界面显示 100、实际扣 85"的坑（同一个数在两处各算一次）。
 */
export function getOfferPrice(state: GameState, offerId: string): number {
  const offer = state.shop.offers.find((o) => o.id === offerId);
  if (!offer) return 0;
  const discount = (1 - fameShopDiscount(state)) * getTraitEffect(state, 'shopBuyMult', 1);
  return Math.max(1, Math.round(offer.price * discount));
}

export function canBuyOffer(state: GameState, offerId: string): { ok: boolean; reason: string | null } {
  const offer = state.shop.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: '货品不存在' };
  if (offer.sold) return { ok: false, reason: '已经售罄' };
  // 老存档里可能还留着已经买过的图纸，别让玩家白花第二遍灵石
  if (offer.kind === 'blueprint' && state.blueprints[offer.item] === true) {
    return { ok: false, reason: '已经持有此图纸' };
  }
  /*
   * ⚠️ 买入**必须**走 getOfferPrice 算出来的实价，而不是 offer.price 标价：
   * 标价只在货架生成时用一次，段位与「商道通达」的折扣是在结算这一刻算的。
   * 三处（判断、扣款、记事）都用同一个数，界面才不会"显示 100、扣 85"。
   */
  const price = getOfferPrice(state, offerId);
  if (state.resources.stone.lt(price)) {
    return { ok: false, reason: `灵石不足（需 ${price}）` };
  }
  return { ok: true, reason: null };
}

/**
 * 买下一件货品。
 *
 * 四种货品落到四个不同的容器里，这里集中处理 ——
 * 以后再加货品种类，只需要在这里加一个 case。
 */
export function buyShopOffer(state: GameState, offerId: string): ShopBuyResult {
  const check = canBuyOffer(state, offerId);
  if (!check.ok) return { state, message: check.reason ?? '无法购买' };

  const offer = state.shop.offers.find((o) => o.id === offerId);
  if (!offer) return { state, message: '货品不存在' };

  const price = getOfferPrice(state, offerId);
  let next: GameState = {
    ...state,
    resources: { ...state.resources, stone: state.resources.stone.sub(price) },
  };

  switch (offer.kind) {
    case 'resource':
      next = addItem(next, offer.item as never, D(offer.amount));
      break;
    case 'material':
      next = addItem(next, offer.item as never, D(offer.amount));
      break;
    case 'seed':
      next = addSeeds(next, offer.item as never, offer.amount);
      break;
    case 'blueprint':
      next = { ...next, blueprints: { ...next.blueprints, [offer.item]: true } };
      break;
  }

  const offers = next.shop.offers.map((o) => (o.id === offerId ? { ...o, sold: true } : o));
  const described = describeOffer(offer);

  next = {
    ...next,
    shop: { ...next.shop, offers },
    journal: pushJournal(next.journal, {
      time: next.playTime,
      kind: offer.kind === 'blueprint' ? 'good' : 'info',
      text: `商行购入 ${described.icon}${described.name}×${offer.amount}（${price} 灵石）`,
    }),
  };

  return { state: next, message: `购得 ${described.name}×${offer.amount}` };
}


