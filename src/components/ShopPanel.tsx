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
import { useGame } from '../game/store';

export function ShopPanel() {
  const game = useGame((s) => s.game);
  const buy = useGame((s) => s.buyShopOffer);

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

      {offers.length === 0 && <p className="panel__note">货架空空如也，下一轮马上补货。</p>}

      {offers.map((offer) => {
        const described = describeOffer(offer);
        const check = canBuyOffer(game, offer.id);
        const isBlueprint = offer.kind === 'blueprint';

        return (
          <div key={offer.id} className={offer.sold ? 'inv-row inv-row--wrap inv-row--sold' : 'inv-row inv-row--wrap'}>
            <span className="inv-row__icon">{described.icon}</span>
            <span className="inv-row__name">
              {described.name}
              {isBlueprint && <span className="tier-badge">图纸</span>}
            </span>
            <span className="inv-row__count">×{offer.amount}</span>
            <span className="inv-row__effect">
              {described.note} · 💎{fmt(offer.price)}
              {isBlueprint && BLUEPRINT_MAP[offer.item] ? ` · ${BLUEPRINT_MAP[offer.item].source}` : ''}
            </span>
            <button
              type="button"
              className="btn btn--tiny"
              disabled={!check.ok}
              onClick={() => buy(offer.id)}
            >
              {offer.sold ? '已售罄' : '买入'}
            </button>
          </div>
        );
      })}
    </section>
  );
}

export default ShopPanel;
