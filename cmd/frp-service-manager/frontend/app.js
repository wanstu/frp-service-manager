const $ = (id) => document.getElementById(id);

let state = null;
let snapshot = null;
const connectionHealth = new Map();

const THEME_KEY = 'frp-service-manager.theme';
const THEME_PACK_KEY = 'frp-service-manager.theme-pack';
let themePacks = new Map();
const COLUMN_LABELS = {
  name: '名称',
  type: '类型',
  status: '状态',
  user: '用户',
  id: 'ID',
  hostname: '主机名',
  os: '系统',
  arch: '架构',
  version: '版本',
  protocol: '协议',
  remote_addr: '远端地址',
  remote_port: '端口号',
  custom_domains: '自定义域名',
  subdomain: '子域名',
  today_traffic_in: '今日入站',
  today_traffic_out: '今日出站',
  cur_conns: '当前连接',
  last_start_time: '最后启动',
  last_close_time: '最后关闭',
  client_version: '客户端版本',
  conf: '配置',
};
const tableViews = {
  clients: {
    targetId: 'clientsTable',
    filterId: 'clientsFilter',
    filterColumnId: 'clientsFilterColumn',
    clearId: 'clientsClearFilter',
    countId: 'clientCount',
    rows: [],
    columns: [],
    sortKey: '',
    sortDir: 'asc',
    filter: '',
    filterColumn: '',
  },
  proxies: {
    targetId: 'proxiesTable',
    filterId: 'proxiesFilter',
    filterColumnId: 'proxiesFilterColumn',
    clearId: 'proxiesClearFilter',
    countId: 'proxyCount',
    rows: [],
    columns: [],
    sortKey: '',
    sortDir: 'asc',
    filter: '',
    filterColumn: '',
  },
};
const API = () => {
  const api = window.go?.main?.App;
  if (!api) throw new Error('Wails 后端尚未就绪');
  return api;
};

function showMessage(text, type = '') {
  const el = $('message');
  el.textContent = text;
  el.className = ('message ' + type).trim();
  el.classList.remove('hidden');
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function setBusy(button, busy, pendingText = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = pendingText;
    button.disabled = true;
    return;
  }
  if (button.dataset.label) button.textContent = button.dataset.label;
  delete button.dataset.label;
  button.disabled = false;
}

function currentConnection() {
  const id = state?.active_connection_id;
  return (state?.connections || []).find((item) => item.id === id) || null;
}

function applyTheme(mode, persist = true) {
  const valid = new Set(['system', 'light', 'dark']);
  const next = valid.has(mode) ? mode : 'system';
  window.desktopKitTheme?.apply(next);
  $('themeMode').value = next;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
  }
}

function initializeTheme() {
  let mode = 'system';
  try { mode = localStorage.getItem(THEME_KEY) || 'system'; } catch (_) {}
  applyTheme(mode, false);
}

async function applyThemePack(name, persist = true) {
  const next = themePacks.has(name) ? name : '';

  if (!next) {
    window.desktopKitTheme?.clearAppliedPack();
  } else {
    await window.desktopKitTheme.applyPack(next);
  }

  $('themePack').value = next;
  if (persist) {
    try { localStorage.setItem(THEME_PACK_KEY, next); } catch (_) {}
  }
}

async function initializeThemePacks() {
  if (!window.desktopKitTheme?.loadCatalog) {
    throw new Error('Desktop Kit Runtime Theme 未加载');
  }

  let catalog = await window.desktopKitTheme.loadCatalog();
  if (catalog?.source === 'builtin' && window.desktopKitTheme.refreshCatalog) {
    catalog = await window.desktopKitTheme.refreshCatalog();
  }
  const packs = Array.isArray(catalog?.packs) ? catalog.packs : [];
  themePacks = new Map(packs.map((pack) => [pack.name, pack]));

  const select = $('themePack');
  select.textContent = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Kit 默认';
  select.appendChild(defaultOption);

  packs.forEach((pack) => {
    const option = document.createElement('option');
    option.value = pack.name;
    option.textContent = pack.display_name;
    option.title = pack.description || '';
    select.appendChild(option);
  });

  let saved = '';
  try { saved = localStorage.getItem(THEME_PACK_KEY) || ''; } catch (_) {}

  try {
    await applyThemePack(saved, false);
  } catch (_) {
    window.desktopKitTheme.clearAppliedPack();
    $('themePack').value = '';
  }
}

