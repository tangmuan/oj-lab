# 部署指南

> 三种方式，按"给别人用"的范围选。**先看第 0 节的安全红线，再动手。**

| 方案 | 适用场景 | 别人怎么访问 | 需要额外准备 |
| --- | --- | --- | --- |
| A. 局域网 | 办公室 / 教室 / 家里多台电脑 | `http://<你的IP>:3001` | 无（本机就能跑） |
| B. 云服务器 | 真正公网访问、要域名和 HTTPS | `https://oj.example.com` | 一台 Linux VPS + 域名 |
| C. Docker | 服务器上想环境隔离、一键迁移 | 同 B | Docker |

---

## 0. ⚠️ 安全红线（务必先读）

判题器是**在本机用子进程执行用户提交的任意代码**，只做了时间/内存/输出限制，**没有文件系统与网络隔离**。

- **方案 A（局域网/内网）**：可接受。使用者是你信任的同学/同事。
- **方案 B/C（公网）**：**必须先做隔离**，否则等于把服务器交给任何会写 `os.system("rm -rf /")` 的人。最低要求：
  - 每次判题跑在独立容器里：`--network none --read-only --pids-limit 64 --memory 256m --cpus 1 --user 65534`
  - 判题容器不挂载任何宿主目录，只挂一个空的可写 tmpfs
  - 判题机与主服务分机部署（把 `judge/` 单独抽成服务）
  - 关闭/收紧注册（加邀请码），Nginx 层加 `limit_req` 限流

当前代码把执行逻辑收敛在 `server/src/judge/exec.ts`（`buildProgram` / `runOnce`），要换成 Docker 只需改这两个函数，业务层不用动——需要我改成 Docker 执行器可以直接说。

---

## A. 局域网部署（最快，Windows 本机）

前提：这台机器装了 Node.js 20+、gcc/g++、JDK、Python（本项目开发机已具备）。

```bash
# 1) 装依赖（首次）
npm run install:all

# 2) 构建前端 + 后端（前端产物会被后端直接托管，单端口）
npm run build

# 3) 初始化题库（只会补缺失的题目，不会重复插入）
npm run seed

# 4) 启动（默认监听 0.0.0.0:3001，启动日志会打印局域网访问地址）
npm run start
```

启动后日志类似：

```
[oj-server] 本机访问: http://localhost:3001
[oj-server] 局域网访问: http://192.168.1.23:3001
[oj-server] 前端静态资源: 已托管 D:\zhuomian\my_first_web\web\dist
```

**放行防火墙**（PowerShell「以管理员身份运行」一次即可）：

```powershell
New-NetFirewallRule -DisplayName "OJ Lab 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

**查本机 IP**：`ipconfig` → 看「IPv4 地址」，例如 `192.168.1.23`。
**其他电脑**浏览器打开 `http://192.168.1.23:3001` 即可。

**长期后台运行**（关掉终端也不停）：

```bash
npm i -g pm2
pm2 start server/dist/index.js --name oj
pm2 save
# Linux: pm2 startup   （Windows 建议用 nssm 注册成服务）
```

---

## B. 云服务器部署（公网 + 域名 + HTTPS）

以 Ubuntu 22.04 为例，项目放 `/opt/oj`。

### 1) 装运行环境

