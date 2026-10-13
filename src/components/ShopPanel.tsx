/**
 * 商行
 *
 * 货架每隔一段时间整体重摇一次，每次只上架商品池里的一小部分 ——
 * 这就是需求里那句「商行每次售卖一部分资源」。
 *
 * ⚠️ 本轮需求 5 起它是**与洞府同级的独立页签**（原先挤在灵植页的右栏里）。
 */
import { fmt, fmtDuration } from '../game/decimal';
import { BLUEPRINT_MAP, SHOP_OFFER_COUNT, SHOP_REFRESH_SECONDS } from '../game/content';
import { getShopOfferCapacity, hasShop } from '../game/engine';
import { canBuyOffer, describeOffer } from '../game/shop';
import { getOfferPrice } from '../game/shop';
// 需求 12：声望商店并到商行之后，这两个也跟着过来
import { famGoodView, getFame } from '../game/fame';
import { useGame } from '../game/store';

export function ShopPanel() {
  const game = useGame((s) => s.game);
  const buy = useGame((s) => s.buyShopOffer);
  const buyAll = useGame((s) => s.buyAllShopOffers);

  if (!hasShop(game)) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>商行</h2>
          <span className="panel__hint">尚未开设</span>
        </div>
        <p className="panel__note">
          尚未开设商行。先钻研「商道」（需先有营造之术），再在「建筑」页里建一座
          <strong>商行</strong>，即可用灵石换取资源、基础材料、基础种子，偶尔还能买到图纸。
        </p>
      </section>
    );
  }

  const offers = game.shop.offers;
  const capacity = getShopOfferCapacity(game);
  /*
   * 一键打包要先算清"买得起几件、一共多少钱"：
   * 价格必须走 getOfferPrice（段位与「商道通达」的折扣都在那里），
   * 若在这里直接用 offer.price 标价，界面与扣款就会差一个折扣。
   */
  const buyableOffers = offers.filter((o) => canBuyOffer(game, o.id).ok);
  const buyable = buyableOffers.length;
  const totalPrice = buyableOffers.reduce((sum, o) => sum + getOfferPrice(game, o.id), 0);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>商行</h2>
        <span className="panel__hint">
          货位 {offers.length} / {capacity} · {fmtDuration(game.shop.secondsLeft)}后刷新
        </span>
      </div>

      <p className="panel__note">
        每 {SHOP_REFRESH_SECONDS} 秒（约 {Math.round(SHOP_REFRESH_SECONDS / 60)} 分钟）重摇一次货架，
        每次只摆出商品池里的一部分（基础 {SHOP_OFFER_COUNT} 件，每多一座商行 +2 件）。
        稀有材料的种子与材料<strong>不会</strong>出现在这里 —— 那些只能靠探索。
      </p>

      {/* 需求 2：一键打包 —— 把当前买得起的货一次全买下 */}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={buyable === 0}
          title={buyable === 0 ? '现在没有买得起的货' : `一次买下 ${buyable} 件（合计 ${fmt(totalPrice)} 灵石）`}
          onClick={buyAll}
        >
          一键打包（{buyable} 件 · 💎{fmt(totalPrice)}）
        </button>
      </div>

      {offers.length === 0 && <p className="panel__note">货架空空如也，下一轮马上补货。</p>}

      <div className="shop-grid">
        {offers.map((offer) => {
        const described = describeOffer(offer);
        const check = canBuyOffer(game, offer.id);
        const isBlueprint = offer.kind === 'blueprint';

        /*
         * 需求 2：每种商品改成一个个**方块**（原来是整行铺开的长条）。
         * 方块化之后一屏能放下的货更多，而且"已售罄"能一眼看出来。
         */
        return (
          <article key={offer.id} className={offer.sold ? 'shop-card shop-card--sold' : 'shop-card'}>
            <div className="shop-card__head">
              <span className="shop-card__icon">{described.icon}</span>
              <span className="shop-card__name">{described.name}</span>
              {isBlueprint && <span className="tier-badge">图纸</span>}
            </div>
            <div className="shop-card__amount">×{offer.amount}</div>
            <div className="shop-card__note">{described.note}</div>
            <div className="shop-card__foot">
              <span className="shop-card__price">💎{fmt(getOfferPrice(game, offer.id))}</span>
              <button type="button" className="btn btn--tiny" disabled={!check.ok} onClick={() => buy(offer.id)}>
                {offer.sold ? '已售罄' : '买入'}
              </button>
            </div>
            {isBlueprint && BLUEPRINT_MAP[offer.item] && (
              <div className="shop-card__note">{BLUEPRINT_MAP[offer.item].source}</div>
            )}
          </article>
        );
        })}
      </div>

      {/*
        需求 12：声望商店合并到商行。
        灵石货架（上面）与声望货架（下面）现在同页 ——
        「我要买东西」不再需要判断"那个东西是用什么买的"。
      */}
      <h3 className="panel__subtitle">声望货架</h3>
      <p className="panel__note">
        声望来自秘境探索、普通探索、论道大比与善行。这里能用它直接换功法碎片、稀有材料。
        货每 10 分钟重摇一次，段位越高能看到的货越好。
        当前声望：<strong>{Math.round(game.fame)}</strong>。
      </p>
      <FameShelf />
    </section>
  );
}

/** 声望商店 */
function FameShelf() {
  const game = useGame((s) => s.game);
  const buy = useGame((s) => s.buyFameOffer);

  if (game.fameShop.offers.length === 0) {
    return <p className="panel__note">声望货架暂无货品（开宗立派后每 10 分钟补一次货）。</p>;
  }

  return (
    <div className="shop-grid">
      {game.fameShop.offers.map((offer) => {
        const good = famGoodView(offer.goodId);
        if (!good) return null;
        const affordable = getFame(game) >= good.price;
        return (
          <article key={offer.goodId} className={good.price > 500 ? 'recipe recipe--rare' : 'recipe'}>
            <div className="recipe__head">
              <span className="recipe__icon">{good.icon}</span>
              <span className="recipe__name">{good.name}</span>
              <span className="recipe__owned">×{good.amount}</span>
            </div>
            <div className="recipe__desc">{good.desc}</div>
            <div className="recipe__foot">
              <span className="recipe__cost">声望 {good.price}</span>
              <button
                type="button"
                className="btn btn--tiny"
                disabled={!affordable}
                title={affordable ? '' : '声望不足'}
                onClick={() => buy(offer.goodId)}
              >
                兑换
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default ShopPanel;
