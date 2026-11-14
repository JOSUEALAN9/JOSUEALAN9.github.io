# JOSUEALAN9.github.io
Website for cpcs







## Publicación

- `main` es producción (fiscontable.app) y `pruebas` es el sitio de pruebas. Cloudflare publica cada rama sola al
  recibir un commit.
- **Los commits de la web nunca llevan `[skip ci]`** (ni `[ci skip]` o `[cf-pages-skip]`): Cloudflare se salta la
  publicación y producción se queda con la versión anterior. Esa marca solo va en el servidor (Backend-Fiscal), para que
  no se compile el Agente.
