/**
 * 宗门建筑与大比（需求 4）
 *
 * 需求原文：「宗门增加宗门建筑，除了掌门大殿和山门，其余建筑需钻研解锁，
 *           比如比武台、武技阁、功法殿、通天塔（弟子用建筑，弟子探索后增加心得，
 *           加快进境等，弟子使用这些建筑为随机事件，比武台除外，
 *           比武台由玩家决定是否开启，十年一次，每次大比结束全宗弟子修行速度增加，
 *           持续一年）」
 *
 * 所以这一页有两块：
 *   上：比武台与大比 —— 唯一由玩家直接控制的宗门建筑
 *   下：弟子用建筑的现状 —— 哪些已建、弟子会去做什么（随机事件）
 *
 * 建筑的建造仍然在「洞府」页的宗门建筑分组里，这里只做控制与说明。
 */
import { fmtDuration } from '../game/decimal';
import { REALMS } from '../game/content';
import { getBuildingCount, getCultivationSpeedMultiplier } from '../game/engine';
import {
  ARENA_BUFF_SECONDS,
  ARENA_INTERVAL_SECONDS,
  getArenaCountdown,
  getEventBuildings,
  hasArena,
  isArenaBuffActive,
  isArenaRunning,
} from '../game/sectActivity';
import { useGame } from '../game/store';

const EVENT_LABEL: Record<string, string> = {
  cultivate: '入殿参悟，修为骤进',
  insight: '研习武技，心得增长',
  discover: '登塔远眺，可望见远处秘境',
};

export function SectHallPanel() {
  const game = useGame((s) => s.game);
  const toggleArena = useGame((s) => s.toggleArena);
  const holdArena = useGame((s) => s.holdArena);

  const built = hasArena(game);
  const running = isArenaRunning(game);
  const countdown = getArenaCountdown(game);
  const buffActive = isArenaBuffActive(game);
  const eventBuildings = getEventBuildings(game);
  const speed = getCultivationSpeedMultiplier(game);

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <h2>🥋 比武台与大比</h2>
          <span className="panel__hint">
            {built ? (running ? '已开启' : '已停办') : '尚未建造'}
          </span>
        </div>

        <p className="panel__note">
          大比是宗门唯一的集体盛事：<strong>十年一度</strong>，
          比完全宗弟子修行速度<strong>翻倍</strong>、持续<strong>一年</strong>，
          并各得一份心得。它是唯一由你决定开不开的宗门建筑 ——
          其余弟子用建筑都是弟子自发的随机事件。
        </p>

        {built ? (
          <>
            <div className="realm-card__stats">
              <span>比试周期 {fmtDuration(ARENA_INTERVAL_SECONDS)}（十年）</span>
              <span>加速时长 {fmtDuration(ARENA_BUFF_SECONDS)}（一年）</span>
              <span>当前修行倍率 ×{speed.toFixed(2)}</span>
            </div>

            {running && countdown !== null && (
              <div className="running">
                <div className="running__head">
                  <span>距下次大比</span>
                  <span className="running__time">{fmtDuration(countdown)}</span>
                </div>
                <div className="bar">
                  <div
                    className="bar__fill"
                    style={{
                      width: `${Math.round((1 - countdown / ARENA_INTERVAL_SECONDS) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {buffActive && (
              <div className="realm-card__power realm-card__power--good">
                大比加成生效中，全宗修行速度 ×2
                <em>（剩余 {fmtDuration(game.arenaBuffSeconds)}）</em>
              </div>
            )}

            <div className="btn-row btn-row--wrap">
              <button
                type="button"
                className={running ? 'btn btn--danger' : 'btn btn--primary'}
                onClick={toggleArena}
              >
                {running ? '停办大比' : '开启大比'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={!running || (countdown ?? 0) > 0}
                onClick={holdArena}
              >
                立即开比
              </button>
            </div>
          </>
        ) : (
          <p className="panel__note panel__note--warn">
            先在「洞府」页的<strong>宗门建筑</strong>分组里建起掌门大殿，
            再钻研「比武之礼」、建成比武台。
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>弟子用建筑</h2>
          <span className="panel__hint">{eventBuildings.length} 类已建</span>
        </div>

        <p className="panel__note">
          弟子闲暇时会自发前往这些建筑（随机事件，约每 45 秒判定一次）。
          弟子探索秘境归来会积累<strong>心得</strong>，每点心得使该弟子修行速度 +1%，最多 +100%。
        </p>

        {eventBuildings.length === 0 && (
          <p className="panel__note">
            还没有可供弟子使用的建筑。武技阁、功法殿、通天塔都需要先钻研对应技术，
            并以掌门大殿为前提。
          </p>
        )}

        {eventBuildings.map((building) => (
          <div key={building.id} className="inv-row inv-row--wrap">
            <span className="inv-row__icon">{building.icon}</span>
            <span className="inv-row__name">{building.name}</span>
            <span className="inv-row__count">×{getBuildingCount(game, building.id)}</span>
            <span className="inv-row__effect">{EVENT_LABEL[building.kind] ?? '弟子自发前往'}</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>弟子心得</h2>
          <span className="panel__hint">修行加速来源</span>
        </div>
        {game.sect.disciples.length === 0 ? (
          <p className="panel__note">尚无弟子。</p>
        ) : (
          [...game.sect.disciples]
            .sort((a, b) => b.insight - a.insight)
            .slice(0, 12)
            .map((d) => (
              <div key={d.id} className="inv-row inv-row--wrap">
                <span className="inv-row__icon">📖</span>
                <span className="inv-row__name">{d.name}</span>
                <span className="inv-row__count">心得 {Math.round(d.insight)}</span>
                <span className="inv-row__effect">
                  {REALMS[d.realmIndex].name} · 修行 +{Math.min(Math.round(d.insight), 100)}%
                </span>
              </div>
            ))
        )}
      </section>
    </>
  );
}

export default SectHallPanel;
