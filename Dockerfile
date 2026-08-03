# Баримт-орчуулга веб — LaTeX (tectonic) орсон бүрэн хувилбар.
# tectonic-ийн musl STATIC бинарь ашиглана (glibc-ээс хамааралгүй, arm64+amd64 хоёулаа).
FROM node:20-bookworm-slim

ARG TECTONIC_VERSION=0.17.0
# Docker buildkit TARGETARCH-ийг автоматаар өгнө: amd64 | arm64
ARG TARGETARCH

# Системийн сангууд: фонтууд + fontconfig + татах хэрэгсэл
#  - fonts-noto-cjk  → Япон Mincho (Noto Serif CJK JP)
#  - fonts-liberation → Times-төстэй serif (Латин + Кирилл)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
      fontconfig fonts-noto-core fonts-noto-cjk fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

# tectonic (musl static) — платформд тохирсон бинарь татах
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) RUST_ARCH=x86_64 ;; \
      arm64) RUST_ARCH=aarch64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    url="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${RUST_ARCH}-unknown-linux-musl.tar.gz"; \
    curl -fsSL "$url" -o /tmp/tectonic.tar.gz; \
    tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin; \
    rm /tmp/tectonic.tar.gz; \
    chmod +x /usr/local/bin/tectonic; \
    tectonic --version

WORKDIR /app

# Хамаарлууд (кэш давхаргад)
COPY package*.json ./
RUN npm ci --omit=dev

# Эх код
COPY . .

# Docker/Linux дахь фонт болон tectonic-ийн зам
ENV TECTONIC_BIN="/usr/local/bin/tectonic" \
    FONT_LATIN="Liberation Serif" \
    FONT_JA="Noto Serif CJK JP" \
    NODE_ENV=production \
    PORT=3000

# LaTeX багцын кэшийг урьдчилан татаж image-д шингээх (эхний хүсэлт хурдан болно)
RUN printf '%s' '\documentclass[12pt,a4paper]{article}\usepackage{fontspec}\setmainfont{Liberation Serif}\usepackage[a4paper,top=20mm,bottom=20mm,left=30mm,right=15mm]{geometry}\usepackage{graphicx}\usepackage[export]{adjustbox}\usepackage{array}\usepackage{fancyhdr}\usepackage{setspace}\usepackage{parskip}\usepackage{ragged2e}\begin{document}warmup \begin{tabular}{|l|}\hline a\\ \hline\end{tabular}\end{document}' > /tmp/warm.tex \
 && tectonic --outdir /tmp /tmp/warm.tex \
 && printf '%s' '\documentclass[12pt,a4paper]{article}\usepackage{fontspec}\setmainfont{Noto Serif CJK JP}\begin{document}公式文書\end{document}' > /tmp/warmja.tex \
 && tectonic --outdir /tmp /tmp/warmja.tex

EXPOSE 3000
CMD ["node", "server.js"]
