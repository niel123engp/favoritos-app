# Favoritos — app instalável (PWA)

Casca do app. Nenhum dado fica aqui: tudo vem da planilha, pela API do Apps Script, com chave de acesso.

Arquivos: index.html (app), manifest.webmanifest (instalação), sw.js (abre offline), icon-192.png / icon-512.png.

Como publicar: subir esta pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Cloudflare Pages).
Link para quem vai usar: <endereço>/#k=<chave>  — a chave fica salva no aparelho.
Para trocar a chave: rodar apiGerarChave() no Apps Script e mandar um link novo.
