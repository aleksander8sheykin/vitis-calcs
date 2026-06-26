<?php

namespace App;

class StationFinder
{
    private const STATIONS_URL = 'https://bulk.meteostat.net/v2/stations/lite.json.gz';
    private const CACHE_TTL = 604800; // 7 дней

    /**
     * @var array<int, array<string, mixed>>|null
     */
    private ?array $allStations = null;

    private function cacheFile(): string
    {
        // v3-latin-coordinates — отдельный кэш, чтобы не использовать старые записи без координат.
        return sys_get_temp_dir() . '/vine-calcs-meteostat-stations-v3-latin-coordinates.json';
    }

    /**
     * Загрузить и закэшировать список станций Meteostat.
     *
     * Важно: для отображения и поиска используем латинские/английские названия.
     * Русские ручные алиасы и русские названия здесь намеренно не используются.
     *
     * @return array<int, array<string, mixed>>
     */
    private function loadAllStations(): array
    {
        if ($this->allStations !== null) {
            return $this->allStations;
        }

        $cacheFile = $this->cacheFile();
        if (is_file($cacheFile) && (time() - filemtime($cacheFile) < self::CACHE_TTL)) {
            $cached = json_decode((string) file_get_contents($cacheFile), true);
            if (is_array($cached)) {
                $this->allStations = $cached;
                return $this->allStations;
            }
        }

        $context = stream_context_create([
            'http' => [
                'timeout' => 30,
                'user_agent' => 'Mozilla/5.0 (compatible; VineCalcs/1.0)',
            ],
        ]);

        $gzData = @file_get_contents(self::STATIONS_URL, false, $context);
        if ($gzData === false) {
            throw new \RuntimeException('Не удалось загрузить список метеостанций Meteostat');
        }

        $json = @gzdecode($gzData);
        if ($json === false) {
            throw new \RuntimeException('Ошибка распаковки списка метеостанций Meteostat');
        }

        $data = json_decode($json, true);
        if (!is_array($data)) {
            throw new \RuntimeException('Ошибка парсинга списка метеостанций Meteostat');
        }

        $stations = [];

        foreach ($data as $item) {
            if (!is_array($item) || empty($item['id'])) {
                continue;
            }

            $name = $this->pickLatinName($item['name'] ?? null);
            if ($name === '') {
                continue;
            }

            $dailyStart = $item['inventory']['daily']['start'] ?? null;
            $dailyEnd = $item['inventory']['daily']['end'] ?? null;
            $coordinates = $this->extractCoordinates($item);

            // Калькулятор работает по daily-данным, поэтому станции без daily-инвентаря
            // в поиске не показываем.
            if ($dailyStart === null && $dailyEnd === null) {
                continue;
            }

            $stations[] = [
                'id' => (string) $item['id'],
                'name' => $name,
                'country' => (string) ($item['country'] ?? ''),
                'region' => (string) ($item['region'] ?? ''),
                'latitude' => $coordinates['latitude'],
                'longitude' => $coordinates['longitude'],
                'daily_start' => $dailyStart,
                'daily_end' => $dailyEnd,
                'identifiers' => [
                    'national' => $item['identifiers']['national'] ?? null,
                    'wmo' => $item['identifiers']['wmo'] ?? null,
                    'icao' => $item['identifiers']['icao'] ?? null,
                ],
            ];
        }

        $this->allStations = $stations;

        $cacheDir = dirname($cacheFile);
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0777, true);
        }

        @file_put_contents(
            $cacheFile,
            json_encode($stations, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );

        return $this->allStations;
    }

    /**
     * Достать координаты станции из разных вариантов структуры Meteostat.
     *
     * @param array<string, mixed> $item
     * @return array{latitude: float|null, longitude: float|null}
     */
    private function extractCoordinates(array $item): array
    {
        $latitude = $this->toFloat(
            $item['latitude']
            ?? $item['lat']
            ?? $item['location']['latitude']
            ?? $item['location']['lat']
            ?? null
        );

        $longitude = $this->toFloat(
            $item['longitude']
            ?? $item['lon']
            ?? $item['location']['longitude']
            ?? $item['location']['lon']
            ?? null
        );

        $coordinates = $item['location']['coordinates'] ?? null;
        if (($latitude === null || $longitude === null) && is_array($coordinates)) {
            // На случай GeoJSON-порядка [longitude, latitude].
            $geoLongitude = $this->toFloat($coordinates[0] ?? null);
            $geoLatitude = $this->toFloat($coordinates[1] ?? null);

            $latitude ??= $geoLatitude;
            $longitude ??= $geoLongitude;
        }

        return [
            'latitude' => $latitude,
            'longitude' => $longitude,
        ];
    }

    private function toFloat(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (float) $value : null;
    }

    /**
     * Выбрать название станции на латинице.
     *
     * @param mixed $name
     */
    private function pickLatinName(mixed $name): string
    {
        if (is_array($name)) {
            // Сначала берём английское название, если оно есть.
            if (!empty($name['en']) && is_string($name['en'])) {
                $candidate = trim($name['en']);
                if ($candidate !== '' && !$this->containsCyrillic($candidate)) {
                    return $candidate;
                }
            }

            // Затем — первое доступное некириллическое название.
            foreach ($name as $value) {
                if (!is_scalar($value)) {
                    continue;
                }

                $candidate = trim((string) $value);
                if ($candidate !== '' && !$this->containsCyrillic($candidate)) {
                    return $candidate;
                }
            }

            return '';
        }

        if (is_scalar($name)) {
            $candidate = trim((string) $name);
            return $candidate !== '' && !$this->containsCyrillic($candidate) ? $candidate : '';
        }

        return '';
    }

    private function containsCyrillic(string $value): bool
    {
        return preg_match('/\p{Cyrillic}/u', $value) === 1;
    }

    /**
     * Найти станции по названию, ID, стране, региону или идентификаторам Meteostat.
     *
     * Русские ручные алиасы не используются: поиск идёт только по списку Meteostat.
     *
     * @return array<int, array<string, mixed>>
     */
    public function search(string $query, int $limit = 20): array
    {
        $query = trim($query);
        $limit = max(1, min($limit, 100));

        if ($query === '') {
            return [];
        }

        $needle = $this->lower($query);
        $matches = [];

        foreach ($this->loadAllStations() as $station) {
            $score = $this->matchScore($station, $needle);
            if ($score === null) {
                continue;
            }

            $id = (string) $station['id'];
            if (!isset($matches[$id]) || $score < $matches[$id]['score']) {
                $matches[$id] = [
                    'score' => $score,
                    'station' => $station,
                ];
            }
        }

        uasort($matches, function (array $a, array $b): int {
            $byScore = $a['score'] <=> $b['score'];
            if ($byScore !== 0) {
                return $byScore;
            }

            return strcmp((string) $a['station']['name'], (string) $b['station']['name']);
        });

        $results = [];
        foreach ($matches as $match) {
            $station = $match['station'];
            unset($station['identifiers']);
            $results[] = $station;

            if (count($results) >= $limit) {
                break;
            }
        }

        return $results;
    }

    /**
     * Получить станции с координатами в пределах видимой области карты.
     *
     * @return array{stations: array<int, array<string, mixed>>, total: int, limit: int}
     */
    public function stationsInBounds(float $south, float $west, float $north, float $east, int $limit = 500): array
    {
        if ($south > $north) {
            [$south, $north] = [$north, $south];
        }

        $south = max(-90.0, min(90.0, $south));
        $north = max(-90.0, min(90.0, $north));
        $west = $this->normalizeLongitude($west);
        $east = $this->normalizeLongitude($east);
        $limit = max(1, min($limit, 1000));

        $centerLatitude = ($south + $north) / 2;
        if ($west <= $east) {
            $centerLongitude = ($west + $east) / 2;
        } else {
            // Область пересекает 180-й меридиан.
            $span = (180 - $west) + ($east + 180);
            $centerLongitude = $this->normalizeLongitude($west + $span / 2);
        }

        $matches = [];

        foreach ($this->loadAllStations() as $station) {
            $latitude = isset($station['latitude']) && is_numeric($station['latitude'])
                ? (float) $station['latitude']
                : null;
            $longitude = isset($station['longitude']) && is_numeric($station['longitude'])
                ? (float) $station['longitude']
                : null;

            if ($latitude === null || $longitude === null) {
                continue;
            }

            if ($latitude < $south || $latitude > $north) {
                continue;
            }

            if (!$this->longitudeWithin($longitude, $west, $east)) {
                continue;
            }

            $distance = (($latitude - $centerLatitude) ** 2)
                + ($this->longitudeDelta($longitude, $centerLongitude) ** 2);

            $matches[] = [
                'distance' => $distance,
                'station' => $station,
            ];
        }

        usort($matches, function (array $a, array $b): int {
            $byDistance = $a['distance'] <=> $b['distance'];
            if ($byDistance !== 0) {
                return $byDistance;
            }

            return strcmp((string) $a['station']['name'], (string) $b['station']['name']);
        });

        $total = count($matches);
        $stations = [];

        foreach (array_slice($matches, 0, $limit) as $match) {
            $station = $match['station'];
            unset($station['identifiers']);
            $stations[] = $station;
        }

        return [
            'stations' => $stations,
            'total' => $total,
            'limit' => $limit,
        ];
    }

    private function matchScore(array $station, string $needle): ?int
    {
        $haystacks = [
            (string) ($station['id'] ?? ''),
            (string) ($station['name'] ?? ''),
            (string) ($station['country'] ?? ''),
            (string) ($station['region'] ?? ''),
        ];

        foreach (($station['identifiers'] ?? []) as $identifier) {
            if ($identifier !== null && $identifier !== '') {
                $haystacks[] = (string) $identifier;
            }
        }

        $best = null;
        foreach ($haystacks as $haystack) {
            $haystack = $this->lower($haystack);
            if ($haystack === '') {
                continue;
            }

            if ($haystack === $needle) {
                $score = 0;
            } elseif (str_starts_with($haystack, $needle)) {
                $score = 10;
            } elseif (str_contains($haystack, $needle)) {
                $score = 20;
            } else {
                continue;
            }

            $best = $best === null ? $score : min($best, $score);
        }

        return $best;
    }

    /**
     * Получить станцию по ID или идентификаторам Meteostat.
     *
     * @return array<string, mixed>|null
     */
    public function getById(string $id): ?array
    {
        $id = trim($id);

        if ($id === '') {
            return null;
        }

        foreach ($this->loadAllStations() as $station) {
            if ((string) $station['id'] === $id) {
                unset($station['identifiers']);
                return $station;
            }

            foreach (($station['identifiers'] ?? []) as $identifier) {
                if ($identifier !== null && (string) $identifier === $id) {
                    unset($station['identifiers']);
                    return $station;
                }
            }
        }

        return null;
    }

    private function normalizeLongitude(float $longitude): float
    {
        $normalized = fmod($longitude + 180.0, 360.0);

        if ($normalized < 0) {
            $normalized += 360.0;
        }

        return $normalized - 180.0;
    }

    private function longitudeWithin(float $longitude, float $west, float $east): bool
    {
        $longitude = $this->normalizeLongitude($longitude);

        if ($west <= $east) {
            return $longitude >= $west && $longitude <= $east;
        }

        return $longitude >= $west || $longitude <= $east;
    }

    private function longitudeDelta(float $a, float $b): float
    {
        $delta = abs($this->normalizeLongitude($a) - $this->normalizeLongitude($b));

        return $delta > 180.0 ? 360.0 - $delta : $delta;
    }

    private function lower(string $value): string
    {
        return function_exists('mb_strtolower')
            ? mb_strtolower($value, 'UTF-8')
            : strtolower($value);
    }
}
