const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// --- SABİT AYARLAR ---
const HOURLY_PRICE = 100;
const DAILY_PRICE = 2000;
const MAX_SLOTS = 15;

// Veritabanı Bağlantısı
const db = new sqlite3.Database('./otopark_v2.db', (err) => {
    if (err) console.error(err.message);
    console.log('Veritabanına bağlandık (V2).');
});

// --- VERİTABANI VE SİMÜLASYON ---
db.serialize(() => {
    // 1. Temiz Kurulum
    db.run("DROP TABLE IF EXISTS reservations");
    db.run("DROP TABLE IF EXISTS parking_lots");
    db.run("DROP TABLE IF EXISTS users");
    db.run("DROP TABLE IF EXISTS sms_codes");

    // 2. Tabloları Oluştur
    db.run(`CREATE TABLE parking_lots (id INTEGER PRIMARY KEY, name TEXT, capacity INTEGER, location TEXT)`);
    db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);
    db.run(`CREATE TABLE sms_codes (phone TEXT PRIMARY KEY, code TEXT)`);
    db.run(`CREATE TABLE reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pnr TEXT, 
        parking_lot_id INTEGER,
        user_id INTEGER,
        plate TEXT,
        day TEXT,
        hour TEXT,
        type TEXT, 
        price INTEGER
    )`);

    // 3. Şubeleri Ekle
    const stmt = db.prepare("INSERT INTO parking_lots (id, name, capacity, location) VALUES (?, ?, ?, ?)");
    stmt.run(1, 'Kadıköy Merkez', 100, 'Rıhtım Cad. No:12, Kadıköy');
    stmt.run(2, 'Beşiktaş Sahil', 100, 'Çırağan Cad. No:5, Beşiktaş');
    stmt.run(3, 'Taksim Meydan', 100, 'İstiklal Cad. No:1, Beyoğlu');
    stmt.run(4, 'Tuzla Sahil', 100, 'Postane Mah. Sahil Yolu, Tuzla');
    stmt.run(5, 'Nişantaşı', 100, 'Abdi İpekçi Cad. No:42, Şişli');
    stmt.run(6, 'Bakırköy Meydan', 100, 'Özgürlük Meydanı, Bakırköy');
    stmt.run(7, 'Ataşehir Merkez', 100, 'Barbaros Mah. Bulvar 216, Ataşehir');
    stmt.finalize();

    // 4. Admin Hesabı
    db.run("INSERT OR IGNORE INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)", ['Sistem Yöneticisi', '+905000000000', 'admin123', 'admin']);

    // --- 5. ULTRA SİMÜLASYON MODU (KALABALIK YARATMA) ---
    console.log("🔥 SİMÜLASYON BAŞLATILIYOR: Otoparklar dolduruluyor...");

    // İşlemi çok hızlandırmak için transaction açıyoruz
    db.run("BEGIN TRANSACTION");

    const simStmt = db.prepare("INSERT INTO reservations (pnr, parking_lot_id, user_id, plate, day, hour, type, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

    // Şubelerin "Popülerlik" Oranları (1.0 = %100 Dolu, 0.1 = %10 Dolu)
    const lotPopularity = [
        { id: 1, rate: 0.85 }, // Kadıköy: Çok Kalabalık
        { id: 2, rate: 0.75 }, // Beşiktaş: Kalabalık
        { id: 3, rate: 0.90 }, // Taksim: İğne atsan yere düşmez
        { id: 4, rate: 0.15 }, // Tuzla: Sinek avlıyor (Boş)
        { id: 5, rate: 0.98 }, // Nişantaşı: FULL ÇAKILI (Yer bulmak imkansız)
        { id: 6, rate: 0.50 }, // Bakırköy: Orta karar
        { id: 7, rate: 0.35 }  // Ataşehir: Sakin
    ];

    const days = ["PZT", "SAL", "ÇAR", "PER", "CUM", "CTS", "PAZ"];
    const hours = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19.00", "20.00", "21.00", "22.00", "23.00"];
    const CAPACITY = 100; // Her otoparkın kapasitesi

    // Rastgele Veri Fonksiyonları
    function randPNR() { return Math.random().toString(36).substr(2, 5).toUpperCase(); }
    function randPlate() {
        const L = "ABCDEFGHKLMNPRSTUVYZ";
        return `34 ${L[Math.floor(Math.random()*L.length)]}${L[Math.floor(Math.random()*L.length)]} ${Math.floor(100+Math.random()*899)}`;
    }

    // --- ANA DÖNGÜ ---
    // Her Şube için...
    lotPopularity.forEach(lot => {
        // Her Gün için...
        days.forEach(day => {
            // Her Saat için...
            hours.forEach(hour => {

                // O saatin doluluk oranı biraz dalgalansın (Her saat aynı olmasın)
                // Örn: Nişantaşı 0.98 ise bazen 0.90 bazen 1.0 olsun.
                let volatility = (Math.random() * 0.2) - 0.1; // -%10 ile +%10 arası oynama
                let currentRate = lot.rate + volatility;

                // KAPASİTE KADAR DENE (100 kere zar at)
                for (let i = 0; i < CAPACITY; i++) {
                    // Eğer zar tutarsa arabayı park et
                    if (Math.random() < currentRate) {
                        simStmt.run(
                            randPNR(),
                            lot.id,
                            1, // Hepsi Admin'in gibi görünsün
                            randPlate(),
                            day,
                            hour,
                            'hourly',
                            100
                        );
                    }
                }
            });
        });
    });

    simStmt.finalize();
    db.run("COMMIT");
    console.log("✅ SİMÜLASYON TAMAMLANDI! Binlerce araç park edildi. Sunucu hazır.");
});