function renderState(nextState) {
  state = nextState;
  const connections = state.connections || [];
  $('connectionList').textContent = '';

  connections.forEach((connection) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'connection-item' + (connection.id === state.active_connection_id ? ' is-active' : '');

    const title = document.createElement('div');
    title.className = 'connection-name-row';
    const dot = document.createElement('span');
    const health = connectionHealth.get(connection.id);
    dot.className = 'connection-dot' + (health === 'online' ? ' online' : health === 'error' ? ' error' : '');
    const name = document.createElement('strong');
    name.textContent = connection.name;
    title.append(dot, name);

    const url = document.createElement('div');
    url.className = 'connection-url';
    url.textContent = connection.base_url;

    button.append(title, url);
    button.addEventListener('click', async () => {
      if (connection.id === state.active_connection_id) {
        openConnectionDialog(connection);
        return;
      }
      try {
        const next = await API().SetActiveConnection(connection.id);
        snapshot = null;
        renderState(next);
        await refreshActive();
      } catch (error) {
        showMessage(errorMessage(error), 'error');
      }
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openConnectionDialog(connection);
    });
    $('connectionList').appendChild(button);
  });

  $('launchAtLogin').checked = Boolean(state.launch_at_login);
  $('launchAtLogin').disabled = !state.launch_at_login_supported;
  $('dataDir').textContent = state.data_dir ? '配置：' + state.data_dir : '';

  const active = currentConnection();
  $('pageTitle').textContent = active?.name || '尚未添加 FRPS';
  $('pageURL').textContent = active?.base_url || '添加一个已经部署好的 FRPS Dashboard 连接。';
  $('refresh').disabled = !active;
  $('openDashboard').disabled = !active;

  const empty = connections.length === 0;
  $('emptyState').classList.toggle('hidden', !empty);
  $('workspace').classList.toggle('hidden', empty);

  if (!active) {
    $('connectionStatus').textContent = '未连接';
    $('connectionStatus').className = 'dk-status-pill';
  }
}

function openConnectionDialog(connection = null) {
  $('connectionForm').reset();
  $('testResult').className = 'test-result hidden';
  $('testResult').textContent = '';
  $('connectionId').value = connection?.id || '';
  $('connectionName').value = connection?.name || '';
  $('connectionURL').value = connection?.base_url || '';
  $('connectionUser').value = connection?.username || '';
  $('connectionPassword').value = '';
  $('connectionPassword').placeholder = connection?.has_password
    ? '留空则保留已保存密码'
    : 'Dashboard 密码（可选）';
  $('skipTLSVerify').checked = Boolean(connection?.skip_tls_verify);
  $('clearPassword').checked = false;
  $('dialogTitle').textContent = connection ? '编辑连接' : '添加连接';
  $('deleteConnection').classList.toggle('hidden', !connection);
  $('clearPasswordRow').classList.toggle('hidden', !connection?.has_password);
  $('passwordHint').textContent = connection?.has_password
    ? '已安全保存密码；留空会继续使用原密码。'
    : '密码不会写入 settings.json。';
  $('connectionDialog').showModal();
}

function closeConnectionDialog() {
  $('connectionDialog').close();
}

function dialogInput() {
  return {
    id: $('connectionId').value.trim(),
    name: $('connectionName').value.trim(),
    base_url: $('connectionURL').value.trim(),
    username: $('connectionUser').value.trim(),
    password: $('connectionPassword').value,
    clear_password: $('clearPassword').checked,
    skip_tls_verify: $('skipTLSVerify').checked,
  };
}

