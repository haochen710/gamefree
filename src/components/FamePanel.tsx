/**
 * 声望 · 外交 · 结局 · 山门特质（设定集第 1 / 9 / 10 章）
 *
 * 四件事合成一个面板，是因为它们在玩家的心里本来就是一件事：
 * **"我在这个仙域里是什么位置"**。声望是评价，外交是关系，结局是目标，
 * 特质是"我这一把的底子"。拆成四个面板会让这条线碎掉。
 *
 * 面板内部按"先看后做"排：段位条 → 声望商店 → 六大宗门 → 结局进度 → 特质。
 */
import { useState } from 'react';
import { fmt } from '../game/decimal';
import {
  ENDINGS,
  FAME_MAX,
  FAME_TIERS,
  GIFT_OPTIONS,
  NPC_SECTS,
  TRAITS,
  ALLIANCE_RELATION,
  type EndingId,
} from '../game/content';
import {
  canChooseTrait,
  checkEndings,
  getFame,
  getFameTier,
  getFameToNextTier,
  getNextFameTier,
  traitView,
  famGoodView,
  endingDaoYunBonus,
  type EndingCheck,
} from '../game/fame';
import { canAlly, canDeclareWar, canGift, canParley, getAlliedCount, getWinChance, sectView } from '../game/diplomacy';
import { useGame } from '../game/store';
import Panel from './Panel';

