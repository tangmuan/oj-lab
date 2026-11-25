# 部署指南

> 三种方式，按"给别人用"的范围选。**先看第 0 节的安全红线，再动手。**

| 方案 | 适用场景 | 别人怎么访问 | 需要额外准备 |
| --- | --- | --- | --- |
| A. 局域网 | 办公室 / 教室 / 家里多台电脑 | `http://<你的IP>:3001` | 无（本机就能跑） |
| B. 云服务器 | 真正公网访问、要域名和 HTTPS | `https://oj.example.com` | 一台 Linux VPS + 域名 |
| C. Docker | 服务器上想环境隔离、一键迁移 | 同 B | Docker |

---

## 0. ⚠️ 安全红线（务必先读）

部署分为三种明确模式：开发模式使用 `local` 执行器；可信的内部教学环境可以在 `OJ_DEPLOYMENT_MODE=internal` 下使用 `local`；公网环境必须设置 `OJ_DEPLOYMENT_MODE=public` 和 `JUDGE_EXECUTOR=docker`，否则生产服务拒绝启动。生产还必须配置非默认 `JWT_SECRET`，且不能使用 demo seed。

`local` 执行器只限制时间、内存和输出，不隔离文件系统或网络。Docker 执行器将编译、选手程序和 checker 放进一次性容器，关闭网络、设只读根文件系统、限制 PID/CPU/内存，并只挂载本次临时工作目录。Docker socket 本身具有高权限，Compose 将 API 与 worker 拆开，但 API 仍需 socket 来运行自测代码；请仅在专用可信主机运行并限制主机访问。

---

## Docker 判题执行器

**前置条件**

1. 宿主机已安装 Docker（Linux 原生，或 Windows/macOS 的 Docker Desktop）；
2. 判题镜像内置 5 种语言的工具链，缺一不可：

   | 语言 | 镜像内需要的命令 |
   | --- | --- |
   | C | `gcc`（-std=c17，链接 `-lm`） |
   | C++ | `g++`（-std=c++17） |
   | Python | `python`（3.11+，支持 `-X utf8` 与 `-m py_compile`） |
   | Node.js | `node`（20+） |
   | Java | `javac` / `java`（17+） |

   仓库已提供镜像定义，使用 `docker build -t oj-judge:latest -f server/docker/judge.Dockerfile server/docker` 构建。

**启用步骤**

```bash
# .env 或 systemd 环境中设置
OJ_DEPLOYMENT_MODE=public
JUDGE_EXECUTOR=docker
JUDGE_DOCKER_IMAGE=oj-judge:latest   # 可选，默认就是 oj-judge:latest
JWT_SECRET=<随机 32 字节以上的密钥>

# API 使用 docker 执行器做自测；正式提交由独立 worker 消费
JUDGE_INLINE=0 npm run start
npm run judge
```

**行为说明**

- 编译、运行、checker **全部在容器里完成**（包括 gcc/g++/javac 本身），宿主机不需要装任何工具链；
- 每条命令一个一次性容器：`docker run --rm --network none --read-only --pids-limit 64 --memory {limit}m --memory-swap {limit}m --cpus 1 --user 65534 --tmpfs /tmp:rw,size=64m -v {工作目录}:/box -w /box`；容器对宿主的可见面只有挂载的一次性工作目录（判完即删），读不到数据库、源码仓库等任何数据目录；
- 选手程序时限在容器内开始计时，不计 Docker daemon/容器启动；外层另留启动宽限并在异常退出时删除容器。超时、输出上限和 cgroup OOM 分别映射 TLE、OLE、MLE。Docker 执行器暂不报告容器峰值内存，界面显示 `—`；
- docker 不存在、daemon 没起、镜像缺失时，提交判为 SE、自测运行返回 503，错误信息直接说明原因，不会冒充成编译错误；
- 每条命令使用一次性容器，编译型程序每个测试点都会启动容器，因此总提交响应时间会包含多次容器启动；单个测试点的程序时限不包含该启动时间。

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

