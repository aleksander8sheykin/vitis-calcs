(function () {
    const API_BASE = '/api';

    const stationInput = document.getElementById('station-search');
    const stationIdInput = document.getElementById('station-id');
    const suggestionsEl = document.getElementById('suggestions');
    const selectedStationEl = document.getElementById('selected-station');
    const startYearInput = document.getElementById('start-year');
    const endYearInput = document.getElementById('end-year');
    const seasonOnlyInput = document.getElementById('season-only');
    const calcBtn = document.getElementById('calc-btn');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const resultsContainer = document.getElementById('results-container');
    const resultsTitle = document.getElementById('results-title');
    const dataInfoEl = document.getElementById('data-info');
    const warningsEl = document.getElementById('warnings');
    const resultsBody = document.getElementById('results-body');
    const averagesEl = document.getElementById('averages');
    const grapeVarietiesEl = document.getElementById('grape-varieties');
    const chartCanvas = document.getElementById('results-chart');
    const chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;
    const mapEl = document.getElementById('station-map');
    const mapStatusEl = document.getElementById('map-status');

    if (
        !stationInput ||
        !stationIdInput ||
        !suggestionsEl ||
        !selectedStationEl ||
        !startYearInput ||
        !endYearInput ||
        !seasonOnlyInput ||
        !calcBtn ||
        !loadingEl ||
        !errorEl ||
        !resultsContainer ||
        !resultsTitle ||
        !dataInfoEl ||
        !warningsEl ||
        !resultsBody ||
        !averagesEl ||
        !grapeVarietiesEl
    ) {
        return;
    }

    let searchTimeout = null;
    let selectedStationName = '';
    let stationMap = null;
    let stationMarkersLayer = null;
    let mapStationsAbortController = null;
    let mapStationsTimeout = null;
    const mapMarkers = new Map();

    const GRAPE_VARIETIES = [
        { name: 'Рислинг', type: 'белый', min: 850, max: 1400, note: 'прохладный климат, высокая кислотность' },
        { name: 'Пино Нуар', type: 'красный', min: 900, max: 1450, note: 'прохладные и умеренные регионы' },
        { name: 'Шардоне', type: 'белый', min: 950, max: 1550, note: 'широкий диапазон стилей' },
        { name: 'Совиньон Блан', type: 'белый', min: 900, max: 1450, note: 'прохладный и умеренный климат' },
        { name: 'Гевюрцтраминер', type: 'белый', min: 950, max: 1450, note: 'ароматные вина прохладных зон' },
        { name: 'Гаме', type: 'красный', min: 1000, max: 1500, note: 'раннее созревание' },
        { name: 'Шенен Блан', type: 'белый', min: 1000, max: 1600, note: 'умеренный климат' },
        { name: 'Каберне Фран', type: 'красный', min: 1200, max: 1700, note: 'умеренно тёплые регионы' },
        { name: 'Мерло', type: 'красный', min: 1250, max: 1750, note: 'умеренно тёплый климат' },
        { name: 'Темпранильо', type: 'красный', min: 1300, max: 1850, note: 'тёплые сухие регионы' },
        { name: 'Неббиоло', type: 'красный', min: 1300, max: 1850, note: 'длинный сезон созревания' },
        { name: 'Санджовезе', type: 'красный', min: 1400, max: 1950, note: 'умеренно тёплые и тёплые зоны' },
        { name: 'Сира / Шираз', type: 'красный', min: 1400, max: 2000, note: 'тёплый климат' },
        { name: 'Каберне Совиньон', type: 'красный', min: 1500, max: 2050, note: 'тёплые регионы, позднее созревание' },
        { name: 'Зинфандель', type: 'красный', min: 1500, max: 2050, note: 'тёплый климат' },
        { name: 'Гренаш', type: 'красный', min: 1600, max: 2150, note: 'жаркие и сухие регионы' },
        { name: 'Мурведр', type: 'красный', min: 1700, max: 2250, note: 'очень тёплый климат, позднее созревание' },
    ];

    stationInput.addEventListener('input', function () {
        const query = this.value.trim();

        stationIdInput.value = '';
        selectedStationEl.classList.remove('active');
        selectedStationEl.textContent = '';
        selectedStationName = '';
        calcBtn.disabled = true;
        updateSelectedMapMarker('');

        if (query.length < 2) {
            suggestionsEl.classList.remove('active');
            return;
        }

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchStations(query), 300);
    });

    document.querySelectorAll('.station-chip').forEach((chip) => {
        chip.addEventListener('click', function () {
            selectStation(this.dataset.stationId, this.dataset.stationName);
            hideError();
            focusStationBySearch(this.dataset.stationId);
        });
    });

    document.addEventListener('click', function (e) {
        if (!e.target.closest('.autocomplete-wrapper')) {
            suggestionsEl.classList.remove('active');
        }

        const popupButton = e.target.closest('.map-popup-button');
        if (!popupButton) {
            return;
        }

        const stationId = popupButton.dataset.stationId;
        const marker = mapMarkers.get(String(stationId));

        if (marker) {
            marker.fire('click');
        }
    });

    calcBtn.addEventListener('click', calculate);
    initStationMap();

    async function searchStations(query) {
        try {
            const response = await fetch(`${API_BASE}/stations/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) {
                throw new Error('Ошибка поиска');
            }

            const data = await response.json();
            showSuggestions(data.results || []);
        } catch (err) {
            console.error('Search error:', err);
        }
    }

    function showSuggestions(stations) {
        suggestionsEl.innerHTML = '';

        if (stations.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'Ничего не найдено';
            li.style.color = '#a0aec0';
            suggestionsEl.appendChild(li);
        } else {
            stations.forEach((station) => {
                const li = document.createElement('li');
                li.dataset.id = station.id;
                li.dataset.name = station.name;

                const nameSpan = document.createElement('span');
                nameSpan.textContent = station.name;

                const metaSpan = document.createElement('span');
                metaSpan.className = 'country';

                const meta = buildStationMeta(station);
                metaSpan.textContent = meta ? `(${meta})` : '';

                li.appendChild(nameSpan);
                li.appendChild(metaSpan);

                li.addEventListener('click', function () {
                    selectStation(station.id, station.name, station);
                    hideError();
                });

                suggestionsEl.appendChild(li);
            });
        }

        suggestionsEl.classList.add('active');
    }

    function selectStation(id, name, station = null, options = {}) {
        stationIdInput.value = id || '';
        stationInput.value = name || '';
        selectedStationName = name || '';

        const stationMeta = station ? buildStationMeta(station) : '';
        selectedStationEl.textContent = `✅ Выбрана: ${selectedStationName} (${id})${stationMeta ? ` · ${stationMeta}` : ''}`;
        selectedStationEl.classList.add('active');
        suggestionsEl.classList.remove('active');
        calcBtn.disabled = !stationIdInput.value;

        updateSelectedMapMarker(id);

        if (station && options.focusMap !== false) {
            focusStationOnMap(station);
        }
    }

    function initStationMap() {
        if (!mapEl || !mapStatusEl) {
            return;
        }

        if (!window.L) {
            setMapStatus('Карта недоступна: Leaflet не загружен');
            return;
        }

        stationMap = L.map(mapEl, {
            preferCanvas: true,
            worldCopyJump: true,
        }).setView([46.5, 2.5], 5);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap contributors',
        }).addTo(stationMap);

        stationMarkersLayer = L.layerGroup().addTo(stationMap);

        stationMap.on('moveend', queueLoadMapStations);
        stationMap.whenReady(() => {
            stationMap.invalidateSize();
            loadMapStationsForBounds();
        });
    }

    function queueLoadMapStations() {
        clearTimeout(mapStationsTimeout);
        mapStationsTimeout = setTimeout(loadMapStationsForBounds, 250);
    }

    async function loadMapStationsForBounds() {
        if (!stationMap) {
            return;
        }

        const bounds = stationMap.getBounds();
        const zoom = stationMap.getZoom();
        const limit = zoom <= 3 ? 300 : zoom <= 5 ? 500 : 800;
        const params = new URLSearchParams({
            south: String(bounds.getSouth()),
            west: String(bounds.getWest()),
            north: String(bounds.getNorth()),
            east: String(bounds.getEast()),
            limit: String(limit),
        });

        if (mapStationsAbortController) {
            mapStationsAbortController.abort();
        }

        const controller = new AbortController();
        mapStationsAbortController = controller;
        setMapStatus('Загрузка станций...');

        try {
            const response = await fetch(`${API_BASE}/stations/bounds?${params.toString()}`, {
                signal: controller.signal,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Ошибка загрузки станций для карты');
            }

            const data = await response.json();
            const stations = data.stations || [];

            renderMapStations(stations);

            const shown = stations.length;
            const total = Number(data.total) || shown;
            setMapStatus(total > shown ? `Показано ${shown} из ${total}` : `Показано ${shown}`);
        } catch (err) {
            if (err.name === 'AbortError') {
                return;
            }

            console.error('Map stations error:', err);
            setMapStatus(err.message || 'Ошибка загрузки станций');
        } finally {
            if (mapStationsAbortController === controller) {
                mapStationsAbortController = null;
            }
        }
    }

    function renderMapStations(stations) {
        if (!stationMarkersLayer) {
            return;
        }

        stationMarkersLayer.clearLayers();
        mapMarkers.clear();

        stations.forEach((station) => {
            const latitude = Number(station.latitude);
            const longitude = Number(station.longitude);

            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return;
            }

            const selected = String(station.id || '') === String(stationIdInput.value || '');
            const marker = L.circleMarker([latitude, longitude], {
                radius: selected ? 7 : 5,
                color: selected ? '#c05621' : '#2f855a',
                weight: selected ? 3 : 2,
                fillColor: selected ? '#ed8936' : '#48bb78',
                fillOpacity: selected ? 0.9 : 0.78,
            });

            marker.bindPopup(buildStationPopup(station));
            marker.on('click', () => {
                selectStation(station.id, station.name, station, { focusMap: false });
                marker.openPopup();
                hideError();
            });

            marker.addTo(stationMarkersLayer);
            mapMarkers.set(String(station.id), marker);
        });

        updateSelectedMapMarker(stationIdInput.value);
    }

    function buildStationPopup(station) {
        const meta = buildStationMeta(station);
        const dailyStart = station.daily_start ? formatDate(station.daily_start) : '—';
        const dailyEnd = station.daily_end ? formatDate(station.daily_end) : '—';

        return `
            <div class="map-popup">
                <strong>${escapeHtml(station.name || station.id || 'Метеостанция')}</strong>
                ${meta ? `<div>${escapeHtml(meta)}</div>` : ''}
                <div>ID: ${escapeHtml(station.id || '—')}</div>
                <div>Daily: ${escapeHtml(dailyStart)} — ${escapeHtml(dailyEnd)}</div>
                <button type="button" class="map-popup-button" data-station-id="${escapeHtml(station.id || '')}">Выбрать</button>
            </div>
        `;
    }

    function focusStationOnMap(station) {
        if (!stationMap) {
            return;
        }

        const latitude = Number(station.latitude);
        const longitude = Number(station.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return;
        }

        stationMap.setView([latitude, longitude], Math.max(stationMap.getZoom(), 8));
        updateSelectedMapMarker(station.id);
    }

    async function focusStationBySearch(stationId) {
        if (!stationId) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/stations/search?q=${encodeURIComponent(stationId)}`);
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const station = (data.results || []).find((item) => String(item.id) === String(stationId));

            if (station) {
                focusStationOnMap(station);
            }
        } catch (err) {
            console.error('Station focus error:', err);
        }
    }

    function updateSelectedMapMarker(stationId) {
        if (!mapMarkers.size) {
            return;
        }

        mapMarkers.forEach((marker, id) => {
            const selected = stationId && String(id) === String(stationId);
            marker.setStyle({
                radius: selected ? 7 : 5,
                color: selected ? '#c05621' : '#2f855a',
                weight: selected ? 3 : 2,
                fillColor: selected ? '#ed8936' : '#48bb78',
                fillOpacity: selected ? 0.9 : 0.78,
            });
        });
    }

    function buildStationMeta(station) {
        const location = [station.country, station.region].filter(Boolean).join(', ');
        const coords = Number.isFinite(Number(station.latitude)) && Number.isFinite(Number(station.longitude))
            ? `${Number(station.latitude).toFixed(3)}, ${Number(station.longitude).toFixed(3)}`
            : '';

        return [location, coords].filter(Boolean).join(' · ');
    }

    function setMapStatus(message) {
        if (mapStatusEl) {
            mapStatusEl.textContent = message;
        }
    }

    async function calculate(options = {}) {
        const stationId = stationIdInput.value;
        if (!stationId) {
            return;
        }

        const currentYear = new Date().getFullYear();
        const startYear = parseInt(startYearInput.value, 10) || (currentYear - 19);
        const endYear = parseInt(endYearInput.value, 10) || currentYear;
        const seasonOnly = seasonOnlyInput.checked;

        if (startYear > endYear) {
            showError('Начальный год не может быть больше конечного');
            return;
        }

        hideError();
        loadingEl.classList.remove('hidden');
        resultsContainer.classList.add('hidden');
        warningsEl.classList.add('hidden');
        warningsEl.innerHTML = '';
        calcBtn.disabled = true;

        try {
            const params = new URLSearchParams({
                station_id: stationId,
                start: String(startYear),
                end: String(endYear),
                season_only: seasonOnly ? '1' : '0',
            });

            if (options.updateUrl !== false) {
                syncUrlParams(stationId, startYear, endYear, seasonOnly);
            }

            const response = await fetch(`${API_BASE}/calculate?${params.toString()}`);

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Ошибка расчёта');
            }

            const data = await response.json();
            displayResults(data);
        } catch (err) {
            showError(err.message);
        } finally {
            loadingEl.classList.add('hidden');
            calcBtn.disabled = !stationIdInput.value;
        }
    }

    function displayResults(data) {
        const results = data.results || [];

        if (results.length === 0) {
            showError('Нет данных за выбранный период. Возможно, станция не имеет достаточно полных записей.');
            return;
        }

        const calculatedResults = results.filter(isCalculatedResult);
        const skippedCount = results.length - calculatedResults.length;
        const modeLabel = data.season_only ? 'автоматически уточнённый сезон' : 'фиксированный период';
        resultsTitle.textContent = `📊 ${data.station || selectedStationName} (${data.start}–${data.end}, ${modeLabel})`;
        dataInfoEl.textContent = buildDataInfo(data);
        displayWarnings(data.warnings || []);

        resultsBody.innerHTML = '';

        let totalSat = 0;
        let totalGdd = 0;
        let totalCalculationDays = 0;
        let rowsWithCalculationDays = 0;

        calculatedResults.forEach((r) => {
            totalSat += Number(r.sat) || 0;
            totalGdd += Number(r.gdd) || 0;

            if (r.calculation_days !== null && r.calculation_days !== undefined) {
                totalCalculationDays += Number(r.calculation_days) || 0;
                rowsWithCalculationDays++;
            }
        });

        results.forEach((r) => {
            const tr = document.createElement('tr');
            const daysLabel = formatDaysLabel(r);
            const calculationPeriod = formatCalculationPeriod(r, data.season_only);
            const calculationDays = formatCalculationDays(r, data.season_only);

            if (r.skipped) {
                const skipReason = r.skip_reason || 'Расчёт пропущен из-за нехватки дней с данными в вегетационный период';

                tr.classList.add('result-row-skipped');
                tr.title = skipReason;
                tr.innerHTML = `
                    <td>${r.year}</td>
                    <td colspan="4" class="result-skip-message">${escapeHtml(skipReason)}</td>
                    <td>${daysLabel}</td>
                `;
            } else {
                tr.innerHTML = `
                    <td>${r.year}</td>
                    <td>${formatMetric(r.sat, r.skipped)}</td>
                    <td>${formatMetric(r.gdd, r.skipped)}</td>
                    <td>${calculationPeriod}</td>
                    <td>${calculationDays}</td>
                    <td>${daysLabel}</td>
                `;
            }

            resultsBody.appendChild(tr);
        });

        const avgCalculationDays = rowsWithCalculationDays > 0
            ? (totalCalculationDays / rowsWithCalculationDays).toFixed(1)
            : null;
        const avgDaysLabel = data.season_only ? 'Средняя длина сезона' : 'Среднее дней в расчёте';
        const avgGdd = calculatedResults.length > 0 ? totalGdd / calculatedResults.length : null;
        const averages = [];

        if (calculatedResults.length > 0) {
            averages.push(`<div>Средний SAT: <span>${Math.round(totalSat / calculatedResults.length)} °C</span></div>`);
            averages.push(`<div>Средний GDD: <span>${Math.round(avgGdd)}</span></div>`);
        } else {
            averages.push('<div>Средний SAT/GDD: <span>нет рассчитанных лет</span></div>');
        }

        if (avgCalculationDays !== null) {
            averages.push(`<div>${avgDaysLabel}: <span>${avgCalculationDays} дней</span></div>`);
        }

        averages.push(`<div>Рассчитано лет: <span>${calculatedResults.length}</span></div>`);

        if (skippedCount > 0) {
            averages.push(`<div>Пропущено лет: <span>${skippedCount}</span></div>`);
        }

        averages.push(`<div>Показано лет: <span>${results.length}</span></div>`);
        averagesEl.innerHTML = averages.join('');

        displayGrapeVarieties(avgGdd);
        drawChart(calculatedResults);
        resultsContainer.classList.remove('hidden');
    }

    function displayWarnings(warnings) {
        warningsEl.innerHTML = '';

        if (!Array.isArray(warnings) || warnings.length === 0) {
            warningsEl.classList.add('hidden');
            return;
        }

        const list = document.createElement('ul');

        warnings.forEach((warning) => {
            const item = document.createElement('li');
            item.textContent = warning;
            list.appendChild(item);
        });

        warningsEl.appendChild(list);
        warningsEl.classList.remove('hidden');
    }

    function displayGrapeVarieties(avgGdd) {
        grapeVarietiesEl.innerHTML = '';

        if (!Number.isFinite(avgGdd)) {
            grapeVarietiesEl.classList.add('hidden');
            return;
        }

        const roundedGdd = Math.round(avgGdd);
        const matched = GRAPE_VARIETIES
            .filter((variety) => roundedGdd >= variety.min && roundedGdd <= variety.max)
            .sort((a, b) => distanceToRangeCenter(roundedGdd, a) - distanceToRangeCenter(roundedGdd, b));

        const varieties = matched.length > 0
            ? matched
            : GRAPE_VARIETIES
                .map((variety) => ({
                    ...variety,
                    distance: distanceToRange(roundedGdd, variety),
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5);

        const title = matched.length > 0
            ? `🍇 Подходящие сорта по среднему GDD (${roundedGdd})`
            : `🍇 Ближайшие сорта по среднему GDD (${roundedGdd})`;
        const description = matched.length > 0
            ? 'Сорта, для которых среднее значение GDD попадает в ориентировочный диапазон созревания.'
            : 'Точного совпадения с каталогом нет, показаны ближайшие ориентировочные диапазоны созревания.';

        grapeVarietiesEl.innerHTML = `
            <div class="grape-varieties__header">
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(description)}</p>
            </div>
            <div class="grape-varieties__grid">
                ${varieties.map((variety) => `
                    <article class="grape-variety-card${matched.length === 0 ? ' grape-variety-card--nearest' : ''}">
                        <div class="grape-variety-card__top">
                            <strong>${escapeHtml(variety.name)}</strong>
                            <span>${escapeHtml(variety.type)}</span>
                        </div>
                        <div class="grape-variety-card__range">${escapeHtml(formatGddRange(variety))}</div>
                        <div class="grape-variety-card__note">${escapeHtml(variety.note)}</div>
                    </article>
                `).join('')}
            </div>
            <div class="grape-varieties__footnote">
                Диапазоны ориентировочные: фактическая пригодность зависит от сорта/клона, экспозиции, почв, осадков, риска заморозков и агротехники.
            </div>
        `;
        grapeVarietiesEl.classList.remove('hidden');
    }

    function distanceToRange(value, variety) {
        if (value < variety.min) {
            return variety.min - value;
        }

        if (value > variety.max) {
            return value - variety.max;
        }

        return 0;
    }

    function distanceToRangeCenter(value, variety) {
        return Math.abs(value - ((variety.min + variety.max) / 2));
    }

    function formatGddRange(variety) {
        return `${variety.min}–${variety.max} GDD`;
    }

    function buildDataInfo(data) {
        const parts = [];

        if (data.station_id) {
            parts.push(`ID станции: ${data.station_id}`);
        }

        const location = [data.country, data.region].filter(Boolean).join(', ');
        if (location) {
            parts.push(`место: ${location}`);
        }

        if (data.hemisphere_label) {
            parts.push(data.hemisphere_label);
        }

        if (data.latitude !== null && data.latitude !== undefined) {
            const latitude = Number(data.latitude).toFixed(4);
            const longitude = data.longitude !== null && data.longitude !== undefined
                ? Number(data.longitude).toFixed(4)
                : '—';
            parts.push(`координаты: ${latitude}, ${longitude}`);
        }

        const basePeriod = data.hemisphere === 'south'
            ? 'базовый период: 01.09 предыдущего года — 31.05 текущего года'
            : 'базовый период: 01.03 — 30.11';

        parts.push(data.season_only
            ? `${basePeriod}; границы сезона уточнены автоматически`
            : basePeriod);

        if (data.last_record_date) {
            parts.push(`последняя доступная запись Meteostat: ${formatDate(data.last_record_date)}`);
        }

        if (data.station_daily_start || data.station_daily_end) {
            const dailyStart = data.station_daily_start ? formatDate(data.station_daily_start) : '—';
            const dailyEnd = data.station_daily_end ? formatDate(data.station_daily_end) : '—';
            parts.push(`паспортный период станции: ${dailyStart} — ${dailyEnd}`);
        }

        return parts.join(' · ');
    }

    function isCalculatedResult(result) {
        return !result.skipped && result.sat !== null && result.sat !== undefined && result.gdd !== null && result.gdd !== undefined;
    }

    function formatMetric(value, skipped) {
        if (skipped || value === null || value === undefined) {
            return '—';
        }

        return String(value);
    }

    function formatDaysLabel(result) {
        const days = result.days ?? '—';
        const expectedDays = result.expected_days ? ` из ${result.expected_days}` : '';
        const minimumDays = result.minimum_days ? `, минимум ${result.minimum_days}` : '';
        const partial = result.partial ? ' (текущий период)' : '';

        return `${days}${expectedDays}${minimumDays}${partial}`;
    }

    function drawChart(results) {
        if (!chartCtx || !chartCanvas) {
            return;
        }

        const width = chartCanvas.width;
        const height = chartCanvas.height;
        const padding = {
            top: 34,
            right: 28,
            bottom: 50,
            left: 64,
        };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;

        chartCtx.clearRect(0, 0, width, height);
        chartCtx.fillStyle = '#ffffff';
        chartCtx.fillRect(0, 0, width, height);

        if (!Array.isArray(results) || results.length === 0) {
            return;
        }

        const values = results.flatMap((result) => [Number(result.sat) || 0, Number(result.gdd) || 0]);
        const maxValue = Math.max(1, ...values);
        const roundedMax = Math.ceil(maxValue / 500) * 500 || maxValue;
        const yMax = roundedMax < maxValue ? maxValue : roundedMax;

        chartCtx.strokeStyle = '#e2e8f0';
        chartCtx.lineWidth = 1;
        chartCtx.fillStyle = '#718096';
        chartCtx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        chartCtx.textAlign = 'right';
        chartCtx.textBaseline = 'middle';

        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
            const y = padding.top + (plotHeight / gridLines) * i;
            const value = Math.round(yMax - (yMax / gridLines) * i);

            chartCtx.beginPath();
            chartCtx.moveTo(padding.left, y);
            chartCtx.lineTo(width - padding.right, y);
            chartCtx.stroke();

            chartCtx.fillText(String(value), padding.left - 10, y);
        }

        chartCtx.strokeStyle = '#a0aec0';
        chartCtx.beginPath();
        chartCtx.moveTo(padding.left, padding.top);
        chartCtx.lineTo(padding.left, height - padding.bottom);
        chartCtx.lineTo(width - padding.right, height - padding.bottom);
        chartCtx.stroke();

        const xForIndex = (index) => {
            if (results.length === 1) {
                return padding.left + plotWidth / 2;
            }

            return padding.left + (plotWidth / (results.length - 1)) * index;
        };

        const yForValue = (value) => padding.top + plotHeight - ((Number(value) || 0) / yMax) * plotHeight;

        function drawSeries(key, color) {
            chartCtx.strokeStyle = color;
            chartCtx.fillStyle = color;
            chartCtx.lineWidth = 3;
            chartCtx.beginPath();

            results.forEach((result, index) => {
                const x = xForIndex(index);
                const y = yForValue(result[key]);

                if (index === 0) {
                    chartCtx.moveTo(x, y);
                } else {
                    chartCtx.lineTo(x, y);
                }
            });

            chartCtx.stroke();

            results.forEach((result, index) => {
                const x = xForIndex(index);
                const y = yForValue(result[key]);

                chartCtx.beginPath();
                chartCtx.arc(x, y, 4, 0, Math.PI * 2);
                chartCtx.fill();
            });
        }

        drawSeries('sat', '#ed8936');
        drawSeries('gdd', '#3182ce');

        chartCtx.fillStyle = '#2d3748';
        chartCtx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        chartCtx.textAlign = 'center';
        chartCtx.textBaseline = 'top';

        const labelStep = Math.max(1, Math.ceil(results.length / 10));
        results.forEach((result, index) => {
            if (index % labelStep !== 0 && index !== results.length - 1) {
                return;
            }

            chartCtx.fillText(String(result.year), xForIndex(index), height - padding.bottom + 14);
        });

        drawLegend([
            { label: 'SAT', color: '#ed8936' },
            { label: 'GDD', color: '#3182ce' },
        ]);
    }

    function drawLegend(items) {
        if (!chartCtx) {
            return;
        }

        let x = 72;
        const y = 18;

        chartCtx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        chartCtx.textAlign = 'left';
        chartCtx.textBaseline = 'middle';

        items.forEach((item) => {
            chartCtx.fillStyle = item.color;
            chartCtx.fillRect(x, y - 5, 18, 4);

            chartCtx.fillStyle = '#2d3748';
            chartCtx.fillText(item.label, x + 26, y);

            x += chartCtx.measureText(item.label).width + 72;
        });
    }

    function formatCalculationPeriod(result, seasonOnly) {
        if (result.skipped) {
            return escapeHtml(result.skip_reason || 'расчёт пропущен');
        }

        if (result.calculation_start && result.calculation_end) {
            return `${formatDate(result.calculation_start)} — ${formatDate(result.calculation_end)}`;
        }

        if (seasonOnly) {
            if (!result.season_start || !result.season_end) {
                return 'не найден';
            }

            return `${formatDate(result.season_start)} — ${formatDate(result.season_end)}`;
        }

        return '—';
    }

    function formatCalculationDays(result, seasonOnly) {
        if (result.skipped) {
            return '—';
        }

        if (result.calculation_days !== null && result.calculation_days !== undefined) {
            return result.calculation_days;
        }

        if (seasonOnly) {
            return result.season_days ?? '—';
        }

        return result.days ?? '—';
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '\u0026amp;')
            .replaceAll('<', '\u0026lt;')
            .replaceAll('>', '\u0026gt;')
            .replaceAll('"', '\u0026quot;')
            .replaceAll("'", '\u0026#039;');
    }

    function formatDate(value) {
        const parts = String(value).split('-');
        if (parts.length !== 3) {
            return value;
        }

        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
        warningsEl.classList.add('hidden');
        warningsEl.innerHTML = '';
        grapeVarietiesEl.classList.add('hidden');
        grapeVarietiesEl.innerHTML = '';
    }

    function hideError() {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
    }

    function initializeDefaults() {
        const currentYear = new Date().getFullYear();
        endYearInput.value = currentYear;
        startYearInput.value = currentYear - 19;
    }

    async function initFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const stationId = (params.get('station_id') || params.get('station') || params.get('id') || '').trim();

        const startYear = parseInt(params.get('start') || '', 10);
        const endYear = parseInt(params.get('end') || '', 10);

        if (Number.isFinite(startYear)) {
            startYearInput.value = startYear;
        }

        if (Number.isFinite(endYear)) {
            endYearInput.value = endYear;
        }

        if (params.has('season_only')) {
            seasonOnlyInput.checked = parseBooleanParam(params.get('season_only'), seasonOnlyInput.checked);
        }

        if (!stationId) {
            return;
        }

        const stationName = (params.get('station_name') || params.get('name') || stationId).trim();
        selectStation(stationId, stationName || stationId, null, { focusMap: false });

        try {
            const response = await fetch(`${API_BASE}/stations/get?id=${encodeURIComponent(stationId)}`);

            if (response.ok) {
                const data = await response.json();

                if (data.station) {
                    selectStation(data.station.id, data.station.name, data.station, { focusMap: true });
                }
            }
        } catch (err) {
            console.error('URL station load error:', err);
        }

        calculate({ updateUrl: false });
    }

    function parseBooleanParam(value, fallback) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
    }

    function syncUrlParams(stationId, startYear, endYear, seasonOnly) {
        if (!window.history || !window.location) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        params.set('station_id', stationId);
        params.set('start', String(startYear));
        params.set('end', String(endYear));
        params.set('season_only', seasonOnly ? '1' : '0');

        if (selectedStationName) {
            params.set('station_name', selectedStationName);
        } else {
            params.delete('station_name');
        }

        const query = params.toString();
        const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', nextUrl);
    }

    initializeDefaults();
    initFromUrl();
})();