async function testDraft() {
  const button = $('testConnection');
  setBusy(button, true, '测试中…');
  const resultBox = $('testResult');
  resultBox.className = 'test-result';
  resultBox.textContent = '正在连接…';
  try {
    const result = await API().TestConnection(dialogInput());
    resultBox.className = 'test-result success';
    resultBox.textContent = result.message || '连接成功';
  } catch (error) {
    resultBox.className = 'test-result error';
    resultBox.textContent = errorMessage(error);
  } finally {
    setBusy(button, false);
  }
}

async function saveConnection(event) {
  event.preventDefault();
  const button = $('saveConnection');
  setBusy(button, true, '保存中…');
  try {
    const next = await API().SaveConnection(dialogInput());
    closeConnectionDialog();
    renderState(next);
    showMessage('连接已保存', 'success');
    await refreshActive();
  } catch (error) {
    showMessage(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteCurrentConnection() {
  const id = $('connectionId').value.trim();
  if (!id) return;
  const connection = (state.connections || []).find((item) => item.id === id);
  if (!window.confirm('删除连接“' + (connection?.name || id) + '”？已保存的密码也会一并删除。')) return;
  const button = $('deleteConnection');
  setBusy(button, true, '删除中…');
  try {
    const next = await API().DeleteConnection(id);
    connectionHealth.delete(id);
    snapshot = null;
    closeConnectionDialog();
    renderState(next);
    showMessage('连接已删除', 'success');
    if (next.active_connection_id) await refreshActive();
  } catch (error) {
    showMessage(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function refreshActive() {
  const active = currentConnection();
  if (!active) return;

  const button = $('refresh');
  setBusy(button, true, '刷新中…');
  $('connectionStatus').textContent = '连接中';
  $('connectionStatus').className = 'dk-status-pill is-warning';

  try {
    snapshot = await API().RefreshConnection(active.id);
    connectionHealth.set(active.id, 'online');
    $('connectionStatus').textContent = '在线';
    $('connectionStatus').className = 'dk-status-pill is-success';
    renderSnapshot(snapshot);
    renderState(state);
  } catch (error) {
    connectionHealth.set(active.id, 'error');
    $('connectionStatus').textContent = '连接失败';
    $('connectionStatus').className = 'dk-status-pill is-danger';
    snapshot = null;
    renderSnapshot(null);
    renderState(state);
    showMessage(errorMessage(error), 'error');
  } finally {
    setBusy(button, false);
    button.disabled = !currentConnection();
  }
}

function renderSnapshot(data) {
  const info = data?.server_info || {};
  const apiModeLabels = {
    hybrid: 'Dashboard API',
    clients: '客户端 API',
    proxy: '代理 API',
    serverinfo: '基础 API',
  };
  $('apiMode').textContent = data ? (apiModeLabels[data.api_mode] || 'Dashboard API') : '—';

  const cards = [
    ['FRPS 版本', pick(info, ['version']) || '—'],
    ['当前连接', formatNumber(pick(info, ['cur_conns', 'curConns', 'current_connections']))],
    ['入站流量', formatBytes(pick(info, ['total_traffic_in', 'totalTrafficIn']))],
    ['出站流量', formatBytes(pick(info, ['total_traffic_out', 'totalTrafficOut']))],
  ];
  const cardRoot = $('overviewCards');
  cardRoot.textContent = '';
  cards.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'metric-card';
    const labelEl = document.createElement('div');
    labelEl.className = 'metric-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'metric-value';
    valueEl.textContent = value;
    card.append(labelEl, valueEl);
    cardRoot.appendChild(card);
  });

  renderDetails(info);
  const clients = flattenItems(data?.clients, ['clients', 'items', 'data']);
  const proxies = flattenProxies(data?.proxies);
  setTableData('clients', clients, ['user', 'hostname', 'status', 'client_version', 'version', 'os', 'arch', 'protocol', 'id']);
  setTableData('proxies', proxies, ['name', 'type', 'status', 'user', 'remote_addr', 'remote_port', 'custom_domains', 'subdomain', 'today_traffic_in', 'today_traffic_out', 'cur_conns', 'conf']);
  $('rawData').textContent = data ? JSON.stringify(data, null, 2) : '尚未获取数据。';

  const warnings = data?.warnings || [];
  $('warningsPanel').classList.toggle('hidden', warnings.length === 0);
  $('warnings').textContent = '';
  warnings.forEach((warning) => {
    const line = document.createElement('div');
    line.className = 'warning-line';
    line.textContent = warning;
    $('warnings').appendChild(line);
  });
}

function renderDetails(info) {
  const root = $('serverInfo');
  root.textContent = '';
  const preferred = [
    ['version', '版本'],
    ['bind_port', 'Bind Port'],
    ['vhost_http_port', 'HTTP Port'],
    ['vhost_https_port', 'HTTPS Port'],
    ['subdomain_host', 'Subdomain Host'],
    ['max_pool_count', 'Max Pool'],
    ['max_ports_per_client', '每客户端最大端口'],
    ['tcp_mux', 'TCP Mux'],
    ['heartbeat_timeout', '心跳超时'],
  ];
  const used = new Set();
  preferred.forEach(([key, label]) => {
    const match = findKey(info, key);
    if (!match) return;
    used.add(match);
    appendDetail(root, label, info[match]);
  });
  Object.keys(info).sort().forEach((key) => {
    if (used.has(key)) return;
    const value = info[key];
    if (value && typeof value === 'object') return;
    appendDetail(root, key, value);
  });
}

function appendDetail(root, label, value) {
  const wrapper = document.createElement('dl');
  wrapper.className = 'detail-item';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = displayValue(value);
  wrapper.append(dt, dd);
  root.appendChild(wrapper);
}

function flattenProxies(groups) {
  if (!groups || typeof groups !== 'object') return [];
  const rows = [];
  Object.entries(groups).forEach(([type, payload]) => {
    const items = flattenItems(payload, ['proxies', 'items', 'data']);
    items.forEach((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        rows.push({
          ...item,
          type: item.type || type,
          remote_port: proxyPort(item),
        });
      }
    });
  });
  return rows;
}

function proxyPort(item) {
  const direct = firstDefined(
    item.remote_port,
    item.remotePort,
    item.port,
  );
  if (direct !== undefined) return normalizePort(direct);

  let conf = item.conf;
  if (typeof conf === 'string') {
    try { conf = JSON.parse(conf); } catch (_) { conf = null; }
  }
  if (conf && typeof conf === 'object') {
    const nested = firstDefined(
      conf.remote_port,
      conf.remotePort,
      conf.port,
    );
    if (nested !== undefined) return normalizePort(nested);
  }
  return '';
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizePort(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 65535) return number;
  return value ?? '';
}

function flattenItems(payload, keys = []) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === 'object') {
      const nested = flattenItems(payload[key], keys);
      if (nested.length) return nested;
    }
  }
  if (Array.isArray(payload.list)) return payload.list;
  return [];
}

