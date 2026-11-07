# Granny’den Kaç — Multiplayer başlangıç paketi

Bu paket mevcut Three.js oyununu korur ve WebSocket oda altyapısını ekler.

## Dosyalar
- `index.html`: Oyun + oda oluşturma/katılma ekranı + oyuncu senkronizasyonu
- `server.js`: Oda kodları, en fazla 4 bağlantı ve WebSocket mesaj aktarımı
- `package.json`: Node.js bağımlılığı ve başlatma komutu

## Render kurulumu
1. Bu klasörün içindekileri bir GitHub deposuna yükle.
2. Render'da **New → Web Service** seçip depoyu bağla.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Deploy tamamlanınca Render servis adresini al. Örnek biçim: `wss://proje-adi.onrender.com`.
5. `index.html` içindeki `WS_SERVER_URL` değerini bu adresle değiştir.
6. `index.html` dosyasını HTTPS destekleyen statik bir hostta yayınla (ör. GitHub Pages).

## Şu anki multiplayer kapsamı
- Oda oluşturma ve 6 karakterli oda koduyla katılma
- En fazla 4 bağlantı
- Oyuncu konumu ve bakış yönünün diğer oyunculara aktarılması
- İlk oyuncunun Granny AI simülasyonunu çalıştırması ve Granny durumunun diğerlerine aktarılması
- Oda sahibi ayrılırsa yeni oda sahibinin seçilmesi

## Henüz tamamlanmamış olanlar
Bu ilk ağ iskeletinde eşya/kapı envanteri ortaklaştırması, Granny'nin odadaki tüm oyuncuları hedef seçmesi, yakalanma/QTE sonucunun herkese uygulanması ve oyuncu animasyonlarının geliştirilmesi henüz yok. Bunlar sonraki geliştirme adımlarıdır. Tek bir Granny vardır; Granny insan oyuncu değildir.
