/**
 * Beter Benutten Scan - Interactieve Gemeentekaart
 * Basis: PDOK Bestuurlijke Gebieden (Kadaster)
 * Minimalistisch, snel en responsive in Rijkshuisstijl
 */

document.addEventListener('DOMContentLoaded', function () {
  const toggleMapBtn = document.getElementById('toggle-map-btn');
  const mapCollapsibleContent = document.getElementById('map-collapsible-content');
  const toggleMapText = document.getElementById('toggle-map-text');
  const toggleMapIcon = document.getElementById('toggle-map-icon');
  const mapElement = document.getElementById('nl-map');
  if (!mapElement) return;

  const STATUS_CONFIG = {
    koploper: {
      key: 'koploper',
      label: 'Koploper',
      fillColor: '#154273',      // Rijksblauw
      color: '#0e2d4f',          // Rijksdonker
      fillOpacity: 1.0,
      weight: 1.0,
      badgeClass: 'bg-[#154273] text-white',
      isAangesloten: true
    },
    snelle_volger: {
      key: 'snelle_volger',
      label: 'Snelle volger',
      fillColor: '#007bc7',      // Rijkshemelblauw
      color: '#005e99',
      fillOpacity: 1.0,
      weight: 1.0,
      badgeClass: 'bg-[#007bc7] text-white',
      isAangesloten: true
    },
    vrije_volger: {
      key: 'vrije_volger',
      label: 'Vrije volger',
      fillColor: '#008873',      // Rijks petrol / groenblauw
      color: '#006354',
      fillOpacity: 1.0,
      weight: 1.0,
      badgeClass: 'bg-[#008873] text-white',
      isAangesloten: true
    },
    aanvragen: {
      key: 'aanvragen',
      label: 'Nog niet aangesloten',
      fillColor: '#e2e8f0',      // Neutraal lichtgrijs
      color: '#cbd5e1',
      fillOpacity: 1.0,
      weight: 0.8,
      badgeClass: 'bg-slate-200 text-slate-700',
      isAangesloten: false
    }
  };

  const INITIAL_VIEW = {
    center: [52.1326, 5.2913],
    zoom: 7
  };

  let map = null;
  let geojsonLayer = null;
  let participantsMap = {};
  let allFeatures = [];
  let selectedLayer = null;
  let mapInitialized = false;

  const searchInput = document.getElementById('municipality-search');
  const searchDropdown = document.getElementById('search-results-dropdown');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const loadingOverlay = document.getElementById('map-loading');

  function initMap() {
    if (map) return;

    map = L.map('nl-map', {
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      minZoom: 6,
      maxZoom: 12,
      scrollWheelZoom: true,
      zoomControl: true,
      attributionControl: false
    });

    map.zoomControl.setPosition('topright');

    map.on('movestart zoomstart dragstart', closeAllTooltips);
    mapElement.addEventListener('mouseleave', closeAllTooltips);

    // Reset highlight wanneer popup gesloten wordt
    map.on('popupclose', function () {
      if (selectedLayer && geojsonLayer) {
        geojsonLayer.resetStyle(selectedLayer);
        selectedLayer = null;
      }
    });
  }

  function closeAllTooltips() {
    if (geojsonLayer) {
      geojsonLayer.eachLayer(l => {
        if (l.closeTooltip) l.closeTooltip();
      });
    }
  }

  async function loadData() {
    try {
      let participants = window.DEELNEMERS_DATA || null;
      let geojson = window.PDOK_BESTUURLIJKE_GEBIEDEN || null;

      if (!participants || !geojson) {
        const promises = [];
        if (!participants) promises.push(fetch('assets/data/deelnemers.json').then(r => r.json()));
        else promises.push(Promise.resolve(participants));

        if (!geojson) promises.push(fetch('assets/data/pdok_bestuurlijke_gebieden.geojson').then(r => r.json()));
        else promises.push(Promise.resolve(geojson));

        const results = await Promise.all(promises);
        participants = results[0];
        geojson = results[1];
      }

      participantsMap = {};
      participants.forEach(p => {
        if (p.code) participantsMap[p.code.toUpperCase()] = p;
        if (p.naam) participantsMap[p.naam.toLowerCase().trim()] = p;
      });

      renderGeoJson(geojson);

      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }
    } catch (err) {
      console.error('Fout bij het laden van de kaart:', err);
      if (loadingOverlay) {
        loadingOverlay.innerHTML = `
          <div class="text-center p-3">
            <span class="text-xs font-bold text-red-600 block mb-0.5">Kaart kon niet worden geladen</span>
            <span class="text-[11px] text-slate-500">Controleer de verbinding of herlaad de pagina.</span>
          </div>
        `;
      }
    }
  }

  function getFeatureStatus(feature) {
    const code = feature.properties.code ? feature.properties.code.toUpperCase() : null;
    const name = feature.properties.naam ? feature.properties.naam.toLowerCase().trim() : '';

    const participant = (code && participantsMap[code]) || participantsMap[name];
    if (participant && STATUS_CONFIG[participant.status]) {
      return {
        config: STATUS_CONFIG[participant.status],
        participant: participant
      };
    }

    return {
      config: STATUS_CONFIG.aanvragen,
      participant: null
    };
  }

  function getFeatureStyle(feature) {
    const { config } = getFeatureStatus(feature);
    return {
      fillColor: config.fillColor,
      weight: config.weight,
      opacity: 1,
      color: config.color,
      dashArray: '',
      fillOpacity: config.fillOpacity
    };
  }

  function buildPopupContent(name, config) {
    const isAangesloten = config.isAangesloten;

    const badgeBg = config.key === 'koploper' ? '#154273' :
                    config.key === 'snelle_volger' ? '#007bc7' :
                    config.key === 'vrije_volger' ? '#008873' : '#e2e8f0';
    const badgeColor = config.key === 'aanvragen' ? '#334155' : '#ffffff';

    if (isAangesloten) {
      return `
        <div style="font-family: 'Source Sans 3', Arial, sans-serif; color: #1e293b; padding: 2px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 8px; padding-right: 28px;">
            <strong style="font-size: 15px; font-weight: 700; color: #154273; margin: 0;">${name}</strong>
            <span style="display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; background-color: ${badgeBg}; color: ${badgeColor}; border-radius: 2px; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap;">
              ${config.label}
            </span>
          </div>
          <p style="font-size: 13px; line-height: 1.5; color: #334155; margin: 0 0 10px 0; font-weight: 500;">
            Neem contact op met beheerder voor toegang.
          </p>
          <a href="algemeen/"
             style="display: block; width: 100%; text-align: center; background-color: #154273; color: #ffffff !important; padding: 8px 12px; font-size: 12px; font-weight: 700; text-decoration: none; border-radius: 0; box-sizing: border-box;">
            Bekijk documentatie &rarr;
          </a>
        </div>
      `;
    } else {
      return `
        <div style="font-family: 'Source Sans 3', Arial, sans-serif; color: #1e293b; padding: 2px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 8px; padding-right: 28px;">
            <strong style="font-size: 15px; font-weight: 700; color: #154273; margin: 0;">${name}</strong>
            <span style="display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; background-color: ${badgeBg}; color: ${badgeColor}; border-radius: 2px; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap;">
              ${config.label}
            </span>
          </div>
          <p style="font-size: 12px; line-height: 1.5; color: #475569; margin: 0 0 10px 0;">
            Deze gemeente is momenteel nog niet aangesloten bij de Beter Benutten Scan.
          </p>
          <a href="algemeen/aanmelden"
             style="display: block; width: 100%; text-align: center; background-color: #007bc7; color: #ffffff !important; padding: 8px 12px; font-size: 12px; font-weight: 700; text-decoration: none; border-radius: 0; box-sizing: border-box;">
            Toelichting aanmeldproces gemeenten &rarr;
          </a>
        </div>
      `;
    }
  }

  function renderGeoJson(geojson) {
    allFeatures = [];

    geojsonLayer = L.geoJSON(geojson, {
      style: getFeatureStyle,
      onEachFeature: function (feature, layer) {
        const name = feature.properties.naam;
        const code = feature.properties.code;
        const { config } = getFeatureStatus(feature);

        allFeatures.push({
          code: code,
          naam: name,
          layer: layer,
          config: config
        });

        // Eenvoudige hover tooltip met alleen de gemeentenaam
        layer.bindTooltip(name, {
          className: 'municipality-tooltip',
          sticky: false,
          direction: 'auto',
          opacity: 0.95
        });

        // Popup direct gekoppeld aan de laag
        layer.bindPopup(buildPopupContent(name, config), {
          className: 'municipality-popup',
          closeButton: true,
          autoPan: true
        });

        // Hover: alleen rand en fill accentueren, GEEN bringToFront!
        layer.on('mouseover', function () {
          closeAllTooltips();
          if (selectedLayer !== layer) {
            layer.setStyle({
              weight: 2.2,
              color: '#0e2d4f',
              fillColor: config.isAangesloten ? config.fillColor : '#cbd5e1'
            });
          }
          layer.openTooltip();
        });

        layer.on('mouseout', function () {
          if (selectedLayer !== layer) {
            geojsonLayer.resetStyle(layer);
          }
          layer.closeTooltip();
        });

        // Klik: puur grens highlighten en popup openen (GEEN focus outline of bbox)
        layer.on('click', function (e) {
          closeAllTooltips();
          highlightSelectedLayer(layer);
          if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.blur) {
            e.originalEvent.target.blur();
          }
          layer.openPopup(e.latlng);
        });
      }
    }).addTo(map);

    setTimeout(() => {
      if (map && geojsonLayer) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [15, 15] });
      }
    }, 50);
  }

  function highlightSelectedLayer(layer) {
    if (selectedLayer && geojsonLayer) {
      geojsonLayer.resetStyle(selectedLayer);
    }
    selectedLayer = layer;
    layer.setStyle({
      weight: 3.2,
      color: '#ffbe1a', // Alleen de grens krijgt highlight
      fillOpacity: 1.0
    });
    if (layer._path && layer._path.blur) {
      layer._path.blur();
    }
  }

  // Zoekbalk autocomplete
  function closeDropdown() {
    if (searchDropdown) {
      searchDropdown.classList.add('hidden');
      searchDropdown.innerHTML = '';
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      const query = this.value.trim().toLowerCase();

      if (query.length > 0) {
        if (clearSearchBtn) clearSearchBtn.classList.remove('hidden');
      } else {
        if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
        closeDropdown();
        return;
      }

      if (query.length < 2) {
        closeDropdown();
        return;
      }

      const matches = allFeatures.filter(f => f.naam.toLowerCase().includes(query)).slice(0, 6);

      if (matches.length === 0) {
        searchDropdown.innerHTML = `
          <div class="p-2.5 text-xs text-slate-500 text-center">
            Geen gemeente gevonden voor "${this.value}"
          </div>
        `;
        searchDropdown.classList.remove('hidden');
        return;
      }

      searchDropdown.innerHTML = matches.map(m => `
        <button
          type="button"
          data-code="${m.code}"
          class="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between transition-colors group cursor-pointer"
        >
          <span class="font-bold text-slate-800 group-hover:text-rijks-blauw">${m.naam}</span>
          <span class="px-1.5 py-0.5 text-[10px] font-bold ${m.config.badgeClass}">
            ${m.config.label}
          </span>
        </button>
      `).join('');

      searchDropdown.classList.remove('hidden');
    });

    if (searchDropdown) {
      searchDropdown.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-code]');
        if (!btn) return;

        const code = btn.getAttribute('data-code');
        const found = allFeatures.find(f => f.code === code);
        if (found) {
          searchInput.value = found.naam;
          closeDropdown();
          closeAllTooltips();
          highlightSelectedLayer(found.layer);
          const center = found.layer.getBounds().getCenter();
          found.layer.openPopup(center);
          map.panTo(center);
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        closeDropdown();
      }
    });

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', function () {
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        closeDropdown();
        if (selectedLayer && geojsonLayer) {
          geojsonLayer.resetStyle(selectedLayer);
          selectedLayer = null;
        }
        if (map) map.closePopup();
      });
    }
  }

  // Uitklapknop: verbonden aan bovenliggend blok
  if (toggleMapBtn && mapCollapsibleContent) {
    toggleMapBtn.addEventListener('click', function () {
      const isExpanded = toggleMapBtn.getAttribute('aria-expanded') === 'true';

      if (!isExpanded) {
        mapCollapsibleContent.classList.remove('hidden');
        toggleMapBtn.setAttribute('aria-expanded', 'true');
        if (toggleMapText) toggleMapText.textContent = 'Verberg gemeentekaart';
        if (toggleMapIcon) toggleMapIcon.classList.add('rotate-180');

        if (!mapInitialized) {
          initMap();
          loadData();
          mapInitialized = true;
        } else if (map) {
          setTimeout(() => {
            map.invalidateSize();
            if (geojsonLayer) {
              map.fitBounds(geojsonLayer.getBounds(), { padding: [15, 15] });
            }
          }, 100);
        }
      } else {
        closeAllTooltips();
        if (map) map.closePopup();
        mapCollapsibleContent.classList.add('hidden');
        toggleMapBtn.setAttribute('aria-expanded', 'false');
        if (toggleMapText) toggleMapText.textContent = 'Check hier of jouw gemeente al deelneemt';
        if (toggleMapIcon) toggleMapIcon.classList.remove('rotate-180');
      }
    });
  }
});
