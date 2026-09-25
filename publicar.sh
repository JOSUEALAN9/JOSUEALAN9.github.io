#!/usr/bin/env bash
# =====================================================================
# publicar.sh — sube los cambios del frontend a GitHub Pages.
#
# Además de commit + push, cambia el número de versión (?v=...) en todas
# las páginas y en assets/js/nucleo.js. Así, en cuanto el navegador baja
# el HTML nuevo, baja también el CSS y JS nuevos, en vez de mezclar una
# página nueva con scripts viejos de su caché.
#
# Uso (desde la carpeta del frontend):
#   ./publicar.sh "Qué cambié, en una frase"
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

MENSAJE="${1:-}"
if [ -z "$MENSAJE" ]; then
  echo 'Uso: ./publicar.sh "Qué cambié, en una frase"'
  exit 1
fi

V=$(date +%Y%m%d%H%M)
grep -rl --include=*.html -E '\?v=[0-9]+' . | xargs -r sed -i -E "s/\?v=[0-9]+/?v=$V/g"
sed -i -E "s/var VERSION = \"[0-9]+\";/var VERSION = \"$V\";/" assets/js/nucleo.js

git add -A
git commit -q -m "$MENSAJE"
git push -q
echo "Publicado. Versión de la interfaz: $V"
git log --oneline -1
