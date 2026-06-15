/**
 * 高考志愿「四位一体」联动查询 — 应用逻辑
 * 处理Tab切换、搜索联想、结果渲染、二次穿透查询
 */
(function() {
  'use strict';

  // ============================================================
  // State
  // ============================================================
  const state = {
    currentTab: 'major',         // 'major' | 'university' | 'city' | 'industry'
    currentQuery: null,          // { type, id, entity } | null
    searchDebounceTimer: null
  };

  // ============================================================
  // DOM References
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    tabNav: $('#tabNav'),
    searchInput: $('#searchInput'),
    searchClear: $('#searchClear'),
    searchHint: $('#searchHint'),
    autocompleteDropdown: $('#autocompleteDropdown'),
    categoryIndex: $('#categoryIndex'),
    cityMatrix: $('#cityMatrix'),
    industryTree: $('#industryTree'),
    majorMatrix: $('#majorMatrix'),
    universityMatrix: $('#universityMatrix'),
    resultsSection: $('#resultsSection'),
    resultQueryBadge: $('#resultQueryBadge'),
    resultQueryName: $('#resultQueryName'),
    cardsGrid: $('#cardsGrid'),
    resultsReset: $('#resultsReset'),
    welcomeState: $('#welcomeState'),
  };

  // ============================================================
  // Tab Switching
  // ============================================================
  const TAB_CONFIG = {
    major: {
      placeholder: '输入专业名称，如「具身智能」「人工智能」「数字金融」...',
      hint: '💡 试试输入「智能」发现具身智能、商业人工智能等，或点击下方专业分类矩阵',
      showIndex: 'majorMatrix',
      resultBadgeClass: 'badge-major',
      resultBadgeText: '按专业查',
    },
    university: {
      placeholder: '输入大学名称，如「哈工大」「常州大学」「深职大」...',
      hint: '💡 支持全称或简称，如「哈工大」「北航」「清华」，或点击下方高校分层矩阵',
      showIndex: 'universityMatrix',
      resultBadgeClass: 'badge-university',
      resultBadgeText: '按高校查',
    },
    city: {
      placeholder: '输入城市名称，如「北京」「常州」「宁德」...',
      hint: '💡 搜索或点击下方城市卡片，打破GDP论，发现隐形冠军产业城市',
      showIndex: 'cityMatrix',
      resultBadgeClass: 'badge-city',
      resultBadgeText: '按城市查',
    },
    industry: {
      placeholder: '输入产业名称，如「新能源」「具身智能」「脑机接口」...',
      hint: '💡 搜索或展开下方产业纲目树，从大类到小类逐层穿透',
      showIndex: 'industryTree',
      resultBadgeClass: 'badge-industry',
      resultBadgeText: '按产业查',
    },
  };

  function switchTab(tab) {
    state.currentTab = tab;
    state.currentQuery = null;

    // Update tab buttons
    $$('.tab-btn').forEach(btn => btn.classList.remove('active'));
    $(`.tab-btn[data-tab="${tab}"]`).classList.add('active');

    // Update search
    const config = TAB_CONFIG[tab];
    dom.searchInput.placeholder = config.placeholder;
    dom.searchHint.innerHTML = config.hint;
    dom.searchInput.value = '';
    dom.autocompleteDropdown.classList.remove('visible');

    // Update category index
    hideAllIndexes();
    // Show the active index
    if (tab === 'major') {
      renderMajorMatrix();
      dom.majorMatrix.style.display = '';
    } else if (tab === 'university') {
      renderUniversityMatrix();
      dom.universityMatrix.style.display = '';
    } else if (tab === 'city') {
      renderCityMatrix();
      dom.cityMatrix.style.display = '';
    } else if (tab === 'industry') {
      renderIndustryTree();
      dom.industryTree.style.display = '';
    }

    // Hide results, show welcome
    dom.resultsSection.style.display = 'none';
    dom.welcomeState.style.display = '';
  }

  function hideAllIndexes() {
    [dom.cityMatrix, dom.industryTree, dom.majorMatrix, dom.universityMatrix].forEach(el => {
      if (el) el.style.display = 'none';
    });
  }

  // Initialize tab click handlers
  dom.tabNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  // ============================================================
  // City Matrix Rendering
  // ============================================================
  function renderCityMatrix() {
    const tierOrder = ['超一线', '一线', '新一线', '二线', '三线', '四线'];
    const tierColors = {
      '超一线': 'tier-super',
      '一线': 'tier-1',
      '新一线': 'tier-new1',
      '二线': 'tier-2',
      '三线': 'tier-3',
      '四线': 'tier-4',
    };

    const grouped = {};
    tierOrder.forEach(t => { grouped[t] = []; });
    CITIES.forEach(city => {
      if (grouped[city.tier]) {
        grouped[city.tier].push(city);
      }
    });

    dom.cityMatrix.innerHTML = tierOrder
      .filter(tier => grouped[tier].length > 0)
      .map(tier => `
        <div class="city-tier-group">
          <div class="city-tier-label">📍 ${tier}城市</div>
          <div class="city-tier-chips">
            ${grouped[tier].map(city => `
              <span class="city-chip" data-city-id="${city.id}" title="${city.description}">
                <span class="chip-tier-dot ${tierColors[tier] || ''}"></span>
                ${city.name}
                <span style="font-size:0.7rem;color:var(--color-text-muted);">${city.region}</span>
              </span>
            `).join('')}
          </div>
        </div>
      `).join('');

    // Click handler for city chips
    dom.cityMatrix.querySelectorAll('.city-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const city = CITY_MAP[chip.dataset.cityId];
        if (city) executeQuery('city', city.id, city);
      });
    });
  }

  // ============================================================
  // Major Matrix Rendering — grouped by discipline category
  // ============================================================
  function renderMajorMatrix() {
    // Group majors by category
    const grouped = {};
    MAJORS.forEach(m => {
      const cat = m.category || '其他';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(m);
    });

    // Sort categories: future/cross-discipline first, then by size
    const categoryOrder = Object.keys(grouped).sort((a, b) => {
      if (a.includes('未来') || a.includes('交叉')) return -1;
      if (b.includes('未来') || b.includes('交叉')) return 1;
      return grouped[b].length - grouped[a].length;
    });

    dom.majorMatrix.innerHTML = categoryOrder
      .filter(cat => grouped[cat].length > 0)
      .map(cat => `
        <div class="city-tier-group">
          <div class="city-tier-label">📚 ${cat} <span style="font-weight:400;opacity:0.6;">(${grouped[cat].length}个)</span></div>
          <div class="city-tier-chips">
            ${grouped[cat].map(m => `
              <span class="city-chip" data-major-id="${m.id}" title="${m.description || ''}">
                ${m.name}
                ${(m.tags || []).slice(0, 1).map(t => {
                  const emoji = t === '最热门' ? '🔥' : t === '最趋势' ? '📈' : t === '最有潜力' ? '🚀' : '📋';
                  return `<span style="font-size:0.65rem;">${emoji}</span>`;
                }).join('')}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('');

    // Click handler for major chips
    dom.majorMatrix.querySelectorAll('.city-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const major = MAJOR_MAP[chip.dataset.majorId];
        if (major) executeQuery('major', major.id, major);
      });
    });
  }

  // ============================================================
  // University Matrix Rendering — grouped by tier
  // ============================================================
  function renderUniversityMatrix() {
    const tierOrder = ['双一流/C9', '双一流', '普通本科', '高职/应用型本科', '高职专科'];
    const tierEmoji = {
      '双一流/C9': '⭐', '双一流': '🏅', '普通本科': '🎓',
      '高职/应用型本科': '🔧', '高职专科': '🛠️'
    };

    const grouped = {};
    tierOrder.forEach(t => { grouped[t] = []; });
    UNIVERSITIES.forEach(u => {
      const t = u.tier || '普通本科';
      if (grouped[t]) {
        grouped[t].push(u);
      } else {
        const matched = tierOrder.find(to => t.includes(to) || to.includes(t));
        if (matched) { grouped[matched].push(u); }
        else { if (!grouped['普通本科']) grouped['普通本科'] = []; grouped['普通本科'].push(u); }
      }
    });

    dom.universityMatrix.innerHTML = tierOrder
      .filter(tier => grouped[tier] && grouped[tier].length > 0)
      .map(tier => `
        <div class="city-tier-group">
          <div class="city-tier-label">${tierEmoji[tier] || ''} ${tier}层次 <span style="font-weight:400;opacity:0.6;">(${grouped[tier].length}所)</span></div>
          <div class="city-tier-chips">
            ${grouped[tier].map(u => `
              <span class="city-chip" data-uni-id="${u.id}" title="${u.description || ''}">
                ${u.name}
                <span style="font-size:0.65rem;color:var(--color-text-muted);">${u.province || ''}</span>
                ${(u.feature_tags || []).slice(0, 1).map(t => `<span style="font-size:0.6rem;color:var(--color-accent);">#${t}</span>`).join('')}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('');

    // Click handler for university chips
    dom.universityMatrix.querySelectorAll('.city-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const uni = UNI_MAP[chip.dataset.uniId];
        if (uni) executeQuery('university', uni.id, uni);
      });
    });
  }

  // ============================================================
  // Industry Tree Rendering
  // ============================================================
  function renderIndustryTree() {
    dom.industryTree.innerHTML = INDUSTRY_TREE.map(gang => `
      <div class="industry-gang" data-gang-id="${gang.id}">
        <div class="industry-gang-header" data-action="toggle-gang">
          <div class="industry-gang-icon">${gang.纲.charAt(0)}</div>
          <div class="industry-gang-info">
            <div class="industry-gang-name">${gang.纲}</div>
            <div class="industry-gang-desc">${gang.纲_desc}</div>
          </div>
          <span class="industry-gang-arrow">▾</span>
        </div>
        <div class="industry-mu-list">
          ${gang.目.map(mu => `
            <div class="industry-mu-item" data-ind-id="${mu.id}" data-action="query-industry">
              <span class="industry-mu-dot"></span>
              <span>${mu.name}</span>
              <span style="font-size:0.75rem;color:var(--color-text-muted);margin-left:auto;">${mu.description.substring(0, 20)}...</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Toggle gang expansion
    dom.industryTree.addEventListener('click', (e) => {
      const header = e.target.closest('.industry-gang-header');
      if (header && header.dataset.action === 'toggle-gang') {
        const gang = header.closest('.industry-gang');
        gang.classList.toggle('open');
      }

      const muItem = e.target.closest('.industry-mu-item');
      if (muItem) {
        const ind = IND_MAP[muItem.dataset.indId];
        if (ind) executeQuery('industry', ind.id, ind);
      }
    });

    // Default: open first gang
    const firstGang = dom.industryTree.querySelector('.industry-gang');
    if (firstGang) firstGang.classList.add('open');
  }

  // ============================================================
  // Search with Autocomplete
  // ============================================================
  dom.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(performSearch, 150);
  });

  dom.searchInput.addEventListener('focus', () => {
    if (dom.searchInput.value.trim().length > 0) {
      performSearch();
    }
  });

  dom.searchClear.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.autocompleteDropdown.classList.remove('visible');
    dom.searchInput.focus();
  });

  // Close autocomplete when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      dom.autocompleteDropdown.classList.remove('visible');
    }
  });

  function performSearch() {
    const query = dom.searchInput.value.trim().toLowerCase();
    if (query.length === 0) {
      dom.autocompleteDropdown.classList.remove('visible');
      return;
    }

    // Fuzzy search across all entities
    const results = fuzzySearch(query, SEARCH_INDEX, 12);

    if (results.length === 0) {
      dom.autocompleteDropdown.innerHTML = `
        <div style="padding:16px;text-align:center;color:var(--color-text-muted);">
          未找到匹配结果，试试其他关键词
        </div>`;
      dom.autocompleteDropdown.classList.add('visible');
      return;
    }

    dom.autocompleteDropdown.innerHTML = results.map(r => {
      const iconMap = {
        major: { icon: '📚', cls: 'type-major', label: '专业' },
        university: { icon: '🏫', cls: 'type-university', label: '高校' },
        city: { icon: '🏙️', cls: 'type-city', label: '城市' },
        industry: { icon: '🏭', cls: 'type-industry', label: '产业' },
      };
      const meta = iconMap[r.type];
      let subtitle = '';
      if (r.type === 'major') {
        subtitle = `${r.entity.category} · ${(r.entity.tags || []).join(' / ')}`;
      } else if (r.type === 'university') {
        subtitle = `${r.entity.tier} · ${r.entity.location ? CITY_MAP[r.entity.location]?.name || '' : ''}`;
      } else if (r.type === 'city') {
        subtitle = `${r.entity.tier} · ${r.entity.region}`;
      } else if (r.type === 'industry') {
        subtitle = `纲：${r.entity.纲_name}`;
      }

      return `
        <div class="autocomplete-item" data-type="${r.type}" data-id="${r.id}">
          <div class="ac-icon ${meta.cls}">${meta.icon}</div>
          <div class="ac-info">
            <div class="ac-name">${highlightMatch(r.entity.name || r.keyword, query)}</div>
            <div class="ac-meta">${meta.label} · ${subtitle}</div>
          </div>
        </div>
      `;
    }).join('');

    dom.autocompleteDropdown.classList.add('visible');

    // Bind click handlers
    dom.autocompleteDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        const id = item.dataset.id;
        const entity = getEntityById(type, id);
        if (entity) {
          dom.autocompleteDropdown.classList.remove('visible');
          dom.searchInput.value = entity.name;
          executeQuery(type, id, entity);
        }
      });
    });
  }

  function fuzzySearch(query, index, limit) {
    const queryLower = query.toLowerCase();
    const scored = [];

    for (const entry of index) {
      const keyword = entry.keyword.toLowerCase();
      let score = 0;

      // Exact match
      if (keyword === queryLower) {
        score = 100;
      }
      // Starts with query
      else if (keyword.startsWith(queryLower)) {
        score = 80;
      }
      // Contains query
      else if (keyword.includes(queryLower)) {
        score = 60;
      }
      // Character-by-character fuzzy (all query chars appear in order)
      else {
        let qi = 0;
        for (let ki = 0; ki < keyword.length && qi < queryLower.length; ki++) {
          if (keyword[ki] === queryLower[qi]) qi++;
        }
        if (qi === queryLower.length) {
          score = 30;
        }
      }

      if (score > 0) {
        scored.push({ ...entry, score });
      }
    }

    // Sort by score descending, deduplicate by entity id
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const unique = [];
    for (const item of scored) {
      const key = `${item.type}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
        if (unique.length >= limit) break;
      }
    }

    return unique;
  }

  function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    const before = escapeHtml(text.substring(0, idx));
    const match = escapeHtml(text.substring(idx, idx + query.length));
    const after = escapeHtml(text.substring(idx + query.length));
    return `${before}<mark style="background:#fde68a;padding:0 2px;border-radius:2px;">${match}</mark>${after}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getEntityById(type, id) {
    switch (type) {
      case 'major': return MAJOR_MAP[id];
      case 'university': return UNI_MAP[id];
      case 'city': return CITY_MAP[id];
      case 'industry': return IND_MAP[id];
      default: return null;
    }
  }

  // ============================================================
  // Query Execution — the core cross-linking logic
  // ============================================================
  function executeQuery(type, id, entity) {
    state.currentQuery = { type, id, entity };
    dom.welcomeState.style.display = 'none';

    // Update search input
    dom.searchInput.value = entity.name || '';

    // Switch to the correct tab
    const tabMap = { major: 'major', university: 'university', city: 'city', industry: 'industry' };
    if (state.currentTab !== tabMap[type]) {
      state.currentTab = tabMap[type];
      $$('.tab-btn').forEach(btn => btn.classList.remove('active'));
      const targetBtn = $(`.tab-btn[data-tab="${tabMap[type]}"]`);
      if (targetBtn) targetBtn.classList.add('active');
      hideAllIndexes();
      if (tabMap[type] === 'major') { renderMajorMatrix(); dom.majorMatrix.style.display = ''; }
      if (tabMap[type] === 'university') { renderUniversityMatrix(); dom.universityMatrix.style.display = ''; }
      if (tabMap[type] === 'city') { renderCityMatrix(); dom.cityMatrix.style.display = ''; }
      if (tabMap[type] === 'industry') { renderIndustryTree(); dom.industryTree.style.display = ''; }
    }

    // Update result header
    const config = TAB_CONFIG[tabMap[type]];
    dom.resultQueryBadge.className = `results-query-badge ${config.resultBadgeClass}`;
    dom.resultQueryBadge.textContent = config.resultBadgeText;
    dom.resultQueryName.textContent = `「${entity.name}」的联动查询结果`;

    // Build & render cards
    renderResults(type, entity);

    // Show results
    dom.resultsSection.style.display = '';
    dom.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderResults(type, entity) {
    let cards = [];

    switch (type) {
      case 'major':
        cards = buildMajorCards(entity);
        break;
      case 'university':
        cards = buildUniversityCards(entity);
        break;
      case 'city':
        cards = buildCityCards(entity);
        break;
      case 'industry':
        cards = buildIndustryCards(entity);
        break;
    }

    dom.cardsGrid.innerHTML = cards.map(card => renderCard(card)).join('');

    // Bind secondary click-throughs
    bindCardClickHandlers();
  }

  // ---- Build Card Configs by Query Type ----

  function buildMajorCards(major) {
    const relatedMajors = (major.related_majors || []).map(id => MAJOR_MAP[id]).filter(Boolean);
    const relatedUnis = (major.related_universities || []).map(id => UNI_MAP[id]).filter(Boolean);
    const relatedCities = (major.related_cities || []).map(id => CITY_MAP[id]).filter(Boolean);
    const relatedInds = (major.related_industries || []).map(id => IND_MAP[id]).filter(Boolean);

    return [
      {
        icon: '📚', iconClass: 'ci-major', title: '相近专业群',
        items: relatedMajors.map(m => ({
          type: 'major', id: m.id, name: m.name,
          subtitle: `${m.category}`,
          tags: m.tags || [],
          desc: m.description?.substring(0, 60) + '...'
        })),
        emptyMsg: '暂无相近专业数据'
      },
      {
        icon: '🏫', iconClass: 'ci-university', title: '优势院校（分层排列）',
        items: relatedUnis.map(u => ({
          type: 'university', id: u.id, name: u.name,
          subtitle: u.tier,
          tags: u.feature_tags?.slice(0, 3) || [],
          desc: u.description?.substring(0, 80) + '...',
          tier: u.tier
        })),
        emptyMsg: '暂无推荐院校数据',
        groupByTier: true
      },
      {
        icon: '🏙️', iconClass: 'ci-city', title: '推荐就业城市',
        items: relatedCities.map(c => ({
          type: 'city', id: c.id, name: c.name,
          subtitle: `${c.tier} · ${c.region}`,
          tags: c.core_industries?.slice(0, 3) || [],
          desc: c.policy_notes || c.enterprise_count_note || ''
        })),
        emptyMsg: '暂无推荐城市数据'
      },
      {
        icon: '🏭', iconClass: 'ci-industry', title: '产业图谱归属',
        items: relatedInds.map(ind => ({
          type: 'industry', id: ind.id, name: ind.name,
          subtitle: `纲：${ind.纲_name}`,
          tags: [],
          desc: ind.description?.substring(0, 60) + '...'
        })),
        emptyMsg: '暂无产业关联数据'
      }
    ];
  }

  function buildUniversityCards(uni) {
    const relatedMajors = (uni.flagship_majors || []).map(id => MAJOR_MAP[id]).filter(Boolean);
    // Derive cities from those majors
    const cityIds = new Set();
    relatedMajors.forEach(m => (m.related_cities || []).forEach(cid => cityIds.add(cid)));
    const relatedCities = [...cityIds].map(id => CITY_MAP[id]).filter(Boolean);
    const relatedInds = (uni.related_industries || []).map(id => IND_MAP[id]).filter(Boolean);

    return [
      {
        icon: '📚', iconClass: 'ci-major', title: '优势/特色专业',
        items: relatedMajors.map(m => ({
          type: 'major', id: m.id, name: m.name,
          subtitle: m.category,
          tags: m.tags || [],
          desc: m.description?.substring(0, 60) + '...'
        })),
        emptyMsg: '暂无专业数据'
      },
      {
        icon: '🏙️', iconClass: 'ci-city', title: '就业集聚城市',
        items: relatedCities.map(c => ({
          type: 'city', id: c.id, name: c.name,
          subtitle: `${c.tier} · ${c.region}`,
          tags: c.core_industries?.slice(0, 3) || [],
          desc: c.policy_notes || c.enterprise_count_note || ''
        })),
        emptyMsg: '暂无就业城市数据'
      },
      {
        icon: '🏭', iconClass: 'ci-industry', title: '对应支撑产业',
        items: relatedInds.map(ind => ({
          type: 'industry', id: ind.id, name: ind.name,
          subtitle: `纲：${ind.纲_name}`,
          tags: [],
          desc: ind.description?.substring(0, 60) + '...'
        })),
        emptyMsg: '暂无产业关联数据'
      },
      {
        icon: '🏷️', iconClass: 'ci-university', title: '学校特色标签',
        items: (uni.feature_tags || []).map((tag, i) => ({
          type: null, id: null, name: tag,
          subtitle: '',
          tags: [],
          desc: '',
          isTag: true
        })),
        emptyMsg: '暂无特色标签'
      }
    ];
  }

  function buildCityCards(city) {
    const relatedUnis = (city.related_universities || []).map(id => UNI_MAP[id]).filter(Boolean);
    const relatedMajors = (city.related_majors || []).map(id => MAJOR_MAP[id]).filter(Boolean);
    const relatedInds = (city.related_industries || []).map(id => IND_MAP[id]).filter(Boolean);

    return [
      {
        icon: '🏭', iconClass: 'ci-industry', title: '核心优势产业（纲目结构）',
        items: relatedInds.map(ind => ({
          type: 'industry', id: ind.id, name: ind.name,
          subtitle: `纲：${ind.纲_name}`,
          tags: [],
          desc: ind.description?.substring(0, 60) + '...'
        })),
        emptyMsg: '暂无产业数据'
      },
      {
        icon: '🏫', iconClass: 'ci-university', title: '本地/定向输送特色大学',
        items: relatedUnis.map(u => ({
          type: 'university', id: u.id, name: u.name,
          subtitle: u.tier,
          tags: u.feature_tags?.slice(0, 3) || [],
          desc: u.description?.substring(0, 80) + '...',
          tier: u.tier
        })),
        emptyMsg: '暂无关联高校数据'
      },
      {
        icon: '📚', iconClass: 'ci-major', title: '对应对口专业清单',
        items: relatedMajors.map(m => ({
          type: 'major', id: m.id, name: m.name,
          subtitle: m.category,
          tags: m.tags || [],
          desc: m.description?.substring(0, 60) + '...'
        })),
        emptyMsg: '暂无对口专业数据'
      },
      {
        icon: '📊', iconClass: 'ci-city', title: '城市产业亮点',
        items: (city.core_industries || []).map(indName => ({
          type: null, id: null, name: indName,
          subtitle: '核心支柱产业',
          tags: [],
          desc: '',
          isTag: true
        })),
        emptyMsg: '暂无产业数据',
        extraNote: city.policy_notes ? `<div style="font-size:0.78rem;color:var(--color-text-muted);padding:8px 12px;margin-top:4px;background:var(--color-bg);border-radius:6px;">📌 ${city.policy_notes}</div>` : ''
      }
    ];
  }

  function buildIndustryCards(ind) {
    // Representative cities for this industry
    const repCities = (ind.representative_cities || []).map(rc => {
      const city = CITY_MAP[rc.cityId];
      return city ? { type: 'city', id: city.id, name: city.name, subtitle: `${city.tier} · ${city.region}`, desc: rc.note, tags: [], extraCityNote: rc.note } : null;
    }).filter(Boolean);

    const relatedUnis = (ind.related_universities || []).map(id => UNI_MAP[id]).filter(Boolean);
    const relatedMajors = (ind.related_majors || []).map(id => MAJOR_MAP[id]).filter(Boolean);

    return [
      {
        icon: '🏙️', iconClass: 'ci-city', title: '中/美/全球产业链聚集代表城市',
        items: repCities.map(c => ({
          type: 'city', id: c.id, name: c.name,
          subtitle: c.subtitle,
          tags: [],
          desc: c.extraCityNote || c.desc || ''
        })),
        emptyMsg: '暂无城市数据'
      },
      {
        icon: '🏫', iconClass: 'ci-university', title: '产学研融合核心大学',
        items: relatedUnis.map(u => ({
          type: 'university', id: u.id, name: u.name,
          subtitle: u.tier,
          tags: u.feature_tags?.slice(0, 3) || [],
          desc: u.description?.substring(0, 80) + '...',
          tier: u.tier
        })),
        emptyMsg: '暂无核心大学数据'
      },
      {
        icon: '📚', iconClass: 'ci-major', title: '精准匹配专业',
        items: relatedMajors.map(m => ({
          type: 'major', id: m.id, name: m.name,
          subtitle: m.category,
          tags: m.tags || [],
          desc: m.description?.substring(0, 60) + '...'
        })),
        emptyMsg: '暂无匹配专业数据'
      },
      {
        icon: '📋', iconClass: 'ci-industry', title: '产业信息',
        items: [],
        emptyMsg: '暂无额外信息',
        extraContent: `
          <div style="padding:8px 0;">
            <div style="font-size:0.85rem;color:var(--color-text-secondary);margin-bottom:6px;">
              📂 产业纲目归属：<span class="tag tag-gang">${escapeHtml(ind.纲_name)}</span> → <strong>${escapeHtml(ind.name)}</strong>
            </div>
            <div style="font-size:0.8rem;color:var(--color-text-muted);line-height:1.5;">
              ${escapeHtml(ind.description || (ind.纲_desc || ''))}
            </div>
          </div>
        `
      }
    ];
  }

  // ---- Render Single Card ----
  function renderCard(card) {
    let bodyHtml = '';

    if (card.extraContent) {
      bodyHtml += card.extraContent;
    }

    if (card.items.length === 0 && !card.extraContent) {
      bodyHtml += `<div style="padding:20px;text-align:center;color:var(--color-text-muted);font-size:0.85rem;">${card.emptyMsg || '暂无数据'}</div>`;
    } else if (card.groupByTier) {
      // Group universities by tier
      const tierOrder = ['双一流/C9', '双一流', '普通本科', '高职/应用型本科', '高职专科'];
      const grouped = {};
      tierOrder.forEach(t => { grouped[t] = []; });

      card.items.forEach(item => {
        const t = item.tier || '普通本科';
        if (grouped[t]) {
          grouped[t].push(item);
        } else {
          // Try to find best match
          const matchedTier = tierOrder.find(to => t.includes(to) || to.includes(t));
          if (matchedTier) {
            grouped[matchedTier].push(item);
          } else {
            if (!grouped['普通本科']) grouped['普通本科'] = [];
            grouped['普通本科'].push(item);
          }
        }
      });

      tierOrder.forEach(tier => {
        if (grouped[tier] && grouped[tier].length > 0) {
          bodyHtml += `<div class="section-label">${tier}</div>`;
          grouped[tier].forEach(item => {
            bodyHtml += renderEntityItem(item);
          });
        }
      });
    } else {
      card.items.forEach(item => {
        bodyHtml += renderEntityItem(item);
      });
    }

    if (card.extraNote) {
      bodyHtml += card.extraNote;
    }

    return `
      <div class="card fade-in">
        <div class="card-header">
          <div class="card-icon ${card.iconClass}">${card.icon}</div>
          <div class="card-title">${card.title}</div>
          <div class="card-count">${card.items.length}项</div>
        </div>
        <div class="card-body">
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  function renderEntityItem(item) {
    if (item.isTag) {
      return `
        <div class="entity-item">
          <span class="tag tag-feature" style="font-size:0.82rem;">${escapeHtml(item.name)}</span>
        </div>
      `;
    }

    const clickable = item.type ? 'clickable' : '';
    const tagsHtml = (item.tags || []).map(t => {
      const cls = t === '最热门' ? 'tag-hot' : t === '最趋势' ? 'tag-trend' : t === '最有潜力' ? 'tag-potential' : t === '最常见' ? 'tag-common' : 'tag-feature';
      return `<span class="tag ${cls}">${escapeHtml(t)}</span>`;
    }).join('');

    return `
      <div class="entity-item ${clickable}" data-entity-type="${item.type || ''}" data-entity-id="${item.id || ''}">
        <div class="entity-rank">${item.type === 'university' ? '🏫' : item.type === 'major' ? '📚' : item.type === 'city' ? '🏙️' : item.type === 'industry' ? '🏭' : '📌'}</div>
        <div class="entity-info">
          <div class="entity-name">
            ${escapeHtml(item.name)}
            ${item.subtitle ? `<span style="font-size:0.72rem;color:var(--color-text-muted);font-weight:400;">· ${escapeHtml(item.subtitle)}</span>` : ''}
            ${tagsHtml}
          </div>
          ${item.desc ? `<div class="entity-desc">${escapeHtml(item.desc)}</div>` : ''}
        </div>
      </div>
    `;
  }

  // ---- Secondary Click-through ----
  function bindCardClickHandlers() {
    dom.cardsGrid.querySelectorAll('.entity-item.clickable').forEach(el => {
      el.addEventListener('click', () => {
        const type = el.dataset.entityType;
        const id = el.dataset.entityId;
        if (!type || !id) return;

        const entity = getEntityById(type, id);
        if (entity) {
          executeQuery(type, id, entity);
          // Scroll back to results
          setTimeout(() => {
            dom.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }
      });
    });
  }

  // ============================================================
  // ============================================================
  // Reset
  // ============================================================
  dom.resultsReset.addEventListener('click', () => {
    state.currentQuery = null;
    dom.searchInput.value = '';
    dom.resultsSection.style.display = 'none';
    dom.welcomeState.style.display = '';
    dom.autocompleteDropdown.classList.remove('visible');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ============================================================
  // Keyboard Navigation
  // ============================================================
  dom.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dom.autocompleteDropdown.classList.remove('visible');
      dom.searchInput.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const query = dom.searchInput.value.trim();
      if (!query) return;

      // Try exact match first by type
      const tabTypeMap = {
        major: 'major', university: 'university', city: 'city', industry: 'industry'
      };
      const searchType = tabTypeMap[state.currentTab];

      // Search in current tab's domain first
      let collection;
      switch (searchType) {
        case 'major': collection = MAJORS; break;
        case 'university': collection = UNIVERSITIES; break;
        case 'city': collection = CITIES; break;
        case 'industry': collection = INDUSTRIES_FLAT; break;
      }

      // Try exact match
      let found = collection.find(e => e.name === query);
      // Try case-insensitive startsWith
      if (!found) {
        found = collection.find(e => e.name.toLowerCase().startsWith(query.toLowerCase()));
      }
      // Try shortName for universities
      if (!found && searchType === 'university') {
        found = UNIVERSITIES.find(e => e.shortName && e.shortName.toLowerCase().startsWith(query.toLowerCase()));
      }
      // Try includes
      if (!found) {
        found = collection.find(e => e.name.toLowerCase().includes(query.toLowerCase()));
      }

      if (found) {
        executeQuery(searchType, found.id, found);
        dom.autocompleteDropdown.classList.remove('visible');
      } else {
        // Cross-type search
        const results = fuzzySearch(query, SEARCH_INDEX, 1);
        if (results.length > 0) {
          const r = results[0];
          executeQuery(r.type, r.id, r.entity);
          dom.autocompleteDropdown.classList.remove('visible');
        }
      }
    }
  });

  // ============================================================
  // Initialization
  // ============================================================
  function init() {
    // Start on major tab
    switchTab('major');

    // Pre-render all indexes for instant tab switching
    renderMajorMatrix();
    renderUniversityMatrix();
    renderCityMatrix();
    renderIndustryTree();
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
