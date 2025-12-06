const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database setup
const db = new sqlite3.Database('./database.db');

// Создание таблиц
const createTables = () => {
  db.serialize(() => {
    // Таблица пикселей
    db.run(`CREATE TABLE IF NOT EXISTS pixels (
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

    // Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      wallet_address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица заказов
    db.run(`CREATE TABLE IF NOT EXISTS orders (
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

    // Таблица администраторов
    db.run(`CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY,
      password TEXT NOT NULL
    )`);

    // Таблица цен
    db.run(`CREATE TABLE IF NOT EXISTS pricing (
      id INTEGER PRIMARY KEY,
      price_per_pixel REAL DEFAULT 0.0001,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Создаем администратора по умолчанию
    db.run(`INSERT OR IGNORE INTO admin (id, password) VALUES (1, 'admin')`, (err) => {
      if (err) console.error('Error creating default admin:', err);
    });

    // Создаем цены по умолчанию
    db.run(`INSERT OR IGNORE INTO pricing (id, price_per_pixel) VALUES (1, 0.0001)`, (err) => {
      if (err) console.error('Error creating default pricing:', err);
    });
  });
};

createTables();

// Создаем папки если их нет
const uploadDir = 'public/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uniqueName + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|bmp|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Допустимые форматы: JPEG, PNG, GIF, WebP, BMP, SVG'));
    }
  }
});

// Session simulation
const sessions = {};
const userSessions = {};

// Helper functions
const generateOrderId = () => {
  return 'ORDER-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
};

// Генерация Bitcoin Testnet3 адреса
const generateBitcoinTestnetAddress = () => {
  const prefixes = ['m', 'n', '2'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let address = prefix;
  for (let i = 0; i < 33; i++) {
    address += chars[Math.floor(Math.random() * chars.length)];
  }
  
  return address;
};

// Функция для создания QR-кода
const generateQRCodeUrl = (bitcoinAddress, amount) => {
  const btcAmount = parseFloat(amount).toFixed(8);
  const uri = `bitcoin:${bitcoinAddress}?amount=${btcAmount}&label=MillionPixels&message=Order%20Payment`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;
};

const deleteOldImage = (imageUrl) => {
  if (imageUrl && imageUrl.startsWith('/uploads/')) {
    const filename = path.basename(imageUrl);
    const filePath = path.join(uploadDir, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) console.error('Ошибка удаления файла:', err);
      });
    }
  }
};

// Hash password
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// Routes
app.get('/', (req, res) => {
  db.all('SELECT * FROM pixels WHERE purchased = 1 ORDER BY created_at DESC', (err, pixels) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Ошибка базы данных');
    }
    res.render('index', { pixels: pixels || [] });
  });
});

// ===================== АДМИН ПАНЕЛЬ =====================
app.get('/admin', (req, res) => {
  const sessionId = req.query.session;
  
  // Проверяем сессию администратора
  db.get('SELECT * FROM admin WHERE id = 1', (err, admin) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Ошибка базы данных');
    }
    
    if (sessionId && sessions[sessionId]) {
      // Загружаем все данные для админ-панели
      db.all('SELECT * FROM pixels ORDER BY created_at DESC', (err, pixels) => {
        if (err) {
          console.error(err);
          return res.status(500).send('Ошибка базы данных');
        }
        
        db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, orders) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Ошибка базы данных');
          }
          
          db.all('SELECT * FROM users ORDER BY created_at DESC', (err, users) => {
            if (err) {
              console.error(err);
              return res.status(500).send('Ошибка базы данных');
            }
            
            const purchasedPixels = (pixels || []).filter(p => p.purchased).length;
            const totalRevenue = (orders || []).filter(o => o.payment_status === 'paid')
              .reduce((sum, o) => sum + (parseFloat(o.payment_received) || 0), 0);
            
            res.render('admin', { 
              pixels: pixels || [], 
              orders: orders || [], 
              users: users || [],
              sessionId: sessionId,
              stats: {
                totalPixels: (pixels || []).length,
                purchasedPixels,
                totalOrders: (orders || []).length,
                totalUsers: (users || []).length,
                totalRevenue: totalRevenue.toFixed(8)
              }
            });
          });
        });
      });
    } else {
      // Если нет сессии, показываем форму входа
      res.render('admin_login', { 
        error: null,
        defaultPassword: admin ? admin.password : 'admin'
      });
    }
  });
});

// Вход в админ-панель
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  
  db.get('SELECT * FROM admin WHERE id = 1', (err, admin) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Ошибка базы данных');
    }
    
    if (!admin) {
      // Создаем администратора если не существует
      db.run('INSERT INTO admin (id, password) VALUES (1, ?)', ['admin'], (insertErr) => {
        if (insertErr) {
          console.error(insertErr);
          return res.status(500).send('Ошибка базы данных');
        }
        
        if (password === 'admin') {
          const sessionId = Date.now().toString() + Math.random().toString(36).substr(2);
          sessions[sessionId] = { 
            authenticated: true,
            expires: Date.now() + 3600000
          };
          return res.redirect(`/admin?session=${sessionId}`);
        } else {
          return res.render('admin_login', { error: 'Неверный пароль', defaultPassword: 'admin' });
        }
      });
    } else {
      if (password === admin.password) {
        const sessionId = Date.now().toString() + Math.random().toString(36).substr(2);
        sessions[sessionId] = { 
          authenticated: true,
          expires: Date.now() + 3600000
        };
        return res.redirect(`/admin?session=${sessionId}`);
      } else {
        return res.render('admin_login', { error: 'Неверный пароль', defaultPassword: admin.password });
      }
    }
  });
});

// Добавление пикселя через админ-панель
app.post('/admin/add-pixel', upload.single('image'), (req, res) => {
  const sessionId = req.query.session;
  
  // Проверяем сессию
  if (!sessionId || !sessions[sessionId]) {
    return res.status(401).json({ success: false, error: 'Не авторизован' });
  }
  
  const { x, y, width, height, color, link, title, username, purchased } = req.body;
  
  console.log('Admin adding pixel:', { x, y, width, height, title, username });
  
  // Валидация
  if (!x || !y || !width || !height || !title || !username) {
    return res.json({ success: false, error: 'Заполните все обязательные поля' });
  }
  
  const pixelX = parseInt(x);
  const pixelY = parseInt(y);
  const pixelWidth = parseInt(width);
  const pixelHeight = parseInt(height);
  
  if (pixelWidth < 1 || pixelHeight < 1 || pixelWidth > 1000 || pixelHeight > 1000) {
    return res.json({ success: false, error: 'Недопустимый размер пикселей (мин: 1x1, макс: 1000x1000)' });
  }
  
  if (pixelX + pixelWidth > 1000 || pixelY + pixelHeight > 1000) {
    return res.json({ success: false, error: 'Пиксели выходят за границы сетки' });
  }
  
  if (pixelX < 0 || pixelY < 0) {
    return res.json({ success: false, error: 'Координаты не могут быть отрицательными' });
  }
  
  // Проверяем, не заняты ли пиксели
  db.get(
    `SELECT COUNT(*) as count FROM pixels WHERE purchased = 1 
     AND x < ? + ? AND x + width > ? 
     AND y < ? + ? AND y + height > ?`,
    [pixelX, pixelWidth, pixelX, pixelY, pixelHeight, pixelY],
    (err, result) => {
      if (err) {
        console.error('Error checking occupied pixels:', err);
        return res.json({ success: false, error: 'Ошибка базы данных при проверке пикселей' });
      }
      
      if (result && result.count > 0) {
        return res.json({ success: false, error: 'Некоторые пиксели уже заняты' });
      }
      
      // Создаем запись пикселя
      let imageUrl = null;
      if (req.file) {
        imageUrl = '/uploads/' + req.file.filename;
      }
      
      const isPurchased = purchased === 'on' ? 1 : 0;
      
      db.run(
        `INSERT INTO pixels (x, y, width, height, color, image_url, link, title, username, purchased) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pixelX, pixelY, pixelWidth, pixelHeight, color || null, imageUrl, link || null, title, username, isPurchased],
        function(err) {
          if (err) {
            console.error('Error adding pixel:', err);
            return res.json({ success: false, error: 'Ошибка добавления пикселя в базу данных' });
          }
          
          console.log('Pixel added successfully by admin, ID:', this.lastID);
          res.json({ 
            success: true, 
            message: 'Пиксель успешно добавлен',
            pixelId: this.lastID
          });
        }
      );
    }
  );
});

