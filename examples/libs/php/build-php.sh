#!/usr/bin/env bash
set -euo pipefail

PHP_VERSION="${PHP_VERSION:-8.3.15}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/php-src"
INSTALL_DIR="$SCRIPT_DIR/php-install"

if ! command -v wasm32posix-cc &>/dev/null; then
    echo "ERROR: wasm32posix-cc not found. Run 'npm link' in sdk/ first." >&2
    exit 1
fi

if [ ! -d "$SRC_DIR" ]; then
    echo "==> Downloading PHP $PHP_VERSION..."
    TARBALL="php-${PHP_VERSION}.tar.gz"
    curl -fsSL "https://www.php.net/distributions/${TARBALL}" -o "/tmp/${TARBALL}"
    mkdir -p "$SRC_DIR"
    tar xzf "/tmp/${TARBALL}" -C "$SRC_DIR" --strip-components=1
    rm "/tmp/${TARBALL}"
fi
