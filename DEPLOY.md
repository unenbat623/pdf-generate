# Deploy хийх заавар (Docker — бүрэн боломж, LaTeX PDF орсон)

Энэ апп нь PDF гаргахдаа `tectonic` (LaTeX) ашигладаг тул **Docker дэмждэг хостинг** дээр байрлуулна.
`Dockerfile` бэлэн — tectonic болон Япон/Кирилл фонтуудыг өөрөө суулгадаг.

> ⚠️ Vercel/Netlify (serverless) дээр LaTeX PDF **ажиллахгүй**. Доорх Railway эсвэл Render-ийг ашиглана уу.

---

## Тохируулах орчны хувьсагчид (аль ч платформд)

| Хувьсагч | Утга |
|---|---|
| `TRANSLATE_PROVIDER` | `google` |
| `GOOGLE_TRANSLATE_API_KEY` | таны Google Cloud Translation key |

> `PORT`, `TECTONIC_BIN`, `FONT_LATIN`, `FONT_JA` нь Dockerfile дотор бэлэн — гараар тавих шаардлагагүй.
> ⚠️ API key-гээ платформын **Variables** хэсэгт тавь — код/git дотор бүү хий.

---

## Хувилбар A: Railway (хамгийн хялбар)

1. Кодоо GitHub repo болгож push хий (доор "Git" хэсгийг үз).
2. https://railway.app → нэвтэр → **New Project → Deploy from GitHub repo**.
3. Repo-гоо сонго. Railway `Dockerfile`-ийг автоматаар олж build хийнэ.
4. **Variables** таб → дээрх 2 хувьсагчийг нэм.
5. **Settings → Networking → Generate Domain** дарж нийтийн линк ав.
6. Build дуусаад линк дээр орж шалга.

CLI-аар (сонголт):
```bash
npm i -g @railway/cli
railway login
railway init
railway up
railway variables set TRANSLATE_PROVIDER=google GOOGLE_TRANSLATE_API_KEY=<key>
railway domain
```

---

## Хувилбар B: Render

1. Кодоо GitHub repo болгож push хий.
2. https://render.com → **New → Web Service** → GitHub repo сонго.
3. **Runtime: Docker** (Dockerfile автоматаар танигдана).
4. **Environment** → дээрх 2 хувьсагчийг нэм.
5. **Create Web Service** → build дуусаад `https://<нэр>.onrender.com` линк гарна.

> Render-ийн үнэгүй tier нь идэвхгүй үед "унтдаг" тул эхний хүсэлт удаан (~30 сек) байж болно.

---

## Git repo болгох (хэрэв хараахан болоогүй бол)

```bash
cd "/Users/tselmuun/Desktop/pdf generate"
git init
git add -A
git commit -m "Баримт-орчуулга веб"
# GitHub дээр шинэ repo үүсгээд:
git remote add origin https://github.com/<хэрэглэгч>/<repo>.git
git push -u origin main
```
> `.gitignore` дотор `.env` орсон тул API key push хийгдэхгүй — платформ дээр тавина.

---

## Локал дээр Docker-оор турших (сонголт)

```bash
docker build -t barimt .
docker run -p 3000:3000 \
  -e TRANSLATE_PROVIDER=google \
  -e GOOGLE_TRANSLATE_API_KEY=<key> \
  barimt
# → http://localhost:3000
```
