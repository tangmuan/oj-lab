import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { errorHandler } from './utils/errors';
import { authRouter } from './routes/auth';
import { problemsRouter } from './routes/problems';
import { submissionsRouter } from './routes/submissions';
import { statsRouter } from './routes/stats';
import { adminRouter } from './routes/admin';
import { runRouter } from './routes/run';
import { filesRouter } from './routes/files';
import { templatesRouter } from './routes/templates';
import { contestsRouter } from './routes/contests';
import { streamsRouter } from './routes/streams';
import { LANGUAGES } from './judge/languages';
import { queueStats } from './judge/queue';

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin, credentials: true }));

  // 管理端一次可能提交 60 个测试点，需要更大的包体；其余接口保持 1MB，
  // 避免匿名请求拿大 body 换进程内存
  const jsonDefault = express.json({ limit: '1mb' });
  const jsonAdmin = express.json({ limit: '16mb' });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/admin')) return next();
    return jsonDefault(req, res, next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'oj-server', time: new Date().toISOString(), judge: queueStats() });
  });

  app.get('/api/meta/languages', (_req, res) => {
    res.json({
      languages: Object.values(LANGUAGES).map((l) => ({ id: l.id, label: l.label })),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/problems', problemsRouter);
  app.use('/api/submissions', submissionsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/run', runRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/contests', contestsRouter);
  app.use('/api/streams', streamsRouter);
  app.use('/api/admin', jsonAdmin, adminRouter);

  // 生产模式：若前端已构建（web/dist 存在），由后端一并托管，实现单端口同源部署
  const indexHtml = path.join(config.webDist, 'index.html');
  const hasWeb = fs.existsSync(indexHtml);
  if (hasWeb) {
    app.use(
      express.static(config.webDist, {
        index: false,
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      })
    );
  }

  app.use((req, res) => {
    // 前端是 SPA：非 /api 的 GET 请求一律回 index.html，交给前端路由
    if (hasWeb && req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
      return;
    }
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  app.use(errorHandler);
  return app;
}
