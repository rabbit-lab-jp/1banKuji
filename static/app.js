const YEAR_STORAGE_KEY = 'ichiban-kuji-year';
const MONTH_STORAGE_KEY = 'ichiban-kuji-month';
const MODE_STORAGE_KEY = 'ichiban-kuji-mode';
const FAVORITES_STORAGE_KEY = 'ichiban-kuji-favorites';
const BUY_TARGETS_STORAGE_KEY = 'ichiban-kuji-buy-targets';
const DOUBLE_CHANCE_COUNT_STORAGE_KEY = 'ichiban-kuji-double-chance-count';
const VALID_MODES = ['all', 'online'];

const state = {
  items: [],
  selectedYear: new Date().getFullYear(),
  selectedMonth: new Date().getMonth() + 1,
  selectedMode: 'all',
  favorites: [],
  buyTargets: [],
  lastNotifiedFavoriteTitles: [],
};

const rangeLabel = document.querySelector('#range-label');
const countLabel = document.querySelector('#count-label');
const statusLabel = document.querySelector('#status-label');
const lotteryList = document.querySelector('#lottery-list');
const lotteryTemplate = document.querySelector('#lottery-template');
const refreshButton = document.querySelector('#refresh-button');
const quickFilterButtons = document.querySelectorAll('.quick-filter-btn');
const yearSelect = document.querySelector('#year-select');
const monthSelect = document.querySelector('#month-select');
const favoriteInput = document.querySelector('#favorite-title-input');
const addFavoriteButton = document.querySelector('#add-favorite-button');
const favoriteList = document.querySelector('#favorite-list');
const doubleChanceCount = document.querySelector('#double-chance-count');
const doubleChanceFetchButton = document.querySelector('#double-chance-fetch-button');
const doubleChanceStatus = document.querySelector('#double-chance-status');

function getSavedDoubleChanceCount() {
  const saved = localStorage.getItem(DOUBLE_CHANCE_COUNT_STORAGE_KEY);
  return saved && /^\d{1,9}$/.test(saved) ? Number(saved) : null;
}

function renderDoubleChanceCount() {
  if (!doubleChanceCount) {
    return;
  }

  const count = getSavedDoubleChanceCount();
  doubleChanceCount.textContent = count === null ? '未取得' : `${count.toLocaleString('ja-JP')}回`;
}

async function fetchDoubleChanceCount() {
  if (!doubleChanceStatus || !doubleChanceFetchButton) {
    return;
  }

  doubleChanceFetchButton.disabled = true;
  doubleChanceStatus.textContent = '専用Edgeを起動しています。初回はEdgeでマイページにログインしてください。';
  try {
    const response = await fetch('/api/double-chance', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '回数を取得できませんでした。');
    }

    if (!Number.isInteger(data.count) || data.count < 0 || data.count > 999999999) {
      throw new Error('取得した回数が不正です。');
    }

    localStorage.setItem(DOUBLE_CHANCE_COUNT_STORAGE_KEY, String(data.count));
    renderDoubleChanceCount();
    doubleChanceStatus.textContent = '回数を更新しました。';
    showToast(`ダブルチャンス挑戦回数を${data.count.toLocaleString('ja-JP')}回に更新しました`);
  } catch (error) {
    doubleChanceStatus.textContent = error.message || '回数を取得できませんでした。';
  } finally {
    doubleChanceFetchButton.disabled = false;
  }
}

function getDefaultYear() {
  return new Date().getFullYear();
}

function getDefaultMonth() {
  return new Date().getMonth() + 1;
}

function buildSourceUrl(year, month) {
  return `https://1kuji.com/products?sale_month=${String(month).padStart(2, '0')}&sale_year=${year}`;
}

function getInitialYear() {
  const saved = Number(localStorage.getItem(YEAR_STORAGE_KEY));
  if (Number.isInteger(saved) && saved >= 2020) {
    return saved;
  }
  return getDefaultYear();
}

function getInitialMonth() {
  const saved = Number(localStorage.getItem(MONTH_STORAGE_KEY));
  if (Number.isInteger(saved) && saved >= 1 && saved <= 12) {
    return saved;
  }
  return getDefaultMonth();
}

