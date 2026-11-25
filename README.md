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
npm run seed        # 建表 + 5 道示例题 + admin/demo 账号（幂等）
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

> `admin/demo` 只由开发用 `npm run seed` 创建。生产环境拒绝运行 demo seed，也不会把首个公开注册账号提权；生产管理员必须显式初始化。
>
> 开发模式下空库的首个注册账号仍会成为管理员。生产首次初始化示例：`OJ_ADMIN_USERNAME=... OJ_ADMIN_PASSWORD=... npm run admin:create`（密码至少 12 位）。

## 生产部署（单端口）

```bash
npm run install:all   # 装两端依赖
npm run build         # web 构建 + server 编译（前端产物由后端托管）
npm run start         # 默认 0.0.0.0:3001，启动日志会打印局域网地址
```

该快捷部署适用于开发或可信的内部教学环境。生产必须设置 `NODE_ENV=production`、`OJ_DEPLOYMENT_MODE=internal|public` 和非默认 `JWT_SECRET`；公网模式还强制 `JUDGE_EXECUTOR=docker`。公网推荐使用 Docker Compose 部署。

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
提交 → 入库(PENDING) + 写入 SQLite 判题队列 → worker 进程认领
  → 落盘源码 → 编译/语法检查（失败=CE）
  → 预热执行（规避 Windows Defender 首次扫描导致误判 TLE）
  → 逐测试点运行：stdin 注入、stdout 捕获、超时/超内存/超输出强杀进程树
  → 输出比对（归一化行尾与行末空白）；题目配了 checker 时改由 checker 判定
  → 首个非 AC 即终止后续测试点
  → 逐点写 submission_cases → API 侧轮询该表经 SSE 推送 → 汇总最终状态