function setTableData(name, rows, preferredColumns) {
  const view = tableViews[name];
  if (!view) return;

  view.rows = Array.isArray(rows) ? rows : [];
  const keys = new Set();
  view.rows.forEach((row) => {
    if (row && typeof row === 'object') Object.keys(row).forEach((key) => keys.add(key));
  });

  const ordered = preferredColumns.filter((key) => keys.has(key));
  [...keys].sort().forEach((key) => {
    if (!ordered.includes(key)) ordered.push(key);
  });
  view.columns = ordered;

  if (view.sortKey && !view.columns.includes(view.sortKey)) {
    view.sortKey = '';
    view.sortDir = 'asc';
  }
  if (view.filterColumn && !view.columns.includes(view.filterColumn)) {
    view.filterColumn = '';
  }

  renderFilterColumnOptions(name);
  renderTableView(name);
}

function renderFilterColumnOptions(name) {
  const view = tableViews[name];
  const select = $(view.filterColumnId);
  if (!select) return;

  const previous = view.filterColumn;
  select.textContent = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '全部字段';
  select.appendChild(all);

  view.columns.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = columnLabel(key);
    select.appendChild(option);
  });
  select.value = view.columns.includes(previous) ? previous : '';
}

function renderTableView(name) {
  const view = tableViews[name];
  const root = $(view.targetId);
  root.textContent = '';

  const filtered = filterTableRows(view);
  const sorted = sortTableRows(filtered, view);
  const total = view.rows.length;
  const count = $(view.countId);
  if (count) count.textContent = filtered.length === total ? String(total) : filtered.length + ' / ' + total;

  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-table';
    empty.textContent = total ? '没有符合筛选条件的数据' : '暂无可显示的数据';
    root.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  view.columns.forEach((key) => {
    const th = document.createElement('th');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button' + (view.sortKey === key ? ' is-sorted' : '');
    button.title = '按“' + columnLabel(key) + '”排序';

    const label = document.createElement('span');
    label.textContent = columnLabel(key);
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    indicator.textContent = view.sortKey === key ? (view.sortDir === 'asc' ? '▲' : '▼') : '↕';

    button.append(label, indicator);
    button.addEventListener('click', () => {
      if (view.sortKey === key) {
        view.sortDir = view.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        view.sortKey = key;
        view.sortDir = 'asc';
      }
      renderTableView(name);
    });
    th.appendChild(button);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  sorted.forEach((row) => {
    const tr = document.createElement('tr');
    view.columns.forEach((key) => {
      const td = document.createElement('td');
      appendTableCell(td, key, row?.[key], row);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  root.appendChild(table);
}

function filterTableRows(view) {
  const query = view.filter.trim().toLocaleLowerCase();
  if (!query) return view.rows.slice();

  return view.rows.filter((row) => {
    const keys = view.filterColumn ? [view.filterColumn] : view.columns;
    return keys.some((key) => searchableValue(row?.[key]).includes(query));
  });
}

function sortTableRows(rows, view) {
  if (!view.sortKey) return rows.slice();
  const direction = view.sortDir === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({row, index}))
    .sort((left, right) => {
      const compared = compareValues(left.row?.[view.sortKey], right.row?.[view.sortKey]);
      return compared === 0 ? left.index - right.index : compared * direction;
    })
    .map((item) => item.row);
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null || left === '') return 1;
  if (right === undefined || right === null || right === '') return -1;

  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = typeof right === 'number' ? right : Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return searchableValue(left).localeCompare(searchableValue(right), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function searchableValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value).toLocaleLowerCase(); } catch (_) { return String(value).toLocaleLowerCase(); }
  }
  return String(value).toLocaleLowerCase();
}

function appendTableCell(td, key, value, row) {
  if (value && typeof value === 'object') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'json-cell-button';
    button.textContent = Array.isArray(value) ? '查看 (' + value.length + ')' : '查看';
    button.addEventListener('click', () => {
      const rowName = row?.name || row?.user || '';
      openJsonDialog(columnLabel(key) + (rowName ? ' · ' + rowName : ''), value);
    });
    td.appendChild(button);
    return;
  }

  if (key.toLocaleLowerCase() === 'status') {
    const badge = document.createElement('span');
    const status = displayValue(value);
    const normalized = status.toLocaleLowerCase();
    badge.className = 'table-status';
    if (['online', 'running', 'active', 'enabled', 'true'].includes(normalized)) badge.classList.add('is-online');
    if (['offline', 'closed', 'inactive', 'disabled', 'false'].includes(normalized)) badge.classList.add('is-offline');
    badge.textContent = status;
    td.appendChild(badge);
    return;
  }

  const text = document.createElement('span');
  text.className = 'cell-text';
  text.textContent = formatTableValue(key, value);
  text.title = displayValue(value);
  td.appendChild(text);
}

function formatTableValue(key, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (/traffic/i.test(key) && Number.isFinite(Number(value))) return formatBytes(value);
  return String(value);
}

function columnLabel(key) {
  return COLUMN_LABELS[key] || key;
}

function openJsonDialog(title, value) {
  $('jsonDialogTitle').textContent = title || '字段详情';
  try {
    $('jsonDialogContent').textContent = JSON.stringify(value, null, 2);
  } catch (_) {
    $('jsonDialogContent').textContent = String(value);
  }
  $('jsonDialog').showModal();
}

function closeJsonDialog() {
  $('jsonDialog').close();
}

function pick(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

function findKey(object, wanted) {
  if (!object) return '';
  if (Object.prototype.hasOwnProperty.call(object, wanted)) return wanted;
  const normalized = wanted.replaceAll('_', '').toLowerCase();
  return Object.keys(object).find((key) => key.replaceAll('_', '').toLowerCase() === normalized) || '';
}

function displayValue(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }
  return String(value);
}

function formatNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : '—';
}