function persistMonthSelection(year, month) {
  const safeYear = Number.isFinite(year) && year >= 2020 ? Number(year) : getDefaultYear();
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? Number(month) : getDefaultMonth();

  state.selectedYear = safeYear;
  state.selectedMonth = safeMonth;

  if (yearSelect) {
    yearSelect.value = String(safeYear);
  }
  if (monthSelect) {
    monthSelect.value = String(safeMonth);
  }

  localStorage.setItem(YEAR_STORAGE_KEY, String(safeYear));
  localStorage.setItem(MONTH_STORAGE_KEY, String(safeMonth));
}

function getInitialMode() {
  const saved = localStorage.getItem(MODE_STORAGE_KEY);
  if (saved && VALID_MODES.includes(saved)) {
    return saved;
  }
  return 'all';
}

function normalizeFavoriteText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[【】\[\]（）()「」『』。.,！!?/\\-_:;~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFavoriteMatchScore(itemTitle, favoriteTitle) {
  const normalizedItemTitle = normalizeFavoriteText(itemTitle);
  const normalizedFavorite = normalizeFavoriteText(favoriteTitle);

  if (!normalizedItemTitle || !normalizedFavorite) {
    return 0;
  }

  if (normalizedItemTitle === normalizedFavorite) {
    return 100;
  }

  if (normalizedItemTitle.includes(normalizedFavorite)) {
    return 80;
  }

  const itemTokens = normalizedItemTitle.split(' ').filter(Boolean);
  const favoriteTokens = normalizedFavorite.split(' ').filter(Boolean);
  if (!favoriteTokens.length) {
    return 0;
  }

  const matchedTokenCount = favoriteTokens.filter((token) => itemTokens.includes(token)).length;
  if (matchedTokenCount === favoriteTokens.length && favoriteTokens.length > 0) {
    return 60;
  }

  if (matchedTokenCount > 0) {
    return 30;
  }

  return 0;
}

function getFavoriteTitles() {
  try {
    const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => String(typeof item === 'string' ? item : item?.title || '').trim())
      .filter((item) => item && item.length <= 40)
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, 12);
  } catch (error) {
    return [];
  }
}

function getBuyTargets() {
  try {
    const saved = localStorage.getItem(BUY_TARGETS_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => String(item).trim())
      .filter((item) => item && item.length <= 80)
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, 100);
  } catch (error) {
    return [];
  }
}

function persistMode(value) {
  const safeValue = VALID_MODES.includes(value) ? value : 'all';
  state.selectedMode = safeValue;
  quickFilterButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === safeValue);
  });
  localStorage.setItem(MODE_STORAGE_KEY, safeValue);
}