```

状态码：`AC` `WA` `TLE` `MLE` `RE` `CE` `OLE`（输出超限）`SE`（系统错误）。

## 判题进程

判题与 API 是两个角色，通过 `judge_queue` SQLite 表衔接（API 入队、worker 轮询认领，SQLite 写锁保证不会重复消费），单机零外部依赖：

| 模式 | 启动方式 | 说明 |
| --- | --- | --- |
| 内联（开发默认） | `npm start` / `npm run dev` | API 进程内自带 worker，适合开发与可信的内部教学环境 |
| 分离 | `JUDGE_INLINE=0 npm start` + `npm run judge` | API 只入队，独立 worker 消费；公网模式要求 `JUDGE_EXECUTOR=docker` |

- **崩溃恢复**：每个认领有独立 token，worker 每 10 秒续租，45 秒过期后才可恢复；恢复和退出仅影响自己的过期/持有任务。新一轮开始会事务清空旧测试点，过期 worker 不能写回旧轮结果。
- **执行器可替换**：真正跑代码的部分抽象为 `JudgeExecutor` 接口（`judge/executor.ts`），`JUDGE_EXECUTOR=local`（默认，宿主子进程）与 `docker`（一次性容器，有隔离）切换行为，自测运行与提交判题走同一实现；详见 DEPLOY.md「Docker 判题执行器」。
- **进度可见**：逐点结果写 `submission_cases`（含 `first_diff`），批量重判批次写 `rejudge_batches` 两表——API 的 SSE 改为轮询这两张表推增量，事件格式与旧的进程内事件完全一致，API 或 worker 任意一方重启都不丢进度。
- 生产构建后 worker 入口是 `node dist/judge/worker-cli.js`（`npm run judge` 是开发快捷方式）。

## 功能清单

- 认证：注册 / 登录 / JWT 续期校验；token 只用来确认身份，**角色一律回查数据库**（普通请求与匿名可选鉴权都如此），管理员被降权后旧 token 立即失效
- 题目：列表（搜索、难度筛选、标签筛选、收藏筛选、通过率、个人解题状态）、详情（Markdown 题面 + 样例 + 提示 + 标签）；未公开题目仅管理员可见；挂了比赛且所有关联比赛都未开赛的题目，对普通用户在列表与详情里同样不可见（404，不泄露存在性），任意关联比赛开赛后自动恢复
- **错因定位**：WA 时给出「第 X 行第 Y 列起不同」，样例额外展示期望/实际那一行；隐藏测试点只回行列、不回数据，避免反推测试内容
- **提交演进**：提交详情页可「与上次提交对比」，逐行 diff 高亮增删（手写 LCS，零依赖）；只能对比自己的提交，管理员可对比任意两条（后端校验）
- **标签与收藏**：标签自由文本（trim + 去重 + 上限 10 个），列表按标签筛选；题目可收藏，支持「只看收藏」
- **个人主页** `/u/:id`：解题数 / 提交数 / 通过率 / 状态分布 + 最近 26 周提交热力图 + 最近提交
- **深色模式**：顶栏一键切换，主题存 localStorage，首次跟随系统；CodeMirror 跟随切换
- 提交：CodeMirror 编辑器、5 种语言模板、草稿存本地、提交冷却
- **自测运行**：自定义标准输入 → 运行 → 右侧看程序输出（含 stderr、退出码、耗时、内存），不入提交记录、不影响通过率；`Ctrl+Enter` 运行、`Ctrl+Shift+Enter` 提交；可一键填充题面样例
- **草稿箱**：自建任意语言的代码文件，输入即自动保存（700ms 防抖）、关页面/换浏览器再打开仍是原样；支持新建/重命名/切换语言/删除/搜索，可直接运行调试；题目页可一键「存草稿」把当前代码带进草稿箱
- **自定义语言模板**：每种语言可保存一份自己的初始模板，之后新建该语言文件自动套用；支持「填入当前文件」快速把已写好的代码结构存为模板、一键恢复系统默认
- **特殊评测（SPJ）**：checker 的正常 `WA` 协议保持不变；checker 的超时、超内存、超输出和执行环境错误判为 `SE`，即使 stdout 已输出 `AC` 也不能通过。隐藏测试点不展示 checker 的诊断文本。
- **题面格式**：题面、输入/输出说明和提示共用 DOMPurify 净化；支持 KaTeX 行内 `$...$` 与块级 `$$...$$` 公式。
- **做题布局**：桌面端题面与编辑器可拖动分栏，编辑器可全屏；窄屏导航和表格可横向滚动。
- 判题结果：SSE 实时逐点结果（前端断线自动降级轮询），编译错误输出、样例差异提示；推送完成后服务端主动断流，并用 60 秒一次性 ticket 代替 URL 上的长期 token
- 历史：我的提交列表（按状态筛选）、提交详情（代码只对本人/管理员可见）
- 排名：通过题数榜（同分看提交次数）、通过率、最近提交时间
- **比赛**：`/contests` 列表与详情、报名、10 分钟倒计时、实时榜单（首次 AC + 20 分钟/次罚时）；封榜期间非管理员只看到「?」，结束或手动解封后自动公布；比赛进行中禁止查看他人提交详情；未开始的比赛不下发题目。封榜语义同时覆盖提交列表与两个统计接口：非本人（含匿名）看到的他人封榜后提交一律显示 `HIDDEN`（封榜中，结果赛后公布），本人与管理员不受影响
- 管理端：题目 CRUD、标签编辑、测试点增删改（样例标记）、可见性、提交列表、任意提交重判、用户角色调整
- **批量重判**：按题目 / 状态 / 时间范围筛选，一次最多 500 条，必须勾选二次确认；只入队不阻塞接口，进度走 SSE（`/api/streams/batch/:id`）实时推送，断线自动降级为 1.5s 轮询状态接口；批次记录持久化在 SQLite，API 或 worker 重启后进度仍可查询、批次照常收敛
- 安全：Zod 入参校验、密码 bcrypt、参数化 SQL、管理端接口双重鉴权、代码长度/输出体积上限、测试点提交总量上限 8MB

## 目录结构

```
server/
  src/
    app.ts            路由挂载
    config.ts         环境变量与默认值
    db/               SQLite 连接与 schema.sql
    routes/           auth / problems / submissions / stats / admin
    judge/            languages（语言配置）/ runner（沙箱）/ comparator / index（队列与流程）
    seed/run.ts       示例题与账号（admin / demo，均幂等）
  scripts/smoke.mjs   判题端到端冒烟（建题 → 5 语言提交 → 校验状态）
  tests/              纯函数单测（node:test）
  judge-include/      C++ 万能头 shim（见下方说明）
