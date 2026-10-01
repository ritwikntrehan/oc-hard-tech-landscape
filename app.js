
const DATA = {
  companies: [],
  mapPoints: [],
  facets: {},
  config: {},
  manifest: {}
};

const state = {
  search: "",
  sector: "",
  city: "",
  maturity: "",
  ownership: "",
  capability: "",
  view: "explore",
  sort: "name",
  selectedCompany: null,
  selectedCapability: null,
  eventType: ""
};

let map;
let cityLayer;

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(v) {
  if (v === null || v === undefined || v === "") return "Not public";
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function display(value, fallback = "Not verified") {
  return value === null || value === undefined || value === "" ? fallback : esc(value);
}

function populateSelect(id, values) {
  const el = $(id);
  for (const v of values) {
    const option = document.createElement("option");
    option.value = v;
    option.textContent = v;
    el.appendChild(option);
  }
}

function normalizeSearch(company) {
  return [
    company.name,
    company.primary_location?.city,
    company.classification?.sector_group,
    company.classification?.primary_sector,
    company.profile?.product_platform_summary,
    company.profile?.capability_summary,
    ...(company.profile?.manufacturing_processes ?? []),
    ...(company.capabilities ?? []).map(c => c.tag),
    ...(company.products ?? []).map(p => p.name)
  ].filter(Boolean).join(" ").toLowerCase();
}

function filteredCompanies() {
  const q = state.search.trim().toLowerCase();
  let rows = DATA.companies.filter(c => {
    if (state.sector && c.classification.sector_group !== state.sector) return false;
    if (state.city && c.primary_location.city !== state.city) return false;
    if (state.maturity && c.classification.maturity !== state.maturity) return false;
    if (state.ownership && c.classification.ownership !== state.ownership) return false;
    if (state.capability && !(c.capabilities || []).some(x => x.tag === state.capability)) return false;
    if (q && !normalizeSearch(c).includes(q)) return false;
    return true;
  });

  rows.sort((a, b) => {
    if (state.sort === "coverage") {
      return (b.completeness?.coverage_pct ?? -1) - (a.completeness?.coverage_pct ?? -1) || a.name.localeCompare(b.name);
    }
    if (state.sort === "recent") {
      return String(b.latest_event?.date ?? "").localeCompare(String(a.latest_event?.date ?? "")) || a.name.localeCompare(b.name);
    }
    if (state.sort === "founded") {
      return (a.profile?.founded_year ?? 9999) - (b.profile?.founded_year ?? 9999) || a.name.localeCompare(b.name);
    }
    if (state.sort === "employees") {
      return (b.profile?.employees?.mid ?? -1) - (a.profile?.employees?.mid ?? -1) || a.name.localeCompare(b.name);
    }
    if (state.sort === "sources") {
      return (b.sources?.length ?? 0) - (a.sources?.length ?? 0) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });

  return rows;
}

function renderCompanyList() {
  const rows = filteredCompanies();

  if ($("visibleCompanyCount")) $("visibleCompanyCount").textContent = rows.length;
  if ($("companiesCount")) $("companiesCount").textContent = rows.length;
  if ($("companiesWithProcesses")) {
    $("companiesWithProcesses").textContent = rows.filter(c => (c.profile?.manufacturing_processes || []).length).length;
  }
  if ($("companiesWithMultipleSources")) {
    $("companiesWithMultipleSources").textContent = rows.filter(c => (c.sources || []).length >= 2).length;
  }

  const container = $("companyList");
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state"><strong>No companies match.</strong>Try widening the filters or clearing the search.</div>`;
    return;
  }

  container.innerHTML = rows.map(c => {
    const latest = c.latest_event
      ? `${display(c.latest_event.date, "")}${c.latest_event.type ? ` · ${esc(c.latest_event.type)}` : ""}`
      : "—";
    return `
      <button class="company-table-row" data-company="${esc(c.slug)}">
        <span class="company-cell-main">
          <strong>${esc(c.name)}</strong>
          <small>${display(c.classification.primary_sector, "Hard tech")}</small>
        </span>
        <span>${display(c.primary_location.city, "—")}</span>
        <span>${display(c.classification.sector_group, "—")}</span>
        <span>${display(c.profile.founded_year, "—")}</span>
        <span>${display(c.profile.employees?.label, "—")}</span>
        <span>${display(c.classification.ownership, "—")}</span>
        <span>${latest}</span>
        <span class="source-count-cell">${(c.sources || []).length}</span>
      </button>`;
  }).join("");

  container.querySelectorAll("[data-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.company));
  });
}

function buildCityGroups(rows) {
  const groups = new Map();
  for (const c of rows) {
    const loc = c.primary_location;
    if (!loc || loc.latitude == null || loc.longitude == null) continue;
    const key = loc.city || "Unknown";
    if (!groups.has(key)) {
      groups.set(key, { city: key, lat: loc.latitude, lng: loc.longitude, companies: [] });
    }
    groups.get(key).companies.push(c);
  }
  return [...groups.values()];
}

