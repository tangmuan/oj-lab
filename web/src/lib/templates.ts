import type { LanguageId } from '../api/types';

/** 各语言的初始模板 */
export const TEMPLATES: Record<LanguageId, string> = {
  python: '# 从标准输入读取数据，把答案打印到标准输出\n# n = int(input())\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  c: '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n    }\n}\n',
  node: "const fs = require('fs');\nconst input = fs.readFileSync(0, 'utf8').trim();\n\n",
};

/** 新建文件时的默认文件名后缀 */
export const LANGUAGE_EXT: Record<LanguageId, string> = {
  python: 'py',
  cpp: 'cpp',
  c: 'c',
  java: 'java',
  node: 'js',
};

export const LANGUAGE_LABEL: Record<LanguageId, string> = {
  python: 'Python 3',
  cpp: 'C++',
  c: 'C',
  java: 'Java',
  node: 'Node.js',
};