web/
  src/
    api/              fetch 封装与类型
    context/          AuthContext / ThemeContext（深浅色）
    components/       Layout / StatusBadge / CodeEditor / CodeDiffView / SubmissionHeatmap / ResultPanel / SelfTestPanel / TemplateModal / ProtectedRoute
    pages/            列表 / 详情 / 草稿箱 / 提交 / 排名 / 个人主页 / 管理端
    lib/              format（状态与格式化）/ templates / diff（逐行 LCS）
  scripts/ui-check.mjs 用本机 Edge 跑一遍真实交互并截图
  scripts/ui-dark.mjs  逐页浅色/深色截图并校验深色生效
  tests/              前端格式化与 diff 单测（node:test + tsx）
.github/workflows/ci.yml  两端类型检查 + 单测
```

## 验证方式

```bash
npm run check                            # 两端 tsc --noEmit（CI 必跑）
npm run test:unit                        # 单测 + 临时 SQLite 集成回归：五语言、SPJ、队列、权限和封榜
npm run test:judge                       # 对当前已启动服务运行 API 冒烟脚本
cd server && node scripts/contest-freeze.mjs  # 封榜语义回归：三个读接口的打码 / 本人可见 / 管理员全量 / 赛后恢复（需先启动后端）
cd server && node scripts/contest-visibility.mjs  # 比赛窗口可见性：未开赛隐藏 / 开赛恢复 / 已结束+未开始并存仍可见（需先启动后端）
cd server && node scripts/spj-stderr.mjs  # SPJ 错因收紧：隐藏点不外泄 checker stderr / 样例正常展示 / SSE 同规则（需先启动后端）
cd web && node scripts/ui-check.mjs      # 登录→自测运行→提交→结果面板截图，收集控制台/HTTP 错误
cd web && node scripts/ui-drafts.mjs     # 草稿箱：新建→自动保存→刷新恢复→即时刷新兜底→运行→删除
cd web && node scripts/ui-templates.mjs  # 自定义模板：保存模板→新建文件自动套用→恢复默认
cd web && node scripts/ui-problem-template.mjs  # 题目页套用自定义模板 / 自己代码优先保留
cd web && node scripts/ui-dark.mjs       # 逐页浅色/深色截图，校验深色生效且无控制台/HTTP 错误
```

测试使用 `node:test` 与临时数据库/工作目录；需要本地 gcc、g++、Python、Node 和 JDK 来跑真实多语言集成。Docker 可用且 `oj-judge:latest` 镜像存在时会额外跑容器限制回归；CI 会构建该镜像。`ui-*.mjs` 依赖的 `playwright-core` 已锁版本。

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
                                    # 封榜期：非本人（含匿名）看到的他人封榜后提交 status='HIDDEN'，耗时/内存/通过点置 0
GET  /api/submissions/:id
GET  /api/submissions?userId=&beforeId=   # 提交对比定位相邻记录（userId 仅本人或管理员）
POST /api/submissions/:id/stream-ticket   # 换 60 秒一次性 SSE 票据
GET  /api/submissions/:id/stream?ticket=  # SSE（也兼容 Authorization 头）
GET  /api/problems/tags             # 标签云（含每标签题目数）
POST|DELETE /api/problems/:id/favorite    # 收藏 / 取消收藏
GET  /api/contests                  GET /api/contests/:id     # 比赛列表 / 详情（含题目）
POST|DELETE /api/contests/:id/register    # 报名 / 取消报名
GET  /api/contests/:id/standings    # 实时榜单（封榜时对非管理员隐藏结果）
GET  /api/stats/overview            GET /api/stats/leaderboard
GET  /api/stats/problems/:id        GET /api/stats/users/:id   # 个人主页（含 26 周热力图数据）；recent 列表同样遵守封榜期 HIDDEN 语义
管理端（需 admin）
GET|POST /api/admin/problems        GET|PUT|DELETE /api/admin/problems/:id
GET|POST /api/admin/problems/:id/testcases
PUT|DELETE /api/admin/testcases/:tid
GET  /api/admin/submissions         POST /api/admin/submissions/:id/rejudge
POST /api/admin/submissions/rejudge-batch          # 批量重判（confirm=true，limit ≤ 500）
GET  /api/admin/submissions/rejudge-batch/:batchId # 进度查询
GET  /api/admin/users               PATCH /api/admin/users/:id/role
GET|POST /api/admin/contests        GET|PUT|DELETE /api/admin/contests/:id
PUT  /api/admin/contests/:id/problems              # 覆盖式挂题（A/B/C 编号）
POST /api/admin/contests/:id/unfreeze              # 手动解封
GET  /api/streams/batch/:id?ticket=                # 批量重判进度 SSE（一次性票据）
```

