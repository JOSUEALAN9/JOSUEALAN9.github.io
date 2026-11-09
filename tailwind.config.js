/**
 * Tailwind compilado (ya no por CDN). `npm run css` arma assets/css/tailwind.css; publicar.sh lo corre solo.
 *
 * content: dónde busca las clases que se usan. Incluye los .js porque muchas pantallas arman su HTML ahí.
 * Si una clase no aparece escrita completa en ningún archivo, no entra al CSS (nunca armar "bg-" + color).
 *
 * Colores: salen de los tokens de assets/css/common.css (un solo acento y grises neutros).
 * Las clases que ya usan las pantallas (slate, violet, indigo, teal…) se dirigen a esos tokens, para que toda la
 * app use la misma paleta sin reescribir cada pantalla. Rojo, ámbar, verde y azul se quedan: son de estado.
 */
const tok = (v) => `rgb(var(--${v}) / <alpha-value>)`;
const escala = (pre) => Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => [n, tok(`${pre}-${n}`)]));
const gris = { ...escala("g"), 950: tok("g-900") };
const acento = { ...escala("ac"), 950: tok("ac-900") };

module.exports = {
    content: [
        "./*.html",
        "./**/*.html",
        "./assets/**/*.js",
        "./herramientas/**/*.js",
        "./clientes/**/*.js",
        "./admin/**/*.js",
        "./configuracion/**/*.js",
        "./creditos/**/*.js",
        "./descargas/**/*.js",
        "./agente/**/*.js",
        "!./node_modules/**",
    ],
    theme: {
        extend: {
            colors: {
                gris, acento,
                slate: gris, gray: gris, zinc: gris, neutral: gris, stone: gris,
                violet: acento, indigo: acento, purple: acento, teal: acento, cyan: acento,
            },
            fontFamily: {
                sans: ["var(--fuente)"],
                mono: ["var(--fuente-mono)"],
            },
            borderRadius: { control: "var(--r-control)", tarjeta: "var(--r-tarjeta)", modal: "var(--r-modal)" },
        },
    },
    plugins: [],
};
