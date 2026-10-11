import { useEffect, useState } from 'react';
import { useGame } from './game/store';
import { useGameLoop } from './game/useGameLoop';
import { getIdleDisciples } from './game/expeditions';
import { getReadyPlantings } from './game/planting';
import { isArenaRunning } from './game/sectActivity';

import Header from './components/Header';
import ResourceBar from './components/ResourceBar';
import ActionPanel from './components/ActionPanel';
import ServantPanel from './components/ServantPanel';
import BuildingsPanel from './components/BuildingsPanel';
import BuildQueuePanel from './components/BuildQueuePanel';
import ResearchPanel from './components/ResearchPanel';
import RealmPanel from './components/RealmPanel';
import SeasonPanel, { SeasonStrip } from './components/SeasonPanel';
import EncounterPanel, { KarmaStrip } from './components/EncounterPanel';
import AscendPanel from './components/AscendPanel';
import StonePanel from './components/StonePanel';
import SectPanel from './components/SectPanel';
import SectHallPanel from './components/SectHallPanel';
import DisciplePanel from './components/DisciplePanel';
import MapPanel from './components/MapPanel';
import AlchemyPanel from './components/AlchemyPanel';
import RefiningPanel from './components/RefiningPanel';
import InventoryPanel from './components/InventoryPanel';
import PlantationPanel from './components/PlantationPanel';
import ShopPanel from './components/ShopPanel';
import SavePanel from './components/SavePanel';
import JournalPanel from './components/JournalPanel';
import OfflineModal from './components/OfflineModal';

type TabId = 'cultivation' | 'cave' | 'sect' | 'expedition' | 'craft' | 'farm';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'cultivation', label: '修行', icon: '☯' },
  { id: 'cave', label: '洞府', icon: '🏔' },
  { id: 'sect', label: '宗门', icon: '🏯' },
  { id: 'expedition', label: '探索', icon: '🗺' },
  { id: 'craft', label: '丹器', icon: '⚗' },
  { id: 'farm', label: '灵植', icon: '🌱' },
];

/** 提示条：3 秒后自动消失 */
function Notice() {
  const notice = useGame((s) => s.notice);
  const setNotice = useGame((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(id);
  }, [notice, setNotice]);

  if (!notice) return null;
  return <div className="notice">{notice}</div>;
}

/** 标签上的小角标：提醒玩家有事情可做 */
function TabBadge({ tab }: { tab: TabId }) {
  const game = useGame((s) => s.game);

  if (tab === 'expedition' && game.expeditions.length > 0) {
    return <span className="tab__badge">{game.expeditions.length}</span>;
  }
  if (tab === 'sect' && game.sect.founded) {
    const idle = getIdleDisciples(game).length;
    if (idle > 0) return <span className="tab__badge tab__badge--soft">{idle}</span>;
  }
  if (tab === 'farm') {
    const ready = getReadyPlantings(game).length;
    if (ready > 0) return <span className="tab__badge">{ready}</span>;
  }
  return null;
}

function CultivationTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <ActionPanel />
        <ServantPanel />
      </div>
      <div className="layout__right">
        {/* 需求 2：开宗前的随机遭遇与善恶值，放在修行页最上面 */}
        <EncounterPanel />
        <RealmPanel />
        <SeasonPanel />
        <StonePanel />
        <AscendPanel />
      </div>
    </main>
  );
}

function CaveTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <BuildingsPanel />
      </div>
      <div className="layout__right">
        <BuildQueuePanel />
        <ResearchPanel />
        <SavePanel />
      </div>
    </main>
  );
}

function SectTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <SectHallPanel />
      </div>
      <div className="layout__right">
        <SectPanel />
        <DisciplePanel />
        <JournalPanel />
      </div>
    </main>
  );
}

function ExpeditionTab() {
  return (
    <main className="layout layout--single">
      <MapPanel />
    </main>
  );
}

function CraftTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <AlchemyPanel />
        <RefiningPanel />
      </div>
      <div className="layout__right">
        <InventoryPanel />
      </div>
    </main>
  );
}

function FarmTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <PlantationPanel />
      </div>
      <div className="layout__right">
        <ShopPanel />
      </div>
    </main>
  );
}

export default function App() {
  useGameLoop();
  const [tab, setTab] = useState<TabId>('cultivation');
  const sectFounded = useGame((s) => s.game.sect.founded);
  const arenaRunning = useGame((s) => isArenaRunning(s.game));

  return (
    <div className="app">
      <Header />

      <nav className="tabs">
        {TABS.map((item) => {
          // 只有宗门本身需要开宗立派。
          // 「探索」页不灰掉 —— 需求 1 的个人游历正是给"还没开宗"的玩家准备的；
          // 「丹器」也不灰掉 —— 开宗前靠游历就能拿到炼丹材料。
          const gated = item.id === 'sect' && !sectFounded;
          return (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'tab tab--active' : 'tab'}
              onClick={() => setTab(item.id)}
            >
              <span className="tab__icon">{item.icon}</span>
              {item.label}
              <TabBadge tab={item.id} />
              {gated && <span className="tab__hint">未开宗</span>}
              {item.id === 'sect' && arenaRunning && <span className="tab__badge tab__badge--soft">比</span>}
            </button>
          );
        })}
      </nav>

      {/*
        需求 2：资源展示模块移到左边，不再压在其它模块上方。
        所以这里改成「左侧固定资源栏 + 右侧内容区」的两列骨架。
      */}
      <div className="shell">
        <aside className="shell__side" aria-label="资源">
          <ResourceBar />
          {/* 季节会改变所有资源产出，所以放在资源栏下面常驻可见（需求 1） */}
          <SeasonStrip />
          {/* 善恶值与"有遭遇待选"的提示（需求 2） */}
          <KarmaStrip />
        </aside>

        <div className="shell__main">
          {tab === 'cultivation' && <CultivationTab />}
          {tab === 'cave' && <CaveTab />}
          {tab === 'sect' && <SectTab />}
          {tab === 'expedition' && <ExpeditionTab />}
          {tab === 'craft' && <CraftTab />}
          {tab === 'farm' && <FarmTab />}
        </div>
      </div>

      <footer className="footer">
        进度保存在你自己的浏览器里 · 数值设定见仓库中的 BALANCE.md
      </footer>

      <Notice />
      <OfflineModal />
    </div>
  );
}