function formatRangeLabel(year, month) {
  if (!year && !month) {
    return '対象月';
  }
  return `${year}年${month}月`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function getDateValue(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getVisibleItems(items) {
  return items.filter((item) => {
    const itemDate = getDateValue(item.date);
    if (!itemDate) {
      return false;
    }

    return itemDate.getFullYear() === state.selectedYear && (itemDate.getMonth() + 1) === state.selectedMonth;
  });
}

function getModeFilteredItems(items) {
  if (state.selectedMode === 'online') {
    return items.filter((item) => item.online_url);
  }

  return items;
}

function isFavoriteMatch(itemTitle) {
  if (!state.favorites.length) {
    return false;
  }

  return state.favorites.some((favorite) => getFavoriteMatchScore(itemTitle, favorite) > 0);
}

function isBuyTarget(itemTitle) {
  if (!state.buyTargets.length) {
    return false;
  }

  const normalizedTitle = normalizeFavoriteText(itemTitle);
  return state.buyTargets.some((target) => normalizeFavoriteText(target) === normalizedTitle);
}

function getFavoritePriority(item) {
  if (!state.favorites.length) {
    return 0;
  }

  return state.favorites.reduce((score, favorite) => {
    return score + getFavoriteMatchScore(item.title, favorite);
  }, 0);
}

function sortFeaturedFirst(items) {
  return [...items].sort((a, b) => {
    const aBuyTarget = isBuyTarget(a.title) ? 1 : 0;
    const bBuyTarget = isBuyTarget(b.title) ? 1 : 0;
    if (aBuyTarget !== bBuyTarget) {
      return bBuyTarget - aBuyTarget;
    }

    const aFavoritePriority = getFavoritePriority(a);
    const bFavoritePriority = getFavoritePriority(b);
    if (aFavoritePriority !== bFavoritePriority) {
      return bFavoritePriority - aFavoritePriority;
    }

    const aFeatured = a.online_url ? 1 : 0;
    const bFeatured = b.online_url ? 1 : 0;
    if (aFeatured !== bFeatured) {
      return bFeatured - aFeatured;
    }

    return new Date(b.date) - new Date(a.date);
  });
}

function persistFavoriteTitles(titles) {
  const sanitizedList = Array.from(new Set(titles.map((title) => String(title).trim()).filter(Boolean))).slice(0, 12);
  state.favorites = sanitizedList;
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(sanitizedList));
  renderFavoriteChips();
}

function persistBuyTargets(titles) {
  const sanitizedList = Array.from(new Set(titles.map((title) => String(title).trim()).filter(Boolean))).slice(0, 100);
  state.buyTargets = sanitizedList;
  localStorage.setItem(BUY_TARGETS_STORAGE_KEY, JSON.stringify(sanitizedList));
}

function renderFavoriteChips() {
  if (!favoriteList) {
    return;
  }

  favoriteList.innerHTML = '';

  if (!state.favorites.length) {
    const empty = document.createElement('span');
    empty.className = 'favorite-empty';
    empty.textContent = 'まだ登録されていません';
    favoriteList.appendChild(empty);
    return;
  }

  state.favorites.forEach((title) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'favorite-chip';
    chip.setAttribute('aria-label', `${title}を削除`);

    const label = document.createElement('span');
    label.textContent = title;

    const remove = document.createElement('span');
    remove.className = 'favorite-chip-remove';
    remove.textContent = '×';

    chip.appendChild(label);
    chip.appendChild(remove);
    chip.addEventListener('click', () => {
      persistFavoriteTitles(state.favorites.filter((item) => item !== title));
      persistBuyTargets(state.buyTargets.filter((item) => !getFavoriteMatchScore(item, title)));
      render();
    });

    favoriteList.appendChild(chip);
  });
}

function showToast(message) {
  const container = document.querySelector('#toast-container');
  if (!container) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });

  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 2800);
}

function requestFavoriteNotifications() {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function notifyFavoriteMatches(items) {
  if (!items.length || !state.favorites.length) {
    state.lastNotifiedFavoriteTitles = [];
    return;
  }

  const matchedTitles = [...new Set(items.map((item) => item.title))]
    .filter((title) => state.favorites.some((favorite) => getFavoriteMatchScore(title, favorite) > 0));

  if (!matchedTitles.length) {
    state.lastNotifiedFavoriteTitles = [];
    return;
  }

  const nextNotified = matchedTitles.slice(0, 3);
  const hasChanged = JSON.stringify(nextNotified) !== JSON.stringify(state.lastNotifiedFavoriteTitles);
  if (!hasChanged) {
    return;
  }

  const title = nextNotified[0];
  const message = `${title} が今回の一覧に出ました`;
  showToast(message);

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('お気に入りタイトル', {
      body: message,
      tag: 'favorite-match'
    });
  }

  state.lastNotifiedFavoriteTitles = nextNotified;
}