function renderFallbackMap(rows) {
  const el = $("map");
  const groups = buildCityGroups(rows);
  const minLat = 33.48, maxLat = 33.97, minLng = -118.16, maxLng = -117.55;

  const bubbles = groups.map(group => {
    const x = ((group.lng - minLng) / (maxLng - minLng)) * 100;
    const y = (1 - (group.lat - minLat) / (maxLat - minLat)) * 100;
    const count = group.companies.length;
    const size = Math.max(34, Math.min(70, 28 + Math.sqrt(count) * 8));
    return `
      <button class="fallback-city" data-fallback-city="${esc(group.city)}"
              style="left:${x}%;top:${y}%;--bubble:${size}px"
              title="${esc(group.city)} · ${count} companies">
        <span>${count}</span><em>${esc(group.city)}</em>
      </button>`;
  }).join("");

  el.innerHTML = `
    <div class="fallback-map">
      <svg class="fallback-outline" viewBox="0 0 700 520" aria-hidden="true">
        <path d="M91 92 L205 52 L334 70 L489 118 L588 196 L620 299 L565 404 L467 474 L313 491 L186 445 L119 354 L78 235 Z"></path>
        <path class="fallback-coast" d="M91 92 C100 155 90 221 112 286 C133 347 170 402 186 445"></path>
        <path class="fallback-road" d="M130 280 C245 241 353 222 570 246"></path>
        <path class="fallback-road" d="M272 70 C308 175 345 290 362 486"></path>
        <path class="fallback-road" d="M171 408 C282 330 400 278 585 196"></path>
      </svg>
      <div class="fallback-caption">Interactive schematic view · city-centroid data</div>
      ${bubbles}
    </div>`;

  el.querySelectorAll("[data-fallback-city]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.city = btn.dataset.fallbackCity;
      $("cityFilter").value = state.city;
      syncURL();
      renderAll();
    });
  });
}

