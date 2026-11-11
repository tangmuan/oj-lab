# OJ Lab · 在线判题系统

前后端分离的 Online Judge 实现：用户登录 → 写代码 → 提交 → 逐测试点实时判题 → 排名统计。

- 前端：React 18 + TypeScript + Vite + Tailwind + CodeMirror 6
- 后端：Node.js + Express + TypeScript + SQLite（better-sqlite3）+ JWT
- 判题：独立队列 + 子进程沙箱（编译/运行、时间/内存/输出三重限制、逐点 SSE 推送）

## 快速开始

需要 Node.js 18+（开发机实测 22），本机已具备 gcc / g++ / javac / python / node。

```bash
# 1) 后端（端口 3001）
cd server
npm install
npm run seed        # 建表 + 5 道示例题 + demo 账号
npm run dev         # tsx watch 热重载

# 2) 前端（端口 5173，/api 已代理到 3001）
cd web
npm install
npm run dev
```

打开 http://localhost:5173

> 给别的电脑用？见 **[DEPLOY.md](./DEPLOY.md)**（局域网 / 云服务器 + 域名 HTTPS / Docker 三种方式，含安全红线说明）。

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin | admin123 | 管理员 |
| demo | demo123 | 普通用户 |

> 首个注册的账号会自动成为管理员；也可以用 `admin` 登录后在管理端改任意用户角色。

## 生产部署（单端口）

```bash
npm run install:all   # 装两端依赖
npm run build         # web 构建 + server 编译（前端产物由后端托管）
npm run seed          # 初始化题库（幂等）
npm run start         # 默认 0.0.0.0:3001，启动日志会打印局域网地址
```

访问 `http://<本机IP>:3001` 即可，前端路由（如 `/problems/5` 刷新）由后端回退到 `index.html`。
详细步骤、Nginx 配置（含 SSE 必须关 `proxy_buffering`）、systemd、Docker、备份升级、常见问题都在 **[DEPLOY.md](./DEPLOY.md)**。

## 支持语言

| 语言 | 编译/检查 | 运行 |
| --- | --- | --- |
| C | `gcc -O2 -std=c17` | `main.exe` |
| C++ | `g++ -O2 -std=c++17` | `main.exe` |
| Java | `javac -encoding UTF-8`（主类可任意命名，自动识别 `public class`） | `java -Xmx{limit}m -Dfile.encoding=UTF-8` |
| Python 3 | `python -m py_compile`（语法错误判 CE） | `python -X utf8` |
| Node.js | `node --check` | `node main.js` |

## 自测运行 vs 提交判题

| | 自测运行 `POST /api/run` | 提交判题 `POST /api/submissions` |
| --- | --- | --- |
| 输入 | 用户自己填 | 题库中的全部测试点 |
| 输出 | 程序原始 stdout/stderr | 逐测试点 AC/WA/TLE… |
| 是否入库 | 否，跑完即删临时目录 | 是，进提交记录与排行榜 |
| 限制 | 题目时间/内存限制、2 秒频控、64KB 输入、1MB 输出 | 同左 + 5 秒提交冷却 |

自测与判题共用 `judge/exec.ts` 的同一套编译与沙箱执行逻辑，所以「自测能过、提交判错」不会来自环境差异。

## 草稿箱的保存机制

1. **输入即写本地镜像** —— 每次改动同步写 `localStorage`（同步 API，关标签页也不会丢）
2. **700ms 防抖落库** —— 停止输入后 `PUT /api/files/:id`，工具栏显示「保存中… / 已保存 20:11:27」
3. **离开页面补存** —— `beforeunload` 用 `fetch(keepalive)` 再补一次
4. **重新打开** —— 先取服务端内容，若本地镜像的时间戳比 `updated_at` 新（说明上次没来得及落库），自动回填并补存

服务端限制：每人最多 200 个文件、单文件 128 KB、自测输入 64 KB。文件按用户隔离，别人的 id 直接返回 404。

## 自定义语言模板

