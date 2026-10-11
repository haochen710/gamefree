/**
 * 秘境探索（需求 5）
 *
 * 每张秘境卡都显示「队伍战力 / 推荐战力」的对比 —— 这是玩家判断该派谁去的核心信息。
 * 战力不足不仅收益腰斩，伤亡率还会成倍上升。
 */
import { useState } from 'react';
import { fmt } from '../game/decimal';
import {
  APTITUDE_MAP,
  ITEM_MAP,
  REALMS,
  SECRET_REALMS,
  type ItemId,
  type SecretRealmDef,
} from '../game/content';
import {
  canStartExpedition,
  getExpeditionProgress,
  getExpeditionSpeed,
  getIdleDisciples,
  autoSelectParty,
} from '../game/expeditions';
import { isRealmUnlocked } from '../game/engine';
import { getPartyPower } from '../game/disciples';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';

/** 把战力比换算成一句人话 */
function powerComment(ratio: number): { text: string; tone: string } {
  if (ratio >= 3) return { text: '碾压，收益已满', tone: 'good' };
  if (ratio >= 1.5) return { text: '稳操胜券', tone: 'good' };
  if (ratio >= 1) return { text: '旗鼓相当', tone: 'ok' };
  if (ratio >= 0.6) return { text: '实力不济，收益大减且伤亡偏高', tone: 'warn' };
  return { text: '凶多吉少，极可能全军覆没', tone: 'bad' };
}