// --- API KISIMLARI (DEĞİŞMEDİ) ---

// Auth
app.post('/api/auth/send-sms', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Tel no eksik." });
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    db.run("INSERT OR REPLACE INTO sms_codes (phone, code) VALUES (?, ?)", [phone, code], (err) => {
        res.json({ message: "Kod yollandı", test_code: code });
    });
});

app.post('/api/auth/register', (req, res) => {
    const { name, phone, code, password } = req.body;
    db.get("SELECT code FROM sms_codes WHERE phone = ?", [phone], (err, row) => {
        if (!row || row.code !== code) return res.status(400).json({ error: "Hatalı kod" });
        db.run("INSERT INTO users (name, phone, password, role) VALUES (?, ?, ?, 'user')", [name, phone, password], (err) => {
            if(err) return res.status(400).json({error: "Zaten kayıtlı"});
            res.json({ message: "Kayıt Başarılı" });
        });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { phone, password } = req.body;
    db.get("SELECT id, name, phone, role FROM users WHERE phone=? AND password=?", [phone, password], (err, user) => {
        if(!user) return res.status(401).json({error: "Hatalı giriş"});
        res.json({ message: "Giriş OK", user });
    });
});

// Veri Çekme
app.get('/api/parking-lots', (req, res) => {
    db.all("SELECT * FROM parking_lots", [], (err, rows) => res.json(rows));
});

app.get('/api/lot-stats/:lotId', (req, res) => {
    // Burada sadece COUNT alıyoruz
    db.all("SELECT day, hour, COUNT(*) as count FROM reservations WHERE parking_lot_id = ? GROUP BY day, hour", [req.params.lotId], (err, rows) => {
        res.json(rows);
    });
});

// Rezervasyon Yap / Sil
app.post('/api/reserve', (req, res) => {
    const { parking_lot_id, user_id, plate, slots } = req.body;
    const pnr = randPNR(); // Helper'ı burada da kullanalım
    let total = 0;

    // Basit Fiyat Hesabı (Simülasyon dışı gerçek rezervasyon için)
    const dayCounts = {};
    slots.forEach(s => dayCounts[s.day] = (dayCounts[s.day]||0)+1);
    for(let d in dayCounts) total += (dayCounts[d]>=MAX_SLOTS ? DAILY_PRICE : dayCounts[d]*HOURLY_PRICE);

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT INTO reservations (pnr, parking_lot_id, user_id, plate, day, hour, type, price) VALUES (?,?,?,?,?,?,?,?)");
        slots.forEach(s => {
            stmt.run(pnr, parking_lot_id, user_id, plate, s.day, s.hour, 'hourly', (dayCounts[s.day]>=MAX_SLOTS?DAILY_PRICE/MAX_SLOTS:HOURLY_PRICE));
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
            if(err) res.status(500).json({error: err.message});
            else res.json({ message: "OK", pnr, totalPrice: total });
        });
    });
});

