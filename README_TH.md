# 🎮 Pixel Agent Office สำหรับ Hermes — คู่มือฉบับสมบูรณ์

ดู Hermes Agent ของคุณทำงานแบบ real-time เป็นตัวละครใน office สไตล์ pixel-art

![Hermes running in Pixel Agents office](docs/demo.png)

> Hermes ทำงานใน TUI ด้านซ้าย ขณะที่ตัวละครขยับใน office ด้านขวา

---

## 📋 สิ่งที่ต้องมีก่อนเริ่ม

- **Node.js 18+** (`node --version`)
- **npm 10+** (`npm --version`)
- **Hermes Agent** ([NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent))
- **VPS หรือเครื่อง Linux** (แนะนำ Ubuntu 22.04+, RAM 4GB+)

---

## 🚀 วิธีติดตั้ง (แบบ 1 คำสั่ง)

SSH เข้า VPS แล้วรัน:

```bash
git clone https://github.com/michoder26-cloud/pixel-agents_hermes.git
cd pixel-agents_hermes
bash scripts/install_vps.sh
```

เสร็จแล้วเปิด `http://YOUR_VPS_IP:3100` ในเบราว์เซอร์ → จะเห็น office ว่างรออยู่

---

## 🔧 วิธีติดตั้ง (แบบ Manual ทีละขั้น)

### ขั้นที่ 1: Build Office Server

```bash
git clone https://github.com/michoder26-cloud/pixel-agents_hermes.git
cd pixel-agents_hermes/pixel-agents
npm install
cd webview-ui && npm install && cd ..
cd server && npm install && cd ..
npm run build
```

### ขั้นที่ 2: ติดตั้ง Hermes Plugin

```bash
cp -r hermes-plugin/pixel_observer ~/.hermes/plugins/
hermes plugins enable pixel_observer
```

### ขั้นที่ 3: ติดตั้ง Bridge Script

```bash
cp bridge/pixel_agents_bridge.py ~/.hermes/pixel_agents_bridge.py
```

### ขั้นที่ 4: ตั้ง Systemd Service (ให้รันถาวร)

```bash
bash scripts/setup_systemd.sh
```

### ขั้นที่ 5: เปิด Firewall

```bash
ufw allow 3100/tcp
```

### ขั้นที่ 6: ทดสอบ

```bash
# เช็คว่า office ทำงาน
curl http://127.0.0.1:3100/api/health

# ส่ง Hermes session ทดสอบ
hermes --cli --yolo -z 'Reply OK'
```

เปิด `http://YOUR_VPS_IP:3100` → ควรเห็นตัวละครปรากฏ!

---

## 🏗️ สถาปัตยกรรม

```
Hermes Agent
  ├── Telegram Gateway  ─┐
  ├── CLI Session        ─┼── Shell Hooks ──→ pixel_agents_bridge.py
  └── Cron Job           ─┘         │
                                    ▼
                          POST /api/hooks/hermes
                                    │
                                    ▼
                       Pixel Agents Office Server (:3100)
                          ├── HermesBridge (hermesBridge.ts)
                          ├── AgentStateStore
                          └── WebSocket ──→ Browser (pixel-art UI)
```

### การแมปตัวละคร
- **1 Hermes Profile = 1 ตัวละคร** (UUID5 จากชื่อ profile)
- Profile `trader` → ตัวละคร trader
- Profile `default` → ตัวละคร default (Telegram)
- Profile `coder` → ตัวละคร coder
- Subagent → ตัวละครพิเศษแยกต่างหาก (สืบทอด palette จาก parent)

---

## 📁 โครงสร้างไฟล์

```
pixel-agents_hermes/
├── pixel-agents/           # Office Server (fork ที่มี Hermes bridge)
│   ├── server/src/
│   │   ├── hermesBridge.ts         # ★ แปลง event → office animation
│   │   └── providers/hermes/       # ★ metadata ของ Hermes tools
│   └── webview-ui/                 # pixel-art UI (React)
├── hermes-plugin/
│   └── pixel_observer/             # ★ Hermes plugin
│       ├── __init__.py             # hook registration + event relay
│       └── plugin.yaml             # plugin metadata
├── bridge/
│   ├── pixel_agents_bridge.py      # ★ bridge v2 (แนะนำ)
│   └── pixel_agents_bridge_legacy.py  # bridge v1 (เก่า)
├── scripts/
│   ├── install_vps.sh              # ติดตั้งทุกอย่าง 1 คำสั่ง
│   ├── install_plugin.sh           # ติดตั้ง plugin อย่างเดียว
│   └── setup_systemd.sh            # ตั้ง systemd service
├── systemd/
│   └── pixel-office.service        # systemd unit file
├── docs/
│   ├── demo.png                    # screenshot ตัวอย่าง
│   ├── ARCHITECTURE.md             # อธิบายสถาปัตยกรรมเต็ม
│   └── TROUBLESHOOTING.md          # แก้ปัญหาที่พบบ่อย
└── .env.example                    # ตัวอย่าง env variables
```

---

## 🔌 Plugin vs Bridge — ใช้อะไรดี?

| | Plugin (`pixel_observer`) | Bridge (`pixel_agents_bridge.py`) |
|---|---|---|
| **ติดตั้ง** | copy → `~/.hermes/plugins/` | copy → `~/.hermes/` |
| **ทำงานยังไง** | Hermes โหลดอัตโนมัติทุก session | Hermes เรียกผ่าน shell hooks |
| **ข้อดี** | ครอบคลุมทุก event, ไม่ต้องตั้ง hooks | ง่าย, ไม่ต้อง enable plugin |
| **ข้อจำกัด** | Gateway ต้อง restart หลัง enable | บาง event อาจพลาด |
| **แนะนำ** | ✅ CLI / TUI session | ✅ Gateway (Telegram) |

**ใช้ทั้งสองพร้อมกันได้** — ไม่ซ้ำซ้อน (bridge จะ skip event ที่ plugin ส่งไปแล้ว)

---

## 🐛 แก้ปัญหาที่พบบ่อย

| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| ตัวละครไม่ขึ้น | Bridge ไม่ทำงาน | เช็ค `~/.pixel-agents/server.json` มีไหม |
| Plugin ไม่โหลด | Gateway เริ่มก่อน enable | `systemctl restart hermes-gateway-watchdog` |
| Port 3100 ถูกใช้ | Process เก่าค้าง | `kill $(lsof -t -i:3100)` แล้ว restart |
| Office ตาย | Node crash | `systemctl restart pixel-office` |

ดูรายละเอียดเพิ่มที่ [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## ⚙️ จัดการ Service

```bash
# เช็คสถานะ
systemctl status pixel-office

# Restart
systemctl restart pixel-office

# ดู log
tail -50 /root/pixel-office.log

# เช็ค health
curl http://127.0.0.1:3100/api/health
```

---

## 🧪 ทดสอบ

```bash
# รัน unit tests
cd pixel-agents && npm run test:server

# ทดสอบ bridge แบบ end-to-end
PA_TOKEN=<token> node verify_bridge.js
```

---

## 🙏 Credits

- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT)
- [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents)
- [aiunlocked1412/hermes-agent-pixel](https://github.com/aiunlocked1412/hermes-agent-pixel) — Original integration

Fork โดย **michoder26-cloud** พร้อมคู่มือภาษาไทย + install scripts อัตโนมัติ
