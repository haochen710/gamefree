/**
 * 商行
 *
 * 货架每隔一段时间整体重摇一次，每次只上架商品池里的一小部分 ——
 * 这就是需求里那句「商行每次售卖一部分资源」。
 *
 * ⚠️ 本轮需求 5 起它是**与洞府同级的独立页签**（原先挤在灵植页的右栏里）。
 */
import { fmt, fmtDuration } from '../game/decimal';
import { BLUEPRINT_MAP, CARAVAN_INTERVAL_SECONDS, SELL_RATIO, SHOP_OFFER_COUNT, SHOP_REFRESH_SECONDS } from '../game/content';
import { getShopOfferCapacity, hasShop } from '../game/engine';
import { canBuyOffer, describeOffer } from '../game/shop';
import { getOfferPrice } from '../game/shop';
import { canBarter, getSellableGoods } from '../game/caravan';
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

      {/* 需求 7：卖出 —— 把用不上的材料换成灵石 */}
      <SellSection />

      {/* 需求 7：商队事件 —— 以物易物 */}
      <CaravanSection />

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

/* ------------------------------------------------------------------ */
/* 需求 7：卖出与商队                                                  */
/* ------------------------------------------------------------------ */

/**
 * 卖出（需求 7）。
 *
 * 卖价 = 买入价 × 40%。界面上把这一条**直接写在标题旁边** ——
 * 玩家第一次卖东西时最想知道的就是"我亏多少"。
 */
function SellSection() {
  const game = useGame((s) => s.game);
  const sell = useGame((s) => s.sellItem);
  const goods = getSellableGoods(game);

  return (
    <>
      <h3 className="panel__subtitle">卖出（按买入价的 {Math.round(SELL_RATIO * 100)}%）</h3>
      <p className="panel__note">
        商行也收货。卖价是买入价的 {Math.round(SELL_RATIO * 100)}% ——
        所以「低买高卖」是赚不到钱的，但把秘境里用不上的材料换成灵石很划算。
      </p>
      {goods.length === 0 && <p className="panel__note">你手上还没有商行收的东西。</p>}
      <div className="shop-grid">
        {goods.map((good) => (
          <article key={good.id} className="shop-card">
            <div className="shop-card__head">
              <span className="shop-card__icon">{good.icon}</span>
              <span className="shop-card__name">{good.name}</span>
            </div>
            <div className="shop-card__amount">持有 {good.have}</div>
            <div className="shop-card__foot">
              <span className="shop-card__price">💎{fmt(good.price)}/个</span>
              <span className="btn-row">
                <button type="button" className="btn btn--tiny" onClick={() => sell(good.id, 1)}>
                  卖 1
                </button>
                <button type="button" className="btn btn--tiny" onClick={() => sell(good.id, 100)}>
                  卖 100
                </button>
              </span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * 商队（需求 7）。
 *
 * 商队来时列两栏：**它要什么**与**它带什么**，按价值对等折算。
 * 玩家的决策点因此是"我舍不舍得拿这些换那些"，而不是"够不够钱"。
 */
function CaravanSection() {
  const game = useGame((s) => s.game);
  const barter = useGame((s) => s.barterCaravan);
  const dismiss = useGame((s) => s.dismissCaravan);
  const caravan = game.caravan;

  if (!caravan) {
    const left = CARAVAN_INTERVAL_SECONDS - (game.caravanTimer ?? 0);
    return (
      <>
        <h3 className="panel__subtitle">商队</h3>
        <p className="panel__note">
          下一支商队约 <strong>{fmtDuration(Math.max(0, left))}</strong> 后到（商队来得很稀，
          这是需求 8 定下的口径）。商队会带上你**拿不出来**的东西 ——
          用你富余的材料去换，是稀有货最稳的来源之一。
        </p>
      </>
    );
  }

  const check = canBarter(game);
  return (
    <>
      <h3 className="panel__subtitle">商队到访（{fmtDuration(caravan.secondsLeft)} 后离开）</h3>
      <p className="panel__note">
        以物易物：商队按<strong>价值对等</strong>折算，所以换不换只取决于你舍不舍得。
        {check.ok ? '' : ` 现在换不了：${check.reason}`}
      </p>

      <div className="shop-grid">
        <div className="notice-board">
          <div className="notice-board__head">
            <span>📤 商队想要</span>
          </div>
          {caravan.wants.map((want) => (
            <div key={want.id} className="notice-board__row">
              <span className="notice-board__name">
                {want.icon}
                {want.name}
              </span>
              <span className="notice-board__missing">×{want.amount}</span>
            </div>
          ))}
        </div>

        <div className="notice-board">
          <div className="notice-board__head">
            <span>📥 商队带来</span>
          </div>
          {caravan.offers.length === 0 && <p className="panel__note">这一趟只收不卖（它也没货了）。</p>}
          {caravan.offers.map((offer) => (
            <div key={offer.id} className="notice-board__row">
              <span className="notice-board__name">
                {offer.icon}
                {offer.name}
              </span>
              <span className="notice-board__missing">×{offer.amount}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="btn-row">
        <button type="button" className="btn btn--primary" disabled={!check.ok} onClick={barter}>
          成交
        </button>
        <button type="button" className="btn btn--tiny" onClick={dismiss}>
          送客
        </button>
      </div>
    </>
  );
}

/** 声望商店 */
function FameShelf() {  const game = useGame((s) => s.game);
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
