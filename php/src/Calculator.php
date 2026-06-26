<?php

namespace App;

class Calculator
{
    private const MIN_DATA_COVERAGE = 0.9;
    private const SEASON_RUN_DAYS = 5;
    private const SECONDS_IN_DAY = 86400;

    /**
     * Рассчитать SAT и GDD для списка записей за указанные годы.
     *
     * Базовые правила:
     * - учитываем только дни, где есть tavg;
     * - северное полушарие: расчётный период года 01.03–30.11;
     * - южное полушарие: расчётный период года 01.09 предыдущего года–31.05 указанного года;
     * - для расчётного периода требуем минимум 95% дней с tavg;
     * - для текущего активного периода порог считается по уже наступившим дням периода;
     * - если данных меньше порога, год выводится как пропущенный без SAT/GDD;
     * - SAT = сумма tavg для дней, где tavg > 10;
     * - GDD = сумма (tavg - 10) для дней, где tavg > 10.
     *
     * Если $seasonOnly = true:
     * - старт сезона — первый день первой серии 5+ календарных дней подряд с tavg > 10
     *   в весеннем окне полушария;
     * - конец сезона — день перед первым днём первой осенней серии 5+ календарных
     *   дней подряд с tavg <= 10;
     * - SAT/GDD считаются только внутри найденных границ сезона.
     *
     * @param array<int, array<string, mixed>> $records
     * @return array<int, array<string, mixed>>
     */
    public function calculate(
        array $records,
        int $startYear,
        int $endYear,
        bool $seasonOnly = false,
        ?float $latitude = null
    ): array {
        if ($startYear > $endYear) {
            return [];
        }

        $hemisphere = $this->hemisphere($latitude);
        $today = date('Y-m-d');

        $validDays = $this->normalizeValidDays($records);
        $results = [];

        for ($year = $startYear; $year <= $endYear; $year++) {
            [$periodStart, $periodEnd] = $this->periodForYear($year, $hemisphere);
            $isActivePeriod = $periodStart <= $today && $today <= $periodEnd;
            $expectedEnd = $isActivePeriod ? $today : $periodEnd;

            $periodDays = $this->filterDaysBetween($validDays, $periodStart, $periodEnd);
            $validDaysCount = count($periodDays);
            $expectedDays = $this->daysBetween($periodStart, $expectedEnd) + 1;
            $minimumDays = (int) ceil($expectedDays * self::MIN_DATA_COVERAGE);

            if ($validDaysCount === 0) {
                continue;
            }

            $complete = $validDaysCount >= $minimumDays;
            $skipReason = null;

            if (!$complete) {
                $skipReason = 'Расчёт пропущен из-за нехватки дней с данными в вегетационный период';

                $results[] = [
                    'year' => $year,
                    'sat' => null,
                    'gdd' => null,
                    'days' => $validDaysCount,
                    'expected_days' => $expectedDays,
                    'minimum_days' => $minimumDays,
                    'period_start' => $periodStart,
                    'period_end' => $periodEnd,
                    'calculation_start' => null,
                    'calculation_end' => null,
                    'calculation_days' => null,
                    'complete' => false,
                    'partial' => $isActivePeriod,
                    'skipped' => true,
                    'skip_reason' => $skipReason,
                    'season_start' => null,
                    'season_end' => null,
                    'season_days' => null,
                    'hemisphere' => $hemisphere,
                ];

                continue;
            }

            $seasonStart = null;
            $seasonEnd = null;
            $seasonDays = null;
            $calculationDays = $periodDays;

            if ($seasonOnly) {
                $seasonStart = $this->findSeasonStart($periodDays, $year, $hemisphere);

                if ($seasonStart !== null) {
                    $seasonEnd = $this->findSeasonEnd($periodDays, $seasonStart, $year, $hemisphere);

                    // Для текущего неполного периода или тёплого климата, где осенняя серия
                    // ещё не найдена, считаем сезон до последнего доступного дня периода.
                    if ($seasonEnd === null) {
                        $lastDay = end($periodDays);
                        $seasonEnd = is_array($lastDay) ? (string) $lastDay['date'] : null;
                        reset($periodDays);
                    }

                    $calculationDays = $this->filterDaysBetween($periodDays, $seasonStart, $seasonEnd);
                    $seasonDays = count($calculationDays);
                } else {
                    $calculationDays = [];
                    $seasonDays = 0;
                }
            }

            $calculationDaysCount = count($calculationDays);
            $calculationStart = null;
            $calculationEnd = null;

            if ($calculationDaysCount > 0) {
                $firstCalculationDay = reset($calculationDays);
                $lastCalculationDay = end($calculationDays);

                $calculationStart = is_array($firstCalculationDay) ? (string) $firstCalculationDay['date'] : null;
                $calculationEnd = is_array($lastCalculationDay) ? (string) $lastCalculationDay['date'] : null;

                reset($calculationDays);
            }

            $sat = 0.0;
            $gdd = 0.0;

            foreach ($calculationDays as $day) {
                $tavg = (float) $day['tavg'];

                if ($tavg <= 10) {
                    continue;
                }

                $sat += $tavg;
                $gdd += ($tavg - 10);
            }

            $results[] = [
                'year' => $year,
                'sat' => (int) round($sat),
                'gdd' => (int) round($gdd),
                'days' => $validDaysCount,
                'expected_days' => $expectedDays,
                'minimum_days' => $minimumDays,
                'period_start' => $periodStart,
                'period_end' => $periodEnd,
                'calculation_start' => $calculationStart,
                'calculation_end' => $calculationEnd,
                'calculation_days' => $calculationDaysCount,
                'complete' => $complete,
                'partial' => $isActivePeriod,
                'skipped' => false,
                'skip_reason' => null,
                'season_start' => $seasonStart,
                'season_end' => $seasonEnd,
                'season_days' => $seasonDays,
                'hemisphere' => $hemisphere,
            ];
        }

        return $results;
    }

