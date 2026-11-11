import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { isLanguageId } from '../judge/languages';
import { requireAuth } from '../middleware/auth';
import { ah, badRequest, notFound } from '../utils/errors';

export const templatesRouter = Router();

templatesRouter.use(requireAuth);

const languageParam = z.string().refine(isLanguageId, '不支持的语言');
const contentSchema = z.object({
  content: z.string().max(131072, '模板不能超过 128KB'),
});

templatesRouter.get(
  '/',
  ah(async (req, res) => {
    const items = db
      .prepare('SELECT language, content, updated_at FROM user_templates WHERE user_id = ? ORDER BY language ASC')
      .all(req.user!.id);
    res.json({ items });
  })
);

templatesRouter.get(
  '/:language',
  ah(async (req, res) => {
    const language = languageParam.parse(req.params.language);
    const row = db
      .prepare('SELECT language, content, updated_at FROM user_templates WHERE user_id = ? AND language = ?')
      .get(req.user!.id, language);
    res.json({ template: row ?? null });
  })
);

templatesRouter.put(
  '/:language',
  ah(async (req, res) => {
    const parsed = languageParam.safeParse(req.params.language);
    if (!parsed.success) throw badRequest('不支持的语言');
    const language = parsed.data;
    const { content } = contentSchema.parse(req.body);

    db.prepare(
      `INSERT INTO user_templates (user_id, language, content) VALUES (?,?,?)
       ON CONFLICT(user_id, language) DO UPDATE SET content = excluded.content, updated_at = datetime('now')`
    ).run(req.user!.id, language, content);

    const row = db
      .prepare('SELECT language, content, updated_at FROM user_templates WHERE user_id = ? AND language = ?')
      .get(req.user!.id, language);
    res.json({ template: row });
  })
);

templatesRouter.delete(
  '/:language',
  ah(async (req, res) => {
    const parsed = languageParam.safeParse(req.params.language);
    if (!parsed.success) throw badRequest('不支持的语言');

    const info = db.prepare('DELETE FROM user_templates WHERE user_id = ? AND language = ?').run(req.user!.id, parsed.data);
    if (info.changes === 0) throw notFound('没有该语言的自定义模板');
    res.json({ ok: true });
  })
);