function renderMap() {
  const rows = filteredCompanies();

  if (!window.L || map?.__fallback) {
    renderFallbackMap(rows);
    return;
  }

  if (!map) return;
  if (cityLayer) cityLayer.clearLayers();

  const groups = buildCityGroups(rows);

  groups.forEach(group => {
    const count = group.companies.length;
    const size = Math.max(32, Math.min(72, 28 + Math.sqrt(count) * 8));
    const icon = L.divIcon({
      className: "city-marker",
      html: `<div style="--size:${size}px">${count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
    const marker = L.marker([group.lat, group.lng], { icon });
    marker.bindTooltip(`<strong>${esc(group.city)}</strong><br>${count} ${count === 1 ? "company" : "companies"}`, {
      className: "city-label",
      direction: "top",
      offset: [0, -(size / 2)]
    });
    marker.on("click", () => {
      state.city = group.city;
      $("cityFilter").value = group.city;
      syncURL();
      renderAll();
    });
    cityLayer.addLayer(marker);
  });

  if (groups.length) {
    const bounds = L.latLngBounds(groups.map(g => [g.lat, g.lng]));
    map.fitBounds(bounds.pad(0.12), { animate: false, maxZoom: 10 });
  }
}

function renderActiveCapability() {
  const row = $("activeCapabilityRow");
  if (!state.capability) {
    row.classList.add("hidden");
    return;
  }
  row.classList.remove("hidden");
  $("activeCapabilityChip").textContent = state.capability;
}


function countBy(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderBarList(targetId, rows, total, clickKind = null, limit = 6) {
  const target = $(targetId);
  if (!target) return;
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map(x => x[1]));
  target.innerHTML = shown.map(([label, value]) => `
    <div class="bar-row">
      <button type="button" ${clickKind ? `data-overview-kind="${clickKind}" data-overview-value="${esc(label)}"` : ""}>${esc(label)}</button>
      <div class="bar-track"><span style="width:${Math.max(4,(value/max)*100)}%"></span></div>
      <span class="bar-value">${value}</span>
    </div>`).join("");

  if (clickKind) {
    target.querySelectorAll("[data-overview-kind]").forEach(btn => {
      btn.addEventListener("click", () => {
        const value = btn.dataset.overviewValue;
        if (btn.dataset.overviewKind === "sector") {
          state.sector = value;
          $("sectorFilter").value = value;
        }
        if (btn.dataset.overviewKind === "city") {
          state.city = value;
          $("cityFilter").value = value;
        }
        if (btn.dataset.overviewKind === "maturity") {
          state.maturity = value;
          $("maturityFilter").value = value;
        }
        if (btn.dataset.overviewKind === "capability") {
          state.capability = value;
          state.selectedCapability = value;
          setView("capabilities");
          setTimeout(() => selectCapability(value), 10);
        }
        syncURL();
        renderAll();
      });
    });
  }
}

function capabilityCounts(rows) {
  const counts = new Map();
  for (const c of rows) {
    for (const cap of c.capabilities || []) {
      if (!cap.tag) continue;
      counts.set(cap.tag, (counts.get(cap.tag) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderOverview() {
  const rows = filteredCompanies();
  renderBarList("sectorOverview", countBy(rows, c => c.classification?.sector_group), rows.length, "sector", 6);
  renderBarList("cityOverview", countBy(rows, c => c.primary_location?.city), rows.length, "city", 6);
  renderBarList("maturityOverview", countBy(rows, c => c.classification?.maturity), rows.length, "maturity", 6);
  renderBarList("capabilityOverview", capabilityCounts(rows), rows.length, "capability", 6);

  const capital = rows.filter(c =>
    c.financials?.disclosed_funding_total_usd ||
    c.financials?.latest_round_usd ||
    c.financials?.valuation_usd
  ).length;
  const gov = rows.filter(c => c.signals?.government_contract_or_grant).length;
  const hiring = rows.filter(c => c.signals?.hiring).length;
  const exact = rows.filter(c => c.primary_location?.address).length;

  const el = $("signalOverview");
  if (el) {
    el.innerHTML = `
      <div class="signal-cell"><strong>${capital}</strong><span>capital records</span></div>
      <div class="signal-cell"><strong>${gov}</strong><span>government signals</span></div>
      <div class="signal-cell"><strong>${hiring}</strong><span>hiring signals</span></div>
      <div class="signal-cell"><strong>${exact}</strong><span>street addresses</span></div>`;
  }

  renderWatchlist(rows);
  renderLatestActivityPreview(rows);
}

function renderWatchlist(rows) {
  const target = $("watchlist");
  if (!target) return;

  const watch = rows
    .filter(c => ["Emerging","Growth","Established growth"].includes(c.classification?.maturity))
    .sort((a,b) =>
      String(b.latest_event?.date || "").localeCompare(String(a.latest_event?.date || "")) ||
      (b.profile?.founded_year || 0) - (a.profile?.founded_year || 0)
    )
    .slice(0, 8);

  target.innerHTML = watch.length ? watch.map(c => `
    <button class="compact-item" data-watch-company="${esc(c.slug)}">
      <span>
        <strong>${esc(c.name)}</strong>
        <small>${display(c.primary_location?.city, "OC")} · ${display(c.classification?.maturity, "")}</small>
      </span>
      <em>${c.profile?.founded_year || "—"}</em>
    </button>`).join("")
  : `<div class="empty-state mini">No emerging/growth companies in current view.</div>`;

  target.querySelectorAll("[data-watch-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.watchCompany));
  });
}

function renderLatestActivityPreview(rows) {
  const target = $("latestActivity");
  if (!target) return;
  const allowed = new Set(rows.map(c => c.slug));
  const events = allEvents().filter(e => allowed.has(e.company_slug)).slice(0, 7);

  target.innerHTML = events.length ? events.map(e => `
    <button class="compact-item activity-preview" data-preview-company="${esc(e.company_slug)}">
      <span>
        <strong>${esc(e.company_name)}</strong>
        <small>${display(e.type, "Activity")} · ${display(e.date, "")}</small>
      </span>
    </button>`).join("")
  : `<div class="empty-state mini">No tracked events in current view.</div>`;

  target.querySelectorAll("[data-preview-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.previewCompany));
  });
}

function allEvents() {
  const events = [];
  const universe = filteredCompanies();
  for (const company of universe) {
    for (const e of company.events || []) {
      events.push({
        ...e,
        company_slug: company.slug,
        company_name: company.name,
        city: company.primary_location?.city,
        sector: company.classification?.sector_group
      });
    }
  }
  return events.sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function activityUniverseCompanies() {
  return filteredCompanies();
}

function filteredEvents() {
  const allowed = new Set(activityUniverseCompanies().map(c => c.slug));
  let events = allEvents().filter(e => allowed.has(e.company_slug));
  if (state.eventType) events = events.filter(e => e.type === state.eventType);
  return events;
}

function renderActivityMetrics(rows, events) {
  const target = $("activityMetrics");
  if (!target) return;

  const capitalCompanies = rows.filter(c =>
    c.financials?.disclosed_funding_total_usd ||
    c.financials?.latest_round_usd ||
    c.financials?.valuation_usd
  );
  const totalFunding = rows.reduce((sum,c) => sum + Number(c.financials?.disclosed_funding_total_usd || 0), 0);
  const gov = rows.filter(c => c.signals?.government_contract_or_grant).length;
  const currentYear = events.filter(e => String(e.date || "").startsWith("2026")).length;

  target.innerHTML = `
    <div><strong>${events.length}</strong><span>tracked events</span></div>
    <div><strong>${capitalCompanies.length}</strong><span>companies with capital records</span></div>
    <div><strong>${gov}</strong><span>government signals</span></div>
    <div><strong>${money(totalFunding)}</strong><span>captured disclosed funding</span></div>
    <div><strong>${currentYear}</strong><span>2026 tracked events</span></div>`;
}

function renderGovernmentCompanies(rows) {
  const target = $("governmentCompanies");
  if (!target) return;
  const gov = rows.filter(c => c.signals?.government_contract_or_grant).slice(0, 12);
  target.innerHTML = gov.length ? gov.map(c => `
    <button class="compact-item" data-gov-company="${esc(c.slug)}">
      <span><strong>${esc(c.name)}</strong><small>${display(c.primary_location?.city, "OC")}</small></span>
    </button>`).join("")
  : `<div class="empty-state mini">No government signals in current view.</div>`;

  target.querySelectorAll("[data-gov-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.govCompany));
  });
}

function renderCapitalTable(rows) {
  const target = $("capitalTable");
  if (!target) return;

  const capital = rows
    .filter(c =>
      c.financials?.disclosed_funding_total_usd ||
      c.financials?.latest_round_usd ||
      c.financials?.valuation_usd
    )
    .sort((a,b) =>
      Number(b.financials?.disclosed_funding_total_usd || b.financials?.latest_round_usd || 0) -
      Number(a.financials?.disclosed_funding_total_usd || a.financials?.latest_round_usd || 0)
    );

  if (!capital.length) {
    target.innerHTML = `<div class="empty-state"><strong>No captured capital records in current view.</strong></div>`;
    return;
  }

  target.innerHTML = `
    <div class="capital-head">
      <span>Company</span><span>City</span><span>Disclosed total</span><span>Latest round</span><span>Stage</span><span>Date</span>
    </div>
    ${capital.map(c => `
      <button class="capital-row" data-capital-company="${esc(c.slug)}">
        <span><strong>${esc(c.name)}</strong></span>
        <span>${display(c.primary_location?.city, "—")}</span>
        <span>${c.financials?.disclosed_funding_total_usd ? money(c.financials.disclosed_funding_total_usd) : "—"}</span>
        <span>${c.financials?.latest_round_usd ? money(c.financials.latest_round_usd) : "—"}</span>
        <span>${display(c.financials?.latest_round_stage, "—")}</span>
        <span>${display(c.financials?.latest_round_date, "—")}</span>
      </button>`).join("")}`;

  target.querySelectorAll("[data-capital-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.capitalCompany));
  });
}

function renderActivity() {
  const feed = $("activityFeed");
  if (!feed) return;

  const rows = activityUniverseCompanies();
  const events = filteredEvents();
  renderActivityMetrics(rows, events);
  renderGovernmentCompanies(rows);
  renderCapitalTable(rows);

  if ($("activitySideTitle")) {
    $("activitySideTitle").textContent = `${events.length} tracked ${events.length === 1 ? "event" : "events"}`;
  }

  feed.innerHTML = events.length ? events.map(e => `
    <div class="activity-entry">
      <div class="activity-date">${display(e.date, "Undated")}</div>
      <div>
        <button type="button" data-activity-company="${esc(e.company_slug)}">
          <div class="activity-company">${esc(e.company_name)}</div>
          <div class="activity-type">${display(e.type, "Activity")}</div>
        </button>
      </div>
      <div class="activity-summary">${display(e.summary, "")}</div>
      <div class="activity-amount">${e.amount_usd ? money(e.amount_usd) : ""}</div>
    </div>`).join("")
  : `<div class="empty-state"><strong>No events match.</strong>Clear filters or choose another event type.</div>`;

  feed.querySelectorAll("[data-activity-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.activityCompany));
  });

  renderBarList("eventTypeOverview", countBy(events, e => e.type), events.length, null, 10);
}

function renderCapabilityBrowser() {
  const search = $("capabilitySearch").value.trim().toLowerCase();
  const categoryMap = new Map();
  for (const company of DATA.companies) {
    for (const cap of company.capabilities || []) {
      if (!cap.tag || !cap.category) continue;
      if (search && !`${cap.tag} ${cap.category}`.toLowerCase().includes(search)) continue;
      if (!categoryMap.has(cap.category)) categoryMap.set(cap.category, new Map());
      const tags = categoryMap.get(cap.category);
      if (!tags.has(cap.tag)) tags.set(cap.tag, new Set());
      tags.get(cap.tag).add(company.id);
    }
  }

  const html = [...categoryMap.entries()]
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([category, tags]) => {
      const rows = [...tags.entries()].sort((a,b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
      return `
        <section class="cap-group">
          <div class="cap-group-head"><strong>${esc(category)}</strong><span>${rows.length} capabilities</span></div>
          <div class="cap-list">
            ${rows.map(([tag, ids]) => `
              <button class="cap-item ${state.selectedCapability === tag ? "active" : ""}" data-capability="${esc(tag)}">
                <span>${esc(tag)}</span><span class="cap-count">${ids.size}</span>
              </button>`).join("")}
          </div>
        </section>`;
    }).join("");

  $("capabilityGroups").innerHTML = html || `<div class="empty-state">No capabilities match this search.</div>`;

  document.querySelectorAll("[data-capability]").forEach(btn => {
    btn.addEventListener("click", () => selectCapability(btn.dataset.capability));
  });
}


function renderCapabilitySummary() {
  const rows = filteredCompanies();
  const tags = new Set();
  let links = 0;
  for (const c of rows) {
    for (const cap of c.capabilities || []) {
      if (cap.tag) tags.add(cap.tag);
      links += 1;
    }
  }
  if ($("uniqueCapabilityCount")) $("uniqueCapabilityCount").textContent = tags.size;
  if ($("manufacturingCompanyCount")) {
    $("manufacturingCompanyCount").textContent = rows.filter(c => (c.profile?.manufacturing_processes || []).length).length;
  }
  if ($("capabilityCompanyCount")) $("capabilityCompanyCount").textContent = rows.length;
  if ($("capabilityLinkCount")) $("capabilityLinkCount").textContent = links;
  renderProcessIndex(rows);
}

function renderProcessIndex(rows) {
  const target = $("processIndex");
  if (!target) return;

  const processRows = rows
    .filter(c => (c.profile?.manufacturing_processes || []).length)
    .sort((a,b) => a.name.localeCompare(b.name));

  target.innerHTML = processRows.length ? processRows.map(c => `
    <button class="process-row" data-process-company="${esc(c.slug)}">
      <span><strong>${esc(c.name)}</strong><small>${display(c.primary_location?.city, "OC")}</small></span>
      <span>${(c.profile.manufacturing_processes || []).map(x => esc(x)).join(" · ")}</span>
    </button>`).join("")
  : `<div class="empty-state"><strong>No sourced manufacturing-process records in current view.</strong></div>`;

  target.querySelectorAll("[data-process-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.processCompany));
  });
}

function selectCapability(tag) {
  state.selectedCapability = tag;
  $("capabilityTitle").textContent = tag;

  const companies = filteredCompanies().filter(c => (c.capabilities || []).some(x => x.tag === tag));
  $("capabilitySubtitle").textContent = `${companies.length} ${companies.length === 1 ? "company" : "companies"} with this capability in the current filtered view`;

  $("capabilityCompanies").innerHTML = companies
    .sort((a,b) => a.name.localeCompare(b.name))
    .map(c => `
      <button class="cap-company" data-cap-company="${esc(c.slug)}">
        <strong>${esc(c.name)}</strong>
        <span>${display(c.primary_location.city, "Orange County")} · ${display(c.classification.primary_sector, "Hard tech")}</span>
      </button>`).join("");

  document.querySelectorAll("[data-cap-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.capCompany));
  });

  const cityCounts = countBy(companies, c => c.primary_location?.city);
  if ($("capabilityCities")) {
    $("capabilityCities").innerHTML = cityCounts.length
      ? `<div class="side-subhead">Geographic concentration</div>` +
        cityCounts.slice(0,8).map(([city,count]) => `<div class="city-count-row"><span>${esc(city)}</span><strong>${count}</strong></div>`).join("")
      : "";
  }

  renderCapabilityBrowser();
}

function openCompany(slug) {
  const c = DATA.companies.find(x => x.slug === slug);
  if (!c) return;
  state.selectedCompany = c;

  const sourceLinks = (c.sources || []).map(s => `
    <a class="source-item" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
      <strong>${display(s.type, "Source")}</strong>
      <span>${display(s.facts_supported, s.url)}</span>
      ${s.verified_as_of ? `<em>verified ${esc(s.verified_as_of)}</em>` : ""}
    </a>`).join("");

  const events = (c.events || []).slice(0, 10).map(e => `
    <div class="timeline-item">
      <span class="timeline-date">${display(e.date, "Date unknown")}</span>
      <strong>${display(e.type, "Activity")}${e.amount_usd ? ` · ${money(e.amount_usd)}` : ""}</strong>
      <p>${display(e.summary, "")}</p>
    </div>`).join("");

  const products = (c.products || []).map(p => `
    <div class="product-row">
      <strong>${display(p.name, "Product / platform")}</strong>
      <span>${display(p.category, "")}</span>
    </div>`).join("");

  const locations = (c.locations || []).map(loc => `
    <div class="location-row">
      <strong>${display(loc.type, "OC location")}</strong>
      <span>${display(loc.address || loc.city, "Location not verified")}</span>
      <small>${loc.verified_as_of ? `verified ${esc(loc.verified_as_of)}` : ""}</small>
    </div>`).join("");

  const leader = c.profile.leader
    ? `${esc(c.profile.leader.name)}${c.profile.leader.role ? ` · ${esc(c.profile.leader.role)}` : ""}`
    : "Not verified";
  const employee = c.profile.employees?.label || "Not verified";
  const sourceCount = (c.sources || []).length;
  const verifiedAsOf = c.status?.as_of_date || "Not stated";
  const confidence = c.status?.data_confidence || c.status?.verification_confidence || "Not rated";

  $("drawerContent").innerHTML = `
    <article>
      <div class="dossier-meta-line">
        <span>${display(c.classification.sector_group, "HARD TECH")}</span>
        <span>${sourceCount} ${sourceCount === 1 ? "source" : "sources"}</span>
        <span>verified ${esc(verifiedAsOf)}</span>
      </div>

      <h2>${esc(c.name)}</h2>
      <div class="drawer-subtitle">
        ${display(c.primary_location.city, "Orange County")} · ${display(c.classification.primary_sector, "Hard tech")}
      </div>

      <div class="profile-actions">
        ${c.website ? `<a class="primary" href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">Company site ↗</a>` : ""}
        <button class="copy-link" id="copyProfileLink">Copy profile link</button>
      </div>

      <div class="profile-summary">${display(c.profile.product_platform_summary || c.profile.capability_summary, "Profile under research.")}</div>

      <div class="profile-grid">
        <div class="profile-field"><span>Founded</span><strong>${display(c.profile.founded_year)}</strong></div>
        <div class="profile-field"><span>Employees</span><strong>${display(employee)}</strong></div>
        <div class="profile-field"><span>Ownership</span><strong>${display(c.classification.ownership)}</strong></div>
        <div class="profile-field"><span>Leadership</span><strong>${leader}</strong></div>
        <div class="profile-field"><span>Maturity</span><strong>${display(c.classification.maturity)}</strong></div>
        <div class="profile-field"><span>Data confidence</span><strong>${display(confidence)}</strong></div>
      </div>

      ${products ? `
      <section class="drawer-section">
        <h3>Products / platforms</h3>
        <div class="product-list">${products}</div>
      </section>` : ""}

      <section class="drawer-section">
        <h3>Capabilities</h3>
        <div class="cap-chip-wrap">
          ${(c.capabilities || []).map(x => `<button class="cap-chip" data-drawer-cap="${esc(x.tag)}">${esc(x.tag)}</button>`).join("") || `<span class="muted small">No structured capabilities captured.</span>`}
        </div>
      </section>

      ${c.profile.manufacturing_processes?.length ? `
      <section class="drawer-section">
        <h3>Manufacturing & process</h3>
        <div class="cap-chip-wrap">${c.profile.manufacturing_processes.map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      </section>` : ""}

      ${c.profile.end_markets?.length ? `
      <section class="drawer-section">
        <h3>End markets</h3>
        <div class="cap-chip-wrap">${c.profile.end_markets.map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      </section>` : ""}

      <section class="drawer-section">
        <h3>Locations</h3>
        <div class="location-list">${locations || `<p>Orange County location under verification.</p>`}</div>
      </section>

      <section class="drawer-section">
        <h3>Capital</h3>
        <div class="finance-grid">
          <div><span>Disclosed total</span><strong>${c.financials?.disclosed_funding_total_usd ? money(c.financials.disclosed_funding_total_usd) : "Not public"}</strong></div>
          <div><span>Latest round</span><strong>${c.financials?.latest_round_usd ? money(c.financials.latest_round_usd) : "Not public"}</strong></div>
          <div><span>Stage</span><strong>${display(c.financials?.latest_round_stage, "Not public")}</strong></div>
          <div><span>Valuation</span><strong>${c.financials?.valuation_usd ? money(c.financials.valuation_usd) : "Not public"}</strong></div>
        </div>
      </section>

      ${(c.signals.government_contract_or_grant || c.signals.commercial_customer || c.signals.hiring) ? `
      <section class="drawer-section">
        <h3>Signals</h3>
        ${c.signals.government_contract_or_grant ? `<p><strong>Government:</strong> ${esc(c.signals.government_contract_or_grant)}</p>` : ""}
        ${c.signals.commercial_customer ? `<p><strong>Commercial:</strong> ${esc(c.signals.commercial_customer)}</p>` : ""}
        ${c.signals.hiring ? `<p><strong>Hiring:</strong> ${esc(c.signals.hiring)}</p>` : ""}
      </section>` : ""}

      ${events ? `<section class="drawer-section"><h3>Activity</h3>${events}</section>` : ""}

      <section class="drawer-section">
        <h3>Source register</h3>
        <div class="source-list">${sourceLinks || `<span class="muted small">No source links captured.</span>`}</div>
      </section>

      <div class="public-method-note">
        Public profile fields are shown only where sufficiently supported in the frozen source set. Missing values are unknown, not zero.
      </div>
    </article>`;

  document.querySelectorAll("[data-drawer-cap]").forEach(btn => {
    btn.addEventListener("click", () => {
      closeDrawer();
      state.capability = btn.dataset.drawerCap;
      state.selectedCapability = btn.dataset.drawerCap;
      syncURL();
      setView("capabilities");
      setTimeout(() => selectCapability(btn.dataset.drawerCap), 20);
    });
  });

  $("copyProfileLink").addEventListener("click", async () => {
    const url = new URL(window.location.href);
    url.hash = `company=${c.slug}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      showToast("Profile link copied");
    } catch {
      window.location.hash = `company=${c.slug}`;
    }
  });

  $("companyDrawer").classList.add("open");
  $("companyDrawer").setAttribute("aria-hidden", "false");
  $("drawerBackdrop").classList.remove("hidden");

  const url = new URL(window.location.href);
  url.hash = `company=${c.slug}`;
  history.replaceState(null, "", url);
}

function closeDrawer() {
  $("companyDrawer").classList.remove("open");
  $("companyDrawer").setAttribute("aria-hidden", "true");
  $("drawerBackdrop").classList.add("hidden");
  state.selectedCompany = null;
  const url = new URL(window.location.href);
  url.hash = "";
  history.replaceState(null, "", url.pathname + url.search);
}

function showToast(text) {
  $("toast").textContent = text;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 1600);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-view]").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  $("exploreView").classList.toggle("hidden", view !== "explore");
  $("companiesView").classList.toggle("hidden", view !== "companies");
  $("capabilitiesView").classList.toggle("hidden", view !== "capabilities");
  $("activityView").classList.toggle("hidden", view !== "activity");

  const url = new URL(window.location.href);
  if (view === "explore") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  history.replaceState(null, "", url);

  if (view === "explore") setTimeout(() => map?.invalidateSize(), 20);
  if (view === "companies") renderCompanyList();
  if (view === "capabilities") {
    renderCapabilitySummary();
    renderCapabilityBrowser();
  }
  if (view === "activity") renderActivity();
}

