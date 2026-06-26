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
    const chartCanvas = document.getElementById('results-chart');
    const chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;

    let searchTimeout = null;
    let selectedStationName = '';

    // --- Поиск станций ---
    stationInput.addEventListener('input', function () {
        const query = this.value.trim();

        // Сбрасываем выбранную станцию при изменении текста.
        stationIdInput.value = '';
        selectedStationEl.classList.remove('active');
        selectedStationEl.textContent = '';
        selectedStationName = '';
        calcBtn.disabled = true;

        if (query.length < 2) {
            suggestionsEl.classList.remove('active');
            return;
        }

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchStations(query), 300);
    });

    // Быстрый выбор популярных винных метеостанций.
    document.querySelectorAll('.station-chip').forEach((chip) => {
        chip.addEventListener('click', function () {
            selectStation(this.dataset.stationId, this.dataset.stationName);
            hideError();
        });
    });

    // Закрываем подсказки при клике вне.
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.autocomplete-wrapper')) {
            suggestionsEl.classList.remove('active');
        }
    });

    async function searchStations(query) {
        try {
            const response = await fetch(`${API_BASE}/stations/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Ошибка поиска');

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

                const meta = [station.country, station.region].filter(Boolean).join(', ');
                metaSpan.textContent = meta ? `(${meta})` : '';

                li.appendChild(nameSpan);
                li.appendChild(metaSpan);

                li.addEventListener('click', function () {
                    selectStation(station.id, station.name);
                    hideError();
                });

                suggestionsEl.appendChild(li);
            });
        }

        suggestionsEl.classList.add('active');
    }

    function selectStation(id, name) {
        stationIdInput.value = id || '';
        stationInput.value = name || '';
        selectedStationName = name || '';
        selectedStationEl.textContent = `✅ Выбрана: ${selectedStationName} (${id})`;
        selectedStationEl.classList.add('active');
        suggestionsEl.classList.remove('active');
        calcBtn.disabled = !stationIdInput.value;
    }

    // --- Расчёт ---
    calcBtn.addEventListener('click', calculate);

    async function calculate() {
        const stationId = stationIdInput.value;
        if (!stationId) return;

        const startYear = parseInt(startYearInput.value, 10) || (new Date().getFullYear() - 19);
        const endYear = parseInt(endYearInput.value, 10) || new Date().getFullYear();
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
            showError('Нет данных за выбранный период. Возможно, станция не имеет полных записей.');
            return;
        }

        const modeLabel = data.season_only ? 'сезон вегетации' : 'расчётный период';
        resultsTitle.textContent = `📊 ${data.station || selectedStationName} (${data.start}–${data.end}, ${modeLabel})`;
        dataInfoEl.textContent = buildDataInfo(data);
        displayWarnings(data.warnings || []);

        resultsBody.innerHTML = '';

        let totalSat = 0;
        let totalGdd = 0;
        let totalCalculationDays = 0;
        let rowsWithCalculationDays = 0;

        results.forEach((r) => {
            totalSat += Number(r.sat) || 0;
            totalGdd += Number(r.gdd) || 0;

            if (r.calculation_days !== null && r.calculation_days !== undefined) {
                totalCalculationDays += Number(r.calculation_days) || 0;
                rowsWithCalculationDays++;
            }

            const tr = document.createElement('tr');
            const daysLabel = r.partial ? `${r.days} (текущий год)` : r.days;
            const calculationPeriod = formatCalculationPeriod(r, data.season_only);
            const calculationDays = formatCalculationDays(r, data.season_only);

            tr.innerHTML = `
                <td>${r.year}</td>
                <td>${r.sat}</td>
                <td>${r.gdd}</td>
                <td>${calculationPeriod}</td>
                <td>${calculationDays}</td>
                <td>${daysLabel}</td>
            `;
            resultsBody.appendChild(tr);
        });

        const avgSat = Math.round(totalSat / results.length);
        const avgGdd = Math.round(totalGdd / results.length);
        const avgCalculationDays = rowsWithCalculationDays > 0
            ? (totalCalculationDays / rowsWithCalculationDays).toFixed(1)
            : null;
        const avgDaysLabel = data.season_only ? 'Средняя длина сезона' : 'Среднее дней в расчёте';

        averagesEl.innerHTML = `
            <div>Средний SAT: <span>${avgSat} °C</span></div>
            <div>Средний GDD: <span>${avgGdd}</span></div>
            ${avgCalculationDays !== null ? `<div>${avgDaysLabel}: <span>${avgCalculationDays} дней</span></div>` : ''}
            <div>Количество лет: <span>${results.length}</span></div>
        `;

        drawChart(results);
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

        if (data.season_only) {
            parts.push(data.hemisphere === 'south'
                ? 'годовой период: 15.08 предыдущего года — 31.07 текущего года'
                : 'годовой период: 15.02 — 31.12');
        } else {
            parts.push(data.hemisphere === 'south'
                ? 'расчётный период: 15.08 предыдущего года — 31.07 текущего года'
                : 'расчётный период: 15.02 — 31.12');
        }

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

        function drawSeries(key, color, label) {
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

            return label;
        }

        drawSeries('sat', '#ed8936', 'SAT');
        drawSeries('gdd', '#3182ce', 'GDD');

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
        if (result.calculation_days !== null && result.calculation_days !== undefined) {
            return result.calculation_days;
        }

        if (seasonOnly) {
            return result.season_days ?? '—';
        }

        return result.days ?? '—';
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
    }

    function hideError() {
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
    }

    // Устанавливаем диапазон последних 20 лет по умолчанию, включая текущий.
    const currentYear = new Date().getFullYear();
    endYearInput.value = currentYear;
    startYearInput.value = currentYear - 19;
})();