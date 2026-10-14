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
  itemView,
  SEED_MAP,
  SHOP_GOODS,
  RARE_GOODS_CHANCE,
  rareGoodsForSectLevel,
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

  /*
   * 需求 7：「装备、丹药、符箓、法宝也可以包含进去，但是**很稀有**，
   * 而且商行刷新的这些**与玩家等级挂钩**」——
   * 这里用**宗门品阶**当那个"玩家等级"：品阶不到就不上架，
   * 所以低级宗门永远刷不出天纵装备。
   *
   * 每轮最多掺 1 件稀有货（`RARE_GOODS` 的权重本来就极低，
   * 但仍然单独限一件：否则一轮出三件天纵，就不叫"很稀有"了）。
   */
  const rarePool = rareGoodsForSectLevel(state.sect.level);
  const rarePick =
    rarePool.length > 0 && pool.length > 0 && capacity > 2 && random() < RARE_GOODS_CHANCE
      ? weightedDraw(rarePool, 1, random)
      : [];
  /*
   * ⚠️ 普通货要**少抽一件**再拼稀有货 ——
   * 第一版是先抽满 capacity 再拼上稀有货后 slice，结果稀有货永远被切掉，
   * 需求 7 的"很稀有"直接变成了"根本不存在"（冒烟补测才抓到）。
   */
  const normalPick =
    rarePick.length > 0 ? weightedDraw(pool, Math.max(1, capacity - rarePick.length), random) : picked;
  const allPicked = [...normalPick, ...rarePick].slice(0, capacity);

  return allPicked.map((good) => {

    const rare = (good as { unlockSectLevel?: number }).unlockSectLevel;
    return {
      id: randomId('o', random),
      kind: good.kind,
      item: good.item,
      // 稀有货一律 1 件（"很稀有"），普通货按境界放大
      amount: rare !== undefined ? 1 : Math.max(1, Math.round(good.baseAmount * amountScale(state, good.kind))),
      price: Math.max(1, Math.round(good.basePrice * priceScale(state, good.kind))),
      sold: false,
    };
  });
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
  /*
   * 第 24 轮（需求 4）：玩家原话「商店部分材料显示英文，看不出来是啥」。
   * 根因与第 19 轮那个"英文材料名"同族：这里只查 MATERIAL_MAP / ITEM_MAP，
   * 而符箓（TALISMAN_MAP）、丹药（PILL_MAP）、器物（ARTIFACT_MAP）都不在里面，
   * 于是一律回落到 `?? offer.item` —— 玩家看到的就是 `spiritBasic` 这种 id。
   * 现在统一交给 content/itemView.ts（它按"资源 → 材料器物 → 符箓 → 图纸"依次查）。
   */
  const view = itemView(offer.item);
  switch (offer.kind) {
    case 'blueprint': {
      const def = BLUEPRINT_MAP[offer.item];
      return { name: def?.name ?? view.name, icon: def?.icon ?? view.icon, note: '图纸' };
    }
    case 'seed': {
      const def = SEED_MAP[offer.item];
      return { name: def?.name ?? view.name, icon: def?.icon ?? view.icon, note: '种子' };
    }
    case 'material': {
      // 材料、符箓、丹药都可能是"材料类"货品 —— 交给 itemView 统一取名
      return { ...view, note: '材料' };
    }
    default: {
      return { ...view, note: '资源' };
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

/**
 * 一键打包（需求 2）：把当前**买得起**的货一次全买下。
 *
 * 逐件走同一条 buyShopOffer —— 折扣、售罄、图纸去重这些规则
 * 与单件购买完全一致，不可能出现"打包价不一样"这种事。
 * 卖完一件就可能买不起下一件了，所以循环里要重新判一次。
 */
export function buyAllShopOffers(state: GameState): { state: GameState; bought: number; spent: number } {
  let working = state;
  let bought = 0;
  let spent = 0;
  // 货架最多十几件，遍历一遍就够；每件只买一次
  for (const offer of state.shop.offers) {
    const check = canBuyOffer(working, offer.id);
    if (!check.ok) continue;
    const price = getOfferPrice(working, offer.id);
    const result = buyShopOffer(working, offer.id);
    if (result.state === working) continue;
    working = result.state;
    bought += 1;
    spent += price;
  }
  return { state: working, bought, spent };
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


