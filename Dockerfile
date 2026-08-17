# Баримт-орчуулга веб — Chromium (WYSIWYG PDF) хувилбар.
FROM node:20-bookworm-slim

# Chromium + фонтууд:
#  - chromium              → Puppeteer-ийн хөдөлгүүр (apt бүх хамаарлыг авчирна)
#  - fonts-noto-core       → Латин + Кирилл (Монгол ү/ө орно)
#  - fonts-noto-cjk        → Япон/Хятад/Солонгос
#  - fonts-liberation      → Times/Arial-тай ижил хэмжээтэй (metric-compatible)
#  - fonts-crosextra-*     → Calibri↔Carlito, Cambria↔Caladea (Excel/Word-ийн
#                            баганын өргөн, мөрийн тоо яг таарахад чухал)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates fontconfig \
      fonts-noto-core fonts-noto-cjk fonts-liberation \
      fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

WORKDIR /app

# Хамаарлууд — Puppeteer-ийн өөрийн Chromium татахгүй (apt-ийнхийг ашиглана)
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci --omit=dev

# Эх код
COPY . .

# Chromium-ийн зам болон орчин
# Тэмдэглэл: LibreOffice-ийг image хэт томроод Railway дийлэхгүй тул түр хассан.
# import нь LibreOffice байхгүй үед автоматаар mammoth/SheetJS руу шилжинэ (parse.js).
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium" \
    NODE_ENV=production \
    PORT=3000

EXPOSE 3000
CMD ["node", "server.js"]
