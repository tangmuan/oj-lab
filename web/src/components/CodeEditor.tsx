import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import type { LanguageId } from '../api/types';
import { useTheme } from '../context/ThemeContext';

function extensionFor(language: LanguageId) {
  switch (language) {
    case 'python':
      return [python()];
    case 'java':
      return [java()];
    case 'node':
      return [javascript()];
    case 'c':
    case 'cpp':
    default:
      return [cpp()];
  }
}

interface Props {
  value: string;
  language: LanguageId;
  onChange?: (value: string) => void;
  height?: string;
  readOnly?: boolean;
}

export function CodeEditor({ value, language, onChange, height = '420px', readOnly = false }: Props) {
  const { theme } = useTheme();

  return (
    // 外层给确定高度，内层 .cm-editor 通过全局 CSS 的 height:100% 撑满
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700" style={{ height }}>
      <CodeMirror
        value={value}
        height="100%"
        theme={theme}
        readOnly={readOnly}
        extensions={extensionFor(language)}
        onChange={(v) => onChange?.(v)}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: true,
          tabSize: 4,
          autocompletion: true,
          bracketMatching: true,
        }}
      />
    </div>
  );
}
