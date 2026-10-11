/** 存档面板：手动存档、导出/导入存档码、重开 */
import { useState } from 'react';
import { fmt, fmtDuration } from '../game/decimal';
import { useGame } from '../game/store';
import { AUTOSAVE_MS } from '../game/useGameLoop';

export function SavePanel() {
  const lastSavedAt = useGame((s) => s.lastSavedAt);
  const playTime = useGame((s) => s.game.playTime);
  const lifetimeQi = useGame((s) => s.game.lifetimeQi);

  const saveNow = useGame((s) => s.saveNow);
  const exportSave = useGame((s) => s.exportSave);
  const importSave = useGame((s) => s.importSave);
  const hardReset = useGame((s) => s.hardReset);

  const [code, setCode] = useState('');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const sinceSave = Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000));

  const handleExport = () => {
    setCode(exportSave());
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const handleImport = () => {
    if (!input.trim()) return;
    if (!window.confirm('导入存档会覆盖当前进度，确定继续？')) return;
    if (importSave(input)) {
      setInput('');
      setCode('');
    }
  };

  const handleReset = () => {
    if (!window.confirm('确定要抹去一切，重新开始修行吗？此操作不可撤销。')) return;
    if (!window.confirm('真的确定？所有境界、道韵与设施都会消失。')) return;
    hardReset();
    setCode('');
    setInput('');
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>洞府记事</h2>
        <span className="panel__hint">存档与统计</span>
      </div>

      <div className="save__stats">
        <div>
          <span className="save__label">累计修行</span>
          <span>{fmtDuration(playTime)}</span>
        </div>
        <div>
          <span className="save__label">历世灵气</span>
          <span>☯ {fmt(lifetimeQi)}</span>
        </div>
        <div>
          <span className="save__label">最近存档</span>
          <span>{sinceSave < 3 ? '刚刚' : `${sinceSave} 秒前`}</span>
        </div>
      </div>

      <p className="panel__note">
        游戏每 {AUTOSAVE_MS / 1000} 秒自动存档到浏览器本地。换设备或清缓存前，请先导出存档码自行保管。
      </p>

      <div className="btn-row btn-row--wrap">
        <button type="button" className="btn" onClick={saveNow}>
          立即存档
        </button>
        <button type="button" className="btn" onClick={handleExport}>
          导出存档码
        </button>
        <button type="button" className="btn btn--danger" onClick={handleReset}>
          重开修行
        </button>
      </div>

      {code && (
        <div className="save__block">
          <textarea className="textarea" readOnly value={code} rows={4} onFocus={(e) => e.target.select()} />
          <div className="btn-row">
            <button type="button" className="btn" onClick={handleCopy}>
              {copied ? '已复制 ✓' : '复制到剪贴板'}
            </button>
          </div>
        </div>
      )}

      <div className="save__block">
        <label className="save__label" htmlFor="import-code">
          导入存档码
        </label>
        <textarea
          id="import-code"
          className="textarea"
          placeholder="把之前导出的存档码粘贴到这里"
          value={input}
          rows={3}
          onChange={(e) => setInput(e.target.value)}
        />
        <div className="btn-row">
          <button type="button" className="btn" disabled={!input.trim()} onClick={handleImport}>
            导入并覆盖
          </button>
        </div>
      </div>
    </section>
  );
}

export default SavePanel;