function syncURL() {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const pairs = [
    ["q", state.search], ["sector", state.sector], ["city", state.city],
    ["maturity", state.maturity], ["ownership", state.ownership], ["capability", state.capability]
  ];
  for (const [key, value] of pairs) {
    if (value) params.set(key, value); else params.delete(key);
  }
  history.replaceState(null, "", url);
}

function restoreURL() {
  const p = new URL(window.location.href).searchParams;
  state.search = p.get("q") || "";
  state.sector = p.get("sector") || "";
  state.city = p.get("city") || "";
  state.maturity = p.get("maturity") || "";
  state.ownership = p.get("ownership") || "";
  state.capability = p.get("capability") || "";
  state.view = p.get("view") || "explore";
  $("searchInput").value = state.search;
  $("sectorFilter").value = state.sector;
  $("cityFilter").value = state.city;
  $("maturityFilter").value = state.maturity;
  $("ownershipFilter").value = state.ownership;
}

function renderAll() {
  renderActiveCapability();
  renderCompanyList();
  renderOverview();
  renderMap();
  renderCapabilitySummary();
  renderCapabilityBrowser();
  renderActivity();
}

function bindControls() {
  $("searchInput").addEventListener("input", e => {
    state.search = e.target.value;
    syncURL(); renderAll();
  });
  [["sectorFilter","sector"],["cityFilter","city"],["maturityFilter","maturity"],["ownershipFilter","ownership"]]
    .forEach(([id,key]) => $(id).addEventListener("change", e => {
      state[key] = e.target.value;
      syncURL(); renderAll();
    }));

  $("sortSelect").addEventListener("change", e => {
    state.sort = e.target.value; renderCompanyList();
  });

  $("eventTypeFilter").addEventListener("change", e => {
    state.eventType = e.target.value;
    renderActivity();
  });

  $("clearFilters").addEventListener("click", () => {
    state.search = state.sector = state.city = state.maturity = state.ownership = state.capability = "";
    $("searchInput").value = "";
    ["sectorFilter","cityFilter","maturityFilter","ownershipFilter"].forEach(id => $(id).value = "");
    syncURL(); renderAll();
  });

  $("clearCapability").addEventListener("click", () => {
    state.capability = ""; syncURL(); renderAll();
  });

  $("activeCapabilityChip").addEventListener("click", () => {
    setView("capabilities");
    selectCapability(state.capability);
  });

  document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));

  $("capabilitySearch").addEventListener("input", renderCapabilityBrowser);

  $("closeDrawer").addEventListener("click", closeDrawer);
  $("drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDrawer();
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault(); $("searchInput").focus();
    }
  });

  $("aboutButton").addEventListener("click", () => $("aboutDialog").showModal());
  $("closeAbout").addEventListener("click", () => $("aboutDialog").close());
}