app.delete('/api/reserve/:pnr', (req, res) => {
    db.run("DELETE FROM reservations WHERE pnr=?", [req.params.pnr], function(err) {
        if(this.changes===0) return res.status(404).json({error:"Bulunamadı"});
        res.json({message:"Silindi"});
    });
});

// Admin & Kullanıcı Listeleri
app.get('/api/reservations/user/:userId', (req, res) => {
    const sql = `SELECT r.pnr, r.plate, r.day, r.hour, pl.name as branch_name FROM reservations r JOIN parking_lots pl ON r.parking_lot_id=pl.id WHERE r.user_id=? ORDER BY r.id DESC`;
    db.all(sql, [req.params.userId], (err, rows) => {
        // Frontend'in beklediği formata çevir (Group by PNR)
        const map = {};
        rows.forEach(r => {
            if(!map[r.pnr]) map[r.pnr] = { pnr: r.pnr, plate: r.plate, branch_name: r.branch_name, time_details: [] };
            let d = map[r.pnr].time_details.find(x => x.day === r.day);
            if(!d) { d = { day: r.day, hours: [] }; map[r.pnr].time_details.push(d); }
            d.hours.push(r.hour);
        });
        res.json(Object.values(map));
    });
});

app.get('/api/admin/reservations', (req, res) => {
    const sql = `SELECT r.pnr, r.plate, r.day, r.hour, pl.name as branch_name FROM reservations r JOIN parking_lots pl ON r.parking_lot_id=pl.id ORDER BY r.id DESC LIMIT 2000`; // Çok veri olacağı için limit koydum
    db.all(sql, [], (err, rows) => {
        const map = {};
        rows.forEach(r => {
            if(!map[r.pnr]) map[r.pnr] = { pnr: r.pnr, plate: r.plate, branch_name: r.branch_name, time_details: [] };
            let d = map[r.pnr].time_details.find(x => x.day === r.day);
            if(!d) { d = { day: r.day, hours: [] }; map[r.pnr].time_details.push(d); }
            d.hours.push(r.hour);
        });
        res.json(Object.values(map));
    });
});

// Helper
function randPNR() { return Math.random().toString(36).substr(2, 5).toUpperCase(); }
// Admin İstatistikleri İçin Yeni Endpoint
app.post('/api/admin/stats', (req, res) => {
    const { userId } = req.body;

    // Güvenlik: Sadece admin mi kontrolü (Opsiyonel ama iyi uygulama)
    db.get("SELECT role FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user || user.role !== 'admin') return res.status(403).json({ error: "Yetkisiz erişim" });

        const sql = `
            SELECT 
                COUNT(*) as totalOccupancy, 
                SUM(price) as totalIncome 
            FROM reservations`;

        db.get(sql, [], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                totalOccupancy: row.totalOccupancy || 0,
                totalIncome: row.totalIncome || 0
            });
        });
    });
});
app.listen(3000, () => {
    console.log("🚀 PARK ULTRA SUNUCUSU BAŞLADI: http://localhost:3000");
});