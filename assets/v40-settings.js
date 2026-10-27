/* ============================================================================
 * v40-settings.js · 一级导航底部的「设置」入口（2026-10-21，业主：「在第一导航栏最下面加个设置入口」）
 * v42（2026-10-22，业主「改设置」）：面板换成 dsh 那套两栏结构。
 *
 * 为什么不做成一页：设置不是业务域，塞进 rail 会和 洞察/引擎/平台 抢同一条视线，
 * 也要连带改 hash 路由、页签去重、面包屑。业主只要一个"入口"，那就给弹层 ——
 * 点开即调，关掉回到原页，不留导航痕迹。
 *
 * 结构照 dsh（_ref/dsh-src/packages/client/ui-settings-general）：
 *   面板 800×800 封顶 · 左导航轨 188 宽 · 右内容列（header 54 + 可滚 options）
 *   导航不是写死的 DOM，是 sectionList() 这张表的投影 —— 加一屏只加一条记录。
 *   导航与内容各自滚动；面板高度取视口不取内容，切分区时不会跳。
 *
 * 八屏按我们自己的分类组织，不照搬参考产品的分组：
 *   账号            ① 账号与权限   身份 + 会话 + 权限点，一屏看完「我是谁、能做什么」
 *   运行            ② 模型供应商   供应商配置（名称/地址/Key/模型），切换与增删改都落本机
 *                   ③ 内置模块     本次页面真实加载了哪些 assets/*.js
 *                   ④ Agent 预设   本原型没有这一层，如实说明并给出去处
 *   界面            ⑤ 外观         字号基准 + 三条显示开关，都是真会改界面的
 *                   ⑥ 快捷键       只列代码里真监听的键位（metaKey || ctrlKey）
 *   数据            ⑦ 本机数据     aiops:* 键的条数与体积，能导出 JSON、能两步清空
 *                   ⑧ 关于本原型   版本/规模/时点/性质，全部运行时读
 *   dsh 的「充值余额 / 赠金余额」两行没搬：那两条要后台账务，本原型没有计费模块，
 *   摆两个假金额比不摆更糟。
 *
 * 铁律：ES5 · 不改既有渲染器，只往 ACTIONS 注册一个动作 + 往 body 挂 class。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var PREF_KEY = 'aiops:v40:prefs';
  var CSS_ID = 'v40-settings-css';
  var VERSION = 'v47 · 2026-10-24';
  /* 默认全开 —— 与"没装设置"时的原样一致，装了不该让界面先变一次 */
  var DEFAULTS = { railIcons: false, noMeta: false, noEnv: false, fs: 14, sub: 0 };

  /* ------------------------------------------------------------------ 偏好 */
  function load() {
    var p = { railIcons: DEFAULTS.railIcons, noMeta: DEFAULTS.noMeta, noEnv: DEFAULTS.noEnv, fs: DEFAULTS.fs, sub: DEFAULTS.sub };
    try {
      var raw = global.localStorage && global.localStorage.getItem(PREF_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && typeof o === 'object') {
        for (var k in p) {
          if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
          /* 字号是数字，别的开关是布尔 —— 一律 !! 会把 14 变成 true */
          p[k] = (k === 'fs') ? (parseInt(o[k], 10) || DEFAULTS.fs) : !!o[k];
        }
      }
    } catch (e) { /* 隐私模式 / 脏数据：用默认值，不抛 */ }
    return p;
  }
  function save(p) {
    try { global.localStorage && global.localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { }
  }
  function apply(p) {
    var b = global.document && global.document.body;
    if (!b) return;
    b.classList[p.railIcons ? 'add' : 'remove']('pf-rail-icons');
    b.classList[p.noMeta ? 'add' : 'remove']('pf-no-meta');
    b.classList[p.noEnv ? 'add' : 'remove']('pf-no-env');
    b.classList[p.sub ? 'add' : 'remove']('pf-sub-collapsed');
    /* 就地更新那颗按钮的无障碍状态：只切 body class 的话，要等下次重渲染才同步 */
    var sb = global.document.querySelector('.sm-collapse');
    if (sb) {
      var tip = p.sub ? '展开侧边栏' : '收起侧边栏';
      sb.setAttribute('title', tip);
      sb.setAttribute('aria-label', tip);
      sb.setAttribute('aria-expanded', p.sub ? 'false' : 'true');
    }
    /* 字号基准挂在 :root 的 --d-fs 上，全站阶梯都从它派生，所以改这一处就够 */
    var root = global.document && global.document.documentElement;
    if (root && root.style) root.style.setProperty('--d-fs', (p.fs || 14) + 'px');
  }

  /* --------------------------------------------------------------- 小工具 */
  function shell() { return global.APP_SHELL || {}; }
  function esc(s) {
    var S = shell();
    if (typeof S.esc === 'function') return S.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function icon(name, size) {
    var S = shell();
    return typeof S.icon === 'function' ? S.icon(name, size || 16) : '';
  }
  function me() {
    var S = global.DATA_SEED || {};
    return global.CURRENT_USER || S.ME || {};
  }
  function seedModels() { return (global.DATA_SEED || {}).MODELS || []; }
  function countArr(key) {
    try {
      var raw = global.localStorage && global.localStorage.getItem(key);
      if (!raw) return 0;
      var v = JSON.parse(raw);
      if (!v) return 0;
      if (v.length != null) return v.length;
      return typeof v === 'object' ? Object.keys(v).length : 0;
    } catch (e) { return 0; }
  }
  /* 会话库的键带版本号（aiops:v27:sessions:v#），按前缀把所有版本加起来 */
  function countByPrefix(prefix) {
    var n = 0;
    try {
      var ls = global.localStorage;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(prefix) === 0) n += countArr(k);
      }
    } catch (e) { }
    return n;
  }

  /* --------------------------------------------------------------- 面板样式 */
  function injectCss() {
    var d = global.document;
    if (!d || d.getElementById(CSS_ID)) return;
    var st = d.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      /* 左导航轨：188 宽、pad 22/12、标题 16/24、cell 40 高 r12；与内容列之间不画分隔线 */
      '.stp-nav{flex:0 0 188px;display:flex;flex-direction:column;padding:18px 12px 0;box-sizing:border-box}',
      '.stp-nav-t{padding:0 12px;font-size:16px;line-height:24px;font-weight:500;color:var(--text)}',
      '.stp-nav-l{display:flex;flex-direction:column;gap:6px;margin-top:6px;overflow-y:auto;padding-bottom:20px}',
      /* 搜索：34 高、左侧放大镜内嵌，与导航 cell 同宽 */
      '.stp-group{padding:16px 12px 2px;font-size:13px;line-height:18px;color:var(--faint)}',
      /* 账号卡：照参考图 —— 52 头像 + 名字 + 副行，右侧描边按钮；下面一条全宽按钮 */
      '.acc-card{display:flex;align-items:center;gap:14px;padding:16px;border:.5px solid var(--line);border-radius:20px;background:#fff}',
      '.acc-av{flex:0 0 52px;width:52px;height:52px;border-radius:50%;background:var(--blue-weak);color:var(--blue);' +
        'display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:500;text-transform:uppercase}',
      '.acc-id{flex:1;min-width:0;display:flex;flex-direction:column}',
      '.acc-nm{font-size:16px;font-weight:500;line-height:24px}',
      '.acc-sub{font-size:12px;line-height:18px;color:var(--sub)}',
      '.acc-wide{width:100%;justify-content:center;height:44px;font-size:14px;border-radius:12px}',
      /* 通用设置：外观三卡 + 字号数字框 */
      '.thm-cards{display:flex;gap:10px;margin-top:10px}',
      '.thm{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:76px;' +
        'border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--sub);font:inherit;font-size:13px;cursor:pointer}',
      '.thm:hover:not(.dis){background:var(--bg-subtle-1);color:var(--text)}',
      '.thm.on{border-color:var(--blue);background:var(--blue-weak);color:var(--blue)}',
      '.thm.dis{opacity:.45;cursor:not-allowed}',
      '.thm:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
      '.stp-hint{margin-top:8px;font-size:12px;line-height:18px;color:var(--faint)}',
      '.stp-numwrap{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}',
      '.stp-num{width:64px;height:32px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;' +
        'background:var(--bg-subtle-1);text-align:center;font:inherit;font-size:13px;color:var(--text);outline:none}',
      '.stp-num:focus{border-color:var(--blue);background:#fff}',
      '.stp-unit{font-size:12px;color:var(--sub)}',
      /* 快捷键：右侧键帽串 */
      '.keys{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto}',
      '.keys .kbd{font-size:11px}',
      /* 安全中心：权限分组小药丸 */
      '.stp-chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 2px}',
      '.chip-s{font-size:11px;line-height:16px;color:var(--sub);border:1px solid var(--line);border-radius:999px;padding:2px 8px}',
      '.stp-nav-c{display:flex;align-items:center;gap:8px;width:100%;height:40px;padding:9px 16px 9px 12px;box-sizing:border-box;' +
        'border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--text);font:inherit;font-size:14px;' +
        'line-height:22px;text-align:left;cursor:pointer}',
      '.stp-nav-c:hover{background:var(--bg-subtle-2)}',
      '.stp-nav-c.on{background:var(--bg-subtle-3)}',
      '.stp-nav-c:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
      '.stp-nav-c svg{flex:0 0 16px;width:16px;height:16px;color:var(--sub)}',
      '.stp-nav-c.on svg{color:var(--text)}',
      '.stp-nav-c b{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:400}',
      '.stp-nav-c.on b{font-weight:500}',
      /* 右内容列：header 54 固定，options 内滚 */
      '.stp-main{flex:1;min-width:0;display:flex;flex-direction:column}',
      '.stp-hd{flex:0 0 46px;display:flex;align-items:center;justify-content:flex-end;padding:6px 14px 0}',
      /* header 里的操作靠右排：一条版本号 + 关闭键，与 dsh 的「打开配置文件 + ×」同一位置 */
      '.stp-hd-a{display:flex;align-items:center;gap:8px;margin-right:2px}',
      '.stp-hd span{font-size:12px;line-height:20px;color:var(--faint)}',
      '.stp-x{flex:0 0 auto;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;' +
        'color:var(--sub);font-size:18px;line-height:1;cursor:pointer}',
      '.stp-x:hover{background:var(--bg-subtle-2);color:var(--text)}',
      '.stp-x:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
      '.stp-body{flex:1;min-height:0;overflow-y:auto;padding:0 24px 24px}',
      '.stp-sec{display:flex;flex-direction:column;gap:16px;padding:8px 0;font-size:13px;line-height:22px;color:var(--text)}',
      /* 卡片：与面板同色，只靠 0.5px 描边分层；圆角 20、内距 12/16 */
      '.stp-card{padding:12px 16px;border:.5px solid var(--line);border-radius:var(--dsw-radius-xl,20px);background:#fff}',
      '.stp-id{display:flex;align-items:center;gap:10px;min-height:44px}',
      '.stp-av{flex:0 0 32px;width:32px;height:32px;border-radius:50%;background:var(--blue-weak);color:var(--blue);' +
        'display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;text-transform:uppercase}',
      '.stp-idc{display:flex;flex-direction:column;min-width:0}',
      '.stp-nm{font-size:14px;font-weight:500;line-height:22px}',
      '.stp-tag{font-size:12px;line-height:18px;color:var(--sub);font-weight:400}',
      '.stp-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:40px;padding:6px 0;box-sizing:border-box}',
      '.stp-div{border-top:.5px solid var(--line-soft)}',
      '.stp-v{color:var(--text);font-weight:500;text-align:right}',
      '.stp-v.s{font-weight:400;color:var(--sub)}',
      '.stp-mono{font-family:"SF Mono",Consolas,monospace;font-size:12px}',
      /* 通用设置的行：16px 上下内距 + 0.5px 分隔，末行去线；标题 14/20、说明 12/18 */
      '.stp-set{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--line-soft);cursor:default}',
      '.stp-set:last-child{border-bottom:0}',
      '.stp-set.sw{cursor:pointer}',
      '.stp-stt{font-size:14px;line-height:20px}',
      '.stp-sd{display:block;margin-top:4px;font-size:12px;line-height:18px;color:var(--sub)}',
      '.stp-note{font-size:12px;line-height:18px;color:var(--faint)}',
      '.stp-btn{height:36px;padding:0 14px;border:.5px solid #DCDCDC;border-radius:var(--dsw-radius-md,12px);background:#fff;' +
        'color:var(--text);font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}',
      '.stp-btn:hover{background:var(--bg-subtle-1)}',
      '.stp-btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
      '.stp-btn.pri{background:var(--blue);border-color:transparent;color:#fff;font-weight:500}',
      '.stp-btn.pri:hover{background:var(--blue-deep)}',
      '.stp-btn.dg{color:var(--red);border-color:#f0c9c9}',
      '.stp-btn:disabled{opacity:.45;cursor:not-allowed}',
      /* 模型配置：照 CC Switch 的供应商卡片 —— 图标 / 名称+分类 / 域名 / 右侧默认模型+三个图标动作 */
      '.mc-dot{flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:var(--green)}',
      '.mc-b{flex:1;min-width:0;display:flex;flex-direction:column}',
      '.mc-nm{font-size:14px;font-weight:500;line-height:22px;display:flex;align-items:center;gap:6px;min-width:0}',
      '.mc-hd{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.mc-hd b{font-size:13px;font-weight:500}',
      '.mc-mode{display:flex;align-items:center;gap:7px;font-size:12px;line-height:18px;color:var(--sub)}',
      '.mc-mode .mc-dot{background:var(--blue)}',
      '.mc-list{display:flex;flex-direction:column;gap:8px}',
      '.mc-item{display:flex;align-items:center;gap:12px;min-height:64px;padding:10px 12px 10px 14px;' +
        'border:.5px solid var(--line);border-radius:12px;background:#fff}',
      '.mc-item:hover{border-color:var(--line)}',
      '.mc-item.on{border-color:var(--blue-line);background:var(--blue-weak)}',
      '.mc-ico{flex:0 0 36px;width:36px;height:36px;border-radius:10px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:500}',
      '.mc-cat{font-size:11px;font-weight:400;color:var(--sub);border:1px solid var(--line);border-radius:999px;padding:0 6px;line-height:16px}',
      '.mc-flag{font-size:11px;font-weight:400;color:var(--amber)}',
      '.mc-host{font-size:12px;line-height:18px;color:var(--sub);font-family:"SF Mono",Consolas,monospace;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mc-side{flex:0 0 auto;display:flex;align-items:center;gap:4px}',
      '.mc-def{font-size:12px;color:var(--sub);font-family:"SF Mono",Consolas,monospace;margin-right:6px}',
      '.mc-ic{width:28px;height:28px;border:0;border-radius:8px;background:none;color:var(--sub);' +
        'display:inline-flex;align-items:center;justify-content:center;cursor:pointer}',
      '.mc-ic:hover{background:rgba(15,23,42,.06);color:var(--text)}',
      '.mc-ic:focus-visible{outline:2px solid var(--blue);outline-offset:1px}',
      '.mc-use{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--blue);padding:0 6px 0 2px}',
      '.mc-use .mc-dot{background:var(--blue)}',
      '.mc-lnk{border:0;background:none;font:inherit;font-size:12px;color:var(--sub);cursor:pointer;padding:3px 5px;border-radius:6px}',
      '.mc-lnk:hover{color:var(--text);background:var(--bg-subtle-2)}',
      '.mc-ok{font-size:12px;line-height:18px;color:var(--green)}',
      '.mc-warn{font-size:12px;line-height:18px;color:var(--amber)}',
      '.mc-fhd{display:flex;align-items:center;gap:12px;padding:0 2px}',
      '.mc-fhd b{font-size:14px;font-weight:500}',
      '.mc-fhd .mc-lnk{font-size:13px}',
      '.mc-tip{font-size:12px;line-height:18px;color:var(--blue);background:var(--blue-weak);border-radius:8px;padding:6px 10px}',
      '.mc-form{display:flex;flex-direction:column;padding:4px 16px 12px;border:.5px solid var(--line);border-radius:20px;background:#fff}',
      '.mc-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}',
      '.mc-field{display:flex;flex-direction:column;gap:6px;padding:10px 0;min-width:0}',
      '.mc-lbl{font-size:12px;line-height:18px;color:var(--sub)}',
      '.mc-lbl em{font-style:normal;color:var(--red);margin-left:2px}',
      '.mc-hint{font-size:11px;line-height:16px;color:var(--faint)}',
      '.mc-sep{border-top:.5px solid var(--line-soft);margin:2px 0}',
      '.mc-nmrow{display:flex;align-items:center;gap:8px;min-width:0}',
      '.mc-ico-sm{flex:0 0 30px;width:30px;height:30px;border-radius:8px;font-size:12px}',
      '.mc-kw{position:relative;display:block}',
      '.mc-kw .mc-inp{padding-right:34px}',
      '.mc-eye{position:absolute;right:4px;top:4px;width:26px;height:26px;border:0;border-radius:6px;background:none;' +
        'color:var(--sub);cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '.mc-eye:hover{background:var(--bg-subtle-2);color:var(--text)}',
      '.mc-adv{display:flex;align-items:center;gap:6px;align-self:flex-start;border:0;background:none;font:inherit;' +
        'font-size:12px;color:var(--sub);cursor:pointer;padding:12px 0 0}',
      '.mc-adv:hover{color:var(--text)}',
      '.mc-caret{font-size:10px;line-height:1}',
      '.mc-advbody{display:none}',
      '.mc-advbody.open{display:block}',
      /* 测速 / 获取列表：输入框右侧一个小按钮，结果单独一行，按状态着色 */
      '.mc-inrow{display:flex;align-items:center;gap:8px}',
      '.mc-mini{flex:0 0 auto;height:34px;padding:0 10px;border:.5px solid #DCDCDC;border-radius:8px;background:#fff;' +
        'font:inherit;font-size:12px;color:var(--text);cursor:pointer;white-space:nowrap}',
      '.mc-mini:hover{background:var(--bg-subtle-1)}',
      '.mc-mini:disabled{opacity:.55;cursor:default}',
      '.mc-test{font-size:11px;line-height:16px;color:var(--faint)}',
      '.mc-test:empty{display:none}',
      '.mc-test[data-tone="ok"]{color:var(--green)}',
      '.mc-test[data-tone="warn"]{color:var(--amber)}',
      '.mc-test[data-tone="bad"]{color:var(--red)}',
      '.mc-test[data-tone="wait"]{color:var(--sub)}',
      '.mc-picker{display:none;margin-top:8px;border:.5px solid var(--line);border-radius:12px;background:var(--bg-subtle-1)}',
      '.mc-picker.open{display:block}',
      '.mc-pick-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:.5px solid var(--line-soft)}',
      '.mc-pick-h b{font-size:12px;font-weight:500}',
      '.mc-pick-l{max-height:188px;overflow-y:auto;padding:4px 6px}',
      '.mc-pick-i{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;font-size:12px;cursor:pointer}',
      '.mc-pick-i:hover{background:var(--bg-subtle-2)}',
      '.mc-pick-i input{width:13px;height:13px}',
      '.mc-pick-i span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:"SF Mono",Consolas,monospace}',
      '.mc-pick-f{display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:.5px solid var(--line-soft)}',
      '.mc-pick-c{margin-right:auto;font-size:11px;color:var(--sub)}',
      '.mc-inp{width:100%;flex:1;min-width:0;height:34px;border:1px solid var(--line);border-radius:8px;background:var(--bg-subtle-1);' +
        'padding:0 10px;font:inherit;font-size:13px;color:var(--text);outline:none}',
      '.mc-inp:focus{border-color:var(--blue);background:#fff}',
      '.mc-err{font-size:12px;line-height:18px;color:var(--red);padding-top:8px}',
      '.mc-err:empty{display:none}',
      '.mc-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:12px}',
      /* 开关：自己画，不用原生 checkbox —— 全站 input[type=checkbox] 已被描成"方框 + 蓝勾" */
      '.stp-sw{flex:0 0 auto;width:38px;height:21px;margin-top:2px;padding:0;border:0;border-radius:999px;' +
        'background:#d8dbe0;position:relative;cursor:pointer;transition:background .16s}',
      '.stp-sw::after{content:"";position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;' +
        'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.18);transition:left .16s}',
      '.stp-sw[aria-checked="true"]{background:var(--blue)}',
      '.stp-sw[aria-checked="true"]::after{left:19px}',
      '.stp-sw:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
      '.stp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:380px;text-align:center}',
      '.stp-empty b{font-size:14px;font-weight:500;color:var(--text)}',
      '.stp-empty p{font-size:13px;line-height:22px;color:var(--sub);max-width:420px}'
    ].join('\n');
    d.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ 分区 */
  function row(label, valueHtml, divider) {
    return (divider ? '<div class="stp-div"></div>' : '') +
      '<div class="stp-row"><span>' + esc(label) + '</span>' +
      '<span class="stp-v">' + valueHtml + '</span></div>';
  }
  function setRow(key, title, desc, on) {
    return '<div class="stp-set sw" data-st-row="' + key + '">' +
      '<span><span class="stp-stt">' + esc(title) + '</span>' +
      '<span class="stp-sd" style="display:block">' + esc(desc) + '</span></span>' +
      '<button type="button" class="stp-sw" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
      ' data-pref="' + key + '" aria-label="' + esc(title) + '"></button>' +
      '</div>';
  }
  function plainRow(label, valueHtml) {
    return '<div class="stp-set"><span class="stp-stt">' + esc(label) + '</span>' +
      '<span class="stp-v s">' + valueHtml + '</span></div>';
  }

  function permsCard() {
    var m = me(), S = global.DATA_SEED || {};
    var pts = S.PERM_POINTS || [], mine = m.perms || [];
    var grp = {}, high = [], i, g, chips = '';
    for (i = 0; i < pts.length; i++) {
      if (mine.indexOf(pts[i].p) < 0) continue;
      grp[pts[i].grp] = (grp[pts[i].grp] || 0) + 1;
      if (pts[i].risk === 'high') high.push(pts[i].label);
    }
    for (g in grp) if (Object.prototype.hasOwnProperty.call(grp, g)) {
      chips += '<span class="chip-s">' + esc(g) + ' · ' + grp[g] + '</span>';
    }
    return '<div class="stp-card">' +
        '<div class="stp-row"><span>权限点</span><span class="stp-v">' + mine.length + ' / ' + pts.length + '</span></div>' +
        '<div class="stp-chips">' + chips + '</div>' +
        '<div class="stp-div"></div>' +
        '<div class="stp-row"><span>高风险权限</span><span class="stp-v">' + high.length + ' 项</span></div>' +
        '<div class="stp-note" style="padding-top:6px">' + esc(high.slice(0, 6).join('、')) +
        (high.length > 6 ? ' 等' : '') + '</div>' +
      '</div>';
  }

  /* ① 账号与权限：身份 + 会话 + 权限点，一屏看完「我是谁、能做什么」 */
  function secAccount() {
    var m = me();
    var tenants = (global.DATA_SEED || {}).TENANTS || [];
    var tn = m.tenant || '—';
    for (var i = 0; i < tenants.length; i++) if (tenants[i].id === m.tenant) tn = tenants[i].name;
    var sess = countByPrefix('aiops:v27:sessions:');
    var audit = countArr('aiops:v10:audit');
    var tabs = countArr('aiops:v10:tabs');
    var ses = m.session || {}, left = (ses.ttlMin || 0) - (ses.issuedMin || 0);
    return '<div class="stp-sec">' +
        /* 身份卡照参考图：52 头像、16 号名字、副行角色，右侧一个描边入口 */
        '<div class="acc-card">' +
          '<span class="acc-av">' + esc(m.initials || 'x') + '</span>' +
          '<span class="acc-id"><span class="acc-nm">' + esc(m.name || '—') + '</span>' +
            '<span class="acc-sub">' + esc((m.role || '—') + ' · ' + (m.dept || '—')) + '</span></span>' +
          '<button type="button" class="stp-btn" data-st-go="#/platform/assets">能力与权限 ↗</button>' +
        '</div>' +
        '<div class="stp-card">' +
          row('账号 ID', '<span class="stp-mono">' + esc(m.id || '—') + '</span>') +
          row('登录标识', '<span class="stp-mono">' + esc(m.mail || '—') + '</span>', true) +
          row('租户', esc(tn), true) +
          row('会话', esc('已登录 ' + (ses.issuedMin || 0) + ' 分钟 · 剩余 ' + left + ' 分钟'), true) +
        '</div>' +
        permsCard() +
        '<div class="stp-note">权限点由角色矩阵推导、不是手工勾选；完整清单与说明在顶栏账号菜单 › 我的权限。这一屏只读。</div>' +
      '</div>';
  }

  /* ② 外观：真正会改变界面的那几项 */
  function secAppearance() {
    var p = load();
    return '<div class="stp-sec">' +
        '<div class="stp-set"><span><span class="stp-stt">字号大小</span>' +
          '<span class="stp-sd">改的是 --d-fs 这个基准：正文、表格、次级说明都从它派生，标题按比例跟随</span></span>' +
          '<span class="stp-numwrap"><input class="stp-num" data-fs-set="1" type="number" min="12" max="18" step="1" value="' + p.fs + '">' +
          '<span class="stp-unit">px</span></span></div>' +
        setRow('railIcons', '一级导航只留图标', '关掉文字标签，导航从 64px 收到 56px，把宽度还给内容区', p.railIcons) +
        setRow('noMeta', '显示「数据口径与说明」', '关掉后各页底部那块收起来 —— 讲演示时页面更干净，评审要追问口径再打开', !p.noMeta) +
        setRow('noEnv', '显示顶栏数据时点与环境标记', '关掉后「数据截至 …」和「演示环境」两个标记不显示', !p.noEnv) +
      '</div>' +
      '<div class="stp-note">三个开关各挂一条 body class，拨了立即重排，不刷新；偏好记在本机浏览器。</div>';
  }

  /* ③ 关于本原型：全是运行时读出来的，不写死 */
  function secAbout() {
    var A = global.APP_DATA || {}, S = global.DATA_SEED || {};
    var clock = global.document && global.document.getElementById('clock');
    var snap = clock ? String(clock.textContent || '').replace(/^\s*|\s*$/g, '') : '';
    return '<div class="stp-sec">' +
        '<div class="stp-card">' +
          row('原型版本', esc(VERSION)) +
          row('内容规模', esc((A.caps || []).length + ' 项能力 · ' + (S.AGENTS || []).length + ' 个 Agent'), true) +
          row('数据时点', esc(snap || '—'), true) +
          row('数据性质', '演示数据，写操作只在本机浏览器生效', true) +
          row('运行形态', '单个 HTML + 顺序加载的 40 个脚本，无构建、无后端', true) +
        '</div>' +
        '<div class="stp-note">这一页的数字全部运行时读：能力数来自 APP_DATA，Agent 数来自种子，时点直接读顶栏那颗时钟 —— 三处只有一个真源。</div>' +
      '</div>';
  }

  /* ③ 模型：供应商配置（照 CC Switch 的做法）
     CC Switch 的模型配置不是一个"列表"，是**供应商（provider）**的集合：
     每个供应商 = 名称 + Base URL + API Key + 模型 + 接口格式 + 分类，
     一次只用其中一个（使用中），切换就是把当前指针挪过去；正在用的删不掉。
     这里照这套做，字段与规则都对齐，数据落 localStorage，不联网。
     没搬的两样：端点测速与健康点（要真网络）、日/月限额与计价倍率（要真用量）——
     本原型没有这些数据，画个绿点说"健康"是编的。 */
  var modelState = { view: 'list', editId: null, notice: '' };
  var PROV_KEY = 'aiops:v42:providers';
  var CAT_TEXT = { official: '官方', cn_official: '国内官方', custom: '自定义', relay: '中转' };
  /* 预设端点：照 CC Switch「预设供应商」的做法，选中即填端点与模型，只剩 Key 要填 */
  var PROV_PRESETS = [
    { id: '', name: '自定义', url: '', models: '', format: 'openai' },
    { id: 'bailian', name: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: 'qwen-max, qwen-plus, qwen-turbo, text-embed-v3', format: 'openai' },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', models: 'deepseek-chat, deepseek-reasoner', format: 'openai' },
    { id: 'sf', name: '硅基流动', url: 'https://api.siliconflow.cn/v1', models: 'Qwen/Qwen2.5-72B-Instruct', format: 'openai' }
  ];

  function seedProviders() {
    return {
      current: 'bailian',
      list: [
        {
          id: 'bailian', name: '阿里云百炼', cat: 'cn_official', preset: 'bailian',
          site: 'https://bailian.console.aliyun.com', notes: '主用，走兼容模式',
          url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          key: 'sk-8f2c1d7a9e4b6c0d', models: 'qwen-max, qwen-plus, qwen-turbo, text-embed-v3',
          def: 'qwen-plus', fast: 'qwen-turbo', format: 'openai', authField: 'token', ua: ''
        },
        {
          id: 'internal', name: '内部 LLM 网关', cat: 'custom', preset: '',
          site: '', notes: '备用，出网受限时切过来',
          url: 'http://llm-gw.internal:8080/v1',
          key: 'sk-internal-demo-0001', models: 'qwen-max, qwen-plus',
          def: 'qwen-plus', fast: '', format: 'openai', authField: 'token', ua: ''
        }
      ]
    };
  }
  function provLoad() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(PROV_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && o.list && o.list.length) return o;
    } catch (e) { }
    return seedProviders();
  }
  function provSave(o) {
    try { global.localStorage && global.localStorage.setItem(PROV_KEY, JSON.stringify(o)); } catch (e) { }
  }
  function modelArr(p) {
    return String(p.models || '').split(/[,，\s]+/).filter(function (x) { return !!x; });
  }
  function maskKey(k) {
    var s = String(k || '');
    if (s.length <= 10) return s ? '••••' : '—';
    return s.slice(0, 5) + '••••' + s.slice(-4);
  }
  /* 这个供应商缺了哪些 Agent 正在用的模型 —— 切换的影响面，用真实 Agent 清单算 */
  function missingFor(p) {
    var agents = (global.DATA_SEED || {}).AGENTS || [];
    var have = modelArr(p), out = [];
    for (var i = 0; i < agents.length; i++) {
      if (have.indexOf(agents[i].model) < 0) out.push(agents[i]);
    }
    return out;
  }
  function catTag(p) {
    return '<span class="mc-cat">' + esc(CAT_TEXT[p.cat] || '自定义') + '</span>';
  }
  /* 卡片第二行显示域名而不是整条 Base URL —— 与 CC Switch 一致：一眼认出是谁，路径留给编辑页 */
  function hostOf(url) {
    return String(url || '').replace(/^https?:\/\//i, '').split('/')[0] || '—';
  }
  var BRAND = { bailian: '#FF6A00', deepseek: '#4D6BFE', sf: '#7C3AED' };
  function brandColor(p) { return BRAND[p.preset] || '#6B7280'; }
  /* 三个图标动作：切换 / 编辑 / 删除。图形只用直线与折线，21px 下不会糊 */
  function gicon(kind) {
    var head = ' viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"' +
      ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
    if (kind === 'play') return '<svg' + head + '><path d="M9 7.2l7.6 4.8L9 16.8z"/></svg>';
    if (kind === 'edit') return '<svg' + head + '><path d="M4.5 19.5h4L19 8.8l-3.8-3.8L4.5 15.5z"/></svg>';
    if (kind === 'sun') return '<svg' + head + '><circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"/></svg>';
    if (kind === 'moon') return '<svg' + head + '><path d="M20 13.4A8.1 8.1 0 0 1 10.6 4a8.2 8.2 0 1 0 9.4 9.4z"/></svg>';
    if (kind === 'monitor') return '<svg' + head + '><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/></svg>';
    if (kind === 'eye') return '<svg' + head + '><path d="M2.6 12S6.1 6.4 12 6.4 21.4 12 21.4 12 17.9 17.6 12 17.6 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
    return '<svg' + head + '><path d="M5 7h14M9.6 7V4.6h4.8V7M7.2 7l.9 12.4h7.8L16.8 7"/></svg>';
  }
  function provCard(p, cur) {
    var on = p.id === cur;
    var miss = missingFor(p);
    return '<div class="mc-item' + (on ? ' on' : '') + '">' +
        '<span class="mc-ico" style="background:' + brandColor(p) + '">' +
          esc(String(p.name || '?').slice(0, 1)) + '</span>' +
        '<span class="mc-b">' +
          '<span class="mc-nm">' + esc(p.name) + catTag(p) +
            (miss.length ? '<span class="mc-flag">缺 ' + miss.length + ' 个模型</span>' : '') + '</span>' +
          '<span class="mc-host">' + esc(hostOf(p.site || p.url)) + '</span>' +
        '</span>' +
        '<span class="mc-side">' +
          '<span class="mc-def">' + esc(p.def || '—') + '</span>' +
          (on
            ? '<span class="mc-use"><span class="mc-dot"></span>使用中</span>'
            : '<button type="button" class="mc-ic" data-mc="use" data-mc-id="' + esc(p.id) + '" title="切换到这个供应商" aria-label="切换">' + gicon('play') + '</button>') +
          '<button type="button" class="mc-ic" data-mc="edit" data-mc-id="' + esc(p.id) + '" title="编辑" aria-label="编辑">' + gicon('edit') + '</button>' +
          (on ? '' : '<button type="button" class="mc-ic" data-mc="del" data-mc-id="' + esc(p.id) + '" title="删除" aria-label="删除">' + gicon('del') + '</button>') +
        '</span>' +
      '</div>';
  }
  /* 表单字段：标签在上、控件在下，同一排两列 —— 与 CC Switch 的编辑面板一致 */
  function fld(label, required, inner, hint, after) {
    return '<div class="mc-field"><span class="mc-lbl">' + esc(label) +
      (required ? '<em>*</em>' : '') + '</span>' + inner +
      (hint ? '<span class="mc-hint">' + esc(hint) + '</span>' : '') + (after || '') + '</div>';
  }
  function inp(k, val, ph, type) {
    return '<input class="mc-inp" data-mc-f="' + k + '" type="' + (type || 'text') +
      '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '">';
  }
  /* ---------------------------------------------- 端点测速 / 拉模型列表
     两个动作都真发请求，不造假：
       · 测速  = GET {base}/models，量 TTFB；跨域被拒时退回 no-cors 再量一次，
                 那一档只能证明"能连上"，看不到状态码，就如实这么说；
       · 获取模型列表 = 同一个端点，读 data[].id。
     页面若是 file:// 打开，Origin 为 null，绝大多数供应商会拒跨域 —— 那就照实报错，
     并提示用本地 http 打开。宁可显示失败，也不摆一个假的绿点。 */
  function modelsUrl(base) {
    return String(base || '').replace(/\/+$/, '') + '/models';
  }
  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : new Date().getTime();
  }
  function authHeaders(key, authMode) {
    var h = {};
    if (!key) return h;
    if (authMode === 'xkey') h['x-api-key'] = key;
    else h['Authorization'] = 'Bearer ' + key;
    return h;
  }
  /* 返回 { kind: 'ok'|'http'|'opaque'|'timeout'|'blocked', status, ms, res } */
  function probe(url, key, authMode, timeoutMs) {
    var t0 = nowMs(), ctrl = null, timer = null;
    var opts = { method: 'GET', cache: 'no-store', headers: authHeaders(key, authMode) };
    try { ctrl = new global.AbortController(); opts.signal = ctrl.signal; } catch (e) { }
    var done = function (v) { if (timer) { global.clearTimeout(timer); timer = null; } return v; };
    var timed = new Promise(function (resolve) {
      timer = global.setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (e) { }
        resolve({ kind: 'timeout', ms: Math.round(nowMs() - t0) });
      }, timeoutMs || 8000);
    });
    var req = global.fetch(url, opts).then(function (res) {
      return { kind: res.ok ? 'ok' : 'http', status: res.status, ms: Math.round(nowMs() - t0), res: res };
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return { kind: 'timeout', ms: Math.round(nowMs() - t0) };
      return { kind: 'blocked', ms: Math.round(nowMs() - t0), err: err };
    });
    return Promise.race([req, timed]).then(function (r) {
      done(r);
      if (r.kind !== 'blocked') return r;
      /* 被跨域挡住时再用不读响应的方式量一次：只能证明网络通不通 */
      var t1 = nowMs();
      return global.fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(function () {
        return { kind: 'opaque', ms: Math.round(nowMs() - t1) };
      }).catch(function () {
        return { kind: 'blocked', ms: Math.round(nowMs() - t1) };
      });
    });
  }
  function probeText(r) {
    if (!r) return '';
    if (r.kind === 'ok') return 'HTTP ' + r.status + ' · ' + r.ms + ' ms';
    if (r.kind === 'http') {
      var why = r.status === 401 || r.status === 403 ? 'Key 无效或无权限'
        : r.status === 404 ? '端点路径不对' : 'HTTP ' + r.status;
      return why + ' · ' + r.ms + ' ms';
    }
    if (r.kind === 'timeout') return '超时（8 秒没有响应）';
    if (r.kind === 'opaque') return '可连通 · ' + r.ms + ' ms（跨域挡住响应，看不到状态码）';
    return '连不上：域名解析失败、端口不通，或被浏览器跨域策略拒绝';
  }
  function isProbeOk(r) { return !!r && (r.kind === 'ok' || r.kind === 'opaque'); }
  /* 一行结果文字：tone = ok | warn | bad | wait */
  function setNote(el, text, tone) {
    if (!el) return;
    el.textContent = text || '';
    el.setAttribute('data-tone', tone || '');
  }
  function updPickCount(bodyEl) {
    var boxes = bodyEl.querySelectorAll('[data-mc-m]');
    var n = 0, i;
    for (i = 0; i < boxes.length; i++) if (boxes[i].checked) n++;
    var c = bodyEl.querySelector('[data-mc-pick-c]');
    if (c) c.textContent = '已选 ' + n + ' / 共 ' + boxes.length;
  }
  function pickerHtml(ids, chosen) {
    var h = '', i;
    for (i = 0; i < ids.length; i++) {
      h += '<label class="mc-pick-i"><input type="checkbox" data-mc-m="' + esc(ids[i]) + '"' +
        (chosen.indexOf(ids[i]) >= 0 ? ' checked' : '') + '><span>' + esc(ids[i]) + '</span></label>';
    }
    return '<div class="mc-pick-h"><b>选择模型 · ' + ids.length + ' 个</b>' +
        '<span><button type="button" class="mc-lnk" data-mc-pick-all="1">全选</button>' +
        '<button type="button" class="mc-lnk" data-mc-pick-none="1">全不选</button></span></div>' +
      '<div class="mc-pick-l">' + h + '</div>' +
      '<div class="mc-pick-f"><span class="mc-pick-c" data-mc-pick-c="1">已选 ' + chosen.length + '</span>' +
        '<button type="button" class="mc-btn" data-mc-pick-cancel="1">取消</button>' +
        '<button type="button" class="stp-btn pri" data-mc-pick-apply="1">应用</button></div>';
  }

  function provForm(editing) {
    var p = editing || {};
    var isCur = !!editing && editing.id === provLoad().current;
    var opts = '', i;
    for (i = 0; i < PROV_PRESETS.length; i++) {
      opts += '<option value="' + PROV_PRESETS[i].id + '"' +
        ((p.preset || '') === PROV_PRESETS[i].id ? ' selected' : '') + '>' + esc(PROV_PRESETS[i].name) + '</option>';
    }
    var nameRow = '<span class="mc-nmrow"><span class="mc-ico mc-ico-sm" style="background:' + brandColor(p) + '">' +
      esc(String(p.name || '供').slice(0, 1)) + '</span>' + inp('name', p.name, '例如 阿里云百炼') + '</span>';
    return '<div class="stp-sec">' +
        '<div class="mc-fhd"><button type="button" class="mc-lnk" data-mc="cancel">← 返回供应商列表</button>' +
          '<b>' + (editing ? '编辑 ' + esc(editing.name) : '添加供应商') + '</b></div>' +
        (isCur ? '<div class="mc-tip">这是正在使用的供应商，保存后立即生效。</div>' : '') +
        '<div class="mc-form">' +
          (!editing ? fld('预设', false, '<select class="mc-inp" data-mc-f="preset">' + opts + '</select>',
            '选预设只替你填地址与模型，Key 仍然要自己贴') : '') +
          '<div class="mc-grid">' +
            fld('供应商名称', true, nameRow) +
            fld('备注', false, inp('notes', p.notes, '例如 公司专用账号')) +
          '</div>' +
          fld('官网地址', false, inp('site', p.site, 'https://example.com（可选）')) +
          '<div class="mc-sep"></div>' +
          fld('请求地址', true,
            '<span class="mc-inrow">' + inp('url', p.url, 'https://your-api-endpoint.com/v1') +
            '<button type="button" class="mc-mini" data-mc-test="1">测速</button></span>',
            '末尾不要带斜杠', '<span class="mc-test" data-mc-testout="1"></span>') +
          fld('API Key', true,
            '<span class="mc-kw"><input class="mc-inp" data-mc-f="key" type="password" value="' + esc(p.key || '') +
            '" placeholder="sk-…"><button type="button" class="mc-eye" data-mc-eye="1" aria-label="显示 Key" title="显示 Key">' +
            gicon('eye') + '</button></span>', '只存在本机浏览器里') +
          fld('上游格式', false, '<select class="mc-inp" data-mc-f="format">' +
            '<option value="openai"' + ((p.format || 'openai') === 'openai' ? ' selected' : '') + '>OpenAI 兼容</option>' +
            '<option value="anthropic"' + (p.format === 'anthropic' ? ' selected' : '') + '>Anthropic Messages</option></select>') +
          '<div class="mc-sep"></div>' +
          fld('模型列表', true,
            '<span class="mc-inrow">' + inp('models', p.models, '逗号分隔，例如 qwen-max, qwen-plus') +
            '<button type="button" class="mc-mini" data-mc-fetch="1">获取列表</button></span>',
            null, '<span class="mc-test" data-mc-fetchout="1"></span>' +
            '<div class="mc-picker" data-mc-picker="1"></div>') +
          '<div class="mc-grid">' +
            fld('主模型', false, inp('def', p.def, '例如 qwen-plus'), '新建会话默认用它') +
            fld('快速模型', false, inp('fast', p.fast, '例如 qwen-turbo'), '轻任务用它，可留空') +
          '</div>' +
          '<button type="button" class="mc-adv" data-mc-adv="1">高级选项<span class="mc-caret">▾</span></button>' +
          '<div class="mc-advbody" data-mc-advbody="1">' +
            '<div class="mc-grid">' +
              fld('认证字段', false, '<select class="mc-inp" data-mc-f="authField">' +
                '<option value="token"' + ((p.authField || 'token') === 'token' ? ' selected' : '') + '>Authorization: Bearer</option>' +
                '<option value="xkey"' + (p.authField === 'xkey' ? ' selected' : '') + '>x-api-key</option></select>') +
              fld('User-Agent', false, inp('ua', p.ua, '可选，替换转发时的 UA')) +
            '</div>' +
          '</div>' +
          '<div class="mc-err" data-mc-err="1"></div>' +
          '<div class="mc-foot">' +
            '<button type="button" class="stp-btn pri" data-mc="save">' + (editing ? '保存' : '添加') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="stp-note">照 CC Switch 的编辑面板：名称与备注同排、地址与 Key 必填、模型分主/快两档，其余收进高级选项。' +
          '「测速」与「获取列表」都会真发一次 GET {请求地址}/models，Key 随请求头发出去；' +
          '被供应商的跨域策略挡住时只能报出连得上/连不上，读不到状态码与模型。</div>' +
      '</div>';
  }
  function secModels() {
    var store = provLoad();
    if (modelState.view === 'form') {
      var editing = null;
      if (modelState.editId) {
        for (var k = 0; k < store.list.length; k++) if (store.list[k].id === modelState.editId) editing = store.list[k];
      }
      return provForm(editing);
    }
    var cur = null, cards = '', i;
    for (i = 0; i < store.list.length; i++) {
      if (store.list[i].id === store.current) cur = store.list[i];
      cards += provCard(store.list[i], store.current);
    }
    var models = seedModels(), pr = '';
    for (i = 0; i < models.length; i++) {
      var m = models[i];
      pr += row(
        m.name + ' · ' + m.tierText,
        '¥' + m.inPer1k + ' / ¥' + m.outPer1k + ' <span class="stp-tag">每千 tok（入/出）</span>',
        i > 0
      );
    }
    var warn = '';
    if (cur) {
      var miss = missingFor(cur);
      if (miss.length) {
        var names = [];
        for (i = 0; i < miss.length && i < 3; i++) names.push(miss[i].name);
        warn = '<div class="mc-warn">该供应商没配 ' + esc(miss.map(function (a) { return a.model; }).filter(function (v, j, s) { return s.indexOf(v) === j; }).join('、')) +
          '，' + miss.length + ' 个 Agent 会回落到默认模型：' + esc(names.join('、')) + (miss.length > 3 ? ' 等' : '') + '。</div>';
      }
    }
    return '<div class="stp-sec">' +
        /* 页头：左边计数、右边主操作 —— CC Switch 的「+ 添加供应商」就在这个位置 */
        '<div class="mc-hd"><b>模型供应商 · ' + store.list.length + '</b>' +
          '<button type="button" class="stp-btn pri" data-mc="add">+ 添加供应商</button></div>' +
        /* 直连状态行：对应 CC Switch 那排「直连 / 路由 / 聚合 + 生效中」。
           这里只有直连 —— 本原型没有本地代理，画两个点不动的页签等于骗人。 */
        '<div class="mc-mode"><span class="mc-dot"></span>直连生效中' +
          (cur ? '· 请求直接发往 ' + esc(cur.name) + '（' + esc(cur.def || '—') + '），不经本地代理'
               : '· 还没有可用的供应商') + '</div>' +
        warn +
        (modelState.notice ? '<div class="mc-ok">' + esc(modelState.notice) + '</div>' : '') +
        '<div class="mc-list">' + cards + '</div>' +
        '<div class="stp-note">一套配置就是一个供应商，切换只挪当前指针，不动任何 Agent 的数据。凭据只存在本机浏览器，换台机器要重新配。</div>' +
      '</div>' +
      '<div class="stp-sec">' +
        '<div class="mc-hd"><b>模型单价</b><span class="stp-tag">读自 seed.js 的 MODELS，只读</span></div>' +
        '<div class="stp-card">' + pr + '</div>' +
      '</div>';
  }

  /* ④ 内置插件：这里没有插件系统，如实列出本次页面真正加载了哪些脚本 */
  function secPlugins() {
    var d = global.document, nodes = d ? d.querySelectorAll('script[src]') : [];
    var base = [], stage = [], i;
    for (i = 0; i < nodes.length; i++) {
      var src = nodes[i].getAttribute('src') || '';
      if (src.indexOf('assets/') !== 0) continue;
      var file = src.replace(/^assets\//, '').split('?')[0];
      if (/^v\d+-/.test(file)) stage.push(file); else base.push(file);
    }
    function list(arr) {
      var h = '';
      for (var j = 0; j < arr.length; j++) {
        h += (j > 0 ? '<div class="stp-div"></div>' : '') +
          '<div class="stp-row" style="min-height:34px;padding:5px 0">' +
          '<span class="stp-mono">' + esc(arr[j]) + '</span>' +
          '<span class="stp-v s">已加载</span></div>';
      }
      return h;
    }
    function group(title, sub, arr) {
      return '<div class="stp-card">' +
        '<div class="stp-set" style="padding:0 0 6px"><span class="stp-stt">' + esc(title) + ' · ' + arr.length + '</span>' +
        '<span class="stp-tag">' + esc(sub) + '</span></div>' + list(arr) + '</div>';
    }
    return '<div class="stp-sec">' +
        '<div class="stp-note">本原型是单个 HTML + 顺序加载的脚本，没有插件系统。这一屏是本次页面真实加载的 ' +
        (base.length + stage.length) + ' 个 assets 脚本，组内按加载顺序。</div>' +
        group('基础脚本', '数据与渲染', base) +
        group('阶段模块', 'v10 – v41', stage) +
      '</div>';
  }

  /* ⑤ Agent 预设：这层在本原型里不存在，不装样子 */
  function secPresets() {
    var S = global.DATA_SEED || {};
    return '<div class="stp-sec"><div class="stp-empty">' +
        '<b>本原型没有「Agent 预设」这一层</b>' +
        '<p>预设是「一组工具 + 提示词 + 权限」的打包。这里 Agent 本身就是那个包：' +
        esc((S.AGENTS || []).length) + ' 个 Agent 各自绑模型与技能，没有独立于 Agent 的预设可选。</p>' +
        '<button type="button" class="stp-btn pri" data-st-go="#/platform/agent-wb">去 Agent 工作台</button>' +
      '</div></div>';
  }

  /* ⑦ 快捷键：只列代码里真监听的键位 */
  var KEY_ROWS = [
    { k: ['K'], mod: true, d: '聚焦顶栏搜索', w: '在任意页面按下即可搜能力、对象与操作' },
    { k: ['Enter'], mod: true, d: '提交当前输入', w: 'AI 访谈与 Agent 会话的发送，等同点发送钮' },
    { k: ['Esc'], mod: false, d: '关闭浮层', w: '弹窗、设置面板、搜索浮层，哪层在最上面关哪层' },
    { k: ['↑', '↓'], mod: false, d: '搜索结果上下移动', w: '焦点落在搜索浮层里时生效' }
  ];
  function secShortcuts() {
    var mac = /Mac|iPhone|iPad/.test(String(global.navigator && global.navigator.platform || ''));
    var h = '', i, j;
    for (i = 0; i < KEY_ROWS.length; i++) {
      var r = KEY_ROWS[i], keys = '';
      if (r.mod) keys += '<kbd class="kbd">' + (mac ? '\u2318' : 'Ctrl') + '</kbd>';
      for (j = 0; j < r.k.length; j++) keys += '<kbd class="kbd">' + esc(r.k[j]) + '</kbd>';
      h += (i ? '<div class="stp-div"></div>' : '') +
        '<div class="stp-row" style="min-height:52px">' +
          '<span><span class="stp-stt">' + esc(r.d) + '</span>' +
          '<span class="stp-sd" style="display:block">' + esc(r.w) + '</span></span>' +
          '<span class="keys">' + keys + '</span>' +
        '</div>';
    }
    return '<div class="stp-sec">' +
        '<div class="stp-card">' + h + '</div>' +
        '<div class="stp-note">只列代码里真实监听的键位（metaKey || ctrlKey）：Mac 上显示 \u2318，Windows 上显示 Ctrl。' +
          '没有「自定义快捷键」——本原型没有一套可重绑的键位表，摆出来也是死设置。</div>' +
      '</div>';
  }

  /* ⑧ 数据管理 */
  function lsStats() {
    var out = { n: 0, bytes: 0 };
    try {
      var ls = global.localStorage;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (!k || k.indexOf('aiops:') !== 0) continue;
        out.n++;
        out.bytes += k.length + String(ls.getItem(k) || '').length;
      }
    } catch (e) { }
    return out;
  }
  function secData() {
    var st = lsStats();
    return '<div class="stp-sec">' +
        '<div class="stp-card">' +
          row('本机数据', esc(st.n + ' 个键 · ' + (st.bytes / 1024).toFixed(1) + ' KB')) +
          row('会话记录', esc(countByPrefix('aiops:v27:sessions:') + ' 条'), true) +
          row('审计流水', esc(countArr('aiops:v10:audit') + ' 条'), true) +
          row('打开的页签', esc(countArr('aiops:v10:tabs') + ' 个'), true) +
          /* 供应商算内存里的实际条数：没动过时来自种子，还没落盘，按 localStorage 数会显示 0 */
          row('模型供应商', esc(provLoad().list.length + ' 条'), true) +
        '</div>' +
        '<div class="stp-set"><span><span class="stp-stt">导出本机数据</span>' +
          '<span class="stp-sd">把 aiops:* 的键连值导成一个 JSON 文件，可以留档，也可以换台机器对照。</span></span>' +
          '<button type="button" class="stp-btn" data-st-export="1">导出 JSON</button></div>' +
        '<div class="stp-set" data-st-box="1"><span><span class="stp-stt">清空本机数据</span>' +
          '<span class="stp-sd">会话、审计、页签、供应商配置一起清掉；界面偏好保留。两步确认，不可撤销。</span></span>' +
          '<button type="button" class="stp-btn dg" data-st-reset="1">清空</button></div>' +
        '<div class="stp-note" data-st-status="1"></div>' +
        '<div class="stp-note">全部数据只在本机浏览器，没有任何一条离开过这台机器。</div>' +
      '</div>';
  }

  /* 分区账本：加一屏只加一条。order 决定导航顺序（负值靠前） */
  function sectionList() {
    var list = [
      { id: 'account', order: -10, label: '账号与权限', icon: 'person', render: secAccount },
      { id: 'models', order: 10, label: '模型供应商', icon: 'chip', render: secModels },
      { id: 'modules', order: 15, label: '内置模块', icon: 'server', render: secPlugins },
      { id: 'presets', order: 20, label: 'Agent 预设', icon: 'tag', render: secPresets },
      { id: 'appearance', order: 30, label: '外观', icon: 'typeface', render: secAppearance },
      { id: 'shortcuts', order: 35, label: '快捷键', icon: 'keyboard', render: secShortcuts },
      { id: 'data', order: 40, label: '本机数据', icon: 'database', render: secData },
      { id: 'about', order: 50, label: '关于本原型', icon: 'doc', render: secAbout }
    ];
    list.sort(function (a, b) { return a.order - b.order; });
    return list;
  }

  /* 导航分组：照参考图那样分堆，比一列平铺好扫。id 找不到就并入「其他」 */
  var NAV_GROUPS = [
    { id: 'g-account', title: '账号', ids: ['account'] },
    { id: 'g-run', title: '运行', ids: ['models', 'modules', 'presets'] },
    { id: 'g-ui', title: '界面', ids: ['appearance', 'shortcuts'] },
    { id: 'g-data', title: '数据', ids: ['data', 'about'] }
  ];

  /* 清掉本原型写下的所有本地状态。前缀 aiops: 是本项目唯一的本地存储命名空间
     （会话记录 aiops:v27/v28、审计与页签 aiops:v10、问卷标记 aiops:sv/iv…），
     但**设置本身（aiops:v40:prefs）留着** —— 重置数据不该顺手把人的界面偏好也抹了。 */
  function clearDemoState() {
    var killed = 0;
    try {
      var ls = global.localStorage, ss = global.sessionStorage;
      var drop = function (store) {
        if (!store) return;
        var keys = [];
        for (var i = 0; i < store.length; i++) {
          var k = store.key(i);
          if (k && k.indexOf('aiops:') === 0 && k !== PREF_KEY) keys.push(k);
        }
        keys.forEach(function (k) { store.removeItem(k); killed++; });
      };
      drop(ls); drop(ss);
    } catch (e) { /* 隐私模式：清不了就如实说 */ }
    return killed;
  }

  /* ---------------------------------------------------------------- 打开面板 */
  function openSettings() {
    var UI = global.V10UI;
    if (!UI || !UI.openSheet) return;
    injectCss();
    var list = sectionList();
    /* 每次打开都回到列表：上次停在"添加供应商"表单上，下次点开还是表单会莫名其妙 */
    modelState = { view: 'list', editId: null, notice: '' };
    var active = list[0].id;

    function byId(id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }
    function navCell(s) {
      return '<button type="button" class="stp-nav-c' + (s.id === active ? ' on' : '') + '"' +
        ' data-st-nav="' + s.id + '"' +
        (s.id === active ? ' aria-current="true"' : '') + '>' +
        icon(s.icon, 16) + '<b>' + esc(s.label) + '</b></button>';
    }
    /* 分组投影：先按 NAV_GROUPS 出三堆，剩下的 id 归「其他」——新增分区不会漏在导航外 */
    function navHtml() {
      var used = {}, h = '', i, j, s;
      for (i = 0; i < NAV_GROUPS.length; i++) {
        var g = NAV_GROUPS[i], cells = '', n = 0;
        for (j = 0; j < g.ids.length; j++) {
          s = byId(g.ids[j]);
          if (!s) continue;
          used[s.id] = 1; cells += navCell(s); n++;
        }
        if (!n) continue;
        h += '<div class="stp-group" data-grp-head="' + g.id + '">' + esc(g.title) + '</div>' +
          '<div data-grp="' + g.id + '">' + cells + '</div>';
      }
      var rest = '';
      for (i = 0; i < list.length; i++) if (!used[list[i].id]) rest += navCell(list[i]);
      if (rest) h += '<div class="stp-group" data-grp-head="g-rest">其他</div><div data-grp="g-rest">' + rest + '</div>';
      return h;
    }
    function bodyOf(id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].render();
      return '';
    }

    var html =
      /* 左栏不再写「设置」大标题：参考图第一行就是搜索框，标题留着反而多一层。
         dialog 的 aria-label 已经是「设置」，读屏不受影响。 */
      '<div class="stp-nav">' +
        /* 不设搜索框：本原型一共就五屏，五个分组一眼扫完，加个搜索反而占掉 34px
           还把导航往下压。等分区过十屏再加。 */
        '<div class="stp-nav-l" data-st-navlist="1">' + navHtml() + '</div></div>' +
      '<div class="stp-main">' +
        /* 关闭键留一条窄带：放到面板外会压在顶栏的账号区上，试过不行 */
        '<div class="stp-hd"><button type="button" class="stp-x" data-v10="close" aria-label="关闭设置">×</button></div>' +
        '<div class="stp-body" data-st-body="1">' + bodyOf(active) + '</div>' +
      '</div>';

    UI.openSheet({
      panel: true,
      title: '设置',
      bodyHtml: html,
      onOpen: function (el) {
        var bodyEl = el.querySelector('[data-st-body]');
        var navEl = el.querySelector('[data-st-navlist]');
        function select(id) {
          active = id;
          navEl.innerHTML = navHtml();
          bodyEl.innerHTML = bodyOf(id);
          bodyEl.scrollTop = 0;
        }

        el.addEventListener('click', function (e) {
          var t = e.target;
          if (!t || !t.closest) return;

          var nav = t.closest('[data-st-nav]');
          if (nav) { select(nav.getAttribute('data-st-nav')); return; }

          /* 去别的页：先关面板再改 hash，回来时不留一层浮层 */
          var go = t.closest('[data-st-go]');
          if (go) {
            var to = go.getAttribute('data-st-go');
            UI.closeSheet();
            if (to) global.location.hash = to;
            return;
          }

          /* 测速：真发 GET {base}/models，把状态码与耗时照实写回来 */
          if (t.closest('[data-mc-test]')) {
            var tBtn = t.closest('[data-mc-test]');
            var tUrl = String((bodyEl.querySelector('[data-mc-f="url"]') || {}).value || '').replace(/^\s+|\s+$/g, '');
            var tKey = (bodyEl.querySelector('[data-mc-f="key"]') || {}).value || '';
            var tAuth = (bodyEl.querySelector('[data-mc-f="authField"]') || {}).value || 'token';
            var tOut = bodyEl.querySelector('[data-mc-testout]');
            if (!/^https?:\/\//i.test(tUrl)) { setNote(tOut, '先填一个 http(s) 开头的请求地址', 'bad'); return; }
            tBtn.disabled = true; tBtn.textContent = '测速中…';
            setNote(tOut, '正在请求 ' + modelsUrl(tUrl) + ' …', 'wait');
            probe(modelsUrl(tUrl), tKey, tAuth, 8000).then(function (r) {
              tBtn.disabled = false; tBtn.textContent = '测速';
              setNote(tOut, probeText(r), r.kind === 'ok' ? 'ok' : (r.kind === 'opaque' ? 'warn' : 'bad'));
            });
            return;
          }

          /* 获取模型列表：同一个端点读响应体，勾选后写回「模型列表」 */
          if (t.closest('[data-mc-fetch]')) {
            var fBtn = t.closest('[data-mc-fetch]');
            var fUrl = String((bodyEl.querySelector('[data-mc-f="url"]') || {}).value || '').replace(/^\s+|\s+$/g, '');
            var fKey = (bodyEl.querySelector('[data-mc-f="key"]') || {}).value || '';
            var fAuth = (bodyEl.querySelector('[data-mc-f="authField"]') || {}).value || 'token';
            var fOut = bodyEl.querySelector('[data-mc-fetchout]');
            var picker = bodyEl.querySelector('[data-mc-picker]');
            if (!/^https?:\/\//i.test(fUrl)) { setNote(fOut, '先填一个 http(s) 开头的请求地址', 'bad'); return; }
            fBtn.disabled = true; fBtn.textContent = '获取中…';
            setNote(fOut, '正在 GET ' + modelsUrl(fUrl) + ' …', 'wait');
            probe(modelsUrl(fUrl), fKey, fAuth, 8000).then(function (r) {
              fBtn.disabled = false; fBtn.textContent = '获取列表';
              if (r.kind !== 'ok') {
                setNote(fOut, probeText(r) + (r.kind === 'opaque' ? '：拿不到响应体，列不了模型' : ''), 'bad');
                return;
              }
              return r.res.json().then(function (j) {
                var arr = (j && (j.data || j.models || j.result)) || j;
                var ids = [], i, one, id;
                if (arr && arr.length) {
                  for (i = 0; i < arr.length; i++) {
                    one = arr[i];
                    id = typeof one === 'string' ? one : (one && (one.id || one.name || one.model));
                    if (id && ids.indexOf(id) < 0) ids.push(String(id));
                  }
                }
                if (!ids.length) { setNote(fOut, '端点返回了，但里面没有可用模型', 'bad'); return; }
                var chosen = String((bodyEl.querySelector('[data-mc-f="models"]') || {}).value || '')
                  .split(/[,，\s]+/).filter(function (x) { return !!x; });
                picker.innerHTML = pickerHtml(ids, chosen);
                picker.classList.add('open');
                setNote(fOut, '拿到 ' + ids.length + ' 个模型，勾完点「应用」', 'ok');
              }).catch(function (e) {
                setNote(fOut, '响应不是可解析的 JSON：' + (e && e.message ? e.message : '解析失败'), 'bad');
              });
            });
            return;
          }

          /* 模型选择器：全选 / 全不选 / 取消 / 应用 */
          if (t.closest('[data-mc-pick-all]') || t.closest('[data-mc-pick-none]')) {
            var all = !!t.closest('[data-mc-pick-all]');
            var boxes = bodyEl.querySelectorAll('[data-mc-m]');
            for (var bi = 0; bi < boxes.length; bi++) boxes[bi].checked = all;
            updPickCount(bodyEl);
            return;
          }
          if (t.closest('[data-mc-pick-cancel]')) {
            var pk0 = bodyEl.querySelector('[data-mc-picker]');
            if (pk0) { pk0.innerHTML = ''; pk0.classList.remove('open'); }
            return;
          }
          if (t.closest('[data-mc-pick-apply]')) {
            var picked = [];
            var bs = bodyEl.querySelectorAll('[data-mc-m]');
            for (var bj = 0; bj < bs.length; bj++) if (bs[bj].checked) picked.push(bs[bj].getAttribute('data-mc-m'));
            if (!picked.length) { return; }
            var modelsInput = bodyEl.querySelector('[data-mc-f="models"]');
            if (modelsInput) modelsInput.value = picked.join(', ');
            var defInput = bodyEl.querySelector('[data-mc-f="def"]');
            var fastInput = bodyEl.querySelector('[data-mc-f="fast"]');
            if (defInput && !defInput.value) defInput.value = picked[0];
            if (fastInput && !fastInput.value && picked.length > 1) fastInput.value = picked[1];
            var pk = bodyEl.querySelector('[data-mc-picker]');
            if (pk) { pk.innerHTML = ''; pk.classList.remove('open'); }
            setNote(bodyEl.querySelector('[data-mc-fetchout]'), '已应用 ' + picked.length + ' 个模型', 'ok');
            return;
          }

          /* 跳到另一个分区（通用设置里的「查看快捷键」） */
          var toSec = t.closest('[data-st-section]');
          if (toSec) { select(toSec.getAttribute('data-st-section')); return; }

          /* 数据管理：导出 aiops:* 为 JSON */
          if (t.closest('[data-st-export]')) {
            var dump = {}, ls = null, i2;
            try {
              ls = global.localStorage;
              for (i2 = 0; i2 < ls.length; i2++) {
                var kk = ls.key(i2);
                if (kk && kk.indexOf('aiops:') === 0) dump[kk] = ls.getItem(kk);
              }
            } catch (e3) { }
            var now = new Date();
            var stamp = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + ('0' + now.getDate()).slice(-2);
            var text = JSON.stringify({ exportedAt: now.toISOString(), keys: dump }, null, 2);
            var blob = new global.Blob([text], { type: 'application/json' });
            var aEl = global.document.createElement('a');
            aEl.href = global.URL.createObjectURL(blob);
            aEl.download = 'aiops-backup-' + stamp + '.json';
            global.document.body.appendChild(aEl);
            aEl.click();
            global.setTimeout(function () {
              global.URL.revokeObjectURL(aEl.href);
              if (aEl.parentNode) aEl.parentNode.removeChild(aEl);
            }, 1500);
            var exNote = bodyEl.querySelector('[data-st-status]');
            if (exNote) {
              exNote.style.color = 'var(--green)';
              exNote.textContent = '已导出 ' + Object.keys(dump).length + ' 个键到 aiops-backup-' + stamp + '.json。';
            }
            return;
          }

          /* 高级选项折叠与 Key 显隐：只动 DOM，不重渲染 —— 一重渲染就把用户敲了一半的内容冲掉 */
          if (t.closest('[data-mc-adv]')) {
            var advBody = bodyEl.querySelector('[data-mc-advbody]');
            if (advBody) advBody.classList.toggle('open');
            return;
          }
          if (t.closest('[data-mc-eye]')) {
            var keyInput = bodyEl.querySelector('[data-mc-f="key"]');
            if (keyInput) {
              var hide = keyInput.type === 'text';
              keyInput.type = hide ? 'password' : 'text';
              var eyeBtn = t.closest('[data-mc-eye]');
              eyeBtn.setAttribute('aria-label', hide ? '隐藏 Key' : '显示 Key');
              eyeBtn.setAttribute('title', hide ? '隐藏 Key' : '显示 Key');
            }
            return;
          }

          /* 模型配置：增删改与切换。全部落 localStorage，不联网 */
          var mc = t.closest('[data-mc]');
          if (mc) {
            var mact = mc.getAttribute('data-mc');
            var mid = mc.getAttribute('data-mc-id') || '';
            var store = provLoad(), z;
            var nameOf = function (id) {
              for (var q = 0; q < store.list.length; q++) if (store.list[q].id === id) return store.list[q].name;
              return id;
            };
            if (mact === 'add') { modelState = { view: 'form', editId: null, notice: '' }; select(active); return; }
            if (mact === 'edit') { modelState = { view: 'form', editId: mid, notice: '' }; select(active); return; }
            if (mact === 'cancel') { modelState = { view: 'list', editId: null, notice: modelState.notice }; select(active); return; }
            if (mact === 'use') {
              store.current = mid;
              provSave(store);
              modelState = { view: 'list', editId: null, notice: '已切换到「' + nameOf(mid) + '」，对新会话生效，进行中的会话不改。' };
              select(active);
              return;
            }
            if (mact === 'del') {
              if (mid === store.current) {
                modelState = { view: 'list', editId: null, notice: '正在使用的供应商不能删除 —— 先把别的切过来。' };
                select(active);
                return;
              }
              var delName = nameOf(mid);   /* 先取名字：删完再查就只剩 id 了 */
              var keep = [];
              for (z = 0; z < store.list.length; z++) if (store.list[z].id !== mid) keep.push(store.list[z]);
              store.list = keep;
              provSave(store);
              modelState = { view: 'list', editId: null, notice: '已删除「' + delName + '」。' };
              select(active);
              return;
            }
            if (mact === 'save') {
              var val = function (k) {
                var el2 = bodyEl.querySelector('[data-mc-f="' + k + '"]');
                return el2 ? String(el2.value || '').replace(/^\s+|\s+$/g, '') : '';
              };
              var vName = val('name'), vUrl = val('url'), vKey = val('key');
              var vNotes = val('notes'), vSite = val('site'), vFast = val('fast');
              var vAuth = val('authField') || 'token', vUa = val('ua');
              var slashTrimmed = /\/$/.test(vUrl);   /* CC Switch 的规矩：地址末尾带斜杠会拼错路径 */
              if (slashTrimmed) vUrl = vUrl.replace(/\/+$/, '');
              var vModels = val('models'), vDef = val('def'), vFmt = val('format') || 'openai';
              var vPreset = val('preset');
              var errMsg = '';
              if (!vName) errMsg = '名称不能为空';
              else if (!/^https?:\/\//i.test(vUrl)) errMsg = '请求地址要以 http:// 或 https:// 开头';
              else if (!vKey) errMsg = 'API Key 不能为空';
              else if (!vModels) errMsg = '至少填一个模型';
              if (errMsg) {
                var errBox = bodyEl.querySelector('[data-mc-err]');
                if (errBox) errBox.textContent = errMsg;
                return;
              }
              if (!vDef) vDef = modelArr({ models: vModels })[0] || '';
              var notice;
              if (modelState.editId) {
                for (z = 0; z < store.list.length; z++) {
                  if (store.list[z].id !== modelState.editId) continue;
                  store.list[z].name = vName; store.list[z].url = vUrl; store.list[z].key = vKey;
                  store.list[z].models = vModels; store.list[z].def = vDef; store.list[z].format = vFmt;
                  store.list[z].preset = vPreset;
                  store.list[z].notes = vNotes; store.list[z].site = vSite; store.list[z].fast = vFast;
                  store.list[z].authField = vAuth; store.list[z].ua = vUa;
                }
                notice = '已保存「' + vName + '」' + (slashTrimmed ? '，地址末尾的斜杠已去掉' : '') + '。';
              } else {
                var newId = 'p' + (new Date().getTime());
                store.list.push({
                  id: newId, name: vName, cat: vPreset ? 'cn_official' : 'custom', preset: vPreset,
                  url: vUrl, key: vKey, models: vModels, def: vDef, format: vFmt,
                  notes: vNotes, site: vSite, fast: vFast, authField: vAuth, ua: vUa
                });
                if (!store.current) store.current = newId;
                notice = '已添加「' + vName + '」' + (store.current === newId ? '，它现在是使用中的供应商。' : '。');
              }
              provSave(store);
              modelState = { view: 'list', editId: null, notice: notice };
              select(active);
              return;
            }
          }

          /* 开关：点整行都能拨，不用瞄准那颗 38px 的开关 */
          var rowEl = t.closest('[data-st-row]');
          if (rowEl) {
            var sw = rowEl.querySelector('.stp-sw');
            if (!sw) return;
            var key = sw.getAttribute('data-pref');
            var next = sw.getAttribute('aria-checked') !== 'true';   /* 拨完之后界面上的状态 */
            sw.setAttribute('aria-checked', next ? 'true' : 'false');
            /* 三个开关里有两个的标题是"显示 XX"，存的是"关掉 XX" —— 勾上 = 不关，翻一次 */
            var cur = load();
            if (key === 'noMeta') cur.noMeta = !next;
            else if (key === 'noEnv') cur.noEnv = !next;
            else cur[key] = next;
            save(cur); apply(cur);
            return;
          }

          /* 重置：两步。第一下只把按钮变成"再点一次"，第二下才真清 ——
             这一步不可撤销（本地记录清掉找不回来），不能一下点错就没。 */
          var btn = t.closest('[data-st-reset]');
          if (btn) {
            /* 账号页与数据管理页各有一条清空，状态行要取自己那张卡里的 */
            var box = btn.closest('.stp-sec') || el;
            var status = box.querySelector('[data-st-status]');
            if (btn.getAttribute('data-st-armed') !== '1') {
              btn.setAttribute('data-st-armed', '1');
              btn.textContent = '再点一次确认';
              if (status) { status.style.color = 'var(--red)'; status.textContent = '这一步不可撤销：本地会话与审计记录会被清空。'; }
              return;
            }
            var n = clearDemoState();
            if (status) { status.style.color = 'var(--green)'; status.textContent = '已清掉 ' + n + ' 项本地记录，正在重载…'; }
            btn.disabled = true;
            global.setTimeout(function () { global.location.reload(); }, 600);
          }
        });

        /* 字号数字输入：失焦或回车时生效，夹在 12–18 之间 */
        el.addEventListener('change', function (e) {
          var num = e.target;
          if (!num || !num.getAttribute || num.getAttribute('data-fs-set') !== '1') return;
          var v = parseInt(num.value, 10);
          if (!v || v < 12) v = 12;
          if (v > 18) v = 18;
          num.value = v;
          var p3 = load();
          p3.fs = v;
          save(p3);
          apply(p3);
          select(active);
        });

        /* 选择器里的勾选：只更新计数，不重渲染 */
        el.addEventListener('change', function (e) {
          if (e.target && e.target.getAttribute && e.target.getAttribute('data-mc-m')) updPickCount(bodyEl);
        });

        /* 预设供应商：选中即把端点/模型/格式填好，仍然要自己贴 Key —— 与 CC Switch 一致 */
        el.addEventListener('change', function (e) {
          var sel = e.target;
          if (!sel || sel.getAttribute('data-mc-f') !== 'preset') return;
          var preset = null, pi;
          for (pi = 0; pi < PROV_PRESETS.length; pi++) if (PROV_PRESETS[pi].id === sel.value) preset = PROV_PRESETS[pi];
          if (!preset) return;
          var field = function (k) { return bodyEl.querySelector('[data-mc-f="' + k + '"]'); };
          if (preset.url && field('url')) field('url').value = preset.url;
          if (preset.models && field('models')) field('models').value = preset.models;
          if (preset.format && field('format')) field('format').value = preset.format;
          if (preset.id && field('name') && !field('name').value) field('name').value = preset.name;
          if (preset.models && field('def') && !field('def').value) {
            field('def').value = String(preset.models).split(',')[0].replace(/^\s+|\s+$/g, '');
          }
        });

        /* 初始焦点落在当前分区（与 dsh 一致）；鼠标点开不画外轮廓 */
        var first = el.querySelector('.stp-nav-c.on');
        if (first) {
          try { first.focus({ preventScroll: true }); }
          catch (e2) { try { first.focus(); } catch (e3) { } }
        }
      }
    });
  }

  (global.ACTIONS || (global.ACTIONS = {}))['open-settings'] = function () {
    openSettings();
  };

  /* 二级菜单底部那个按钮：收起 / 展开二级菜单，状态记在本机 */
  (global.ACTIONS || (global.ACTIONS = {}))['toggle-sub'] = function () {
    var p = load();
    p.sub = p.sub ? 0 : 1;
    save(p);
    apply(p);
  };

  /* 首屏就应用一次 —— 脚本在 body 末尾，body 已存在 */
  apply(load());
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () { apply(load()); });
    } else {
      apply(load());
    }
  }
})(window);
