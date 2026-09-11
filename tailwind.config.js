/**
 * Configuración de Tailwind para generar el CSS por adelantado.
 *
 * Sólo hace falta si decides dejar de cargar Tailwind desde el CDN.
 * Ver la sección "Compilar Tailwind" en CAMBIOS.md.
 *
 * "content" es la lista de archivos donde Tailwind busca clases usadas.
 * Lo que no aparezca ahí, no se incluye en el CSS final.
 */
module.exports = {
    content: [
        "./*.html",
        "./*/*.html",
        "./assets/*.js",
    ],
    theme: { extend: {} },
    plugins: [],
};
