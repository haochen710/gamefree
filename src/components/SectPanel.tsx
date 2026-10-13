/**
 * 宗门面板（需求 3 / 6）
 *
 * 开宗立派 → 晋升品阶 → 招收弟子。
 * 宗门品阶同时决定三件事：招到好苗子的概率、弟子上限、可并行的探索队伍数。
 */
import { fmt } from '../game/decimal';
import { REALMS, SECT_LEVELS, discipleCapBySect, expeditionSlots } from '../game/content';
import {
  getDiscipleCapacity,
  getDiscipleHousing,
  getSectLevelDef,
  getSectUpgradeStatus,
  toCostMap,
} from '../game/engine';
import { canRecruit, getRecruitCost } from '../game/disciples';
import { useGame } from '../game/store';
import CostList from './CostList';

export function SectPanel() {
  const game = useGame((s) => s.game);
  const foundSect = useGame((s) => s.foundSect);
  const upgradeSect = useGame((s) => s.upgradeSect);
  const recruitDisciple = useGame((s) => s.recruitDisciple);
  const recruitBatch = useGame((s) => s.recruitDiscipleBatch);

  /* ---------------- 尚未开宗 ---------------- */
  if (!game.sect.founded) {
    const need = SECT_LEVELS[0];
    const ready = game.realmIndex >= need.requiresRealm;
    const cost = toCostMap(need.cost);

    return (
      <section className="panel">
        <div className="panel__head">
          <h2>开宗立派</h2>
          <span className="panel__hint">宗门系统</span>
        </div>
        <p className="panel__note">
          修至 <strong>{REALMS[need.requiresRealm].name}</strong> 后便可开宗立派、广收门徒。
          弟子会在你离线时自行修炼，也可派往秘境探索稀有材料 —— 但探索可能折损人手。
        </p>
        <p className="panel__note">
          开派所需：<CostList cost={cost} state={game} />
        </p>
        <button type="button" className="btn btn--primary btn--wide" disabled={!ready} onClick={foundSect}>
          开宗立派
          {!ready && <span className="btn__sub">需先修至{REALMS[need.requiresRealm].name}</span>}
        </button>
      </section>
    );
  }

  /* ---------------- 已开宗 ---------------- */
  const levelDef = getSectLevelDef(game.sect.level);
  const upgrade = getSectUpgradeStatus(game);
  const recruit = canRecruit(game);
  const recruitCost = getRecruitCost(game);

  // 需求 1 / 2：弟子上限有两条线 —— 弟子居所床位 与 宗门品阶上限
  const housing = getDiscipleHousing(game);
  const bySect = discipleCapBySect(game.sect.level);
  const capacity = getDiscipleCapacity(game);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>宗门</h2>
        <span className="panel__hint">{levelDef.name}</span>
      </div>

      <div className="realm">
        <div className="realm__name">{levelDef.name}</div>
        <div className="realm__desc">{levelDef.desc}</div>

        <div className="sect__stats">
          <div>
            <span className="save__label">弟子上限</span>
            <strong>{capacity}</strong>
            <em>
              （弟子居所 {housing} / 宗门品阶 {bySect}）
            </em>
          </div>
          <div>
            <span className="save__label">探索队伍</span>
            <strong>{expeditionSlots(game.sect.level)}</strong>
          </div>
          <div>
            <span className="save__label">累计招收</span>
            <strong>{game.sect.totalRecruited}</strong>
          </div>
        </div>

        {capacity < bySect && (
          <p className="panel__note panel__note--warn">
            弟子居所不够 —— 去「建筑」页的<strong>弟子居所</strong>一组再盖几座
            （仆役居所不算数，两边是分开的）。
          </p>
        )}
        {capacity >= bySect && capacity < 2048 && (
          <p className="panel__note">
            已住满{levelDef.name}允许的 {bySect} 人 —— 想再收人就先晋升宗门品阶。
          </p>
        )}

        <div className="realm__action">
          <button
            type="button"
            className="btn btn--primary btn--wide"
            disabled={!recruit.ok}
            onClick={recruitDisciple}
          >
            招收弟子
            <span className="btn__sub">
              💎 {fmt(recruitCost)} {recruit.ok ? '' : `· ${recruit.reason}`}
            </span>
          </button>
          {/*
            需求 10：支持批量招收。
            十次十次地点在千人宗门里是纯折磨 —— 三个档位覆盖"补几个人"到"住满为止"。
            招到招不动（灵石/床位/品阶上限）就自己停，并把原因写在提示里。
          */}
          <div className="btn-row btn-row--wrap">
            {[10, 50, 200].map((count) => (
              <button
                key={count}
                type="button"
                className="btn btn--tiny"
                disabled={!recruit.ok}
                title={recruit.ok ? `连续招 ${count} 人（招不动就停）` : (recruit.reason ?? '')}
                onClick={() => recruitBatch(count)}
              >
                一次招 {count}
              </button>
            ))}
            <button
              type="button"
              className="btn btn--tiny"
              disabled={!recruit.ok}
              title="一直招到灵石、床位或品阶上限为止"
              onClick={() => recruitBatch(2048)}
            >
              招到住满
            </button>
          </div>
          <p className="panel__note">
            招收价格只看宗门品阶（同一个品阶里招第一个和招最后一个一个价）。
            宗门品阶越高，招到高资质弟子的概率越大 ——
            九品宗门有 30% 的概率招到天灵根。
          </p>
        </div>

        <div className="realm__action">
          <div className="realm__req">
            {upgrade.nextLevel !== null ? (
              <>
                晋升 {SECT_LEVELS[upgrade.nextLevel - 1].name} 所需：
                <CostList cost={upgrade.cost} state={game} />
              </>
            ) : (
              '宗门已至九品'
            )}
          </div>
          <button
            type="button"
            className="btn btn--wide"
            disabled={!upgrade.possible}
            onClick={upgradeSect}
          >
            晋升宗门品阶
            {!upgrade.possible && upgrade.reason && <span className="btn__sub">{upgrade.reason}</span>}
          </button>
        </div>
      </div>
    </section>
  );
}

export default SectPanel;