    private function hemisphere(?float $latitude): string
    {
        return $latitude !== null && $latitude < 0 ? 'south' : 'north';
    }

    /**
     * @param array<int, array<string, mixed>> $records
     * @return array<int, array<string, mixed>>
     */
    private function normalizeValidDays(array $records): array
    {
        $validDays = [];

        foreach ($records as $record) {
            if (!isset($record['tavg']) || $record['tavg'] === null) {
                continue;
            }

            $date = $this->dateString($record);
            if ($date === null) {
                continue;
            }

            $timestamp = strtotime($date . ' 00:00:00 UTC');
            if ($timestamp === false) {
                continue;
            }

            $record['date'] = $date;
            $record['timestamp'] = $timestamp;
            $record['tavg'] = (float) $record['tavg'];

            $validDays[] = $record;
        }

        usort(
            $validDays,
            static fn(array $a, array $b): int => ((int) $a['timestamp']) <=> ((int) $b['timestamp'])
        );

        return $validDays;
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function periodForYear(int $year, string $hemisphere): array
    {
        if ($hemisphere === 'south') {
            return [
                sprintf('%04d-09-01', $year - 1),
                sprintf('%04d-05-31', $year),
            ];
        }

        return [
            sprintf('%04d-03-01', $year),
            sprintf('%04d-11-30', $year),
        ];
    }

    /**
     * @param array<string, mixed> $day
     */
    private function dateString(array $day): ?string
    {
        $year = (int) ($day['year'] ?? 0);
        $month = (int) ($day['month'] ?? 0);
        $dayOfMonth = (int) ($day['day'] ?? 0);

        if (!checkdate($month, $dayOfMonth, $year)) {
            return null;
        }

        return sprintf('%04d-%02d-%02d', $year, $month, $dayOfMonth);
    }

    /**
     * Найти старт сезона: первая серия 5+ календарных дней подряд с tavg > 10
     * в весеннем окне соответствующего полушария.
     *
     * @param array<int, array<string, mixed>> $days
     */
    private function findSeasonStart(array $days, int $year, string $hemisphere): ?string
    {
        if ($hemisphere === 'south') {
            $windowStart = sprintf('%04d-09-01', $year - 1);
            $windowEnd = sprintf('%04d-12-31', $year - 1);
        } else {
            $windowStart = sprintf('%04d-03-01', $year);
            $windowEnd = sprintf('%04d-05-31', $year);
        }

        return $this->findRunStart(
            $days,
            $windowStart,
            $windowEnd,
            static fn(float $tavg): bool => $tavg > 10
        );
    }

    /**
     * Найти конец сезона: день перед первой осенней серией 5+ календарных дней
     * подряд с tavg <= 10.
     *
     * @param array<int, array<string, mixed>> $days
     */
    private function findSeasonEnd(array $days, string $seasonStart, int $year, string $hemisphere): ?string
    {
        if ($hemisphere === 'south') {
            $windowStart = sprintf('%04d-04-01', $year);
            $windowEnd = sprintf('%04d-05-31', $year);
        } else {
            $windowStart = sprintf('%04d-10-01', $year);
            $windowEnd = sprintf('%04d-11-30', $year);
        }

        if ($windowStart < $seasonStart) {
            $windowStart = $seasonStart;
        }

        $runStart = $this->findRunStart(
            $days,
            $windowStart,
            $windowEnd,
            static fn(float $tavg): bool => $tavg <= 10
        );

        return $runStart !== null ? $this->previousDate($runStart) : null;
    }

    /**
     * @param array<int, array<string, mixed>> $days
     * @param callable(float): bool $predicate
     */
    private function findRunStart(array $days, string $windowStart, string $windowEnd, callable $predicate): ?string
    {
        $windowStartTimestamp = strtotime($windowStart . ' 00:00:00 UTC');
        $windowEndTimestamp = strtotime($windowEnd . ' 00:00:00 UTC');

        if ($windowStartTimestamp === false || $windowEndTimestamp === false) {
            return null;
        }

        $runStart = null;
        $runCount = 0;
        $previousTimestamp = null;

        foreach ($days as $day) {
            $timestamp = (int) $day['timestamp'];

            if ($timestamp < $windowStartTimestamp) {
                continue;
            }

            if ($timestamp > $windowEndTimestamp) {
                break;
            }

            $matches = $predicate((float) $day['tavg']);

            if (!$matches) {
                $runStart = null;
                $runCount = 0;
                $previousTimestamp = null;
                continue;
            }

            if ($previousTimestamp !== null && ($timestamp - $previousTimestamp) === self::SECONDS_IN_DAY) {
                $runCount++;
            } else {
                $runStart = (string) $day['date'];
                $runCount = 1;
            }

            $previousTimestamp = $timestamp;

            if ($runCount >= self::SEASON_RUN_DAYS) {
                return $runStart;
            }
        }

        return null;
    }

    private function previousDate(string $date): string
    {
        return (new \DateTimeImmutable($date))->modify('-1 day')->format('Y-m-d');
    }

    private function daysBetween(string $startDate, string $endDate): int
    {
        $start = new \DateTimeImmutable($startDate);
        $end = new \DateTimeImmutable($endDate);

        return (int) $start->diff($end)->format('%a');
    }

    /**
     * @param array<int, array<string, mixed>> $days
     * @return array<int, array<string, mixed>>
     */
    private function filterDaysBetween(array $days, string $startDate, ?string $endDate): array
    {
        $startTimestamp = strtotime($startDate . ' 00:00:00 UTC');
        $endTimestamp = $endDate !== null ? strtotime($endDate . ' 00:00:00 UTC') : false;

        if ($startTimestamp === false || $endTimestamp === false || $endTimestamp < $startTimestamp) {
            return [];
        }

        return array_values(array_filter(
            $days,
            static function (array $day) use ($startTimestamp, $endTimestamp): bool {
                $timestamp = (int) $day['timestamp'];
                return $timestamp >= $startTimestamp && $timestamp <= $endTimestamp;
            }
        ));
    }
}