import { useEffect, useState } from 'react';
import { useGame } from './game/store';
import { useGameLoop } from './game/useGameLoop';
import { getIdleDisciples } from './game/expeditions';

import Header from './components/Header';
import ResourceBar from './components/ResourceBar';
import ActionPanel from './components/ActionPanel';
import BuildingsPanel from './components/BuildingsPanel';
import RealmPanel from './components/RealmPanel';
import AscendPanel from './components/AscendPanel';
import StonePanel from './components/StonePanel';
import SectPanel from './components/SectPanel';
import DisciplePanel from './components/DisciplePanel';
import ExpeditionPanel from './components/ExpeditionPanel';
import AlchemyPanel from './components/AlchemyPanel';
import RefiningPanel from './components/RefiningPanel';
import InventoryPanel from './components/InventoryPanel';
import SavePanel from './components/SavePanel';
import JournalPanel from './components/JournalPanel';
import OfflineModal from './components/OfflineModal';

type TabId = 'cultivation' | 'sect' | 'expedition' | 'craft' | 'save';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'cultivation', label: '修行', icon: '☯' },
  { id: 'sect', label: '宗门', icon: '🏯' },
  { id: 'expedition', label: '秘境', icon: '🌌' },
  { id: 'craft', label: '丹器', icon: '⚗' },
  { id: 'save', label: '洞府', icon: '📜' },
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
  const idle = getIdleDisciples(game).length;

  if (tab === 'expedition' && game.expeditions.length > 0) {
    return <span className="tab__badge">{game.expeditions.length}</span>;
  }
  if (tab === 'sect' && game.sect.founded && idle > 0) {
    return <span className="tab__badge tab__badge--soft">{idle}</span>;
  }
  return null;
}

function CultivationTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <ActionPanel />
        <BuildingsPanel />
      </div>
      <div className="layout__right">
        <RealmPanel />
        <StonePanel />
        <AscendPanel />
      </div>
    </main>
  );
}

function SectTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <DisciplePanel />
      </div>
      <div className="layout__right">
        <SectPanel />
        <JournalPanel />
      </div>
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

function SaveTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <SavePanel />
      </div>
      <div className="layout__right">
        <JournalPanel />
      </div>
    </main>
  );
}

export default function App() {
  useGameLoop();
  const [tab, setTab] = useState<TabId>('cultivation');
  const sectFounded = useGame((s) => s.game.sect.founded);

  return (
    <div className="app">
      <Header />
      <ResourceBar />

      <nav className="tabs">
        {TABS.map((item) => {
          // 宗门、秘境、丹器在开宗立派前没有意义，先灰掉但保留可见，
          // 让玩家知道后面还有什么系统
          const gated = (item.id === 'sect' || item.id === 'expedition' || item.id === 'craft') && !sectFounded;
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
            </button>
          );
        })}
      </nav>

      {tab === 'cultivation' && <CultivationTab />}
      {tab === 'sect' && <SectTab />}
      {tab === 'expedition' && (
        <main className="layout layout--single">
          <ExpeditionPanel />
        </main>
      )}
      {tab === 'craft' && <CraftTab />}
      {tab === 'save' && <SaveTab />}

      <footer className="footer">
        进度保存在你自己的浏览器里 · 数值设定见仓库中的 BALANCE.md
      </footer>

      <Notice />
      <OfflineModal />
    </div>
  );
}