## B. 云服务器内部教学部署（systemd）

此方案使用 `local` 执行器，只适用于可信用户的内部教学环境。公网部署请使用下方 Docker Compose 方案。

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
```

首次管理员请用 `OJ_ADMIN_USERNAME` / `OJ_ADMIN_PASSWORD` 执行 `node server/dist/seed/create-admin.js`。生产环境不要运行开发用 `npm run seed`。

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
Environment=OJ_DEPLOYMENT_MODE=internal
Environment=JUDGE_EXECUTOR=local
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

## C. 公网 Docker Compose 部署

```bash
# Linux 宿主机上的绝对路径；该路径会以相同绝对路径挂入 API、worker 和判题容器
export OJ_DATA_DIR=/srv/oj-data
sudo mkdir -p "$OJ_DATA_DIR"
sudo chown "$USER" "$OJ_DATA_DIR"

# 生产密钥与数据路径只通过环境传入，不写入仓库
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# 一次性容器镜像（含五种语言工具链）和服务镜像
docker build -t oj-judge:latest -f server/docker/judge.Dockerfile server/docker
docker compose build
docker compose up -d
docker compose logs -f api judge
```

反向代理只转发到本机 `127.0.0.1:3001`，关闭 SSE buffering，并只对外开放 80/443。Compose 运行 API 与独立 worker 两个服务，使用同一 SQLite 文件；判题工作目录按宿主绝对路径 bind mount，容器与 Docker daemon 看到的源路径保持一致。API 和 worker 都挂载 Docker socket，因为自测和正式提交都必须走隔离执行器。

生产没有公开默认管理员或默认密码。首次初始化时交互式读取账号和密码，然后在 API 镜像中运行一次性命令：

```bash
read -r -p 'Admin username: ' OJ_ADMIN_USERNAME
read -r -s -p 'Admin password (12+ chars): ' OJ_ADMIN_PASSWORD
printf '\n'
export OJ_ADMIN_USERNAME OJ_ADMIN_PASSWORD
docker compose run --rm -e OJ_ADMIN_USERNAME -e OJ_ADMIN_PASSWORD api node dist/seed/create-admin.js
unset OJ_ADMIN_USERNAME OJ_ADMIN_PASSWORD
```

`OJ_DATA_DIR` 必须是 Linux Docker daemon 可访问的绝对路径。挂载 `/var/run/docker.sock` 会给应用进程 Docker 主机级权限；请专用部署主机，限制 shell/SSH 访问并及时更新主机和镜像。

---

## 环境变量

| 变量 | 默认 | 生产建议 |
| --- | --- | --- |
| `PORT` | 3001 | 保持 |
| `HOST` | 0.0.0.0 | 走 Nginx 反代时设 `127.0.0.1` |
| `JWT_SECRET` | dev 默认值 | **必须换随机 32 字节**，否则 token 可伪造 |
| `OJ_DEPLOYMENT_MODE` | 非生产为 `development` | 生产必填 `internal` 或 `public`；公网只允许 `JUDGE_EXECUTOR=docker` |
| `DB_PATH` | `server/data/oj.db` | 放数据盘并纳入备份 |
| `JUDGE_CONCURRENCY` | 2 | 按 CPU 核数，`核数/2` 左右 |
| `JUDGE_WORKERS` | 2（兼容旧名 `JUDGE_CONCURRENCY`） | 判题 worker 并发数 |
| `JUDGE_EXECUTOR` | `local` | 公网部署必须设 `docker`（见上文「Docker 判题执行器」） |
| `JUDGE_DOCKER_IMAGE` | `oj-judge:latest` | Docker 执行器的判题镜像 |
| `JUDGE_QUEUE_LIMIT` | 2000 | SQLite 队列最大任务数 |
| `SUBMIT_COOLDOWN_SEC` | 5 | 人多了保持 5~10 |
| `RUN_COOLDOWN_MS` | 2000 | 自测频率限制 |
| `TRUST_PROXY` | 0 | 只在单层可信反代后设为 1 |
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