function formatBytes(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = num;
  let index = 0;
  while (Math.abs(n) >= 1024 && index < units.length - 1) {
    n /= 1024;
    index += 1;
  }
  return n.toLocaleString(undefined, {maximumFractionDigits: index === 0 ? 0 : 1}) + ' ' + units[index];
}

function errorMessage(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('is-active', item === button));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
    $('tab-' + button.dataset.tab).classList.remove('hidden');
  });
});

$('addConnection').addEventListener('click', () => openConnectionDialog());
$('emptyAdd').addEventListener('click', () => openConnectionDialog());
$('dialogClose').addEventListener('click', closeConnectionDialog);
$('cancelDialog').addEventListener('click', closeConnectionDialog);
$('connectionForm').addEventListener('submit', saveConnection);
$('testConnection').addEventListener('click', testDraft);
$('deleteConnection').addEventListener('click', deleteCurrentConnection);
$('refresh').addEventListener('click', refreshActive);
$('openDashboard').addEventListener('click', async () => {
  const active = currentConnection();
  if (!active) return;
  try { await API().OpenDashboard(active.id); } catch (error) { showMessage(errorMessage(error), 'error'); }
});
$('themeMode').addEventListener('change', (event) => applyTheme(event.target.value));
$('themePack').addEventListener('change', async (event) => {
  try {
    await applyThemePack(event.target.value);
  } catch (error) {
    showMessage(errorMessage(error), 'error');
    await applyThemePack('', false);
  }
});