function initMap() {
  if (!window.L) {
    map = { __fallback: true, invalidateSize() {} };
    cityLayer = null;
    return;
  }

  map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true
  }).setView([33.72, -117.82], 9);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  cityLayer = L.layerGroup().addTo(map);
}

async function loadData() {
  const [companies, mapPoints, facets, config, manifest] = await Promise.all([
    fetch("./data/companies.min.json").then(r => r.json()),
    fetch("./data/map_points.json").then(r => r.json()),
    fetch("./data/facets.json").then(r => r.json()),
    fetch("./data/site_config.json").then(r => r.json()),
    fetch("./manifest.json").then(r => r.json())
  ]);
  DATA.companies = companies;
  DATA.mapPoints = mapPoints;
  DATA.facets = facets;
  DATA.config = config;
  DATA.manifest = manifest;
}


// -----------------------------------------------------------------------------
// Grounded Ask-the-map interface
//
// Production default: POST /api/ask
// Production endpoint: POST /api/ask on the same Render service.
// The browser sends the question and active filters; the server re-retrieves
// canonical company records and calls the configured open-weight model endpoint.
// -----------------------------------------------------------------------------

const ASK_ENDPOINT = window.OC_HARDTECH_ASK_ENDPOINT || "/api/ask";
const ASK_TOP_K = 10;