- 入口：草稿箱右上角「模板设置」，按语言分别编辑，存服务端（`user_templates` 表，主键 `user_id + language`）
- 优先级：**用户自定义模板 > 系统内置模板**；新建文件、以及在草稿里切换语言（当前内容为空或仍是旧模板时）都会自动套用
- **题目页同样生效**：题目详情页编辑器的初始代码也优先用你的自定义模板，「重置模板」也回到你的模板而不是内置模板
- 优先级：自己改过的代码（本地缓存） > 用户自定义模板 > 系统内置模板；只有真正改过模板内容才写缓存，避免「旧的系统模板缓存」盖住后来新建的自定义模板
- 只影响初始内容，不会改动已有文件；每个账号每种语言各存一份，互不可见
- 「填入当前文件」把正在编辑的代码直接搬进模板编辑器，适合把常用的读入/输出骨架固化成模板
- 「恢复系统默认」删除自定义模板，回退到 `web/src/lib/templates.ts` 里的内置模板

## 判题流水线

```
提交 → 入库(PENDING) → 内存队列 → Worker
  → 落盘源码 → 编译/语法检查（失败=CE）
  → 预热执行（规避 Windows Defender 首次扫描导致误判 TLE）
  → 逐测试点运行：stdin 注入、stdout 捕获、超时/超内存/超输出强杀进程树
  → 输出比对（归一化行尾与行末空白）
  → 首个非 AC 即终止后续测试点
  → 逐点写库 + SSE 推送 → 汇总最终状态
```

状态码：`AC` `WA` `TLE` `MLE` `RE` `CE` `OLE`（输出超限）`SE`（系统错误）。

## 功能清单

- 认证：注册 / 登录 / JWT 续期校验，角色以数据库为准（防旧 token 越权）
- 题目：列表（搜索、难度筛选、通过率、个人解题状态）、详情（Markdown 题面 + 样例 + 提示）
- 提交：CodeMirror 编辑器、5 种语言模板、草稿存本地、提交冷却
- **自测运行**：自定义标准输入 → 运行 → 右侧看程序输出（含 stderr、退出码、耗时、内存），不入提交记录、不影响通过率；`Ctrl+Enter` 运行、`Ctrl+Shift+Enter` 提交；可一键填充题面样例
- **草稿箱**：自建任意语言的代码文件，输入即自动保存（700ms 防抖）、关页面/换浏览器再打开仍是原样；支持新建/重命名/切换语言/删除/搜索，可直接运行调试；题目页可一键「存草稿」把当前代码带进草稿箱
- **自定义语言模板**：每种语言可保存一份自己的初始模板，之后新建该语言文件自动套用；支持「填入当前文件」快速把已写好的代码结构存为模板、一键恢复系统默认
- 判题结果：SSE 实时逐点结果（前端断线自动降级轮询），编译错误输出、样例差异提示
- 历史：我的提交列表（按状态筛选）、提交详情（代码只对本人/管理员可见）
- 排名：通过题数榜（同分看提交次数）、通过率、最近提交时间
- 管理端：题目 CRUD、测试点增删改（样例标记）、可见性、提交列表、任意提交重判、用户角色调整
- 安全：Zod 入参校验、密码 bcrypt、参数化 SQL、管理端接口双重鉴权、代码长度/输出体积上限

## 目录结构

```
server/
  src/
    app.ts            路由挂载
    config.ts         环境变量与默认值
    db/               SQLite 连接与 schema.sql
    routes/           auth / problems / submissions / stats / admin
    judge/            languages（语言配置）/ runner（沙箱）/ comparator / index（队列与流程）
    seed/run.ts       示例题与演示账号
  scripts/smoke.mjs   判题端到端冒烟（建题 → 5 语言提交 → 校验状态）
  judge-include/      C++ 万能头 shim（见下方说明）
web/
  src/
    api/              fetch 封装与类型
    context/          AuthContext
    components/       Layout / StatusBadge / CodeEditor / ResultPanel / SelfTestPanel / TemplateModal / ProtectedRoute
    pages/            列表 / 详情 / 草稿箱 / 提交 / 排名 / 管理端
  scripts/ui-check.mjs 用本机 Edge 跑一遍真实交互并截图
```

## 验证方式