function buildOfficialShopSearchUrl(url) {
  if (!url) {
    return '';
  }

  const match = /\/products\/([^/?#]+)/i.exec(url);
  if (!match || !match[1]) {
    return '';
  }

  return `https://1kuji.com/shop_lists?product_id=${match[1]}`;
}

function render() {
  const baseItems = getVisibleItems(state.items);
  const visibleItems = sortFeaturedFirst(getModeFilteredItems(baseItems));
  const favoriteMatches = visibleItems.filter((item) => isFavoriteMatch(item.title));

  rangeLabel.textContent = formatRangeLabel(state.selectedYear, state.selectedMonth);
  countLabel.textContent = `${visibleItems.length}件`;
  statusLabel.textContent = visibleItems.length > 0 ? '更新済み' : 'データなし';

  if (favoriteMatches.length) {
    notifyFavoriteMatches(favoriteMatches);
  }

  lotteryList.innerHTML = '';

  if (visibleItems.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'この期間の一番くじ情報はまだありません。';
    lotteryList.appendChild(emptyState);
    return;
  }

  visibleItems.forEach((item) => {
    const node = lotteryTemplate.content.cloneNode(true);
    const card = node.querySelector('.lottery-card');
    const thumb = node.querySelector('.lottery-thumb');
    const productLink = node.querySelector('.lottery-product-link');
    const shopLink = node.querySelector('.lottery-shop-link');
    const onlineLink = node.querySelector('.lottery-online-link');
    const titleNode = node.querySelector('.lottery-title');
    const top = node.querySelector('.lottery-top');
    const onlineSchedule = node.querySelector('.lottery-online-schedule');
    const storeList = node.querySelector('.store-list');

    const buyCheckbox = document.createElement('label');
    buyCheckbox.className = 'buy-target-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isBuyTarget(item.title);
    checkbox.setAttribute('aria-label', `${item.title}を買いたいにチェック`);
    checkbox.addEventListener('change', (event) => {
      const nextTargets = event.target.checked
        ? Array.from(new Set([...state.buyTargets, item.title]))
        : state.buyTargets.filter((target) => normalizeFavoriteText(target) !== normalizeFavoriteText(item.title));
      persistBuyTargets(nextTargets);
      render();
    });
    buyCheckbox.appendChild(checkbox);
    const buyLabel = document.createElement('span');
    buyLabel.textContent = '買いたい！';
    buyCheckbox.appendChild(buyLabel);
    top.insertBefore(buyCheckbox, top.firstChild);

    if (isFavoriteMatch(item.title)) {
      card.classList.add('is-favorite');
      titleNode.classList.add('favorite-highlight');

      const indicator = document.createElement('span');
      indicator.className = 'featured-indicator favorite-indicator';
      indicator.textContent = '登録中';
      top.appendChild(indicator);
    }

    if (isBuyTarget(item.title)) {
      card.classList.add('is-buy-target');
      checkbox.checked = true;
    }

    titleNode.textContent = item.title;
    node.querySelector('.lottery-meta').textContent = item.note;
    node.querySelector('.lottery-date').textContent = formatDate(item.date);
    if (item.online_date) {
      const onlineTime = item.online_time ? ` ${item.online_time}〜` : '';
      node.querySelector('.lottery-online-date').textContent = `${formatDate(item.online_date)}${onlineTime}`;
    } else {
      onlineSchedule.classList.add('hidden');
    }

    const stores = Array.isArray(item.stores) ? item.stores : [];
    if (stores.length) {
      stores.forEach((store) => {
        const chip = document.createElement('span');
        chip.className = 'store-chip';
        chip.textContent = store;
        storeList.appendChild(chip);
      });
    } else {
      const empty = document.createElement('span');
      empty.className = 'store-empty';
      empty.textContent = '取扱店情報は未掲載です';
      storeList.appendChild(empty);
    }

    if (item.thumbnail && !/1kuji\.com\/ogp\.jpg|ogp\.jpg|logo/i.test(item.thumbnail)) {
      thumb.src = item.thumbnail;
      thumb.alt = item.title;
    } else {
      thumb.parentElement.style.display = 'none';
    }

    if (item.url) {
      productLink.href = item.url;
      productLink.textContent = '商品ページ';
    } else {
      productLink.classList.add('hidden');
    }

    const officialShopUrl = item.shop_search_url || buildOfficialShopSearchUrl(item.url);
    if (officialShopUrl) {
      shopLink.href = officialShopUrl;
      shopLink.textContent = '公式店舗検索';
    } else {
      shopLink.classList.add('hidden');
    }

    if (item.online_url && item.online_url !== 'javascript:void(0)') {
      onlineLink.href = item.online_url;
      onlineLink.textContent = 'オンライン販売';
    } else {
      onlineLink.classList.add('hidden');
    }

    lotteryList.appendChild(node);
  });
}

async function loadData() {
  try {
    statusLabel.textContent = '取得中';
    const sourceUrl = buildSourceUrl(state.selectedYear, state.selectedMonth);
    const response = await fetch(`/api/lotteries?url=${encodeURIComponent(sourceUrl)}`);
    if (!response.ok) throw new Error('データの取得に失敗しました');

    const data = await response.json();
    state.items = Array.isArray(data.lotteries) ? data.lotteries : [];
    render();
  } catch (error) {
    statusLabel.textContent = 'エラー';
    lotteryList.innerHTML = `
      <div class="empty-state">
        データの読み込みに失敗しました。<br />
        ${error.message}
      </div>
    `;
  }
}

async function refreshFromSource() {
  try {
    statusLabel.textContent = '取得中';
    const sourceUrl = buildSourceUrl(state.selectedYear, state.selectedMonth);
    const response = await fetch(`/api/fetch?url=${encodeURIComponent(sourceUrl)}`, { method: 'POST' });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || '更新に失敗しました');
    }

    const data = await response.json();
    state.items = Array.isArray(data.lotteries) ? data.lotteries : [];
    render();
  } catch (error) {
    statusLabel.textContent = 'エラー';
    lotteryList.innerHTML = `
      <div class="empty-state">
        取得に失敗しました。<br />
        ${error.message}
      </div>
    `;
  }
}