function tokenise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9$&+./-]+/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function companyGroundingRecord(c) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    website: c.website,
    city: c.primary_location?.city || null,
    address: c.primary_location?.address || null,
    sector_group: c.classification?.sector_group || null,
    primary_sector: c.classification?.primary_sector || null,
    maturity: c.classification?.maturity || null,
    ownership: c.classification?.ownership || null,
    parent_or_successor: c.classification?.parent_or_successor || null,
    founded_year: c.profile?.founded_year || null,
    employee_band: c.profile?.employees?.label || null,
    leader: c.profile?.leader || null,
    product_summary: c.profile?.product_platform_summary || null,
    capability_summary: c.profile?.capability_summary || null,
    manufacturing_processes: c.profile?.manufacturing_processes || [],
    end_markets: c.profile?.end_markets || [],
    capabilities: (c.capabilities || []).map(x => ({
      tag: x.tag, category: x.category, confidence: x.confidence, source_url: x.source_url
    })),
    products: (c.products || []).map(x => ({
      name: x.name, category: x.category, source_url: x.source_url
    })),
    financials: c.financials || {},
    signals: c.signals || {},
    latest_event: c.latest_event || null,
    recent_events: (c.events || []).slice(0, 5),
    sources: (c.sources || []).slice(0, 8).map(s => ({
      id: s.id, url: s.url, type: s.type, facts_supported: s.facts_supported,
      priority: s.priority, verified_as_of: s.verified_as_of
    })),
    data_quality: c.completeness || {}
  };
}

