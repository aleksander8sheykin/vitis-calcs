<?php

$autoload = __DIR__ . '/../vendor/autoload.php';

if (is_file($autoload)) {
    require_once $autoload;
} else {
    spl_autoload_register(function (string $class): void {
        $prefix = 'App\\';
        $baseDir = __DIR__ . '/../src/';

        if (strncmp($prefix, $class, strlen($prefix)) !== 0) {
            return;
        }

        $relativeClass = substr($class, strlen($prefix));
        $file = $baseDir . str_replace('\\', '/', $relativeClass) . '.php';

        if (is_file($file)) {
            require_once $file;
        }
    });
}

use App\Calculator;
use App\MeteostatClient;
use App\StationFinder;

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$currentYear = (int) date('Y');

/**
 * Найти дату последней daily-записи в загруженном файле Meteostat.
 *
 * @param array<int, array<string, mixed>> $records
 */
function latestDailyRecordDate(array $records): ?string
{
    $latest = null;

    foreach ($records as $record) {
        $year = (int) ($record['year'] ?? 0);
        $month = (int) ($record['month'] ?? 0);
        $day = (int) ($record['day'] ?? 0);

        if (!checkdate($month, $day, $year)) {
            continue;
        }

        $date = sprintf('%04d-%02d-%02d', $year, $month, $day);

        if ($latest === null || strcmp($date, $latest) > 0) {
            $latest = $date;
        }
    }

    return $latest;
}

// Поиск метеостанций
if ($uri === '/api/stations/search') {
    $query = $_GET['q'] ?? '';

    try {
        $finder = new StationFinder();
        $results = $finder->search($query);

        echo json_encode(['results' => $results], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    }

    exit;
}

// Станции с координатами в пределах видимой области карты
if ($uri === '/api/stations/bounds') {
    $requiredBounds = ['south', 'west', 'north', 'east'];

    foreach ($requiredBounds as $param) {
        if (!isset($_GET[$param]) || !is_numeric($_GET[$param])) {
            http_response_code(400);
            echo json_encode(['error' => 'Некорректные границы карты'], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    $south = (float) $_GET['south'];
    $west = (float) $_GET['west'];
    $north = (float) $_GET['north'];
    $east = (float) $_GET['east'];
    $limit = isset($_GET['limit']) && is_numeric($_GET['limit'])
        ? (int) $_GET['limit']
        : 500;

    try {
        $finder = new StationFinder();
        $payload = $finder->stationsInBounds($south, $west, $north, $east, $limit);

        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    }

    exit;
}

// Расчёт SAT/GDD для выбранной станции
if ($uri === '/api/calculate') {
    $stationId = trim((string) ($_GET['station_id'] ?? ''));
    $startYear = (int) ($_GET['start'] ?? $currentYear - 19);
    $endYear = (int) ($_GET['end'] ?? $currentYear);
    $seasonOnlyRaw = strtolower(trim((string) ($_GET['season_only'] ?? '0')));
    $seasonOnly = in_array($seasonOnlyRaw, ['1', 'true', 'yes', 'on'], true);

    if ($stationId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Не указан ID станции'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($startYear > $endYear) {
        http_response_code(400);
        echo json_encode(['error' => 'Начальный год не может быть больше конечного'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if (($endYear - $startYear) > 80) {
        http_response_code(400);
        echo json_encode(['error' => 'Слишком большой диапазон лет'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    try {
        $finder = new StationFinder();
        $station = $finder->getById($stationId);

        $latitude = isset($station['latitude']) && is_numeric($station['latitude'])
            ? (float) $station['latitude']
            : null;
        $longitude = isset($station['longitude']) && is_numeric($station['longitude'])
            ? (float) $station['longitude']
            : null;
        $hemisphere = $latitude !== null && $latitude < 0 ? 'south' : 'north';

        $client = new MeteostatClient();
        $records = $client->fetchDaily($stationId);

        $calc = new Calculator();
        $results = $calc->calculate($records, $startYear, $endYear, $seasonOnly, $latitude);

        $warnings = [];

        if ($station === null) {
            $warnings[] = 'Станция не найдена в справочнике Meteostat: расчёт выполнен только по указанному ID.';
        }

        if ($latitude === null) {
            $warnings[] = 'У станции нет координат в справочнике Meteostat, поэтому применено правило северного полушария.';
        }

        if (array_filter($results, static fn(array $result): bool => (bool) ($result['partial'] ?? false)) !== []) {
            $warnings[] = 'Текущий расчётный период ещё не завершён, поэтому последний год может быть неполным.';
        }

        echo json_encode([
            'station' => $station ? $station['name'] : $stationId,
            'station_id' => $stationId,
            'country' => $station['country'] ?? null,
            'region' => $station['region'] ?? null,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'hemisphere' => $hemisphere,
            'hemisphere_label' => $hemisphere === 'south' ? 'Южное полушарие' : 'Северное полушарие',
            'station_daily_start' => $station['daily_start'] ?? null,
            'station_daily_end' => $station['daily_end'] ?? null,
            'last_record_date' => latestDailyRecordDate($records),
            'start' => $startYear,
            'end' => $endYear,
            'current_year' => $currentYear,
            'season_only' => $seasonOnly,
            'warnings' => $warnings,
            'results' => $results,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    }

    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Not found', 'uri' => $uri], JSON_UNESCAPED_UNICODE);