```bash
cd server && node scripts/smoke.mjs      # 9 项断言：5 语言 AC + WA + TLE + CE + RE
cd web && node scripts/ui-check.mjs      # 登录→自测运行→提交→结果面板截图，收集控制台/HTTP 错误
cd web && node scripts/ui-drafts.mjs     # 草稿箱：新建→自动保存→刷新恢复→即时刷新兜底→运行→删除
cd web && node scripts/ui-templates.mjs  # 自定义模板：保存模板→新建文件自动套用→恢复默认
cd web && node scripts/ui-problem-template.mjs  # 题目页套用自定义模板 / 自己代码优先保留
```

## API 速览

```
POST /api/auth/register|login        GET /api/auth/me
GET  /api/problems                  GET /api/problems/:id
POST /api/run                       # 自测运行（不落库）：{problemId?, language, code, input}
GET|POST /api/files                 # 草稿箱列表 / 新建
GET|PUT|DELETE /api/files/:id       # 打开 / 保存 / 删除
GET  /api/templates                 # 我的自定义语言模板
PUT|DELETE /api/templates/:language # 保存 / 恢复系统默认
POST /api/submissions               GET /api/submissions?mine=1&problemId=&status=
GET  /api/submissions/:id           GET /api/submissions/:id/stream   (SSE)
GET  /api/stats/overview            GET /api/stats/leaderboard
GET  /api/stats/problems/:id
管理端（需 admin）
GET|POST /api/admin/problems        GET|PUT|DELETE /api/admin/problems/:id
GET|POST /api/admin/problems/:id/testcases
PUT|DELETE /api/admin/testcases/:tid
GET  /api/admin/submissions         POST /api/admin/submissions/:id/rejudge
GET  /api/admin/users               PATCH /api/admin/users/:id/role
```

## 环境变量（server/.env）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| PORT | 3001 | 服务端口 |
| JWT_SECRET | dev-only-secret-change-me | 生产必须替换 |
| DB_PATH | data/oj.db | SQLite 文件路径 |
| JUDGE_WORK_DIR | data/judge | 判题临时目录（跑完即删） |
| JUDGE_CONCURRENCY | 2 | 并发判题数 |
| SUBMIT_COOLDOWN_SEC | 5（本地 .env 设为 1） | 同一用户提交间隔 |
| RUN_COOLDOWN_MS | 2000 | 同一用户自测运行间隔（毫秒） |
| CORS_ORIGIN | http://localhost:5173 | 允许的前端来源 |

## 已知限制（重要）

1. **沙箱不是安全隔离。** 子进程 + 资源限制只能防「跑太久/吃太多内存」，挡不住恶意代码读文件、联网、fork 炸弹。仅适合本地教学/内部使用；用于公网必须换 Docker/gVisor/nsjail 等隔离方案（`judge/languages.ts` 与 `judge/runner.ts` 已抽象，替换成本可控）。
2. **内存是采样值，不是 cgroup 精确值。** Windows 无 cgroup，靠每 120ms 轮询 `tasklist` 的工作集，几十毫秒就跑完的 C/C++ 程序可能采不到，界面显示 `—`（鼠标悬停有说明）；MLE 判定对长时间运行的程序才准确。
3. **判题在 API 进程内。** 提交量上来会拖慢接口，生产应把 judge 拆成独立进程/服务，队列换成 Redis/BullMQ。
4. **C++ 万能头 shim。** 本机 MinGW 8.1 的 `<bits/stdc++.h>` 会引入残缺的 `<filesystem>`，C++17 下必然编译失败；`judge-include/bits/stdc++.h` 提供了跳过 `<filesystem>` 的等价头，判题时用 `-I` 优先命中。换用 GCC 9+ 后可直接删掉该目录。
5. **题面 HTML 未做 sanitize。** 题面仅管理员可写，若开放给普通用户出题，需要接入 DOMPurify。
6. **JWT 存 localStorage。** 简单直接，但存在 XSS 窃取风险；更高安全要求应改用 httpOnly Cookie + CSRF token。

## 后续可做

- 比赛模式（限时、封榜、实时排名）
- 特殊评测（SPJ）、交互题、多文件提交
- 题目标签与题单、收藏
- judge 服务化 + Docker 沙箱、判题机水平扩容
- 单元测试（当前以真实提交的端到端冒烟替代）
