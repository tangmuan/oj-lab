import { config } from '../config';
import { dockerExecutor } from './docker-executor';
import { JudgeExecutor } from './executor';
import { localExecutor } from './local-executor';

/**
 * 按配置返回执行器。单独一个小文件而不是塞进 executor.ts，
 * 避免「接口/公共层 → 实现 → 接口/公共层」的循环依赖。
 */
export function getExecutor(): JudgeExecutor {
  return config.judgeExecutor === 'docker' ? dockerExecutor : localExecutor;
}