// Удаление пикселя через админ-панель
app.post('/admin/delete-pixel', (req, res) => {
  const sessionId = req.query.session;
  const { pixelId } = req.body;
  
  // Проверяем сессию
  if (!sessionId || !sessions[sessionId]) {
    return res.status(401).json({ success: false, error: 'Не авторизован' });
  }
  
  if (!pixelId) {
    return res.json({ success: false, error: 'Не указан ID пикселя' });
  }
  
  // Получаем информацию о пикселе для удаления изображения
  db.get('SELECT image_url FROM pixels WHERE id = ?', [pixelId], (err, pixel) => {
    if (err) {
      console.error('Error getting pixel:', err);
      return res.json({ success: false, error: 'Ошибка базы данных' });
    }
    
    if (!pixel) {
      return res.json({ success: false, error: 'Пиксель не найден' });
    }
    
    // Удаляем файл изображения если есть
    if (pixel.image_url) {
      deleteOldImage(pixel.image_url);
    }
    
    // Удаляем пиксель из базы
    db.run('DELETE FROM pixels WHERE id = ?', [pixelId], function(err) {
      if (err) {
        console.error('Error deleting pixel:', err);
        return res.json({ success: false, error: 'Ошибка удаления пикселя' });
      }
      
      res.json({ 
        success: true, 
        message: 'Пиксель успешно удален'
      });
    });
  });
});

