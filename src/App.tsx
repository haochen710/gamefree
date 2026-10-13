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
import RefinePanel from './components/RefinePanel';
import EnlightenmentPanel from './components/EnlightenmentPanel';
import ResearchPanel from './components/ResearchPanel';
import RealmPanel from './components/RealmPanel';
import SeasonPanel from './components/SeasonPanel';
import EncounterPanel, { KarmaStrip } from './components/EncounterPanel';
import AscendPanel from './components/AscendPanel';
import SectPanel from './components/SectPanel';
import SectHallPanel from './components/SectHallPanel';
import DisciplePanel from './components/DisciplePanel';
import ManualPanel from './components/ManualPanel';
import FamePanel from './components/FamePanel';
import { PostOverview, PostSection } from './components/PostPanel';
import GearPanel from './components/GearPanel';
import TalismanPanel from './components/TalismanPanel';
import MapPanel from './components/MapPanel';
import AlchemyPanel from './components/AlchemyPanel';
import RefiningPanel from './components/RefiningPanel';
import InventoryPanel from './components/InventoryPanel';
import PlantationPanel from './components/PlantationPanel';
import ShopPanel from './components/ShopPanel';
import SavePanel from './components/SavePanel';
import JournalPanel from './components/JournalPanel';
import OfflineModal from './components/OfflineModal';

/*
 * 页签顺序（本轮需求 8：「修行和洞府等大模块的排列顺序修改一下」）。
 *
 * 排法按"一天里点开的频率"从高到低，再往后是纯养成的模块：
 *   修行（挂机时一直要看）→ 探索（有队伍在外面就要看）→ 宗门（弟子）
 *   → 建筑 / 工坊 / 丹器（三件事一条线：盖房 → 合成钻研 → 炼丹炼器）
 *   → 商行 → 灵植 → 感悟 → 洞府（存档，最后）
 *
 * 本轮同时新增了三个**与洞府同级**的模块（需求 5 / 6 / 7）：
 *   商行、工坊（合成 + 钻研）、建筑（建造）。
 * 建造从"洞府"里搬到了"建筑"，钻研与合成从"修行"里搬到了"工坊" ——
 * 于是"洞府"就只剩存档了。
 */
type TabId =
  | 'cultivation'
  | 'expedition'
  | 'sect'
  | 'build'
  | 'workshop'
  /* 需求 5：丹器拆成「炼丹」与「炼器」两页 —— 混在一起界面太长 */
  | 'alchemy'
  | 'refining'
  | 'talisman'
  | 'shop'
  | 'farm'
  | 'enlighten'
  | 'cave';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'cultivation', label: '修行', icon: '☯' },
  { id: 'expedition', label: '探索', icon: '🗺' },
  { id: 'sect', label: '宗门', icon: '🏯' },
  { id: 'build', label: '建筑', icon: '🏗' },
  { id: 'workshop', label: '工坊', icon: '⚒' },
  { id: 'alchemy', label: '炼丹', icon: '⚗' },
  { id: 'refining', label: '炼器', icon: '🔨' },
  { id: 'talisman', label: '符箓', icon: '📜' },
  { id: 'shop', label: '商行', icon: '🏪' },
  { id: 'farm', label: '灵植', icon: '🌱' },
  { id: 'enlighten', label: '感悟', icon: '🧘' },
  { id: 'cave', label: '洞府', icon: '🏔' },
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
  // 建造队列里排着东西：让玩家知道工地上还有活
  if (tab === 'build' && game.buildQueue.length > 0) {
    return <span className="tab__badge tab__badge--soft">{game.buildQueue.length}</span>;
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
        {/* 开宗前的随机遭遇与善恶值，放在修行页最上面 */}
        <EncounterPanel />
        <RealmPanel />
        {/*
          需求 2：派遣的四个岗位小节已经分化到炼丹 / 炼器 / 符箓 / 灵植四页，
          这里只留「四类技艺的横向比较 + 一键填岗」—— 弟子修炼的主场，
          放在弟子面板旁边最顺手。
        */}
        <PostOverview collapsible />
        <SeasonPanel />
        <AscendPanel />
      </div>
    </main>
  );
}

/** 建筑（本轮需求 7：建造单独成为一个与洞府同级的模块） */
function BuildTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        {/*
          洞府界面各个子门类都可以展开收起。
          ⚠️ 组件写好了 `collapsible` 却忘了在这里传 —— 那样它永远是展开的，
          折叠功能只生效了一半。所以这一处必须显式传参。
        */}
        <BuildingsPanel collapsible />
      </div>
      <div className="layout__right">
        <BuildQueuePanel collapsible />
      </div>
    </main>
  );
}