function scoreCompanyForQuestion(c, question) {
  const qTokens = tokenise(question);
  if (!qTokens.length) return 0;

  const strong = [
    c.name,
    c.primary_location?.city,
    c.classification?.sector_group,
    c.classification?.primary_sector,
    ...(c.capabilities || []).map(x => x.tag),
    ...(c.profile?.manufacturing_processes || []),
    ...(c.profile?.end_markets || [])
  ].filter(Boolean).join(" ").toLowerCase();

  const broad = [
    strong,
    c.profile?.product_platform_summary,
    c.profile?.capability_summary,
    c.signals?.government_contract_or_grant,
    c.signals?.commercial_customer,
    c.signals?.hiring,
    c.latest_event?.summary,
    ...(c.products || []).map(x => x.name),
    ...(c.events || []).map(x => `${x.type || ""} ${x.summary || ""}`)
  ].filter(Boolean).join(" ").toLowerCase();

  let score = 0;
  for (const token of qTokens) {
    if (strong.includes(token)) score += 5;
    else if (broad.includes(token)) score += 2;
  }

  // Useful lexical boosts for common user language.
  const q = question.toLowerCase();
  const aliases = [
    ["robot", ["robotics","autonomy","physical ai"]],
    ["chip", ["semiconductor","microelectronics","rf"]],
    ["aerospace", ["aerospace","space"]],
    ["space", ["space","satellite","spacecraft"]],
    ["manufactur", ["manufacturing","machining","fabrication","assembly"]],
    ["fund", ["funding","financing","series","capital"]],
    ["government", ["government","dod","doe","nasa","nih","contract","grant"]],
    ["hire", ["hiring","careers","jobs"]],
    ["small", ["2-10","11-50"]],
    ["new", ["emerging","growth"]]
  ];
  for (const [needle, values] of aliases) {
    if (q.includes(needle) && values.some(v => broad.includes(v))) score += 3;
  }

  // Respect currently active site filters as mild context.
  if (state.city && c.primary_location?.city === state.city) score += 3;
  if (state.sector && c.classification?.sector_group === state.sector) score += 3;
  if (state.capability && (c.capabilities || []).some(x => x.tag === state.capability)) score += 4;

  return score;
}

function retrieveGrounding(question, k = ASK_TOP_K) {
  const ranked = DATA.companies
    .map(c => ({ c, score: scoreCompanyForQuestion(c, question) }))
    .sort((a,b) => b.score - a.score || a.c.name.localeCompare(b.c.name));

  const positive = ranked.filter(x => x.score > 0);
  const selected = (positive.length ? positive : ranked).slice(0, k).map(x => companyGroundingRecord(x.c));

  return {
    dataset_version: DATA.config.dataset_version || DATA.manifest.dataset_version,
    dataset_scope: DATA.config.geographic_scope || "Orange County, California",
    active_filters: {
      sector: state.sector || null,
      city: state.city || null,
      maturity: state.maturity || null,
      ownership: state.ownership || null,
      capability: state.capability || null
    },
    candidate_companies: selected
  };
}

function appendAskMessage(role, html, extraClass = "") {
  const wrapper = document.createElement("div");
  wrapper.className = `ask-message ${role} ${extraClass}`.trim();
  wrapper.innerHTML = role === "assistant"
    ? `<div class="ask-avatar">OC</div><div class="ask-bubble">${html}</div>`
    : `<div class="ask-bubble">${html}</div>`;
  $("askMessages").appendChild(wrapper);
  $("askMessages").scrollTop = $("askMessages").scrollHeight;
  return wrapper;
}

function askStatus(text, mode = "ready") {
  $("askStatusText").textContent = text;
  const parent = $("askStatusText").parentElement;
  parent.classList.toggle("busy", mode === "busy");
  parent.classList.toggle("error", mode === "error");
}

function sourceLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./,"");
    return host;
  } catch {
    return "Source";
  }
}