## 环境变量（server/.env）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| PORT | 3001 | 服务端口 |
| JWT_SECRET | dev-only-secret-change-me | 生产必须替换 |
| OJ_DEPLOYMENT_MODE | development（非生产） | 生产必填：`internal` 或 `public`；公网强制 Docker 执行器 |
| DB_PATH | data/oj.db | SQLite 文件路径 |
| JUDGE_WORK_DIR | data/judge | 判题临时目录（跑完即删） |
| JUDGE_INLINE | 1 | 1 = API 进程内联一个 worker（零配置）；0 = 分离模式，API 只入队，需另跑 `npm run judge` |
| JUDGE_WORKERS | 2（兼容旧名 JUDGE_CONCURRENCY） | 判题 worker 并发数 |
| JUDGE_EXECUTOR | local | 判题执行器：local = 宿主子进程（无隔离）；docker = 一次性容器（有隔离，见 DEPLOY.md） |
| JUDGE_DOCKER_IMAGE | oj-judge:latest | docker 执行器的判题镜像，需内置 5 种语言工具链 |
| JUDGE_QUEUE_LIMIT | 2000 | 判题队列最大任务数 |
| SUBMIT_COOLDOWN_SEC | 5（本地 .env 设为 1） | 同一用户提交间隔 |
| RUN_COOLDOWN_MS | 2000 | 同一用户自测运行间隔（毫秒） |
| TRUST_PROXY | 0 | 单层可信反向代理后设为 1，启用客户端 IP 限流 |
| CORS_ORIGIN | http://localhost:5173 | 允许的前端来源 |

## 已知限制（重要）

1. `local` 执行器没有文件系统或网络隔离，只适用于可信的本地/内部环境。生产 `public` 模式拒绝非 Docker 执行器。
2. Docker 容器内通过 cgroup 限制内存，但 Docker 执行器不报告容器峰值内存，因此界面显示 `—`；超限仍按 MLE 判定。宿主 local 模式的 Windows 内存值是采样值。
3. Docker 执行器依赖 Docker daemon。公网 Compose 将 API 和 worker 分开，但两者都需要 Docker socket（API 自测也会运行容器）；挂载 Docker socket 的服务账号拥有高权限，需限制主机访问并保持系统更新。判题工作目录必须在宿主机与服务容器使用相同绝对路径。
4. JWT 仍存于 `localStorage`，XSS 可窃取当前用户 token；SSE 长期 JWT 不放 URL，使用 60 秒一次性 ticket。
5. SSE ticket 当前存在 API 进程内存；多 API 副本需要共享票据存储或粘性路由。
6. 热力图按 UTC 日期聚合；北京时间凌晨 0–8 点的提交会计入前一天。
7. 代码 diff 单侧超过 1500 行时降级为整段删除/新增。
8. 本机 MinGW 8.1 使用仓库内的 `<bits/stdc++.h>` shim；Linux Docker 镜像使用系统 GCC 头文件。
9. better-sqlite3 是同步驱动，SQLite 写锁竞争会短暂阻塞 API 事件循环；当前通过 WAL、busy timeout 和有限队列控制单机负载。

## 后续可做

- 交互题、多文件提交
- 题单（把标签组合成学习路径）
- 交互题、多文件提交
- 多 API 副本时共享 SSE ticket 存储与更高负载下 SQLite 写入优化