/** 进度条：声望段位 */
function FameBar() {
  const game = useGame((s) => s.game);
  const fame = getFame(game);
  const tier = getFameTier(game);
  const next = getNextFameTier(game);
  const toNext = getFameToNextTier(game);
  const prevMin = tier.min;
  const nextMin = next?.min ?? FAME_MAX;
  const ratio = Math.min(1, Math.max(0, (fame - prevMin) / Math.max(1, nextMin - prevMin)));

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          声望 {Math.round(fame)} / {FAME_MAX} · {tier.icon} {tier.name}
        </span>
        <span className="tier-upgrade__slots">
          {next && toNext !== null ? `距「${next.name}」还差 ${Math.round(toNext)}` : '已至巅峰'}
        </span>
      </div>
      <div className="mini-bar">
        <div className="mini-bar__fill mini-bar__fill--cultivation" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="panel__note">
        {tier.desc}
        {next && ` · 下一段位：${next.name}（招收弟子 −${Math.round(next.recruitDiscount * 100)}%、商行 −${Math.round(next.shopDiscount * 100)}%）`}
      </p>
      <div className="tier-upgrade__slots">
        {FAME_TIERS.map((t) => (
          <span key={t.id} title={t.desc} style={{ opacity: fame >= t.min ? 1 : 0.4 }}>
            {t.icon}
            {t.name}
            {t.min > 0 ? `(${t.min})` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 声望商店 */
function FameShop() {
  const game = useGame((s) => s.game);
  const buy = useGame((s) => s.buyFameOffer);

  if (game.fameShop.offers.length === 0) {
    return <p className="panel__note">声望商店暂无货品（开宗立派后每 10 分钟补一次货）。</p>;
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

/** 单个 NPC 宗门 */
function SectRow({ sectId }: { sectId: string }) {
  const game = useGame((s) => s.game);
  const gift = useGame((s) => s.giftSect);
  const parley = useGame((s) => s.parleySect);
  const ally = useGame((s) => s.allySect);
  const breakAlliance = useGame((s) => s.breakAlliance);
  const declareWar = useGame((s) => s.declareWar);
  const fight = useGame((s) => s.fightBattle);
  const [open, setOpen] = useState(false);

  const def = NPC_SECTS.find((s) => s.id === sectId);
  if (!def) return null;
  const view = sectView(game, def);
  const parleyCheck = canParley(game, sectId);
  const allyCheck = canAlly(game, sectId);
  const warCheck = canDeclareWar(game, sectId);
  const cooldown = game.parleyCooldowns[sectId] ?? 0;

  return (
    <article className={view.atWar ? 'recipe recipe--warn' : 'recipe'}>
      <div className="recipe__head">
        <span className="recipe__icon">{def.icon}</span>
        <span className="recipe__name">{def.name}</span>
        <span className="cat-badge">{def.specialty}</span>
        <span className="recipe__owned">
          {view.tier.name} {Math.round(view.relation)}
        </span>
        {view.alliance && <span className="recipe__owned">盟友</span>}
        {view.atWar && <span className="recipe__owned recipe__owned--warn">交战中</span>}
      </div>
      <div className="recipe__desc">
        {def.desc} · 心头好：{def.favorite === 'herb' ? '灵草' : def.favorite}
      </div>
      <div className="recipe__foot">
        <div className="btn-row">
          <button type="button" className="btn btn--tiny" onClick={() => setOpen((v) => !v)}>
            {open ? '收起' : '外交'}
          </button>
        </div>
      </div>
      {open && (
        <div className="btn-row btn-row--wrap">
          {GIFT_OPTIONS.map((option, index) => {
            const check = canGift(game, sectId, index);
            return (
              <button
                key={option.label}
                type="button"
                className="btn btn--tiny"
                disabled={!check.ok}
                title={check.reason ?? `消耗心头好 ${option.amount} → 关系 +${check.gain}`}
                onClick={() => gift(sectId, index)}
              >
                赠{option.label}（+{option.relation}）
              </button>
            );
          })}
          <button
            type="button"
            className="btn btn--tiny"
            disabled={!parleyCheck.ok}
            title={parleyCheck.reason ?? '不花资源，关系 +4'}
            onClick={() => parley(sectId)}
          >
            {cooldown > 0 ? `论道（${Math.ceil(cooldown)}s）` : '论道（+4）'}
          </button>
          {view.alliance ? (
            <button type="button" className="btn btn--tiny" onClick={() => breakAlliance(sectId)}>
              撕毁盟约
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--tiny"
              disabled={!allyCheck.ok}
              title={allyCheck.reason ?? `关系 ≥ ${ALLIANCE_RELATION} 且声望足够即可结盟`}
              onClick={() => ally(sectId)}
            >
              结盟
            </button>
          )}
          <button
            type="button"
            className="btn btn--tiny"
            disabled={!warCheck.ok}
            title={warCheck.reason ?? `宣战（胜率 ${Math.round(getWinChance(game, sectId) * 100)}%）`}
            onClick={() => declareWar(sectId)}
          >
            宣战
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            disabled={!view.atWar}
            title={view.atWar ? '立刻打一场（正常每 10 分钟自动一场）' : '先宣战'}
            onClick={() => fight(sectId)}
          >
            开战（胜率 {Math.round(getWinChance(game, sectId) * 100)}%）
          </button>
        </div>
      )}
    </article>
  );
}

/** 结局进度（随时可查，而不是达成瞬间弹窗） */
function EndingList() {
  const game = useGame((s) => s.game);
  const settle = useGame((s) => s.settleEnding);
  const checks: EndingCheck[] = checkEndings(game);

  return (
    <div className="inv-list">
      {ENDINGS.map((def) => {
        const check = checks.find((c) => c.id === def.id);
        const done = game.legacyEndings.includes(def.id as EndingId);
        return (
          <div key={def.id} className="inv-row">
            <span className="inv-row__name">
              {def.icon} {def.name}
            </span>
            <span className="inv-row__effect">{check?.progress ?? def.condition}</span>
            {done ? (
              <span className="inv-row__count">已记入周目</span>
            ) : (
              <button
                type="button"
                className="btn btn--tiny"
                disabled={!check?.reached}
                title={check?.reached ? '结算这个结局' : `尚未达成：${check?.progress ?? ''}`}
                onClick={() => settle(def.id)}
              >
                结算
              </button>
            )}
          </div>
        );
      })}
      <p className="panel__note">
        已完成结局 {game.legacyEndings.length} 个 · 周目奖励合计道韵 +{endingDaoYunBonus(game)}
        {game.legacyEndings.length > 0 && ' · 传承特质已解锁（重开一局可在候选里看到）'}
      </p>
    </div>
  );
}

/** 山门先天特质：开局三选一 / 已定则展示 */
function TraitSection() {
  const game = useGame((s) => s.game);
  const choose = useGame((s) => s.chooseTrait);

  if (game.traits.length > 0) {
    const def = traitView(game.traits[0]);
    return (
      <p className="panel__note">
        山门气运：{def?.icon} <strong>{def?.name}</strong> —— {def?.desc}
        （开局选定，不可更改）
      </p>
    );
  }
  if (game.traitOffer.length === 0) return null;

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>山门气运（三选一，选后不可更改）</span>
      </div>
      <div className="btn-row btn-row--wrap">
        {game.traitOffer.map((id) => {
          const def = traitView(id);
          const check = canChooseTrait(game, id);
          if (!def) return null;
          return (
            <button
              key={id}
              type="button"
              className="btn btn--primary"
              disabled={!check.ok}
              title={def.detail}
              onClick={() => choose(id)}
            >
              {def.icon} {def.name} —— {def.desc}
            </button>
          );
        })}
      </div>
      <p className="panel__note">
        共 {TRAITS.length} 种山门特质：6 种开局可选，3 种需先完成任一周目结局才会进入候选。
      </p>
    </div>
  );
}

export function FamePanel({ collapsible }: { collapsible?: boolean }) {
  const game = useGame((s) => s.game);
  const allied = getAlliedCount(game);

  return (
    <Panel
      title="仙域名望"
      hint={`${getFameTier(game).name} · 盟友 ${allied}/6 · 结局 ${game.legacyEndings.length}/${ENDINGS.length}`}
      collapsible={collapsible}
      storageKey="fame"
    >
      <FameBar />
      <TraitSection />

      <h3 className="panel__subtitle">声望商店</h3>
      <p className="panel__note">
        声望来自秘境探索、普通探索、论道大比与善行；这里能用它直接换功法碎片、稀有材料。
        供奉的货每 10 分钟重摇一次，段位越高能看到的货越好。
      </p>
      <FameShop />

      <h3 className="panel__subtitle">六大宗门</h3>
      <p className="panel__note">
        关系五档：敌对 / 冷淡 / 中立 / 友好 / 盟友。赠礼（送对方的**心头好**效果翻倍）与论道能拉近关系；
        <strong>关系 ≥ {ALLIANCE_RELATION} 且声望足够</strong>即可结盟，每多一个盟友，宗门全产出 +3%。
        宣战则关系直接掉到底，并且会**永久记下"曾主动宣战"**（隐世传承结局会因此不成立）。
      </p>
      {NPC_SECTS.map((def) => (
        <SectRow key={def.id} sectId={def.id} />
      ))}

      <h3 className="panel__subtitle">结局</h3>
      <p className="panel__note">
        四个结局随时可查（不会突然弹出来）：{ENDINGS.map((e) => `${e.icon}${e.name}`).join(' · ')}。
        达成后点「结算」记入周目，累计的道韵会在下次飞升时一并结算。
      </p>
      <EndingList />

      <p className="panel__note">
        当前资源上限参考：灵石 {fmt(game.resources.stone)}，声望 {Math.round(getFame(game))}。
      </p>
    </Panel>
  );
}

export default FamePanel;