function renderAskAnswer(payload) {
  const companies = (payload.companies || []).map(slug => DATA.companies.find(c => c.slug === slug)).filter(Boolean);
  const companyLinks = companies.length
    ? `<div class="ask-company-links">${companies.map(c => `<button class="ask-company-link" data-ask-company="${esc(c.slug)}">${esc(c.name)}</button>`).join("")}</div>`
    : "";

  const citations = (payload.citations || []).slice(0, 8);
  const citationHtml = citations.length
    ? `<div class="ask-citations"><strong>Sources used</strong>${citations.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label || sourceLabel(x.url))} ↗</a>`).join("")}</div>`
    : "";

  const safeAnswer = esc(payload.answer || "The dataset did not support a confident answer.")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>");

  const node = appendAskMessage("assistant",
    `<p>${safeAnswer}</p>${companyLinks}${citationHtml}<div class="ask-grounding-note">Grounded in the frozen OC Hard Tech dataset${payload.model ? ` · ${esc(payload.model)}` : ""}.</div>`
  );

  node.querySelectorAll("[data-ask-company]").forEach(btn => {
    btn.addEventListener("click", () => openCompany(btn.dataset.askCompany));
  });
}

function localRetrievalFallback(question, grounding) {
  const companies = grounding.candidate_companies.slice(0, 6);
  if (!companies.length) {
    return {
      answer: "I could not find a company in the frozen dataset that matches that question.",
      companies: [],
      citations: [],
      local_fallback: true
    };
  }

  const lines = companies.map(c => {
    const why = [
      c.city,
      c.primary_sector,
      c.capabilities?.slice(0,2).map(x => x.tag).join(", ")
    ].filter(Boolean).join(" · ");
    return `${c.name}: ${why}`;
  });

  const citations = [];
  const seen = new Set();
  for (const c of companies) {
    for (const s of c.sources || []) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      citations.push({ url: s.url, label: `${c.name} · ${s.type || sourceLabel(s.url)}` });
      if (citations.length >= 6) break;
    }
    if (citations.length >= 6) break;
  }

  return {
    answer:
      "The live language-model endpoint is not connected in this local preview. The closest dataset matches are:\n\n" +
      lines.join("\n") +
      "\n\nWhen the Render API is connected to an open-weight model endpoint, the same retrieved records are sent to the model for a synthesized grounded answer.",
    companies: companies.map(c => c.slug),
    citations,
    local_fallback: true
  };
}

async function askDataset(question) {
  const grounding = retrieveGrounding(question);

  const body = {
    question,
    filters: grounding.active_filters,
    history: [...document.querySelectorAll(".ask-message")]
      .slice(-6)
      .map(node => ({
        role: node.classList.contains("user") ? "user" : "assistant",
        text: node.innerText.slice(0, 1800)
      }))
  };

  try {
    const response = await fetch(ASK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`Ask endpoint returned ${response.status}`);
    const payload = await response.json();
    if (!payload || typeof payload.answer !== "string") throw new Error("Ask endpoint returned an invalid payload");
    return payload;
  } catch (error) {
    console.warn("Using local retrieval fallback:", error);
    return localRetrievalFallback(question, grounding);
  }
}

function openAsk() {
  $("askPanel").classList.add("open");
  $("askPanel").setAttribute("aria-hidden", "false");
  $("askBackdrop").classList.remove("hidden");
  setTimeout(() => $("askInput").focus(), 120);
}

function closeAsk() {
  $("askPanel").classList.remove("open");
  $("askPanel").setAttribute("aria-hidden", "true");
  $("askBackdrop").classList.add("hidden");
}

function bindAskInterface() {
  $("askButton").addEventListener("click", openAsk);
  $("closeAsk").addEventListener("click", closeAsk);
  $("askBackdrop").addEventListener("click", closeAsk);

  document.querySelectorAll("[data-question]").forEach(btn => {
    btn.addEventListener("click", () => {
      $("askInput").value = btn.dataset.question;
      openAsk();
      setTimeout(() => $("askForm").requestSubmit(), 40);
    });
  });

  $("askInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("askForm").requestSubmit();
    }
  });

  $("askForm").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("askInput");
    const question = input.value.trim();
    if (!question) return;

    appendAskMessage("user", esc(question));
    input.value = "";
    $("askSubmit").disabled = true;
    askStatus("Searching dataset…", "busy");

    const thinking = appendAskMessage("assistant", `<span class="ask-thinking"><i></i><i></i><i></i></span>`);
    try {
      const payload = await askDataset(question);
      thinking.remove();
      renderAskAnswer(payload);
      askStatus(payload.local_fallback ? "Local retrieval preview" : "Grounded answer", payload.local_fallback ? "error" : "ready");
    } catch (error) {
      thinking.remove();
      appendAskMessage("assistant", `I could not complete that query. ${esc(error.message)}`, "error");
      askStatus("Query failed", "error");
    } finally {
      $("askSubmit").disabled = false;
      input.focus();
    }
  });
}


async function boot() {
  try {
    await loadData();

    populateSelect("sectorFilter", DATA.facets.sector_groups || []);
    populateSelect("cityFilter", DATA.facets.cities || []);
    populateSelect("maturityFilter", DATA.facets.maturity_stages || []);
    populateSelect("ownershipFilter", DATA.facets.ownership_statuses || []);
    populateSelect("eventTypeFilter", DATA.facets.event_types || []);

    $("statCompanies").textContent = DATA.manifest.counts.company_count;
    $("statLocations").textContent = DATA.manifest.counts.map_point_count;
    $("statCapabilities").textContent = DATA.manifest.counts.capability_link_count;
    $("statSources").textContent = DATA.manifest.counts.source_count;
    if ($("statEvents")) $("statEvents").textContent = DATA.manifest.counts.event_count;

    initMap();
    bindControls();
    bindAskInterface();
    restoreURL();
    renderCapabilityBrowser();
    renderAll();
    setView(state.view);

    if (window.location.hash.startsWith("#company=")) {
      const slug = window.location.hash.replace("#company=", "");
      setTimeout(() => openCompany(slug), 30);
    }
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <main style="max-width:720px;margin:80px auto;padding:24px;font-family:system-ui">
        <h1>Could not load the OC Hard Tech dataset.</h1>
        <p>This site must be served over HTTP rather than opened directly as a local file.</p>
        <pre>${esc(error.message)}</pre>
      </main>`;
  }
}

boot();
