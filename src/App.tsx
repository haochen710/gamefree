import { useEffect } from 'react';
import { useGame } from './game/store';
import { useGameLoop } from './game/useGameLoop';
import Header from './components/Header';
import ResourceBar from './components/ResourceBar';
import ActionPanel from './components/ActionPanel';
import GeneratorPanel from './components/GeneratorPanel';
import RealmPanel from './components/RealmPanel';
import AscendPanel from './components/AscendPanel';
import SavePanel from './components/SavePanel';
import OfflineModal from './components/OfflineModal';

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

export default function App() {
  useGameLoop();

  return (
    <div className="app">
      <Header />
      <ResourceBar />

      <main className="layout">
        <div className="layout__left">
          <ActionPanel />
          <GeneratorPanel />
        </div>
        <div className="layout__right">
          <RealmPanel />
          <AscendPanel />
          <SavePanel />
        </div>
      </main>

      <footer className="footer">
        进度保存在你自己的浏览器里 ·
        <a href="https://github.com/" target="_blank" rel="noreferrer">
          源码
        </a>
      </footer>

      <Notice />
      <OfflineModal />
    </div>
  );
}
