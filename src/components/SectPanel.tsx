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
  getHousingCapacity,
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

  const housing = getHousingCapacity(game);
  const capacity = getDiscipleCapacity(game);
  const atHousingLimit = housing <= capacity;

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
              （居所 {housing} / 宗门 {discipleCapBySect(game.sect.level)}）
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

        {atHousingLimit && capacity < discipleCapBySect(game.sect.level) && (
          <p className="panel__note panel__note--warn">
            居所已满 —— 去「修行」页建造更多茅屋 / 院落 / 洞天。
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
          <p className="panel__note">
            招收价格随宗门品阶和弟子人数上涨。宗门品阶越高，招到高资质弟子的概率越大 ——
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