function populateMonthSelectors() {
  if (yearSelect) {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 8 }, (_, index) => currentYear - 2 + index);
    yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
  }

  if (monthSelect) {
    monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return `<option value="${month}">${month}月</option>`;
    }).join('');
  }
}

state.favorites = getFavoriteTitles();
state.buyTargets = getBuyTargets();
state.selectedYear = getInitialYear();
state.selectedMonth = getInitialMonth();
state.selectedMode = getInitialMode();
persistMonthSelection(state.selectedYear, state.selectedMonth);
populateMonthSelectors();
persistMonthSelection(state.selectedYear, state.selectedMonth);
if (quickFilterButtons.length > 0) {
  quickFilterButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.selectedMode);
  });
}

if (yearSelect && monthSelect) {
  yearSelect.addEventListener('change', (event) => {
    const nextYear = Number(event.target.value || state.selectedYear);
    persistMonthSelection(nextYear, state.selectedMonth);
    loadData();
  });

  monthSelect.addEventListener('change', (event) => {
    const nextMonth = Number(event.target.value || state.selectedMonth);
    persistMonthSelection(state.selectedYear, nextMonth);
    loadData();
  });
}

if (favoriteInput && addFavoriteButton) {
  addFavoriteButton.addEventListener('click', () => {
    const title = favoriteInput.value.trim();
    if (!title) {
      favoriteInput.focus();
      return;
    }

    requestFavoriteNotifications();
    const nextFavorites = Array.from(new Set([...state.favorites, title])).slice(0, 12);
    persistFavoriteTitles(nextFavorites);
    favoriteInput.value = '';
    render();
  });

  favoriteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addFavoriteButton.click();
    }
  });
}

quickFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    persistMode(button.dataset.mode || 'all');
    render();
  });
});

if (refreshButton) {
  refreshButton.addEventListener('click', refreshFromSource);
}

const optionsPanel = document.querySelector('#options-panel');
const optionsMenuToggle = document.querySelector('#options-menu-toggle');
const sidebarToggle = document.querySelector('#sidebar-toggle');

function setOptionsPanelOpen(isOpen) {
  if (!optionsPanel || !optionsMenuToggle || !sidebarToggle) {
    return;
  }

  optionsPanel.classList.toggle('is-open', isOpen);
  optionsPanel.setAttribute('aria-hidden', String(!isOpen));
  optionsMenuToggle.setAttribute('aria-expanded', String(isOpen));
  optionsMenuToggle.setAttribute('aria-label', isOpen ? 'オプションを閉じる' : 'オプションを開く');
  sidebarToggle.setAttribute('aria-label', isOpen ? 'オプションを閉じる' : 'オプションを閉じる');
}

if (doubleChanceFetchButton) {
  doubleChanceFetchButton.addEventListener('click', fetchDoubleChanceCount);
}

if (optionsMenuToggle && optionsPanel && sidebarToggle) {
  optionsMenuToggle.addEventListener('click', () => {
    const isOpen = !optionsPanel.classList.contains('is-open');
    setOptionsPanelOpen(isOpen);
  });

  sidebarToggle.addEventListener('click', () => {
    setOptionsPanelOpen(false);
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    const clickedInsidePanel = optionsPanel.contains(target);
    const clickedToggle = optionsMenuToggle.contains(target);
    if (!clickedInsidePanel && !clickedToggle && optionsPanel.classList.contains('is-open')) {
      setOptionsPanelOpen(false);
    }
  });

  setOptionsPanelOpen(false);
}

renderDoubleChanceCount();
renderFavoriteChips();
loadData();
