FROM php:8.2-cli

RUN apt-get update && apt-get install -y \
    libzip-dev \
    libonig-dev \
    unzip \
    curl \
    git \
    ca-certificates \
    && docker-php-ext-install zip mbstring \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

COPY composer.json composer.lock* ./
RUN composer install --no-interaction --no-dev --prefer-dist --optimize-autoloader

COPY . .

RUN mkdir -p cache

EXPOSE 9000

CMD ["sh", "-c", "if [ ! -f vendor/autoload.php ]; then composer install --no-interaction --no-dev --prefer-dist --optimize-autoloader; fi; mkdir -p cache; php -S 0.0.0.0:9000 -t public public/index.php"]