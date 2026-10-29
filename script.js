(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);

  function initTheme() {
    const button = byId('theme-toggle');
    const label = byId('theme-label');
    const symbol = byId('theme-symbol');
    const themes = [
      { value: 'system', label: '跟随系统', symbol: '◐' },
      { value: 'light', label: '浅色模式', symbol: '○' },
      { value: 'dark', label: '深色模式', symbol: '●' }
    ];
    let current = themes.findIndex((theme) => theme.value === document.documentElement.dataset.theme);
    if (current < 0) current = 0;

    function applyTheme() {
      const theme = themes[current];
      const next = themes[(current + 1) % themes.length];
      document.documentElement.dataset.theme = theme.value;
      label.textContent = theme.label;
      symbol.textContent = theme.symbol;
      button.setAttribute('aria-label', `当前${theme.label}，切换为${next.label}`);
      button.title = `当前${theme.label}，点击切换为${next.label}`;
    }

    applyTheme();
    button.hidden = false;
    button.addEventListener('click', () => {
      current = (current + 1) % themes.length;
      applyTheme();
      try {
        localStorage.setItem('flower-jie-theme', themes[current].value);
      } catch (_) { /* Theme switching also works when persistence is unavailable. */ }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== 'flower-jie-theme' && event.key !== null) return;
      const nextIndex = themes.findIndex((theme) => theme.value === event.newValue);
      current = nextIndex < 0 ? 0 : nextIndex;
      applyTheme();
    });
  }

  function initNavigation() {
    const header = byId('site-header');
    const navigation = byId('navigation');
    const toggle = byId('nav-toggle');
    const label = byId('nav-toggle-label');
    let open = false;

    function setOpen(value, returnFocus = false) {
      open = value;
      header.dataset.navOpen = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      label.textContent = open ? '关闭导航菜单' : '打开导航菜单';
      if (returnFocus) toggle.focus();
    }

    header.dataset.navReady = 'true';
    toggle.hidden = false;
    setOpen(false);
    toggle.addEventListener('click', () => setOpen(!open));
    navigation.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || !open) return;
      setOpen(false);
      // Native fragment navigation still controls scrolling and URL history.
      const target = byId(link.getAttribute('href').slice(1));
      if (target) target.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && open) {
        setOpen(false, true);
        event.preventDefault();
      }
    });
    if (typeof window.matchMedia === 'function') {
      const mobile = window.matchMedia('(max-width: 700px)');
      const onBreakpoint = () => {
        const focusWasInMenu = navigation.contains(document.activeElement);
        setOpen(false, mobile.matches && focusWasInMenu);
      };
      if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', onBreakpoint);
      else if (typeof mobile.addListener === 'function') mobile.addListener(onBreakpoint);
    }
  }

  const elements = {
    query: byId('project-query'),
    search: byId('project-search'),
    clear: byId('clear-search'),
    filters: byId('category-filters'),
    results: byId('project-results'),
    summary: byId('results-summary'),
    grid: byId('project-grid'),
    loading: byId('project-loading'),
    empty: byId('project-empty'),
    emptyTitle: byId('empty-title'),
    emptyDescription: byId('empty-description'),
    reset: byId('reset-filters'),
    error: byId('project-error'),
    retry: byId('retry-projects')
  };
  const state = { projects: [], categories: [], selected: 'all', query: '', loading: false };
  const filterElements = new Map();
  const accents = new Set(['orange', 'blue', 'green', 'ochre', 'neutral']);
  const platforms = [
    { key: 'github', label: 'GitHub' },
    { key: 'gitee', label: 'Gitee' }
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function requiredText(value, field, maxLength = 2000) {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
      throw new Error(`Invalid project data field: ${field}`);
    }
    return value.trim();
  }

  function validId(value, field) {
    const id = requiredText(value, field, 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id === 'all') {
      throw new Error(`Invalid project data identifier: ${field}`);
    }
    return id;
  }

  function textList(value, field) {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`Invalid project data list: ${field}`);
    return [...new Set(value.map((item) => requiredText(item, field, 100)))];
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function safeExternalUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      // No base URL: relative, protocol-relative and non-HTTP URLs are rejected.
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function normalizeText(value) {
    return value.normalize('NFKC').toLocaleLowerCase().trim();
  }

  function parseProjectData(data) {
    if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.projects)) {
      throw new Error('Unsupported projects.json structure or schemaVersion');
    }
    const categoryIds = new Set();
    const categories = data.categories.map((category) => {
      if (!isRecord(category)) throw new Error('Invalid category');
      const id = validId(category.id, 'category.id');
      if (categoryIds.has(id)) throw new Error('Duplicate category identifier');
      categoryIds.add(id);
      return { id, label: requiredText(category.label, 'category.label', 80) };
    });
    const projectIds = new Set();
    const projects = data.projects.map((project) => {
      if (!isRecord(project)) throw new Error('Invalid project');
      const id = validId(project.id, 'project.id');
      if (projectIds.has(id)) throw new Error('Duplicate project identifier');
      projectIds.add(id);
      const projectCategories = textList(project.categories, 'project.categories');
      if (projectCategories.some((category) => !categoryIds.has(category))) {
        throw new Error('Project references an undefined category');
      }
      const name = requiredText(project.name, 'project.name', 160);
      const description = requiredText(project.description, 'project.description');
      const technologies = textList(project.technologies, 'project.technologies');
      if (!isRecord(project.links)) throw new Error('Invalid project links');
      if (project.featured !== undefined && typeof project.featured !== 'boolean') throw new Error('Invalid featured flag');
      const links = platforms.map((platform) => ({
        label: platform.label,
        url: safeExternalUrl(project.links[platform.key])
      }));
      const searchText = normalizeText([name, id, description, ...technologies].join(' '));
      return {
        id,
        name,
        description,
        technologies,
        categories: projectCategories,
        kind: requiredText(project.kind, 'project.kind', 80),
        status: requiredText(project.status, 'project.status', 80),
        visibility: requiredText(project.visibility, 'project.visibility', 160),
        featured: project.featured === true,
        mark: typeof project.mark === 'string' && project.mark.trim() ? project.mark.trim().slice(0, 8) : '</>',
        accent: accents.has(project.accent) ? project.accent : 'neutral',
        links,
        searchText,
        compactSearchText: searchText.replace(/\s+/g, '')
      };
    });
    return { categories, projects };
  }

  function buildProjectCard(project) {
    const item = element('li', project.featured ? 'project-item project-item--featured' : 'project-item');
    const card = element('article', `project-card card-accent-${project.accent}${project.featured ? ' project-card--featured' : ''}`);
    card.id = `project-${project.id}`;
    const titleId = `project-title-${project.id}`;
    card.setAttribute('aria-labelledby', titleId);
    const top = element('div', 'card-top');
    const mark = element('span', 'card-mark', project.mark);
    mark.setAttribute('aria-hidden', 'true');
    const badges = element('div', 'card-badges');
    badges.append(element('span', 'card-status', project.status), element('span', 'card-kind', project.kind));
    top.append(mark, badges);

    const body = element('div', 'card-body');
    const title = element('h3', '', project.name);
    title.id = titleId;
    body.append(element('span', 'card-project-id', project.id), title, element('p', 'card-description', project.description));
    const categories = element('div', 'card-categories');
    categories.setAttribute('aria-label', '项目分类');
    for (const id of project.categories) {
      const category = state.categories.find((entry) => entry.id === id);
      categories.append(element('span', 'card-category', category.label));
    }
    const technologies = element('ul', 'card-technologies');
    technologies.setAttribute('aria-label', '技术栈');
    technologies.setAttribute('role', 'list');
    for (const technology of project.technologies) technologies.append(element('li', '', technology));
    body.append(categories, technologies);

    const footer = element('footer', 'card-footer');
    footer.append(element('p', 'card-visibility', project.visibility));
    const links = element('div', 'card-links');
    for (const source of project.links) {
      if (!source.url) {
        links.append(element('span', 'link-unavailable', `${source.label} 暂未配置`));
        continue;
      }
      const link = element('a', 'source-link', source.label);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `${project.name} 的 ${source.label} 源码（新窗口打开）`);
      const arrow = element('span', '', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      link.append(arrow);
      links.append(link);
    }
    footer.append(links);
    card.append(top, body, footer);
    item.append(card);
    return item;
  }

  function buildFilters() {
    filterElements.clear();
    const fragment = document.createDocumentFragment();
    for (const category of [{ id: 'all', label: '全部项目' }, ...state.categories]) {
      const button = element('button', 'filter-button');
      button.type = 'button';
      button.setAttribute('aria-controls', 'project-grid');
      const count = element('span', 'filter-count', '0');
      count.setAttribute('aria-hidden', 'true');
      button.append(element('span', '', category.label), count);
      button.addEventListener('click', () => {
        state.selected = category.id;
        renderProjects();
      });
      filterElements.set(category.id, { button, count, label: category.label });
      fragment.append(button);
    }
    elements.filters.replaceChildren(fragment);
  }

  function renderProjects() {
    const terms = normalizeText(state.query).split(/\s+/).filter(Boolean);
    const searched = state.projects.filter((project) => terms.every((term) =>
      project.searchText.includes(term) || project.compactSearchText.includes(term)
    ));
    const visible = searched.filter((project) => state.selected === 'all' || project.categories.includes(state.selected));
    const fragment = document.createDocumentFragment();
    for (const project of visible) fragment.append(buildProjectCard(project));
    elements.grid.replaceChildren(fragment);
    elements.grid.hidden = visible.length === 0;
    elements.empty.hidden = visible.length !== 0;

    // Counts follow the current query; filtering never recreates the focused button.
    for (const [id, entry] of filterElements) {
      const count = id === 'all' ? searched.length : searched.filter((project) => project.categories.includes(id)).length;
      entry.count.textContent = String(count);
      entry.button.setAttribute('aria-pressed', String(state.selected === id));
      entry.button.setAttribute('aria-label', `${entry.label}，${count} 个项目`);
    }
    const selected = state.categories.find((category) => category.id === state.selected);
    elements.summary.textContent = `正在显示 ${visible.length} / ${state.projects.length} 个项目${selected ? ` · ${selected.label}` : ''}${state.query.trim() ? ` · “${state.query.trim()}”` : ''}`;
    elements.clear.hidden = state.query.length === 0;
    const noProjects = state.projects.length === 0;
    elements.emptyTitle.textContent = noProjects ? '项目档案正在整理中' : '还没有找到这个方向的项目';
    elements.emptyDescription.textContent = noProjects ? '新的学习实践会陆续记录在这里，也欢迎到 GitHub 或 Gitee 看看。' : '试试其他关键词，或回到全部项目继续看看。';
    elements.reset.hidden = noProjects;
  }

  async function loadProjects(fromRetry = false) {
    if (state.loading) return;
    state.loading = true;
    elements.results.setAttribute('aria-busy', 'true');
    elements.query.disabled = true;
    elements.retry.disabled = true;
    elements.loading.hidden = false;
    elements.error.hidden = true;
    elements.empty.hidden = true;
    elements.grid.hidden = true;
    elements.clear.hidden = true;
    elements.summary.textContent = '正在读取项目档案…';
    for (const entry of filterElements.values()) entry.button.disabled = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let loaded = false;
    try {
      const response = await fetch('./projects.json', { signal: controller.signal, cache: 'no-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Project data HTTP status: ${response.status}`);
      const data = parseProjectData(await response.json());
      state.categories = data.categories;
      state.projects = data.projects;
      if (!state.categories.some((category) => category.id === state.selected)) state.selected = 'all';
      buildFilters();
      renderProjects();
      loaded = true;
    } catch (_) {
      elements.grid.replaceChildren();
      elements.filters.replaceChildren();
      filterElements.clear();
      elements.error.hidden = false;
      elements.summary.textContent = '项目加载失败。可使用“重新加载”按钮再试一次。';
    } finally {
      window.clearTimeout(timeout);
      state.loading = false;
      elements.results.setAttribute('aria-busy', 'false');
      elements.loading.hidden = true;
      elements.query.disabled = !loaded;
      elements.retry.disabled = false;
      if (fromRetry) (loaded ? elements.query : elements.retry).focus({ preventScroll: true });
    }
  }

  function updateQuery(value) {
    state.query = value;
    renderProjects();
  }

  elements.search.addEventListener('submit', (event) => event.preventDefault());
  elements.query.addEventListener('input', () => updateQuery(elements.query.value));
  elements.clear.addEventListener('click', () => {
    elements.query.value = '';
    updateQuery('');
    elements.query.focus();
  });
  elements.reset.addEventListener('click', () => {
    state.selected = 'all';
    elements.query.value = '';
    updateQuery('');
    elements.query.focus();
  });
  elements.retry.addEventListener('click', () => loadProjects(true));

  initTheme();
  initNavigation();
  byId('current-year').textContent = String(new Date().getFullYear());
  loadProjects();
})();
