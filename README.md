# Parça — Birlikte Puzzle

Oda koduyla paylaşılan, gerçek zamanlı ortak puzzle uygulaması. Kullanıcılar kendi fotoğraflarını yükleyebilir ve aynı puzzle üzerinde birlikte çalışabilir.

## Vercel dağıtımı

1. Projeyi Vercel'de Git deposuna bağlayın.
2. Supabase projenizi bağlayın.
3. Supabase SQL Editor'da supabase/schema.sql dosyasını çalıştırın. Admin paneli ve aktif kullanıcı sayacı için supabase/migrations/001_admin_gallery.sql dosyasını da bir kez çalıştırın.
4. Vercel proje ayarlarında aşağıdaki ortam değişkenlerini tanımlayın:

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_replace_me
SUPABASE_STORAGE_BUCKET=puzzle-images
ADMIN_PASSWORD=change-this-to-a-long-private-password

SUPABASE_SECRET_KEY ve ADMIN_PASSWORD yalnızca sunucu ortamında tutulmalıdır; NEXT_PUBLIC_ öneki kullanmayın.

Admin paneli /admin adresindedir. ADMIN_PASSWORD ile korunan panelden aktif kullanıcı sayısını görebilir, galeriye JPG/PNG/WebP puzzle ekleyebilir veya puzzle silebilirsiniz.

Vercel uyumluluk derlemesi:

    npm run build:vercel

Fotoğraf yükleme boyutu Vercel Functions sınırları için 4 MB ile sınırlıdır.
