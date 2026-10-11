/**
 * 随机遭遇与善恶值（需求 2）
 *
 * 需求原文：
 *   「增加随机事件，开宗前有遇到商队、不同npc等，对不同npc的选择可以获得
 *     不同奖励或者惩罚，人物增加善恶值设定。人物恶行值越高，突破时越容易
 *     遭受天雷之罚，导致突破失败（小境界突破也会），但是恶行值突破一定程度
 *     之后可以抢劫npc，获取大量材料，乃至部分稀有材料，但是几率不大。
 *     善行值越高，普通探索或者秘境探索产出有相应加成。」
 *
 * 这个面板要把"选择"讲清楚，所以每条选项都写明了它的代价与收益，
 * 包括**成功率** —— 抢劫是赌，赌注得摆在明面上。
 * 另外把两条后果（天雷之罚 / 探索加成）实时算出来显示，
 * 否则玩家看不出善恶值到底在做什么。
 */
import { ENCOUNTER_MAP, isAttackEncounter, optionRequiredItems, type ItemId } from '../game/content';
import { ITEM_MAP } from '../game/content';
import {
  canChooseOption,
  describeOption,
  getEvil,
  getKarma,
  getKarmaExploreBonus,
  getKarmaLabel,
  getKarmaThunderPenalty,
  getPendingEncounter,
  getSectDefense,
  previewAttack,
  KARMA_EXPLORE_BONUS_MAX,
  KARMA_ROB_THRESHOLD,
  KARMA_THUNDER_MAX,
} from '../game/encounter';
import { useGame } from '../game/store';

export function EncounterPanel() {
  const game = useGame((s) => s.game);
  const chooseEncounter = useGame((s) => s.chooseEncounter);

  const pending = getPendingEncounter(game);
  const karma = getKarma(game);
  const label = getKarmaLabel(game);
  const thunder = getKarmaThunderPenalty(game);
  const bonus = getKarmaExploreBonus(game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>善恶值</h2>
        <span className="panel__hint">
          {label.icon} {label.name} · {karma > 0 ? '+' : ''}
          {Math.round(karma)}
        </span>
      </div>

      {/* 一条从 -100 到 +100 的轴：正 = 善、负 = 恶 */}
      <div className="karma-bar">
        <div className="karma-bar__zero" />
        <div
          className={karma >= 0 ? 'karma-bar__fill karma-bar__fill--good' : 'karma-bar__fill karma-bar__fill--evil'}
          style={{
            left: karma >= 0 ? '50%' : `${50 + (karma / 100) * 50}%`,
            width: `${(Math.abs(karma) / 100) * 50}%`,
          }}
        />
        <span className="karma-bar__min">大恶</span>
        <span className="karma-bar__mid">中立</span>
        <span className="karma-bar__max">大善</span>
      </div>

      <div className="karma-effects">
        <span className={thunder > 0 ? 'karma-chip karma-chip--evil' : 'karma-chip'}>
          天雷之罚：突破成功率 −{(thunder * 100).toFixed(0)}%（上限 −{Math.round(KARMA_THUNDER_MAX * 100)}%）
        </span>
        <span className={bonus > 0 ? 'karma-chip karma-chip--good' : 'karma-chip'}>
          善行加成：探索产出 +{(bonus * 100).toFixed(0)}%（上限 +{Math.round(KARMA_EXPLORE_BONUS_MAX * 100)}%）
        </span>
        <span className={getEvil(game) >= -KARMA_ROB_THRESHOLD ? 'karma-chip karma-chip--evil' : 'karma-chip'}>
          抢劫：{karma <= KARMA_ROB_THRESHOLD ? '已解锁' : `需恶行值 ≤ ${KARMA_ROB_THRESHOLD}`}
        </span>
      </div>

      {!pending ? (
        <p className="panel__note">
          {game.sect.founded
            ? '宗门已立，山中的事与路上的事都会找上门来。'
            : '尚未开宗，行走在外，时不时会遇到商队与各色人物。'}
        </p>
      ) : (
        <div className={`encounter encounter--${pending.id}${isAttackEncounter(pending) ? ' encounter--attack' : ''}`}>
          <div className="encounter__head">
            <span className="encounter__icon">{pending.icon}</span>
            <span className="encounter__name">{pending.name}</span>
            <span className="encounter__timer">
              剩 {Math.max(0, Math.ceil(game.encounterDeadline))} 秒
            </span>
          </div>
          <p className="encounter__desc">{pending.desc}</p>

          {/*
            进攻类事件必须把后果写在明面上（需求 1）：
            不选也会照常结算，所以玩家得知道"放着不管会损失多少"。
          */}
          {isAttackEncounter(pending) && (
            <div className="encounter__warning">
              {(() => {
                const preview = previewAttack(game, pending);
                if (!preview) return null;
                const def = getSectDefense(game);
                return (
                  <>
                    <strong>进攻宗门 —— 不处理就会照常结算。</strong>
                    <span>
                      宗门防御 {Math.round(def * 100)}% · 预期受伤弟子 {preview.casualties.length} 人
                      {preview.severity <= 0 ? '（大阵足以完全挡下）' : ' · 另有资源损失'}
                    </span>
                  </>
                );
              })()}
            </div>
          )}

          <div className="encounter__options">
            {pending.options.map((option, index) => {
              const check = canChooseOption(game, option);
              const need = optionRequiredItems(option);
              return (
                <button
                  key={option.label}
                  type="button"
                  className={
                    option.effect.karma < 0
                      ? 'encounter-option encounter-option--evil'
                      : 'encounter-option'
                  }
                  disabled={!check.ok}
                  onClick={() => chooseEncounter(index)}
                >
                  <span className="encounter-option__label">{option.label}</span>
                  <span className="encounter-option__desc">{option.desc}</span>
                  <span className="encounter-option__effect">{describeOption(option)}</span>
                  {Object.keys(need).length > 0 && (
                    <span className="encounter-option__need">
                      需 {Object.entries(need).map(([item, n]) => `${ITEM_MAP[item as ItemId]?.name ?? item}×${n}`).join('、')}
                    </span>
                  )}
                  {!check.ok && check.reason && <span className="encounter-option__why">{check.reason}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default EncounterPanel;

/** 侧栏用的一行善恶值（小屏时也看得见） */
export function KarmaStrip() {
  const game = useGame((s) => s.game);
  const label = getKarmaLabel(game);
  const karma = getKarma(game);
  const pending = Boolean(game.pendingEncounter);

  return (
    <div className={`karma-strip karma-strip--${label.tone}`}>
      <span className="karma-strip__icon">{label.icon}</span>
      <span className="karma-strip__name">{label.name}</span>
      <span className="karma-strip__value">
        {karma > 0 ? '+' : ''}
        {Math.round(karma)}
      </span>
      {pending && <span className="karma-strip__badge">遇</span>}
    </div>
  );
}

/** 遭遇里的物品名（导出给测试用） */
export function encounterItemName(item: ItemId): string {
  return ITEM_MAP[item]?.name ?? item;
}

/** 遭遇表（导出给测试用） */
export const ENCOUNTER_IDS = Object.keys(ENCOUNTER_MAP);
