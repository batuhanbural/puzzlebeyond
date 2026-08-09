# puzzlebeyond — Birlikte Puzzle

Oda koduyla paylaşılan, gerçek zamanlı ortak puzzle uygulaması. Kullanıcılar kendi fotoğraflarını yükleyebilir ve aynı puzzle üzerinde birlikte çalışabilir.

## Vercel dağıtımı

1. Projeyi Vercel'de Git deposuna bağlayın.
2. Supabase projenizi bağlayın.
3. Yeni kurulumda Supabase SQL Editor'da `supabase/schema.sql` dosyasını, ardından `006_room_activity_and_piece_rpc.sql` migration dosyasını çalıştırın. Mevcut kurulumlarda sırasıyla `001_admin_gallery.sql`, `002_admin_sessions.sql`, `003_presence_nicknames.sql`, görsel bucket'ını özel yapan `004_private_image_bucket.sql`, geçiş kısıtını ekleyen `005_room_code_hardening.sql`, oda aktivitesi/tek-parça CAS optimizasyonunu ekleyen `006_room_activity_and_piece_rpc.sql` ve yalnızca 6 karakterli oda kodlarını zorunlu kılan `007_strict_six_character_room_codes.sql` dosyalarını bir kez çalıştırın.
4. Vercel proje ayarlarında aşağıdaki ortam değişkenlerini tanımlayın:

SITE_URL=https://your-production-domain.example
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
SUPABASE_SECRET_KEY=sb_secret_replace_me
SUPABASE_STORAGE_BUCKET=puzzle-images
ADMIN_PASSWORD=change-this-to-a-long-private-password
ADMIN_SESSION_SECRET=replace-this-with-at-least-32-random-characters
PRESENCE_SECRET=replace-this-with-at-least-32-random-characters
CRON_SECRET=replace-this-with-at-least-16-random-characters

`SITE_URL`, sosyal paylaşım ve canonical bağlantılarında kullanılacak güvenilir HTTPS üretim adresidir. `CRON_SECRET` için en az 16 karakterlik rastgele bir değer üretin; Vercel zamanlanmış temizlik isteğinde bu değeri otomatik olarak `Authorization` başlığıyla gönderir.

`006_room_activity_and_piece_rpc.sql` uygulanmadığında uygulama güvenli biçimde eski `updated_at` TTL ve tam parça JSON'u yazma yoluna döner; metadata polling ve tek-parça güncelleme performans kazanımları için migration deploy öncesinde uygulanmalıdır. İstek rotaları artık toplu oda temizliğini beklemez; 24 saatlik süresi dolan odaların arka planda temizlenmesi için `CRON_SECRET` ve Vercel Cron yapılandırması etkin olmalıdır.

`007_strict_six_character_room_codes.sql`, mevcut 8 karakterli oda kodlarını çakışmasız 6 karakterli kodlara dönüştürür ve hem oda hem presence tablolarını yalnızca 6 karakter kabul edecek şekilde kilitler. Migration sonrasında 8 karakterli bir kod veritabanına yazılamaz.

`ADMIN_PASSWORD` en az 12 karakter olmalıdır. `ADMIN_SESSION_SECRET`, admin oturumlarını imzalamak için paroladan ayrı üretilmiş en az 32 karakterlik rastgele bir değerdir. `PRESENCE_SECRET` de istemci presence kimliklerini imzalamak için tercihen ayrı üretilmiş en az 32 karakterlik rastgele bir değer olmalıdır. `SUPABASE_SECRET_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `PRESENCE_SECRET` ve `CRON_SECRET` yalnızca sunucu ortamında tutulmalıdır; `NEXT_PUBLIC_` öneki kullanmayın.

Admin paneli /admin adresindedir. ADMIN_PASSWORD ile korunan panelden aktif kullanıcı ve oturumları görebilir, boş odaların 24 saatlik silinme süresini takip edebilir, oturumları kapatıp silebilir, galeriye JPG/PNG/WebP puzzle ekleyebilir veya puzzle silebilirsiniz.

Vercel uyumluluk derlemesi:

    npm ci
    npm run build

`npm run build:vercel` aynı Next.js üretim derlemesinin açık isimli alias'ıdır. Ayrı Sites/Cloudflare hedefi gerekiyorsa `npm run build:sites` kullanılır. Vercel derleme ve fonksiyon çalışma zamanı Node.js 22.x olarak sabitlenmiştir.

Fotoğraf yükleme boyutu Vercel Functions sınırları için 4 MB ile sınırlıdır.

Realtime kurulum notu: Parça hareketlerinin anında yayılması için Vercel ortamına SUPABASE_PUBLISHABLE_KEY (eski projelerde SUPABASE_ANON_KEY) ekleyin. Bu anahtar istemciye açılabilir; SUPABASE_SECRET_KEY istemciye verilmemelidir. Publishable anahtar yoksa uygulama otomatik olarak polling yedeğini kullanır.