/** 工坊（本轮需求 6：合成与钻研都搬到这里） */
function WorkshopTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <RefinePanel collapsible />
      </div>
      <div className="layout__right">
        <ResearchPanel collapsible />
      </div>
    </main>
  );
}

/** 商行（本轮需求 5：从灵植页里独立出来，与洞府同级） */
function ShopTab() {
  return (
    <main className="layout layout--single">
      <ShopPanel />
    </main>
  );
}

/** 感悟 */
function EnlightenmentTab() {
  return (
    <main className="layout layout--single">
      <EnlightenmentPanel />
    </main>
  );
}

/**
 * 洞府（本轮需求 8：保留这个页签）。
 *
 * 建造搬去「建筑」、感悟早已独立，所以洞府现在放的是"这一局本身"的事：
 * 存档、导出导入、重开。留一个位置而不是把存档塞进别的页面，
 * 是因为"我这局玩到哪了"值得有自己的入口。
 */
function CaveTab() {
  return (
    <main className="layout layout--single">
      <SavePanel collapsible />
    </main>
  );
}

function SectTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        {/*
          需求 2：「宗门界面右边挂的东西很多，左边却只有几个，不合理，重新布置一下」。
          分栏口径改成**按使用频率**：
            左 = 低频只读（宗门概况、名望、记事）
            右 = 要频繁操作（弟子、藏经阁、丹器阁）
          另外「弟子派遣」已经分化到炼丹 / 炼器 / 符箓 / 灵植四页，
          这一页不再挂派遣面板（总览在修行页）。
        */}
        <SectPanel />
        <FamePanel collapsible />
        <SectHallPanel />
        <JournalPanel />
      </div>
      <div className="layout__right">
        <DisciplePanel collapsible />
        {/* 设定集第 7 章：藏经阁（功法碎片、合成、发书） */}
        <ManualPanel collapsible />
        {/* 设定集第 8.7 / 11 章：丹器阁（丹炉九件 + 弟子五装备栏） */}
        <GearPanel collapsible />
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

/** 炼丹（需求 5：从「丹器」里拆出来；需求 2：丹房岗位也归这一页） */
function AlchemyTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <AlchemyPanel />
      </div>
      <div className="layout__right">
        {/* 需求 2：派遣分化到功能页 —— 丹房岗位在这一页安排 */}
        <PostSection kind="alchemy" />
        <InventoryPanel mode="pills" />
      </div>
    </main>
  );
}

/** 炼器（需求 5：器物与弟子装备都归这里；需求 2：炼器房岗位也归这一页） */
function RefiningTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <RefiningPanel />
      </div>
      <div className="layout__right">
        <PostSection kind="refining" />
        {/* 需求 3：这里看的是器物，不是丹药 —— 标题必须跟着变 */}
        <InventoryPanel mode="artifacts" />
      </div>
    </main>
  );
}

/** 符箓（需求 8；需求 2：符房岗位；需求 3：符箓库） */
function TalismanTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <TalismanPanel />
      </div>
      <div className="layout__right">
        <PostSection kind="talisman" />
        <InventoryPanel mode="talismans" />
      </div>
    </main>
  );
}

/** 灵植（需求 2：灵田岗位归这一页） */
function FarmTab() {
  return (
    <main className="layout">
      <div className="layout__left">
        <PlantationPanel />
      </div>
      <div className="layout__right">
        <PostSection kind="farm" />
        <InventoryPanel mode="pills" />
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
          // 「探索」页不灰掉 —— 个人游历正是给"还没开宗"的玩家准备的；
          // 「丹器」「工坊」「商行」也不灰掉 —— 开宗前靠游历就能拿到材料。
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

      <div className="shell">
        <aside className="shell__side" aria-label="资源">
          <ResourceBar />
          {/* 善恶值与"有遭遇待选"的提示 */}
          <KarmaStrip />
        </aside>

        <div className="shell__main">
          {tab === 'cultivation' && <CultivationTab />}
          {tab === 'expedition' && <ExpeditionTab />}
          {tab === 'sect' && <SectTab />}
          {tab === 'build' && <BuildTab />}
          {tab === 'workshop' && <WorkshopTab />}
          {tab === 'alchemy' && <AlchemyTab />}
          {tab === 'refining' && <RefiningTab />}
          {tab === 'talisman' && <TalismanTab />}
          {tab === 'shop' && <ShopTab />}
          {tab === 'farm' && <FarmTab />}
          {tab === 'enlighten' && <EnlightenmentTab />}
          {tab === 'cave' && <CaveTab />}
        </div>
      </div>

      <Notice />
      <OfflineModal />
    </div>
  );
}