Object.entries(tableViews).forEach(([name, view]) => {
  $(view.filterId).addEventListener('input', (event) => {
    view.filter = event.target.value || '';
    renderTableView(name);
  });
  $(view.filterColumnId).addEventListener('change', (event) => {
    view.filterColumn = event.target.value || '';
    renderTableView(name);
  });
  $(view.clearId).addEventListener('click', () => {
    view.filter = '';
    view.filterColumn = '';
    $(view.filterId).value = '';
    $(view.filterColumnId).value = '';
    renderTableView(name);
  });
});

$('jsonDialogClose').addEventListener('click', closeJsonDialog);
$('jsonDialogDone').addEventListener('click', closeJsonDialog);

$('launchAtLogin').addEventListener('change', async (event) => {
  const target = event.target;
  target.disabled = true;
  try {
    const next = await API().SetLaunchAtLogin(target.checked);
    renderState(next);
    showMessage(target.checked ? '已开启开机启动' : '已关闭开机启动', 'success');
  } catch (error) {
    target.checked = !target.checked;
    showMessage(errorMessage(error), 'error');
  } finally {
    target.disabled = !state?.launch_at_login_supported;
  }
});

async function boot() {
  initializeTheme();
  try {
    await initializeThemePacks();
    renderState(await API().GetState());
    if (state.active_connection_id) await refreshActive();
  } catch (error) {
    showMessage(errorMessage(error), 'error');
  }
}

boot();
