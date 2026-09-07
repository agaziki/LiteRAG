/**
 * LiteRAG 网页挂件：一段代码接入任意站点
 *
 * 用法（目标站点 </body> 前加入）：
 * <script>
 *   window.LiteRAGConfig = { server: "https://your-literag-domain.com" };
 * </script>
 * <script src="https://your-literag-domain.com/embed.js"></script>
 *
 * 功能：右下角悬浮客服按钮 → 打开 iframe 对话窗（加载 /widget 页面）。
 */
(function () {
  var config = window.LiteRAGConfig || {};
  var server = (config.server || '').replace(/\/$/, '');
  if (!server) {
    console.error('[LiteRAG] 请配置 window.LiteRAGConfig.server');
    return;
  }

  // 样式
  var style = document.createElement('style');
  style.textContent = [
    '#literag-fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;',
    'background:#0052d9;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 12px rgba(0,82,217,.4);',
    'font-size:24px;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .2s}',
    '#literag-fab:hover{transform:scale(1.08)}',
    '#literag-panel{position:fixed;right:20px;bottom:88px;width:400px;max-width:calc(100vw - 32px);',
    'height:600px;max-height:calc(100vh - 120px);border:none;border-radius:12px;overflow:hidden;',
    'box-shadow:0 8px 32px rgba(0,0,0,.18);z-index:2147483000;display:none}',
    '#literag-panel.open{display:block}',
    '@media (max-width:480px){#literag-panel{right:8px;left:8px;bottom:80px;width:auto;height:70vh}}'
  ].join('');
  document.head.appendChild(style);

  // 悬浮按钮
  var fab = document.createElement('button');
  fab.id = 'literag-fab';
  fab.setAttribute('aria-label', '打开客服');
  fab.innerHTML = '&#128172;'; // 💬
  document.body.appendChild(fab);

  // 对话面板（iframe 加载 /widget）
  var panel = document.createElement('iframe');
  panel.id = 'literag-panel';
  panel.src = server + '/widget';
  panel.allow = 'clipboard-write';
  document.body.appendChild(panel);

  var open = false;
  fab.addEventListener('click', function () {
    open = !open;
    panel.classList.toggle('open', open);
    fab.innerHTML = open ? '&#10005;' : '&#128172;'; // ✕ / 💬
  });
})();