function RealmCard({ def, state }: { def: SecretRealmDef; state: GameState }) {
  const startExpedition = useGame((s) => s.startExpedition);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const idle = getIdleDisciples(state).filter((d) => d.realmIndex >= def.minRealm);
  const partyPower = getPartyPower(state, selected);
  const ratio = def.requiredPower > 0 ? partyPower / def.requiredPower : 3;
  const comment = powerComment(ratio);

  const check = canStartExpedition(state, def.id, selected);
  const speed = getExpeditionSpeed(state);
  const realDuration = def.duration / speed;

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= def.partySize ? prev : [...prev, id],
    );
  };

  const lootText = def.loot
    .map((entry) => `${ITEM_MAP[entry.item].icon}${ITEM_MAP[entry.item].name}`)
    .join(' ');

  return (
    <article className="realm-card">
      <div className="realm-card__head">
        <span className="realm-card__icon">{def.icon}</span>
        <div>
          <div className="realm-card__name">{def.name}</div>
          <div className="realm-card__desc">{def.desc}</div>
        </div>
      </div>

      <div className="realm-card__stats">
        <span>推荐战力 <strong>{fmt(def.requiredPower)}</strong></span>
        <span>队伍 {def.partySize} 人</span>
        <span>{REALMS[def.minRealm].name}以上</span>
        <span>约 {Math.round(realDuration / 60)} 分钟</span>
        <span>伤亡率 {(def.baseCasualty * 100).toFixed(0)}%</span>
      </div>

      <div className="realm-card__loot">产出倾向：{lootText}</div>

      <div className={`realm-card__power realm-card__power--${comment.tone}`}>
        当前队伍战力 {fmt(Math.round(partyPower))} / {fmt(def.requiredPower)}
        <em>（{selected.length}/{def.partySize} 人 · {comment.text}）</em>
      </div>

      {selected.length > 0 && (
        <div className="chip-row">
          {selected.map((id) => {
            const d = state.sect.disciples.find((x) => x.id === id);
            if (!d) return null;
            return (
              <button key={id} type="button" className="chip" onClick={() => toggle(id)}>
                {d.name}
                <span className="chip__sub" style={{ color: APTITUDE_MAP[d.aptitude].color }}>
                  {REALMS[d.realmIndex].name}
                </span>
                ×
              </button>
            );
          })}
        </div>
      )}

      {picking && (
        <div className="picker">
          {idle.length === 0 && <p className="panel__note">没有符合条件的空闲弟子。</p>}
          {idle.map((d) => (
            <button
              key={d.id}
              type="button"
              className={selected.includes(d.id) ? 'picker__item picker__item--on' : 'picker__item'}
              onClick={() => toggle(d.id)}
            >
              <span className="picker__name">{d.name}</span>
              <span className="picker__apt" style={{ color: APTITUDE_MAP[d.aptitude].color }}>
                {APTITUDE_MAP[d.aptitude].name}
              </span>
              <span className="picker__realm">{REALMS[d.realmIndex].name}</span>
              <span className="picker__power">战力 {fmt(REALMS[d.realmIndex].power)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setPicking((v) => !v)}>
          {picking ? '收起名单' : '选择弟子'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={idle.length < def.partySize}
          onClick={() => setSelected(autoSelectParty(state, def.id))}
        >
          推荐队伍
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!check.ok}
          onClick={() => {
            startExpedition(def.id, selected);
            setSelected([]);
            setPicking(false);
          }}
        >
          派遣
          {!check.ok && check.reason && <span className="btn__sub">{check.reason}</span>}
        </button>
      </div>
    </article>
  );
}

export function ExpeditionPanel() {
  const game = useGame((s) => s.game);
  const speed = getExpeditionSpeed(game);

  if (!game.sect.founded) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>秘境</h2>
          <span className="panel__hint">探索</span>
        </div>
        <p className="panel__note">
          秘境是稀有丹药材料的唯一来源，但需要弟子前往探索 ——
          先到「宗门」面板开宗立派、招收弟子。
        </p>
      </section>
    );
  }

  const unlocked = SECRET_REALMS.filter((def) => isRealmUnlocked(def, game));
  const locked = SECRET_REALMS.filter((def) => !isRealmUnlocked(def, game));

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2>进行中的探索</h2>
          <span className="panel__hint">
            {game.expeditions.length} 支队伍 · 速度 ×{speed.toFixed(2)}
          </span>
        </div>

        {game.expeditions.length === 0 && <p className="panel__note">当前没有弟子在外探索。</p>}

        {game.expeditions.map((expedition) => {
          const def = SECRET_REALMS.find((r) => r.id === expedition.realmId);
          const names = expedition.discipleIds
            .map((id) => game.sect.disciples.find((d) => d.id === id)?.name ?? '？')
            .join('、');
          const remainSeconds = Math.max(0, (expedition.duration - expedition.progress) / speed);
          const progress = getExpeditionProgress(expedition);

          return (
            <div key={expedition.id} className="running">
              <div className="running__head">
                <span>{def?.icon} {def?.name ?? expedition.realmId}</span>
                <span className="running__time">
                  剩余 {remainSeconds > 90 ? `${Math.round(remainSeconds / 60)} 分钟` : `${Math.round(remainSeconds)} 秒`}
                </span>
              </div>
              <div className="bar">
                <div className="bar__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="running__party">{names}</div>
            </div>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>秘境</h2>
          <span className="panel__hint">已发现 {unlocked.length} 处</span>
        </div>
        <div className="realm-card-list">
          {unlocked.map((def) => (
            <RealmCard key={def.id} def={def} state={game} />
          ))}
        </div>
      </section>

      {locked.length > 0 && (
        <section className="panel">
          <div className="panel__head">
            <h2>未探明的秘境</h2>
            <span className="panel__hint">{locked.length} 处</span>
          </div>
          {locked.map((def) => {
            const needs = Object.entries(def.unlock).map(([id, amount]) => {
              const item = ITEM_MAP[id as ItemId];
              return `${item?.icon ?? '?'}${item?.name ?? id}×${amount}`;
            });
            if (def.requiresSectLevel) needs.push(`${def.requiresSectLevel} 品宗门`);
            return (
              <div key={def.id} className="locked-realm">
                <span>{def.icon} {def.name}</span>
                <span className="locked-realm__need">需 {needs.join('、')}</span>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

export default ExpeditionPanel;