```bash
sudo apt update
sudo apt install -y curl build-essential python3 openjdk-17-jdk-headless nginx
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

> 判题要真编译：`build-essential`（gcc/g++）、`openjdk-17-jdk-headless`（javac/java）、`python3` 三者缺一不可，缺谁该语言就全判 CE。

### 2) 部署代码并构建

```bash
sudo mkdir -p /opt/oj && sudo chown $USER /opt/oj
cd /opt/oj
# 上传代码：git clone <你的仓库> .  或  rsync -av ./ user@server:/opt/oj/
npm run install:all
npm run build
npm run seed
```

### 3) systemd 托管（只监听本机，公网入口交给 Nginx）

```bash
sudo tee /etc/systemd/system/oj.service > /dev/null <<'EOF'
[Unit]
Description=OJ Lab
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/oj/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
User=www-data
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=JWT_SECRET=换成随机长字符串
Environment=JUDGE_CONCURRENCY=2

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now oj
sudo systemctl status oj
```

> `HOST=127.0.0.1` 表示只有本机能连，外网必须经 Nginx；`/opt/oj/server/data` 要给 `www-data` 写权限：
> `sudo chown -R www-data:www-data /opt/oj/server/data`

### 4) Nginx 反向代理（SSE 必须关 buffering）

```nginx
server {
    listen 80;
    server_name oj.example.com;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 判题结果走 SSE，这两行不开的话前端只会一次性拿到全部结果（或一直转圈）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/oj /etc/nginx/sites-enabled/oj
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d oj.example.com   # 自动配 HTTPS 并续期
```

云服务器**安全组/防火墙只放行 22、80、443**，不要放 3001。

---

## C. Docker 部署

```bash
# JWT_SECRET 换成随机值
export JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
sed -i "s/change-me-to-a-long-random-string/$JWT/" docker-compose.yml

docker compose up -d --build
docker compose logs -f

# 首次初始化题库（容器里跑编译后的 seed）
docker compose exec oj node dist/seed/run.js
```

镜像内已包含 `build-essential / python3 / openjdk-17`，`server/data` 通过 volume 持久化。

> 说明：本机（Windows）没有安装 Docker，**Dockerfile / compose 未在本机实测**，语法按官方镜像规范编写；如果构建时 `better-sqlite3` 编译失败，确认镜像里装了 `build-essential python3`（已装）。

---

## 环境变量

| 变量 | 默认 | 生产建议 |
| --- | --- | --- |
| `PORT` | 3001 | 保持 |
| `HOST` | 0.0.0.0 | 走 Nginx 反代时设 `127.0.0.1` |
| `JWT_SECRET` | dev 默认值 | **必须换随机 32 字节**，否则 token 可伪造 |
| `DB_PATH` | `server/data/oj.db` | 放数据盘并纳入备份 |
| `JUDGE_CONCURRENCY` | 2 | 按 CPU 核数，`核数/2` 左右 |
| `SUBMIT_COOLDOWN_SEC` | 5 | 人多了保持 5~10 |
| `RUN_COOLDOWN_MS` | 2000 | 自测频率限制 |
| `CORS_ORIGIN` | `http://localhost:5173` | 同源部署（单端口）可不改；前后端分开部署时改成前端域名 |

---

## 备份与升级

**备份**（SQLite 单文件，冷备最简单）：

```bash
# 停服 2 秒 or 直接热备（WAL 模式下用 sqlite3 .backup 更稳）
sqlite3 server/data/oj.db ".backup 'backup-$(date +%F).db'"
```

**升级**：

```bash
cd /opt/oj
git pull              # 或重新上传
npm run install:all
npm run build
npm run seed          # 幂等：只补缺失题目
sudo systemctl restart oj
```

---

## 常见问题

**别人打不开页面**
1. 服务是不是真的监听 `0.0.0.0`（看启动日志，`HOST=127.0.0.1` 就只有本机能连）
2. 防火墙/安全组是否放行端口
3. 两台机器是否同一网段（`ping 你的IP`）
4. 云服务器上有没有把 3001 直接暴露（不建议，走 Nginx）

**判题结果一直"判题中"、不逐点亮起**
Nginx 没关 `proxy_buffering`，SSE 被缓冲了。按上面配置加上 `proxy_buffering off;`。

**某语言全部编译错误（CE）**
服务器缺对应编译器。`gcc --version`、`g++ --version`、`javac -version`、`python3 --version` 逐个确认；Java 还要注意 `JAVA_HOME`。

**判题 TLE 抖动、明明本地很快却超时**
服务器 CPU 被占满或核数太少。调低 `JUDGE_CONCURRENCY`，或给题目的时间限制留余量（1s → 1000ms 是标准，机器太弱可给题目 2000ms）。

**端口被占用**

```bash
# Linux
ss -lptn 'sport = :3001'
# Windows
netstat -ano | findstr :3001
```

**想换端口**：`PORT=8080 npm run start`，同时改 Nginx 反代地址和防火墙规则。