// Обновление статуса оплаты заказа (админ)
app.post('/admin/update-order-status', (req, res) => {
  const sessionId = req.query.session;
  const { orderId, status } = req.body;
  
  // Проверяем сессию
  if (!sessionId || !sessions[sessionId]) {
    return res.status(401).json({ success: false, error: 'Не авторизован' });
  }
  
  if (!orderId || !status) {
    return res.json({ success: false, error: 'Не указаны ID заказа и статус' });
  }
  
  const validStatuses = ['pending', 'paid', 'expired', 'processing'];
  if (!validStatuses.includes(status)) {
    return res.json({ success: false, error: 'Неверный статус' });
  }
  
  db.run(
    `UPDATE orders SET payment_status = ? WHERE order_id = ?`,
    [status, orderId],
    function(err) {
      if (err) {
        console.error('Error updating order status:', err);
        return res.json({ success: false, error: 'Ошибка обновления статуса заказа' });
      }
      
      // Если статус изменен на "paid", отмечаем пиксели как купленные
      if (status === 'paid') {
        db.run(
          'UPDATE pixels SET purchased = 1 WHERE order_id = ?',
          [orderId],
          (err) => {
            if (err) {
              console.error('Error updating pixels:', err);
              // Не прерываем ответ, просто логируем ошибку
            }
          }
        );
      }
      
      res.json({ 
        success: true, 
        message: 'Статус заказа успешно обновлен'
      });
    }
  );
});

// ===================== ПОЛЬЗОВАТЕЛЬСКАЯ ПАНЕЛЬ =====================
// ... остальной код пользовательской панели остается без изменений ...

// Cleanup old sessions
setInterval(() => {
  const now = Date.now();
  for (const sessionId in sessions) {
    if (sessions[sessionId].expires < now) {
      delete sessions[sessionId];
    }
  }
  for (const sessionId in userSessions) {
    if (userSessions[sessionId].expires < now) {
      delete userSessions[sessionId];
    }
  }
}, 60000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`👤 Панель пользователя: http://localhost:${PORT}/user`);
  console.log(`⚙️  Админ-панель: http://localhost:${PORT}/admin`);
  console.log(`🔑 Пароль администратора: admin`);
  console.log(`💰 Используется Bitcoin Testnet3 для платежей`);
  console.log(`📊 Минимальный размер пикселя: 1×1`);
});