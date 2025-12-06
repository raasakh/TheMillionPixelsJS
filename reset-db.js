// reset-db.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Удаляем старую базу данных
if (fs.existsSync('./database.db')) {
    fs.unlinkSync('./database.db');
    console.log('✅ Старая база данных удалена');
}

// Создаем новую базу
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    // Создаем таблицы
    db.run(`CREATE TABLE pixels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        color TEXT,
        image_url TEXT,
        link TEXT,
        title TEXT,
        username TEXT,
        email TEXT,
        purchased BOOLEAN DEFAULT 0,
        order_id TEXT,
        bitcoin_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        wallet_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        pixel_ids TEXT,
        total_amount REAL NOT NULL,
        bitcoin_address TEXT NOT NULL,
        payment_status TEXT DEFAULT 'pending',
        transaction_hash TEXT,
        payment_received REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        qr_code_url TEXT
    )`);
    
    db.run(`CREATE TABLE admin (
        id INTEGER PRIMARY KEY,
        password TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE pricing (
        id INTEGER PRIMARY KEY,
        price_per_pixel REAL DEFAULT 0.0001,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Добавляем данные по умолчанию
    db.run(`INSERT INTO admin (id, password) VALUES (1, 'admin')`);
    db.run(`INSERT INTO pricing (id, price_per_pixel) VALUES (1, 0.0001)`);
    
    console.log('✅ Новая база данных создана');
    console.log('🔑 Пароль администратора: admin');
    console.log('💰 Цена за пиксель: 0.0001 BTC');
});

db.close();