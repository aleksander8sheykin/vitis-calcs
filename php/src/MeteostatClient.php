<?php

namespace App;

class MeteostatClient
{
    private const BASE_URL = 'https://bulk.meteostat.net/v2/daily/';

    /**
     * Получить ежедневные данные для метеостанции.
     *
     * Meteostat bulk v2 daily CSV:
     * date,tavg,tmin,tmax,prcp,snow,wdir,wspd,wpgt,pres,tsun
     *
     * @return array<array{year:int,month:int,day:int,tavg:float|null,tmin:float|null,tmax:float|null}>
     */
    public function fetchDaily(string $stationId): array
    {
        $stationId = trim($stationId);

        if ($stationId === '') {
            throw new \InvalidArgumentException('Не указан ID метеостанции');
        }

        $url = self::BASE_URL . rawurlencode($stationId) . '.csv.gz';

        $context = stream_context_create([
            'http' => [
                'timeout' => 45,
                'user_agent' => 'Mozilla/5.0 (compatible; VineCalcs/1.0)',
            ],
        ]);

        $gzData = @file_get_contents($url, false, $context);

        if ($gzData === false) {
            throw new \RuntimeException("Не удалось загрузить daily-данные Meteostat для станции {$stationId}");
        }

        $csv = @gzdecode($gzData);
        if ($csv === false) {
            throw new \RuntimeException("Ошибка распаковки daily-данных Meteostat для станции {$stationId}");
        }

        return $this->parseCsv($csv);
    }

    private function parseCsv(string $csv): array
    {
        $lines = preg_split('/\r\n|\r|\n/', trim($csv));
        if ($lines === false) {
            return [];
        }

        $records = [];

        foreach ($lines as $line) {
            $line = trim($line);

            if ($line === '') {
                continue;
            }

            $fields = str_getcsv($line);

            if (count($fields) < 2) {
                continue;
            }

            // Формат Meteostat bulk v2:
            // 1901-01-01,,,,5.0,,,,,,
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $fields[0])) {
                [$year, $month, $day] = array_map('intval', explode('-', $fields[0]));

                $records[] = [
                    'year' => $year,
                    'month' => $month,
                    'day' => $day,
                    'tavg' => $this->toFloat($fields[1] ?? null),
                    'tmin' => $this->toFloat($fields[2] ?? null),
                    'tmax' => $this->toFloat($fields[3] ?? null),
                ];

                continue;
            }

            // На всякий случай поддерживаем старый/альтернативный формат:
            // station,year,month,day,tavg,tmin,tmax,...
            if (
                count($fields) >= 7
                && is_numeric($fields[1])
                && is_numeric($fields[2])
                && is_numeric($fields[3])
            ) {
                $records[] = [
                    'year' => (int) $fields[1],
                    'month' => (int) $fields[2],
                    'day' => (int) $fields[3],
                    'tavg' => $this->toFloat($fields[4] ?? null),
                    'tmin' => $this->toFloat($fields[5] ?? null),
                    'tmax' => $this->toFloat($fields[6] ?? null),
                ];
            }
        }

        return $records;
    }

    private function toFloat(mixed $value): ?float
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        if ($value === '') {
            return null;
        }

        return is_numeric($value) ? (float) $value : null;
    }
}