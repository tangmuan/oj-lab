import path from 'path';
import { LanguageId } from '../types';

export interface CommandSpec {
  cmd: string;
  args: string[];
}

export interface LanguageSpec {
  id: LanguageId;
  label: string;
  /** 源码文件名（Java 需跟随 public class 名） */
  sourceFile: (code: string) => string;
  /** 编译命令，返回 null 表示无需编译 */
  compile?: (dir: string, file: string, memMb: number) => CommandSpec | null;
  /** 运行命令 */
  run: (dir: string, file: string, memMb: number) => CommandSpec;
  /** 是否需要在正式测试点前空跑一次预热（默认 true，纯解释型语言可关掉） */
  warmup?: boolean;
  /**
   * Docker 执行器用的容器内命令：工作目录挂载在 /box，file 是其中的相对路径。
   * 宿主绝对路径在容器里不可用，所以需要单独一份；缺省表示该语言暂不支持 Docker 执行器。
   */
  containerCompile?: (file: string, memMb: number) => CommandSpec | null;
  containerRun?: (file: string, memMb: number) => CommandSpec;
}

const EXE = process.platform === 'win32' ? 'main.exe' : 'main';

/**
 * 万能头 shim 目录：本机 MinGW 8.1 的 <bits/stdc++.h> 会带进残缺的 <filesystem>，
 * C++17 下直接编译失败，这里用 -I 优先命中 server/judge-include/bits/stdc++.h。
 * 路径从 __dirname 反推，src(tsx) 与 dist(tsc) 两种运行方式都能命中 server 根目录。
 */
const INCLUDE_DIR = path.resolve(__dirname, '..', '..', 'judge-include');

/** 提取 Java 主类名，缺省 Main */
export function javaClassName(code: string): string {
  const pub = code.match(/public\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
  if (pub) return pub[1];
  const any = code.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
  return any ? any[1] : 'Main';
}

export const LANGUAGES: Record<LanguageId, LanguageSpec> = {
  python: {
    id: 'python',
    label: 'Python 3',
    sourceFile: () => 'main.py',
    // 用 py_compile 做语法检查，把语法错误准确判为 CE
    compile: () => ({ cmd: 'python', args: ['-m', 'py_compile', 'main.py'] }),
    run: (_dir, file) => ({ cmd: 'python', args: ['-X', 'utf8', file] }),
    containerCompile: () => ({ cmd: 'python', args: ['-m', 'py_compile', 'main.py'] }),
    containerRun: () => ({ cmd: 'python', args: ['-X', 'utf8', 'main.py'] }),
    warmup: false,
  },
  node: {
    id: 'node',
    label: 'Node.js',
    sourceFile: () => 'main.js',
    compile: (_dir, file) => ({ cmd: 'node', args: ['--check', file] }),
    run: (_dir, file, memMb) => ({ cmd: 'node', args: [`--max-old-space-size=${Math.max(32, memMb)}`, file] }),
    containerCompile: () => ({ cmd: 'node', args: ['--check', 'main.js'] }),
    containerRun: (_file, memMb) => ({
      cmd: 'node',
      args: [`--max-old-space-size=${Math.max(32, memMb)}`, 'main.js'],
    }),
    warmup: false,
  },
  c: {
    id: 'c',
    label: 'C (gcc)',
    sourceFile: () => 'main.c',
    compile: () => ({ cmd: 'gcc', args: ['-O2', '-std=c17', '-o', EXE, 'main.c', '-lm'] }),
    run: (dir) => ({ cmd: path.join(dir, EXE), args: [] }),
    // 容器固定是 Linux，可执行文件名不带 .exe
    containerCompile: () => ({ cmd: 'gcc', args: ['-O2', '-std=c17', '-o', 'main', 'main.c', '-lm'] }),
    containerRun: () => ({ cmd: './main', args: [] }),
  },
  cpp: {
    id: 'cpp',
    label: 'C++ (g++)',
    sourceFile: () => 'main.cpp',
    compile: () => ({
      cmd: 'g++',
      // MinGW 8.1 需要 shim 头；Linux 上 gcc 自带的 bits/stdc++.h 正常，不注入 -I
      args: ['-O2', '-std=c++17', ...(process.platform === 'win32' ? ['-I', INCLUDE_DIR] : []), '-o', EXE, 'main.cpp'],
    }),
    run: (dir) => ({ cmd: path.join(dir, EXE), args: [] }),
    // 容器镜像是 Linux 工具链，不需要 Windows 的万能头 shim
    containerCompile: () => ({ cmd: 'g++', args: ['-O2', '-std=c++17', '-o', 'main', 'main.cpp'] }),
    containerRun: () => ({ cmd: './main', args: [] }),
  },
  java: {
    id: 'java',
    label: 'Java 17',
    sourceFile: (code) => `${javaClassName(code)}.java`,
    compile: (_dir, file) => ({ cmd: 'javac', args: ['-encoding', 'UTF-8', '-d', '.', file] }),
    run: (dir, file, memMb) => ({
      cmd: 'java',
      args: [
        `-Xmx${Math.max(32, memMb)}m`,
        '-Xss64m',
        '-XX:+UseSerialGC',
        '-Dfile.encoding=UTF-8',
        '-cp',
        dir,
        path.basename(file, '.java'),
      ],
    }),
    containerCompile: (file) => ({ cmd: 'javac', args: ['-encoding', 'UTF-8', '-d', '.', file] }),
    containerRun: (file, memMb) => ({
      cmd: 'java',
      args: [
        `-Xmx${Math.max(32, memMb)}m`,
        '-Xss64m',
        '-XX:+UseSerialGC',
        '-Dfile.encoding=UTF-8',
        '-cp',
        '.',
        path.basename(file, '.java'),
      ],
    }),
  },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

export function isLanguageId(v: unknown): v is LanguageId {
  // 不能用 `v in LANGUAGES`：原型链上的 toString/constructor 也会命中，
  // 校验通过后在 LANGUAGES[...] 取值为 undefined，直接 500
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, v);
}
