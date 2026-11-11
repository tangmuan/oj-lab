import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { isLanguageId } from '../judge/languages';
import { requireAuth } from '../middleware/auth';
import { UserFileRow } from '../types';
import { ah, AppError, notFound } from '../utils/errors';

export const filesRouter = Router();

filesRouter.use(requireAuth);

/** 单个用户最多保留的文件数，防止无限建文件把库撑爆 */
const MAX_FILES_PER_USER = 200;
const MAX_CONTENT_CHARS = 131072; // 128KB

const languageField = z.string().refine(isLanguageId, '不支持的语言');

const createSchema = z.object({
  title: z.string().trim().min(1, '文件名不能为空').max(60, '文件名最多 60 个字符').optional(),
  language: languageField,
  content: z.string().max(MAX_CONTENT_CHARS, '内容不能超过 128KB').default(''),
  last_input: z.string().max(65536, '自测输入不能超过 64KB').default(''),
  problem_id: z.coerce.number().int().positive().nullish(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1, '文件名不能为空').max(60, '文件名最多 60 个字符').optional(),
  language: languageField.optional(),
  content: z.string().max(MAX_CONTENT_CHARS, '内容不能超过 128KB').optional(),
  last_input: z.string().max(65536, '自测输入不能超过 64KB').optional(),
  problem_id: z.coerce.number().int().positive().nullish(),
});

function loadOwned(id: number, userId: number): UserFileRow {
  const row = db.prepare('SELECT * FROM user_files WHERE id = ? AND user_id = ?').get(id, userId) as UserFileRow | undefined;
  if (!row) throw notFound('文件不存在');
  return row;
}

/** 列表不返回 content，避免首屏拉几百 KB */
filesRouter.get(
  '/',
  ah(async (req, res) => {
    const items = db
      .prepare(
        `SELECT id, title, language, problem_id, created_at, updated_at,
                length(content) AS char_count, length(last_input) AS input_len
         FROM user_files WHERE user_id = ? ORDER BY updated_at DESC, id DESC`
      )
      .all(req.user!.id);
    res.json({ items, limit: MAX_FILES_PER_USER });
  })
);

filesRouter.post(
  '/',
  ah(async (req, res) => {
    const data = createSchema.parse(req.body);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM user_files WHERE user_id = ?').get(req.user!.id) as { c: number }).c;
    if (count >= MAX_FILES_PER_USER) {
      throw new AppError(`草稿箱最多存 ${MAX_FILES_PER_USER} 个文件，请先删除不用的`, 400, 'FILE_LIMIT');
    }

    const title = data.title ?? '未命名文件';
    const info = db
      .prepare('INSERT INTO user_files (user_id, title, language, content, last_input, problem_id) VALUES (?,?,?,?,?,?)')
      .run(req.user!.id, title, data.language, data.content, data.last_input, data.problem_id ?? null);

    const file = loadOwned(Number(info.lastInsertRowid), req.user!.id);
    res.status(201).json({ file });
  })
);

filesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const file = loadOwned(Number(req.params.id), req.user!.id);
    res.json({ file });
  })
);

filesRouter.put(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadOwned(id, req.user!.id);
    const data = updateSchema.parse(req.body);
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw notFound('没有需要更新的字段');

    const setSql = entries.map(([k]) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE user_files SET ${setSql}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(
      ...entries.map(([, v]) => (v ?? null) as never),
      id,
      req.user!.id
    );

    res.json({ file: loadOwned(id, req.user!.id) });
  })
);

filesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const info = db.prepare('DELETE FROM user_files WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id);
    if (info.changes === 0) throw notFound('文件不存在');
    res.json({ ok: true });
  })
);
