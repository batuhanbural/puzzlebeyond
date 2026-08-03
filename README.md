# Parça — Birlikte Puzzle

Gerçek zamanlı, oda koduyla paylaşılan ve kullanıcı fotoğrafı yüklemeyi destekleyen ortak puzzle uygulaması.

## Yerel geliştirme

```bash
npm install
npm run dev
```

Cloudflare/Sites üretim derlemesi `npm run build`, Vercel uyumluluk derlemesi ise `npm run build:vercel` komutuyla alınır.

## Vercel dağıtımı

1. Vercel'de projeyi Git deposuna bağlayın.
2. Vercel Marketplace üzerinden bir Supabase projesi bağlayın veya mevcut Supabase projenizi kullanın.
3. Supabase SQL Editor içinde `supabase/schema.sql` dosyasını çalıştırın.
4. Vercel proje ayarlarında aşağıdaki ortam değişkenlerini tanımlayın:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_replace_me
SUPABASE_STORAGE_BUCKET=puzzle-images
```

`SUPABASE_SECRET_KEY` yalnızca sunucu ortamında tutulmalıdır; `NEXT_PUBLIC_` öneki kullanmayın. `vercel.json`, Vercel'e doğal Next.js derlemesini (`npm run build:vercel`) kullanmasını söyler.

Vercel Functions istek sınırına uyum sağlamak için fotoğraf yükleme boyutu 4 MB ile sınırlandırılmıştır.

## Çift platform yapısı

- `lib/storage.ts`: Vercel + Supabase REST/Storage adaptörü.
- `lib/storage.cloudflare.ts`: mevcut Sites D1/R2 adaptörü.
- `vite.config.ts`: Sites derlemesinde Cloudflare adaptörünü seçer.
- Doğal Next.js/Vercel derlemesi varsayılan olarak Supabase adaptörünü kullanır.
"# puzzlebeyond" 
