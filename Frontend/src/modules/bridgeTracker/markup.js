// The tracker's page, as the standalone index.html laid it out. mountTracker writes it into
// its root element; app.js then finds every part by id, scoped to that root.
export const MARKUP = `
<div id="app">
  <header class="topbar">
    <div class="brand">
      <svg width="30" height="22" viewBox="0 0 30 22" aria-hidden="true"><path d="M1 16h28M4 16V9M15 16V2M26 16V9M4 9l11-7 11 7M9 16v5M21 16v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div style="min-width:0">
        <h1>Palashbari–Sualkuchi Extradosed Bridge</h1>
        <div class="sub" id="sub">RFI tracker · Schedule 4</div>
      </div>
    </div>
    <div class="ipcpick" title="Active IPC upload">
      <select id="ipcSel" aria-label="Active IPC"></select>
      <span class="meta" id="ipcMeta"></span>
    </div>
    <div class="chips" id="chips" role="toolbar" aria-label="Summary"></div>
    <div class="search">
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="q" type="search" placeholder="Element key or RFI no." autocomplete="off" aria-label="Search by element key or RFI number">
      <div class="results" id="qres" hidden></div>
    </div>
  </header>

  <main class="stage" id="stage">
    <canvas id="c3d" aria-label="3D bridge model"></canvas>
    <div class="labels" id="labels"></div>
    <div class="hover-tag" id="hoverTag" hidden></div>
    <div class="cube"><canvas id="cube" width="192" height="192" aria-label="View cube"></canvas>
      <button class="iconbtn" id="cubeHome" title="Home view" aria-label="Home view"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M3 11 12 4l9 7M6 9.5V20h12V9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>
    </div>
    <aside class="panel left" id="left" hidden></aside>
    <aside class="panel right" id="right" hidden></aside>
    <div class="section-box" id="sectionBox" hidden></div>
    <div class="legend" id="legend"></div>
    <div class="timeline" id="timeline" hidden></div>
    <div class="empty" id="empty" hidden></div>
    <div class="progress" id="progress" hidden><div id="progLabel">Loading</div><div class="bar"><i id="progBar"></i></div></div>
    <div class="toast" id="toast" hidden role="status" aria-live="polite"></div>
    <nav class="toolbar" id="toolbar" aria-label="Viewer tools"></nav>
  </main>
</div>
<div class="modal" id="modal" hidden></div>
`;
