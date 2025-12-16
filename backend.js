const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'salternsql',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10
});

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saltern_db.devices (
        mac_address VARCHAR(17) PRIMARY KEY,
        name VARCHAR(50),
        salinity FLOAT DEFAULT 0,
        target_salinity FLOAT DEFAULT 100,
        valve BOOLEAN DEFAULT FALSE,
        manual_mode BOOLEAN DEFAULT FALSE,
        is_final BOOLEAN DEFAULT FALSE,
        lat FLOAT DEFAULT 0,
        lng FLOAT DEFAULT 0,
        address VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("초기화 완료");
  } catch (err) {
    console.error("에러:", err);
  }
};
initDB();

// [1] 아두이노용: 데이터 동기화 (센서값 저장 + 명령 반환)
app.post('/api/device/sync', async (req, res) => {
  const { mac, salinity, valve, lat, lng, address } = req.body;
  
  try {
    // [수정] devices -> saltern_db.devices 로 변경
    await pool.query(
      `INSERT INTO saltern_db.devices (mac_address, salinity, valve, lat, lng, address)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       salinity = VALUES(salinity),
       valve = IF(manual_mode = 1, valve, VALUES(valve)),
       lat = VALUES(lat),
       lng = VALUES(lng),
       address = VALUES(address),
       updated_at = NOW()`,
      [mac, salinity, valve, lat, lng, address]
    );

    // [수정] devices -> saltern_db.devices 로 변경
    const [rows] = await pool.query(
      'SELECT manual_mode, target_salinity, valve FROM saltern_db.devices WHERE mac_address = ?', 
      [mac]
    );
    
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      // 처음 등록된 기기라 설정값이 없으면 기본값 반환
      res.json({ manual_mode: 0, target_salinity: 0, valve: 0 });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// [2] 앱용: 전체 장비 상태 조회 (fetchAll 대체)
app.get('/api/devices', async (req, res) => {
  try {
    // [수정] devices -> saltern_db.devices 로 변경
    const [rows] = await pool.query('SELECT * FROM saltern_db.devices');
    
    // 앱이 편하게 쓰도록 { "MAC주소": {데이터...}, "MAC주소2": {...} } 형태로 변환
    const responseData = {};
    rows.forEach(row => {
      responseData[row.mac_address] = {
        name: row.name,
        salinity: row.salinity,
        targetSalinity: row.target_salinity,
        valve: row.valve === 1,       // DB의 0/1을 true/false로 변환
        manualMode: row.manual_mode === 1,
        isFinal: row.is_final === 1,
        address: row.address,
        location: { lat: row.lat, lng: row.lng }
      };
    });
    
    res.json(responseData);
  } catch (err) {
    console.error(err);
    res.status(500).send('DB Error');
  }
});

// [3] 앱용: 장비 제어 및 설정 변경 (toggle, edit 등)
app.put('/api/device/:mac', async (req, res) => {
  const mac = req.params.mac;
  const body = req.body; // { valve: true } or { targetSalinity: 15 } ...

  // DB 컬럼명과 앱 변수명 매핑
  const fieldMap = {
    valve: 'valve',
    manualMode: 'manual_mode',
    targetSalinity: 'target_salinity',
    isFinal: 'is_final',
    name: 'name'
  };

  let updates = [];
  let values = [];

  // 요청 온 데이터만 쿼리에 추가
  Object.keys(body).forEach(key => {
    if (fieldMap[key]) {
      updates.push(`${fieldMap[key]} = ?`);
      values.push(body[key]);
    }
  });

  if (updates.length === 0) return res.send('No changes');

  values.push(mac);
  // [수정] devices -> saltern_db.devices 로 변경
  const sql = `UPDATE saltern_db.devices SET ${updates.join(', ')} WHERE mac_address = ?`;

  try {
    await pool.query(sql, values);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.listen(3000, () => {
  console.log('실행중');

});




